import os
import tempfile
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import BACKEND_DIR, get_settings
from app.constants import CONSENT_COPY, LANGUAGES, REACTIONS, REPORT_REASONS, TOPICS
from app.database import get_db
from app.deps import get_current_user
from app.models import Notification, User
from app.services.common import iso

router = APIRouter(tags=["system"])


def upload_root() -> Path:
    settings = get_settings()
    path = Path(settings.upload_dir)
    if not path.is_absolute():
        if os.environ.get("VERCEL") == "1":
            path = Path(tempfile.gettempdir()) / path
        else:
            path = BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def sniff_image(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    return None


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    settings = get_settings()
    return {
        "ok": True,
        "database": True,
        "ai_mode": "live" if settings.ai_live else "demo",
        "demo_banner": settings.demo_banner,
    }


@router.get("/meta")
def meta():
    settings = get_settings()
    return {
        "name": "HeartBridge",
        "demo_banner": settings.demo_banner,
        "ai_mode": "live" if settings.ai_live else "demo",
        "topics": TOPICS,
        "reactions": [{"id": key, "label": label} for key, label in REACTIONS.items()],
        "languages": [
            {"id": "en", "label": "English"},
            {"id": "hi", "label": "Hindi — preference saved, interface stays in English"},
            {"id": "te", "label": "Telugu — preference saved, interface stays in English"},
        ],
        "report_reasons": REPORT_REASONS,
        "consents": [
            {"key": key, "title": value["title"], "description": value["description"]}
            for key, value in CONSENT_COPY.items()
        ],
        "language_codes": LANGUAGES,
    }


@router.post("/uploads")
async def upload(file: UploadFile = File(...), user: User = Depends(get_current_user)):
    data = await file.read()
    if len(data) > 2_000_000:
        raise HTTPException(status_code=400, detail="Images must be 2 MB or smaller.")
    extension = sniff_image(data)
    if extension is None:
        raise HTTPException(status_code=400, detail="Use a JPEG, PNG, or WebP image.")
    name = f"{uuid.uuid4().hex}.{extension}"
    (upload_root() / name).write_bytes(data)
    return {"url": f"/uploads/{name}", "owner_id": user.id}


@router.get("/notifications")
def list_notifications(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Notification).where(Notification.recipient_id == user.id).order_by(Notification.created_at.desc()).limit(50)
    ).all()
    return {
        "items": [
            {
                "id": row.id,
                "event_type": row.event_type,
                "title": row.title,
                "body": row.body,
                "link": row.link,
                "read": row.read,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ]
    }


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Notification, notification_id)
    if row is None or row.recipient_id != user.id:
        raise HTTPException(status_code=404, detail="That notification is unavailable.")
    row.read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.recipient_id == user.id, Notification.read.is_(False))).all()
    for row in rows:
        row.read = True
    db.commit()
    return {"ok": True}
