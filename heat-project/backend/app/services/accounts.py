from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.constants import AVATAR_COLORS, DEFAULT_CONSENTS
from app.database import utcnow
from app.models import (
    AIConversation,
    AIMessage,
    Appointment,
    AppointmentEvent,
    AuditEvent,
    AvailabilitySlot,
    Block,
    Bookmark,
    Comment,
    CommunityEvent,
    Consent,
    Doctor,
    ExportRequest,
    Follow,
    JournalEntry,
    Membership,
    Message,
    NextStep,
    Notification,
    Participant,
    Post,
    PostTopic,
    PrepKit,
    Profile,
    Reaction,
    Report,
    User,
    UserInterest,
)
from app.security import hash_password
from app.services.common import audit, consent_map, interests_for, iso, profile_payload


def create_user(db: Session, email: str, password: str, display_name_value: str, role: str = "member") -> User:
    color = AVATAR_COLORS[sum(ord(char) for char in display_name_value) % len(AVATAR_COLORS)]
    user = User(email=email, password_hash=hash_password(password), role=role, status="active", onboarded=False)
    db.add(user)
    db.flush()
    db.add(Profile(user_id=user.id, display_name=display_name_value, bio="", language="en", avatar_color=color))
    for key, enabled in DEFAULT_CONSENTS.items():
        db.add(Consent(user_id=user.id, preference_key=key, enabled=enabled, updated_at=utcnow()))
    audit(db, user.id, "register", "user", user.id)
    db.commit()
    db.refresh(user)
    return user


def export_user(db: Session, user: User) -> dict:
    posts = db.scalars(select(Post).where(Post.author_id == user.id)).all()
    comments = db.scalars(select(Comment).where(Comment.author_id == user.id)).all()
    appointments = db.scalars(select(Appointment).where(Appointment.patient_id == user.id)).all()
    conversations = db.scalars(select(AIConversation).where(AIConversation.owner_id == user.id)).all()
    journal = db.scalars(select(JournalEntry).where(JournalEntry.user_id == user.id)).all()
    prep = db.get(PrepKit, user.id)
    sent = db.scalars(select(Message).where(Message.sender_id == user.id)).all()
    ai_payload = []
    for conversation in conversations:
        messages = db.scalars(
            select(AIMessage).where(AIMessage.conversation_id == conversation.id).order_by(AIMessage.id)
        ).all()
        ai_payload.append(
            {
                "title": conversation.title,
                "summary": conversation.summary,
                "messages": [{"role": item.role, "content": item.content} for item in messages],
            }
        )
    appointment_payload = []
    for appointment in appointments:
        doctor = db.get(Doctor, appointment.doctor_id)
        slot = db.get(AvailabilitySlot, appointment.slot_id)
        appointment_payload.append(
            {
                "status": appointment.status,
                "notes": appointment.notes,
                "doctor_name": doctor.name if doctor else None,
                "starts_at": iso(slot.starts_at) if slot else None,
            }
        )
    db.add(ExportRequest(user_id=user.id, status="completed", created_at=utcnow()))
    audit(db, user.id, "export_requested", "user", user.id)
    db.commit()
    return {
        "exported_at": iso(utcnow()),
        "note": "Generated immediately for this demo. It is not emailed. Other people's direct messages are not included.",
        "user": {"email": user.email, "role": user.role, "created_at": iso(user.created_at)},
        "profile": profile_payload(db, user),
        "interests": interests_for(db, user.id),
        "consents": consent_map(db, user.id),
        "posts": [{"body": post.body, "visibility": post.visibility, "created_at": iso(post.created_at)} for post in posts],
        "comments": [{"body": comment.body, "created_at": iso(comment.created_at)} for comment in comments],
        "appointments": appointment_payload,
        "ai_conversations": ai_payload,
        "journal": [{"body": entry.body, "created_at": iso(entry.created_at)} for entry in journal],
        "prep": None
        if prep is None
        else {"concerns": prep.concerns, "questions": prep.questions, "timeline": prep.timeline},
        "messages_sent": [{"body": item.body, "created_at": iso(item.created_at)} for item in sent],
    }


def delete_account(db: Session, user: User) -> None:
    uid = user.id
    db.execute(update(Message).where(Message.sender_id == uid).values(body="[message removed]", sender_id=None))
    appointments = db.scalars(select(Appointment).where(Appointment.patient_id == uid)).all()
    for appointment in appointments:
        slot = db.get(AvailabilitySlot, appointment.slot_id)
        if slot is not None and appointment.status != "cancelled":
            slot.status = "open"
        db.execute(delete(AppointmentEvent).where(AppointmentEvent.appointment_id == appointment.id))
        db.delete(appointment)
    conversation_ids = list(db.scalars(select(AIConversation.id).where(AIConversation.owner_id == uid)).all())
    if conversation_ids:
        db.execute(delete(AIMessage).where(AIMessage.conversation_id.in_(conversation_ids)))
        db.execute(delete(NextStep).where(NextStep.conversation_id.in_(conversation_ids)))
        db.execute(delete(AIConversation).where(AIConversation.id.in_(conversation_ids)))
    post_ids = list(db.scalars(select(Post.id).where(Post.author_id == uid)).all())
    if post_ids:
        db.execute(delete(PostTopic).where(PostTopic.post_id.in_(post_ids)))
        db.execute(delete(Reaction).where(Reaction.post_id.in_(post_ids)))
        db.execute(delete(Comment).where(Comment.post_id.in_(post_ids)))
        db.execute(delete(Bookmark).where(Bookmark.post_id.in_(post_ids)))
        db.execute(delete(Post).where(Post.id.in_(post_ids)))
    for model, column in (
        (JournalEntry, JournalEntry.user_id),
        (PrepKit, PrepKit.user_id),
        (NextStep, NextStep.user_id),
        (Notification, Notification.recipient_id),
        (Bookmark, Bookmark.user_id),
        (Consent, Consent.user_id),
        (UserInterest, UserInterest.user_id),
        (Membership, Membership.user_id),
        (Reaction, Reaction.user_id),
        (Comment, Comment.author_id),
        (Participant, Participant.user_id),
        (ExportRequest, ExportRequest.user_id),
    ):
        db.execute(delete(model).where(column == uid))
    db.execute(delete(Follow).where(or_(Follow.follower_id == uid, Follow.followed_id == uid)))
    db.execute(delete(Block).where(or_(Block.blocker_id == uid, Block.blocked_id == uid)))
    db.execute(update(Report).where(Report.reporter_id == uid).values(reporter_id=None))
    db.execute(update(Report).where(Report.moderator_id == uid).values(moderator_id=None))
    db.execute(update(AuditEvent).where(AuditEvent.actor_id == uid).values(actor_id=None))
    db.execute(update(Doctor).where(Doctor.user_id == uid).values(user_id=None))
    db.execute(update(AppointmentEvent).where(AppointmentEvent.actor_id == uid).values(actor_id=None))
    db.execute(update(CommunityEvent).where(CommunityEvent.created_by == uid).values(created_by=None))
    profile = db.get(Profile, uid)
    if profile is not None:
        db.delete(profile)
    db.add(
        AuditEvent(
            actor_id=None,
            action="account_deleted",
            target_type="user",
            target_id=uid,
            created_at=utcnow(),
        )
    )
    db.delete(user)
    db.commit()
