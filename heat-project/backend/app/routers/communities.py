import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import TOPIC_IDS
from app.database import get_db, utcnow
from app.deps import get_current_user, require_moderator
from app.models import Community, CommunityEvent, CommunityResource, Membership, User
from app.services.common import audit, display_name, iso, notify
from app.services.social import serialize_post, visible_post_query
from app.models import Post

router = APIRouter(tags=["communities"])


class CommunityIn(BaseModel):
    name: str = Field(min_length=3, max_length=80)
    description: str = Field(default="", max_length=500)
    guidelines: str = Field(default="", max_length=1000)
    topic: str
    visibility: str = "public"
    allow_anonymous: bool = False


class JoinIn(BaseModel):
    anonymous_name: str | None = Field(default=None, max_length=40)


class MemberPatch(BaseModel):
    status: str


class EventIn(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(default="", max_length=500)
    starts_at: str


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (slug or "community")[:70]


def membership_for(db: Session, community_id: int, user_id: int) -> Membership | None:
    return db.scalars(
        select(Membership).where(Membership.community_id == community_id, Membership.user_id == user_id)
    ).first()


def serialize_community(db: Session, community: Community, viewer: User) -> dict:
    member_count = db.scalar(
        select(func.count()).select_from(Membership).where(
            Membership.community_id == community.id,
            Membership.status == "member",
        )
    )
    membership = membership_for(db, community.id, viewer.id)
    events = db.scalars(
        select(CommunityEvent).where(CommunityEvent.community_id == community.id).order_by(CommunityEvent.starts_at)
    ).all()
    resources = db.scalars(select(CommunityResource).where(CommunityResource.community_id == community.id)).all()
    moderators = db.scalars(
        select(Membership).where(
            Membership.community_id == community.id,
            Membership.role == "moderator",
            Membership.status == "member",
        )
    ).all()
    can_review = viewer.role in {"admin", "moderator"} or (membership is not None and membership.role == "moderator")
    pending = []
    if can_review:
        requests = db.scalars(
            select(Membership).where(Membership.community_id == community.id, Membership.status == "pending")
        ).all()
        pending = [
            {"user_id": item.user_id, "display_name": display_name(db, db.get(User, item.user_id))}
            for item in requests
        ]
    return {
        "id": community.id,
        "slug": community.slug,
        "name": community.name,
        "description": community.description,
        "guidelines": community.guidelines,
        "topic": community.topic,
        "visibility": community.visibility,
        "allow_anonymous": community.allow_anonymous,
        "member_count": int(member_count or 0),
        "membership": None
        if membership is None
        else {
            "status": membership.status,
            "role": membership.role,
            "anonymous_name": membership.anonymous_name,
        },
        "events": [
            {
                "id": event.id,
                "title": event.title,
                "description": event.description,
                "starts_at": iso(event.starts_at),
            }
            for event in events
        ],
        "resources": [
            {
                "id": resource.id,
                "title": resource.title,
                "url": resource.url,
                "summary": resource.summary,
                "source_label": resource.source_label,
                "last_reviewed": resource.last_reviewed,
            }
            for resource in resources
        ],
        "moderators": [display_name(db, db.get(User, item.user_id)) for item in moderators],
        "pending_requests": pending,
        "can_review": can_review,
        "notice": "Peer experiences here are personal experiences, not professional medical advice.",
        "why": f"Listed in {community.topic.replace('-', ' ')}. Recommendations use topics you select, not private chats.",
    }


@router.get("/communities")
def list_communities(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Community).order_by(Community.name)).all()
    visible = []
    for community in rows:
        membership = membership_for(db, community.id, user.id)
        if community.visibility == "private" and (membership is None or membership.status != "member"):
            if user.role not in {"admin", "moderator"}:
                visible.append(
                    {
                        **serialize_community(db, community, user),
                        "description": "Private group. Request to join to read discussions.",
                        "guidelines": "",
                        "resources": [],
                        "events": [],
                    }
                )
                continue
        visible.append(serialize_community(db, community, user))
    return {"items": visible}


@router.post("/communities")
def create_community(
    body: CommunityIn,
    user: User = Depends(require_moderator),
    db: Session = Depends(get_db),
):
    if body.topic not in TOPIC_IDS:
        raise HTTPException(status_code=400, detail="Choose a topic from the list.")
    if body.visibility not in {"public", "private"}:
        raise HTTPException(status_code=400, detail="Choose public or private.")
    slug = slugify(body.name)
    base = slug
    index = 2
    while db.scalars(select(Community).where(Community.slug == slug)).first():
        slug = f"{base}-{index}"
        index += 1
    community = Community(
        slug=slug,
        name=body.name.strip(),
        description=body.description.strip(),
        guidelines=body.guidelines.strip() or "Be kind. Do not give medical orders. Share only what you choose.",
        topic=body.topic,
        visibility=body.visibility,
        allow_anonymous=body.allow_anonymous,
        created_at=utcnow(),
    )
    db.add(community)
    db.flush()
    db.add(Membership(user_id=user.id, community_id=community.id, role="moderator", status="member", created_at=utcnow()))
    audit(db, user.id, "community_created", "community", community.id)
    db.commit()
    return serialize_community(db, community, user)


@router.get("/communities/{slug}")
def read_community(slug: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = db.scalars(select(Community).where(Community.slug == slug)).first()
    if community is None:
        raise HTTPException(status_code=404, detail="That community is unavailable.")
    membership = membership_for(db, community.id, user.id)
    if community.visibility == "private" and (membership is None or membership.status != "member") and user.role not in {"admin", "moderator"}:
        payload = serialize_community(db, community, user)
        payload["description"] = "Private group. Request to join to read discussions."
        payload["guidelines"] = ""
        payload["resources"] = []
        payload["events"] = []
        payload["locked"] = True
        return payload
    payload = serialize_community(db, community, user)
    payload["locked"] = False
    return payload


@router.post("/communities/{community_id}/join")
def join(community_id: int, body: JoinIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = db.get(Community, community_id)
    if community is None:
        raise HTTPException(status_code=404, detail="That community is unavailable.")
    alias = None
    if body.anonymous_name and community.allow_anonymous:
        alias = " ".join(body.anonymous_name.split())
        if "@" in alias:
            raise HTTPException(status_code=400, detail="Anonymous name cannot be an email address.")
    existing = membership_for(db, community.id, user.id)
    status = "pending" if community.visibility == "private" else "member"
    if existing is None:
        db.add(
            Membership(
                user_id=user.id,
                community_id=community.id,
                role="member",
                status=status,
                anonymous_name=alias,
                created_at=utcnow(),
            )
        )
    else:
        existing.status = status if existing.status != "member" else existing.status
        if alias:
            existing.anonymous_name = alias
        status = existing.status
    if status == "pending":
        mods = db.scalars(
            select(Membership).where(
                Membership.community_id == community.id,
                Membership.role == "moderator",
                Membership.status == "member",
            )
        ).all()
        for mod in mods:
            notify(
                db,
                mod.user_id,
                "join_request",
                "New join request",
                f"Someone asked to join {community.name}. Open the community to respond.",
                f"/communities/{community.slug}",
            )
    audit(db, user.id, "community_join", "community", community.id)
    db.commit()
    return {"status": status}


@router.delete("/communities/{community_id}/join")
def leave(community_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    existing = membership_for(db, community_id, user.id)
    if existing is not None:
        db.delete(existing)
        audit(db, user.id, "community_leave", "community", community_id)
        db.commit()
    return {"ok": True}


@router.patch("/communities/{community_id}/members/{member_id}")
def review_member(
    community_id: int,
    member_id: int,
    body: MemberPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.status not in {"member", "rejected"}:
        raise HTTPException(status_code=400, detail="Choose approve or decline.")
    community = db.get(Community, community_id)
    actor = membership_for(db, community_id, user.id)
    if community is None:
        raise HTTPException(status_code=404, detail="That community is unavailable.")
    if user.role not in {"admin", "moderator"} and (actor is None or actor.role != "moderator"):
        raise HTTPException(status_code=403, detail="Only a community moderator can review requests.")
    target = membership_for(db, community_id, member_id)
    if target is None:
        raise HTTPException(status_code=404, detail="That request is unavailable.")
    target.status = body.status
    notify(
        db,
        member_id,
        "join_reviewed",
        "Community request updated",
        f"Your request for {community.name} was updated. Open the community to see the result.",
        f"/communities/{community.slug}",
    )
    db.commit()
    return {"status": target.status}


@router.get("/communities/{community_id}/posts")
def community_posts(community_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    community = db.get(Community, community_id)
    if community is None:
        raise HTTPException(status_code=404, detail="That community is unavailable.")
    membership = membership_for(db, community.id, user.id)
    if community.visibility == "private" and (membership is None or membership.status != "member") and user.role not in {"admin", "moderator"}:
        raise HTTPException(status_code=403, detail="Join this community to read posts.")
    stmt, _personalized = visible_post_query(db, user, "latest", None, None, community.id)
    rows = db.scalars(stmt.order_by(Post.created_at.desc()).limit(50)).all()
    return {"items": [serialize_post(db, post, user) for post in rows]}


@router.post("/communities/{community_id}/events")
def create_event(
    community_id: int,
    body: EventIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    community = db.get(Community, community_id)
    actor = membership_for(db, community_id, user.id)
    if community is None:
        raise HTTPException(status_code=404, detail="That community is unavailable.")
    if user.role not in {"admin", "moderator"} and (actor is None or actor.role != "moderator" or actor.status != "member"):
        raise HTTPException(status_code=403, detail="Only a moderator can schedule an event.")
    from datetime import datetime

    try:
        starts = datetime.fromisoformat(body.starts_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Use a valid date and time.") from exc
    event = CommunityEvent(
        community_id=community.id,
        title=body.title.strip(),
        description=body.description.strip(),
        starts_at=starts,
        created_by=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {"id": event.id, "title": event.title, "starts_at": iso(event.starts_at)}
