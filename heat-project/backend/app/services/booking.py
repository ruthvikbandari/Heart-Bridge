from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.database import utcnow
from app.models import Appointment, AppointmentEvent, AvailabilitySlot, Doctor
from app.services.common import iso, notify


def book_slot(db: Session, patient_id: int, slot_id: int, notes: str) -> Appointment:
    slot = db.get(AvailabilitySlot, slot_id)
    if slot is None or slot.status != "open":
        raise HTTPException(status_code=409, detail="That time is no longer available.")
    doctor = db.get(Doctor, slot.doctor_id)
    if doctor is None:
        raise HTTPException(status_code=404, detail="That clinician profile is unavailable.")
    try:
        result = db.execute(
            update(AvailabilitySlot)
            .where(AvailabilitySlot.id == slot_id, AvailabilitySlot.status == "open")
            .values(status="booked")
        )
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(status_code=409, detail="That time was just reserved.")
        appointment = Appointment(
            patient_id=patient_id,
            doctor_id=doctor.id,
            slot_id=slot.id,
            status="confirmed",
            notes=notes.strip(),
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(appointment)
        db.flush()
        db.add(
            AppointmentEvent(
                appointment_id=appointment.id,
                actor_id=patient_id,
                from_status="requested",
                to_status="confirmed",
                created_at=utcnow(),
            )
        )
        notify(
            db,
            patient_id,
            "appointment_confirmed",
            "Appointment confirmed",
            "A demo appointment was saved. Open it for the time and provider. Your notes stay on the appointment, not in this alert.",
            f"/appointments/{appointment.id}",
        )
        if doctor.user_id and doctor.user_id != patient_id:
            notify(
                db,
                doctor.user_id,
                "appointment_confirmed",
                "New appointment",
                "A demo booking was confirmed on your sample profile. Open Appointments for the time. Patient notes are not included here.",
                f"/appointments/{appointment.id}",
            )
        db.commit()
        db.refresh(appointment)
        return appointment
    except HTTPException:
        raise
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="That time is no longer available.") from exc


def serialize_slot(slot: AvailabilitySlot) -> dict:
    return {
        "id": slot.id,
        "doctor_id": slot.doctor_id,
        "starts_at": iso(slot.starts_at),
        "ends_at": iso(slot.ends_at),
        "status": slot.status,
        "is_demo": slot.is_demo,
    }


def serialize_doctor(doctor: Doctor, open_slots: int | None = None) -> dict:
    return {
        "id": doctor.id,
        "name": doctor.name,
        "qualifications": doctor.qualifications,
        "specialty": doctor.specialty,
        "clinic": doctor.clinic,
        "area": doctor.area,
        "languages": [part.strip() for part in doctor.languages.split(",") if part.strip()],
        "modes": [part.strip() for part in doctor.modes.split(",") if part.strip()],
        "fee_inr": doctor.fee_inr if doctor.fee_confirmed else None,
        "fee_confirmed": doctor.fee_confirmed,
        "verification_status": doctor.verification_status,
        "is_demo": doctor.is_demo,
        "bio": doctor.bio,
        "accessibility": doctor.accessibility,
        "open_slots": open_slots,
        "why": "Shown because the profile matches the filters you set. Sample profiles are fictional.",
    }


def appointment_visible(db: Session, appointment: Appointment, user_id: int, role: str) -> bool:
    if role == "admin" or appointment.patient_id == user_id:
        return True
    doctor = db.get(Doctor, appointment.doctor_id)
    return bool(doctor and doctor.user_id == user_id)


def serialize_appointment(db: Session, appointment: Appointment) -> dict:
    doctor = db.get(Doctor, appointment.doctor_id)
    slot = db.get(AvailabilitySlot, appointment.slot_id)
    events = db.scalars(
        select(AppointmentEvent)
        .where(AppointmentEvent.appointment_id == appointment.id)
        .order_by(AppointmentEvent.created_at.asc())
    ).all()
    return {
        "id": appointment.id,
        "status": appointment.status,
        "notes": appointment.notes,
        "created_at": iso(appointment.created_at),
        "updated_at": iso(appointment.updated_at),
        "patient_id": appointment.patient_id,
        "doctor": serialize_doctor(doctor) if doctor else None,
        "slot": serialize_slot(slot) if slot else None,
        "demo": bool(slot and slot.is_demo),
        "events": [
            {
                "from_status": event.from_status,
                "to_status": event.to_status,
                "created_at": iso(event.created_at),
            }
            for event in events
        ],
    }

