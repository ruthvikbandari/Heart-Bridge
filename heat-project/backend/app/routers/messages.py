from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal, get_db, utcnow
from app.deps import get_current_user
from app.models import Conversation, Message, Participant, User
from app.rate_limit import limiter
from app.security import decode_token
from app.services.common import audit, display_name, is_blocked, iso, notify, profile_payload
from app.services.realtime import hub, push
from app.services.common import clean_text

router = APIRouter(tags=["messages"])


class RequestIn(BaseModel):
    recipient_id: int
    body: str


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class BlockIn(BaseModel):
    user_id: int


class MuteIn(BaseModel):
    muted: bool


def participants(db: Session, conversation_id: int) -> list[Participant]:
    return list(db.scalars(select(Participant).where(Participant.conversation_id == conversation_id)).all())


def require_participant(db: Session, conversation_id: int, user_id: int) -> Conversation:
    conversation = db.get(Conversation, conversation_id)
    member = db.get(Participant, (conversation_id, user_id))
    if conversation is None or member is None:
        raise HTTPException(status_code=404, detail="That conversation is unavailable.")
    return conversation


def other_user_id(db: Session, conversation_id: int, user_id: int) -> int | None:
    for member in participants(db, conversation_id):
        if member.user_id != user_id:
            return member.user_id
    return None


def find_pair(db: Session, left: int, right: int) -> Conversation | None:
    rows = db.scalars(
        select(Conversation)
        .join(Participant, Participant.conversation_id == Conversation.id)
        .where(Participant.user_id == left)
    ).all()
    fallback = None
    for conversation in rows:
        ids = {item.user_id for item in participants(db, conversation.id)}
        if ids != {left, right}:
            continue
        if conversation.status in {"request", "active"}:
            return conversation
        fallback = conversation
    return fallback


def serialize_conversation(db: Session, conversation: Conversation, viewer: User) -> dict:
    other_id = other_user_id(db, conversation.id, viewer.id)
    other = db.get(User, other_id) if other_id else None
    member = db.get(Participant, (conversation.id, viewer.id))
    last = db.scalars(
        select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id.desc())
    ).first()
    preview = "Message request" if conversation.status == "request" else "Conversation"
    if last and conversation.status == "active" and last.sender_id == viewer.id:
        preview = "You sent a message"
    elif last and conversation.status == "active":
        preview = "New message"
    return {
        "id": conversation.id,
        "status": conversation.status,
        "created_by": conversation.created_by,
        "unread": member.unread if member else 0,
        "muted": member.muted if member else False,
        "preview": preview,
        "other": None
        if other is None
        else {"id": other.id, "profile": profile_payload(db, other), "display_name": display_name(db, other)},
        "updated_at": iso(last.created_at if last else conversation.created_at),
    }


@router.get("/inbox/summary")
def inbox_summary(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Participant).where(Participant.user_id == user.id)).all()
    unread_messages = 0
    for row in rows:
        conversation = db.get(Conversation, row.conversation_id)
        if conversation and conversation.status == "declined":
            continue
        other = other_user_id(db, row.conversation_id, user.id)
        if other and is_blocked(db, user.id, other):
            continue
        unread_messages += row.unread
    from app.models import Notification

    unread_notifications = db.scalars(
        select(Notification).where(Notification.recipient_id == user.id, Notification.read.is_(False))
    ).all()
    return {"unread_messages": unread_messages, "unread_notifications": len(unread_notifications)}


@router.get("/conversations")
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Participant).where(Participant.user_id == user.id)).all()
    items = []
    for row in rows:
        conversation = db.get(Conversation, row.conversation_id)
        if conversation is None or conversation.status == "declined" and conversation.created_by != user.id:
            continue
        other = other_user_id(db, conversation.id, user.id)
        if other and is_blocked(db, user.id, other):
            continue
        items.append(serialize_conversation(db, conversation, user))
    items.sort(key=lambda item: item["updated_at"] or "", reverse=True)
    return {"items": items}


@router.post("/message-requests")
def create_request(body: RequestIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    limiter.check(f"message:{user.id}", 40)
    if body.recipient_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot message yourself.")
    recipient = db.get(User, body.recipient_id)
    if recipient is None or recipient.status != "active" or is_blocked(db, user.id, recipient.id):
        raise HTTPException(status_code=404, detail="That person is unavailable.")
    existing = find_pair(db, user.id, recipient.id)
    if existing and existing.status in {"request", "active"}:
        raise HTTPException(status_code=409, detail="You already have a conversation with this person.")
    text = clean_text(body.body, 2000)
    conversation = Conversation(created_by=user.id, status="request", created_at=utcnow())
    db.add(conversation)
    db.flush()
    db.add(Participant(conversation_id=conversation.id, user_id=user.id, unread=0, muted=False))
    db.add(Participant(conversation_id=conversation.id, user_id=recipient.id, unread=1, muted=False))
    db.add(Message(conversation_id=conversation.id, sender_id=user.id, body=text, created_at=utcnow()))
    notify(
        db,
        recipient.id,
        "message_request",
        "Message request",
        "Someone wants to message you. Accept the request before an ongoing chat starts. The message text is not included here.",
        f"/messages/{conversation.id}",
    )
    audit(db, user.id, "message_request", "conversation", conversation.id)
    db.commit()
    push(recipient.id, {"type": "message", "conversation_id": conversation.id})
    return serialize_conversation(db, conversation, user)


@router.post("/conversations/{conversation_id}/accept")
def accept(conversation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversation = require_participant(db, conversation_id, user.id)
    if conversation.created_by == user.id:
        raise HTTPException(status_code=400, detail="The other person needs to accept this request.")
    conversation.status = "active"
    if conversation.created_by:
        notify(
            db,
            conversation.created_by,
            "message_accepted",
            "Message request accepted",
            "You can continue the conversation. Message text is not included in this alert.",
            f"/messages/{conversation.id}",
        )
    db.commit()
    return serialize_conversation(db, conversation, user)


@router.post("/conversations/{conversation_id}/decline")
def decline(conversation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conversation = require_participant(db, conversation_id, user.id)
    if conversation.created_by == user.id:
        raise HTTPException(status_code=400, detail="You can leave this request, but only the recipient can decline it.")
    conversation.status = "declined"
    db.commit()
    return {"ok": True}


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: int,
    after_id: int = 0,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = require_participant(db, conversation_id, user.id)
    other = other_user_id(db, conversation.id, user.id)
    if other and is_blocked(db, user.id, other):
        raise HTTPException(status_code=404, detail="That conversation is unavailable.")
    rows = db.scalars(
        select(Message)
        .where(Message.conversation_id == conversation.id, Message.id > after_id)
        .order_by(Message.id.asc())
    ).all()
    return {
        "conversation": serialize_conversation(db, conversation, user),
        "items": [
            {
                "id": item.id,
                "sender_id": item.sender_id,
                "body": item.body,
                "created_at": iso(item.created_at),
                "mine": item.sender_id == user.id,
            }
            for item in rows
        ],
    }


@router.post("/conversations/{conversation_id}/messages")
def send_message(
    conversation_id: int,
    body: MessageIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    limiter.check(f"message:{user.id}", 40)
    conversation = require_participant(db, conversation_id, user.id)
    other = other_user_id(db, conversation.id, user.id)
    if other and is_blocked(db, user.id, other):
        raise HTTPException(status_code=403, detail="You can't message this person.")
    if conversation.status == "request":
        raise HTTPException(status_code=403, detail="Wait until the request is accepted before sending more messages.")
    if conversation.status != "active":
        raise HTTPException(status_code=403, detail="This conversation is closed.")
    text = clean_text(body.body, 2000)
    message = Message(conversation_id=conversation.id, sender_id=user.id, body=text, created_at=utcnow())
    db.add(message)
    db.flush()
    for member in participants(db, conversation.id):
        if member.user_id == user.id:
            continue
        if not member.muted:
            member.unread += 1
            notify(
                db,
                member.user_id,
                "message",
                "New message",
                "You have a new message. The text is not included in this alert.",
                f"/messages/{conversation.id}",
            )
        push(member.user_id, {"type": "message", "conversation_id": conversation.id})
    db.commit()
    return {
        "id": message.id,
        "sender_id": message.sender_id,
        "body": message.body,
        "created_at": iso(message.created_at),
        "mine": True,
    }


@router.post("/conversations/{conversation_id}/read")
def mark_read(conversation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_participant(db, conversation_id, user.id)
    member = db.get(Participant, (conversation_id, user.id))
    if member is not None:
        member.unread = 0
        db.commit()
    return {"ok": True}


@router.post("/conversations/{conversation_id}/mute")
def mute(conversation_id: int, body: MuteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    require_participant(db, conversation_id, user.id)
    member = db.get(Participant, (conversation_id, user.id))
    if member is None:
        raise HTTPException(status_code=404, detail="That conversation is unavailable.")
    member.muted = body.muted
    db.commit()
    return {"muted": member.muted}


@router.post("/blocks")
def block(body: BlockIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models import Block

    if body.user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot block yourself.")
    other = db.get(User, body.user_id)
    if other is None:
        raise HTTPException(status_code=404, detail="That person is unavailable.")
    if db.get(Block, (user.id, other.id)) is None:
        db.add(Block(blocker_id=user.id, blocked_id=other.id, created_at=utcnow()))
        audit(db, user.id, "block", "user", other.id)
        db.commit()
    return {"blocked": True}


@router.delete("/blocks/{user_id}")
def unblock(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models import Block

    row = db.get(Block, (user.id, user_id))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"blocked": False}


@router.websocket("/ws")
async def socket(websocket: WebSocket):
    token = websocket.cookies.get("hb_session")
    user_id = None
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            user_id = None
    allowed = False
    if user_id is not None:
        db = SessionLocal()
        try:
            user = db.get(User, user_id)
            allowed = user is not None and user.status == "active"
        finally:
            db.close()
    if not allowed or user_id is None:
        await websocket.accept()
        await websocket.close(code=1008)
        return
    await hub.connect(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        hub.disconnect(user_id, websocket)
