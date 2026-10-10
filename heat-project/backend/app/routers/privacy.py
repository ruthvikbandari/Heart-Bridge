from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.deps import get_current_user
from app.models import JournalEntry, NextStep, PrepKit, User
from app.services.accounts import export_user
from app.services.common import audit, clean_text, consent_payload, iso, set_consents

router = APIRouter(tags=["privacy"])


class ConsentPatch(BaseModel):
    consents: dict[str, bool]


class PrepIn(BaseModel):
    concerns: str = Field(default="", max_length=4000)
    questions: str = Field(default="", max_length=4000)
    timeline: str = Field(default="", max_length=4000)


class JournalIn(BaseModel):
    body: str


class NextStepIn(BaseModel):
    action: str = Field(default="", max_length=500)
    clinician_question: str = Field(default="", max_length=500)
    resource: str = Field(default="", max_length=500)


def step_payload(row: NextStep) -> dict:
    return {
        "id": row.id,
        "conversation_id": row.conversation_id,
        "action": row.action,
        "clinician_question": row.clinician_question,
        "resource": row.resource,
        "created_at": iso(row.created_at),
        "label": "Only you can see this. It is not a medical record.",
    }


@router.get("/privacy/consents")
def read_consents(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return consent_payload(db, user.id)


@router.patch("/privacy/consents")
def update_consents(body: ConsentPatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    set_consents(db, user.id, body.consents)
    audit(db, user.id, "consents_updated", "user", user.id)
    db.commit()
    return consent_payload(db, user.id)


@router.post("/privacy/export-request")
def export_request(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return export_user(db, user)


@router.get("/journal")
def list_journal(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(JournalEntry).where(JournalEntry.user_id == user.id).order_by(JournalEntry.created_at.desc())
    ).all()
    return {
        "items": [{"id": row.id, "body": row.body, "created_at": iso(row.created_at)} for row in rows],
        "note": "Journal entries stay private. They are not sent to the assistant unless you paste them into a chat.",
    }


@router.post("/journal")
def create_journal(body: JournalIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = JournalEntry(user_id=user.id, body=clean_text(body.body, 4000), created_at=utcnow())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "body": row.body, "created_at": iso(row.created_at)}


@router.delete("/journal/{entry_id}")
def delete_journal(entry_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(JournalEntry, entry_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="That entry is unavailable.")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.get("/prep")
def read_prep(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(PrepKit, user.id)
    if row is None:
        row = PrepKit(user_id=user.id, concerns="", questions="", timeline="", updated_at=utcnow())
        db.add(row)
        db.commit()
        db.refresh(row)
    return {
        "concerns": row.concerns,
        "questions": row.questions,
        "timeline": row.timeline,
        "updated_at": iso(row.updated_at),
        "label": "Your notes for a clinician. Nothing here is shared until you decide to share it yourself.",
    }


@router.put("/prep")
def update_prep(body: PrepIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(PrepKit, user.id)
    if row is None:
        row = PrepKit(user_id=user.id)
        db.add(row)
    row.concerns = body.concerns.strip()
    row.questions = body.questions.strip()
    row.timeline = body.timeline.strip()
    row.updated_at = utcnow()
    db.commit()
    return {
        "concerns": row.concerns,
        "questions": row.questions,
        "timeline": row.timeline,
        "updated_at": iso(row.updated_at),
        "label": "Saved only to your account.",
    }


@router.get("/next-steps")
def list_steps(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(NextStep).where(NextStep.user_id == user.id).order_by(NextStep.created_at.desc())).all()
    return {"items": [step_payload(row) for row in rows]}


@router.patch("/next-steps/{step_id}")
def update_step(step_id: int, body: NextStepIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(NextStep, step_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="That plan is unavailable.")
    row.action = body.action.strip()
    row.clinician_question = body.clinician_question.strip()
    row.resource = body.resource.strip()
    db.commit()
    return step_payload(row)


@router.delete("/next-steps/{step_id}")
def delete_step(step_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(NextStep, step_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="That plan is unavailable.")
    db.delete(row)
    db.commit()
    return {"ok": True}
