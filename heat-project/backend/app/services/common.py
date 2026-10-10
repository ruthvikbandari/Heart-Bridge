from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.constants import CONSENT_COPY, DEFAULT_CONSENTS
from app.database import utcnow
from app.models import (
    AuditEvent,
    Block,
    Consent,
    Membership,
    Notification,
    Profile,
    User,
    UserInterest,
)
from app.services.realtime import push


def clean_text(value: str, limit: int) -> str:
    text = value.replace("\x00", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Please write something first.")
    if len(text) > limit:
        raise HTTPException(status_code=400, detail=f"Please keep this under {limit} characters.")
    return text


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def consent_map(db: Session, user_id: int) -> dict[str, bool]:
    current = dict(DEFAULT_CONSENTS)
    rows = db.scalars(select(Consent).where(Consent.user_id == user_id)).all()
    for row in rows:
        if row.preference_key in current:
            current[row.preference_key] = row.enabled
    return current


def set_consents(db: Session, user_id: int, updates: dict[str, bool]) -> dict[str, bool]:
    for key, enabled in updates.items():
        if key not in DEFAULT_CONSENTS:
            continue
        row = db.scalars(
            select(Consent).where(Consent.user_id == user_id, Consent.preference_key == key)
        ).first()
        if row is None:
            db.add(Consent(user_id=user_id, preference_key=key, enabled=enabled, updated_at=utcnow()))
        else:
            row.enabled = enabled
            row.updated_at = utcnow()
    db.flush()
    return consent_map(db, user_id)


def interests_for(db: Session, user_id: int) -> list[str]:
    rows = db.scalars(select(UserInterest.topic).where(UserInterest.user_id == user_id)).all()
    return list(rows)


def replace_interests(db: Session, user_id: int, topics: list[str]) -> None:
    existing = db.scalars(select(UserInterest).where(UserInterest.user_id == user_id)).all()
    for row in existing:
        db.delete(row)
    db.flush()
    for topic in topics:
        db.add(UserInterest(user_id=user_id, topic=topic))


def display_name(db: Session, user: User | None) -> str:
    if user is None or user.status != "active":
        return "Deleted member"
    profile = db.get(Profile, user.id)
    if profile and profile.display_name:
        return profile.display_name
    return "Member"


def profile_payload(db: Session, user: User) -> dict:
    profile = db.get(Profile, user.id)
    return {
        "display_name": profile.display_name if profile else "Member",
        "bio": profile.bio if profile else "",
        "language": profile.language if profile else "en",
        "avatar_color": profile.avatar_color if profile else "#0f6e68",
    }


def user_payload(db: Session, user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "onboarded": user.onboarded,
        "profile": profile_payload(db, user),
        "interests": interests_for(db, user.id),
        "consents": consent_map(db, user.id),
    }


def consent_payload(db: Session, user_id: int) -> dict:
    values = consent_map(db, user_id)
    items = []
    for key, copy in CONSENT_COPY.items():
        items.append(
            {
                "key": key,
                "title": copy["title"],
                "description": copy["description"],
                "enabled": values[key],
            }
        )
    return {"items": items}


def blocked_ids(db: Session, user_id: int) -> set[int]:
    rows = db.scalars(
        select(Block).where(or_(Block.blocker_id == user_id, Block.blocked_id == user_id))
    ).all()
    found: set[int] = set()
    for row in rows:
        found.add(row.blocked_id if row.blocker_id == user_id else row.blocker_id)
    return found


def is_blocked(db: Session, left: int, right: int) -> bool:
    return right in blocked_ids(db, left)


def member_community_ids(db: Session, user_id: int) -> set[int]:
    rows = db.scalars(
        select(Membership.community_id).where(
            Membership.user_id == user_id,
            Membership.status == "member",
        )
    ).all()
    return set(rows)


def audit(db: Session, actor_id: int | None, action: str, target_type: str, target_id: int | None = None) -> None:
    db.add(
        AuditEvent(
            actor_id=actor_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            created_at=utcnow(),
        )
    )


def notify(
    db: Session,
    recipient_id: int,
    event_type: str,
    title: str,
    body: str,
    link: str,
) -> None:
    row = Notification(
        recipient_id=recipient_id,
        event_type=event_type,
        title=title,
        body=body,
        link=link,
        created_at=utcnow(),
    )
    db.add(row)
    db.flush()
    push(recipient_id, {"type": "notification", "id": row.id, "title": title, "link": link})
