from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.deps import get_current_user
from app.models import Appointment, AppointmentEvent, AvailabilitySlot, Doctor, User
from app.services.booking import appointment_visible, book_slot, serialize_appointment, serialize_doctor, serialize_slot
from app.services.common import audit, notify

router = APIRouter(tags=["care"])


class BookIn(BaseModel):
    slot_id: int
    notes: str = Field(default="", max_length=1000)


class StatusIn(BaseModel):
    status: str


def _like(value: str) -> str:
    cleaned = value.replace("%", "").replace("_", "").strip()[:80]
    return f"%{cleaned}%"


@router.get("/doctors")
def list_doctors(
    specialty: str | None = None,
    area: str | None = None,
    language: str | None = None,
    mode: str | None = None,
    accessibility: str | None = None,
    availability: str | None = None,
    q: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Doctor)
    if specialty:
        stmt = stmt.where(Doctor.specialty.ilike(_like(specialty)))
    if area:
        stmt = stmt.where(Doctor.area.ilike(_like(area)))
    if language:
        stmt = stmt.where(Doctor.languages.ilike(_like(language)))
    if mode:
        stmt = stmt.where(Doctor.modes.ilike(_like(mode)))
    if accessibility:
        stmt = stmt.where(Doctor.accessibility.ilike(_like(accessibility)))
    if q:
        stmt = stmt.where(Doctor.name.ilike(_like(q)) | Doctor.specialty.ilike(_like(q)) | Doctor.clinic.ilike(_like(q)))
    rows = db.scalars(stmt.order_by(Doctor.name)).all()
    items = []
    for doctor in rows:
        open_count = db.scalar(
            select(func.count())
            .select_from(AvailabilitySlot)
            .where(AvailabilitySlot.doctor_id == doctor.id, AvailabilitySlot.status == "open")
        )
        if availability == "open" and not open_count:
            continue
        items.append(serialize_doctor(doctor, int(open_count or 0)))
    return {
        "items": items,
        "note": "Sample profiles are fictional. Filters use only the fields stored on each profile.",
        "viewer": user.id,
    }


@router.get("/doctors/{doctor_id}")
def read_doctor(doctor_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="That profile is unavailable.")
    open_count = db.scalar(
        select(func.count())
        .select_from(AvailabilitySlot)
        .where(AvailabilitySlot.doctor_id == doctor.id, AvailabilitySlot.status == "open")
    )
    payload = serialize_doctor(doctor, int(open_count or 0))
    payload["viewer"] = user.id
    return payload


@router.get("/doctors/{doctor_id}/slots")
def list_slots(doctor_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doctor = db.get(Doctor, doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="That profile is unavailable.")
    rows = db.scalars(
        select(AvailabilitySlot)
        .where(AvailabilitySlot.doctor_id == doctor.id)
        .order_by(AvailabilitySlot.starts_at)
    ).all()
    return {
        "items": [serialize_slot(slot) for slot in rows],
        "demo": doctor.is_demo,
        "note": "Demo slots are simulated. They are not a live clinic calendar.",
        "viewer": user.id,
    }


@router.post("/appointments")
def create_appointment(body: BookIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    appointment = book_slot(db, user.id, body.slot_id, body.notes)
    audit(db, user.id, "appointment_booked", "appointment", appointment.id)
    db.commit()
    return serialize_appointment(db, appointment)


@router.get("/appointments")
def list_appointments(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Appointment)
    if user.role == "admin":
        pass
    elif user.role == "clinician":
        doctor_ids = select(Doctor.id).where(Doctor.user_id == user.id)
        stmt = stmt.where(Appointment.doctor_id.in_(doctor_ids))
    else:
        stmt = stmt.where(Appointment.patient_id == user.id)
    rows = db.scalars(stmt.order_by(Appointment.created_at.desc())).all()
    return {"items": [serialize_appointment(db, row) for row in rows]}


@router.get("/appointments/{appointment_id}")
def read_appointment(appointment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if appointment is None or not appointment_visible(db, appointment, user.id, user.role):
        raise HTTPException(status_code=404, detail="That appointment is unavailable.")
    return serialize_appointment(db, appointment)


@router.patch("/appointments/{appointment_id}/cancel")
def cancel_appointment(appointment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    appointment = db.get(Appointment, appointment_id)
    if appointment is None or not appointment_visible(db, appointment, user.id, user.role):
        raise HTTPException(status_code=404, detail="That appointment is unavailable.")
    if user.role != "admin" and appointment.patient_id != user.id:
        raise HTTPException(status_code=403, detail="Only the person who booked can cancel.")
    if appointment.status == "cancelled":
        raise HTTPException(status_code=400, detail="This appointment is already cancelled.")
    previous = appointment.status
    appointment.status = "cancelled"
    appointment.updated_at = utcnow()
    slot = db.get(AvailabilitySlot, appointment.slot_id)
    if slot is not None:
        slot.status = "open"
    db.add(
        AppointmentEvent(
            appointment_id=appointment.id,
            actor_id=user.id,
            from_status=previous,
            to_status="cancelled",
            created_at=utcnow(),
        )
    )
    notify(
        db,
        appointment.patient_id,
        "appointment_cancelled",
        "Appointment cancelled",
        "The demo slot was released. Notes are not included in this alert.",
        f"/appointments/{appointment.id}",
    )
    doctor = db.get(Doctor, appointment.doctor_id)
    if doctor and doctor.user_id and doctor.user_id != user.id:
        notify(
            db,
            doctor.user_id,
            "appointment_cancelled",
            "Appointment cancelled",
            "A demo booking on your sample profile was cancelled.",
            f"/appointments/{appointment.id}",
        )
    audit(db, user.id, "appointment_cancelled", "appointment", appointment.id)
    db.commit()
    return serialize_appointment(db, appointment)


@router.patch("/appointments/{appointment_id}/status")
def update_status(
    appointment_id: int,
    body: StatusIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.status not in {"completed", "no_show", "confirmed"}:
        raise HTTPException(status_code=400, detail="Choose a valid status.")
    appointment = db.get(Appointment, appointment_id)
    if appointment is None or not appointment_visible(db, appointment, user.id, user.role):
        raise HTTPException(status_code=404, detail="That appointment is unavailable.")
    doctor = db.get(Doctor, appointment.doctor_id)
    clinician = doctor is not None and doctor.user_id == user.id
    if user.role != "admin" and not clinician:
        raise HTTPException(status_code=403, detail="Only the sample clinician or an admin can change this status.")
    if appointment.status == "cancelled":
        raise HTTPException(status_code=400, detail="Cancelled appointments stay cancelled. Book a new slot instead.")
    previous = appointment.status
    appointment.status = body.status
    appointment.updated_at = utcnow()
    db.add(
        AppointmentEvent(
            appointment_id=appointment.id,
            actor_id=user.id,
            from_status=previous,
            to_status=body.status,
            created_at=utcnow(),
        )
    )
    notify(
        db,
        appointment.patient_id,
        "appointment_status",
        "Appointment updated",
        f"Status is now {body.status.replace('_', ' ')}. Clinical notes are not included in this alert.",
        f"/appointments/{appointment.id}",
    )
    db.commit()
    return serialize_appointment(db, appointment)
