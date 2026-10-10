from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from fastapi import HTTPException

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.database import Base, SessionLocal, make_engine, utcnow
from app.models import Appointment, AvailabilitySlot, Doctor, User
from app.security import hash_password
from app.services.booking import book_slot


def _slot(db, patient_email="patient@example.com"):
    user = User(
        email=patient_email,
        password_hash=hash_password("Password1"),
        role="member",
        status="active",
        onboarded=True,
    )
    db.add(user)
    doctor = Doctor(
        name="Dr. Sample",
        qualifications="MBBS (sample)",
        specialty="Cardiology",
        clinic="Sample Clinic",
        area="Hyderabad",
        languages="English, Hindi",
        modes="video, clinic",
        fee_inr=800,
        fee_confirmed=True,
        verification_status="sample",
        is_demo=True,
        bio="Fictional",
        accessibility="Wheelchair accessible entrance",
    )
    db.add(doctor)
    db.flush()
    start = utcnow() + timedelta(days=2)
    slot = AvailabilitySlot(
        doctor_id=doctor.id,
        starts_at=start,
        ends_at=start + timedelta(minutes=30),
        status="open",
        is_demo=True,
    )
    db.add(slot)
    db.commit()
    return user, doctor, slot


def test_filters_and_double_booking(client):
    client.post("/api/auth/register", json={"email": "book@example.com", "password": "Password1", "display_name": "Booker"})
    db = SessionLocal()
    _user, doctor, slot = _slot(db)
    other = User(email="second@example.com", password_hash=hash_password("Password1"), role="member", status="active", onboarded=True)
    db.add(other)
    db.commit()
    slot_id = slot.id
    doctor_id = doctor.id
    db.close()

    listed = client.get("/api/doctors?specialty=cardio&language=Hindi&mode=video&area=Hyderabad&accessibility=wheelchair")
    assert listed.status_code == 200
    assert len(listed.json()["items"]) == 1
    assert listed.json()["items"][0]["is_demo"] is True
    assert listed.json()["items"][0]["verification_status"] == "sample"

    first = client.post("/api/appointments", json={"slot_id": slot_id, "notes": "Please keep this private"})
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "confirmed"
    appointment_id = first.json()["id"]

    other_client = client.__class__(client.app)
    other_client.post("/api/auth/register", json={"email": "second@example.com", "password": "Password1", "display_name": "Second"})
    # second email already exists from the direct insert, so register a third person
    third = client.__class__(client.app)
    third.post("/api/auth/register", json={"email": "third@example.com", "password": "Password1", "display_name": "Third"})
    conflict = third.post("/api/appointments", json={"slot_id": slot_id, "notes": "me too"})
    assert conflict.status_code == 409
    assert third.get(f"/api/appointments/{appointment_id}").status_code == 404
    assert client.get(f"/api/doctors/{doctor_id}/slots").json()["demo"] is True

    cancelled = client.patch(f"/api/appointments/{appointment_id}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    again = third.post("/api/appointments", json={"slot_id": slot_id, "notes": "after cancel"})
    assert again.status_code == 200


def test_concurrent_booking_allows_one_winner(tmp_path):
    engine = make_engine(f"sqlite:///{tmp_path}/race.db")
    Base.metadata.create_all(engine)
    Local = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    db = Local()
    users = []
    for index in (1, 2):
        user = User(
            email=f"racer{index}@example.com",
            password_hash=hash_password("Password1"),
            role="member",
            status="active",
            onboarded=True,
        )
        db.add(user)
        users.append(user)
    doctor = Doctor(
        name="Dr. Race",
        qualifications="sample",
        specialty="General practice",
        clinic="Sample",
        area="Online",
        languages="English",
        modes="video",
        verification_status="sample",
        is_demo=True,
        bio="Fictional",
        accessibility="",
    )
    db.add(doctor)
    db.flush()
    start = utcnow() + timedelta(days=3)
    slot = AvailabilitySlot(
        doctor_id=doctor.id,
        starts_at=start,
        ends_at=start + timedelta(minutes=20),
        status="open",
        is_demo=True,
    )
    db.add(slot)
    db.commit()
    slot_id = slot.id
    user_ids = [user.id for user in users]
    db.close()

    def attempt(user_id: int) -> int:
        session = Local()
        try:
            book_slot(session, user_id, slot_id, "race")
            return 201
        except HTTPException as exc:
            return exc.status_code
        finally:
            session.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, user_ids))
    assert sorted(results) == [201, 409]
    check = Local()
    stored = check.scalars(
        select(Appointment).where(Appointment.slot_id == slot_id, Appointment.status != "cancelled")
    ).all()
    assert len(stored) == 1
    check.close()
