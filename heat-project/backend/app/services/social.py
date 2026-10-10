from fastapi import HTTPException
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.constants import REACTIONS, TOPIC_IDS, VISIBILITIES
from app.database import utcnow
from app.models import (
    Bookmark,
    Comment,
    Community,
    Membership,
    Post,
    PostTopic,
    Profile,
    Reaction,
    User,
)
from app.services.common import (
    blocked_ids,
    clean_text,
    consent_map,
    display_name,
    interests_for,
    iso,
    member_community_ids,
)


def can_view_post(db: Session, post: Post, viewer: User) -> bool:
    if post.author_id in blocked_ids(db, viewer.id):
        return False
    if post.removed and viewer.id != post.author_id and viewer.role not in {"admin", "moderator"}:
        return False
    if post.visibility == "public" and not post.removed:
        return True
    if post.visibility == "public" and post.removed:
        return viewer.id == post.author_id or viewer.role in {"admin", "moderator"}
    if post.visibility == "private":
        return post.author_id == viewer.id
    if post.visibility == "community" and post.community_id is not None:
        if post.author_id == viewer.id or viewer.role in {"admin", "moderator"}:
            return True
        return post.community_id in member_community_ids(db, viewer.id)
    return False


def author_card(db: Session, post: Post, viewer: User) -> dict:
    author = db.get(User, post.author_id)
    profile = db.get(Profile, post.author_id) if author else None
    hide = post.is_anonymous and viewer.id != post.author_id and viewer.role not in {"admin", "moderator"}
    if hide:
        name = "Community member"
        if post.community_id is not None and author is not None:
            membership = db.scalars(
                select(Membership).where(
                    Membership.community_id == post.community_id,
                    Membership.user_id == author.id,
                )
            ).first()
            if membership and membership.anonymous_name:
                name = membership.anonymous_name
        return {"id": None, "display_name": name, "anonymous": True, "avatar_color": "#6d5b8e"}
    return {
        "id": author.id if author else None,
        "display_name": display_name(db, author),
        "anonymous": False,
        "avatar_color": profile.avatar_color if profile else "#0f6e68",
    }


def serialize_post(db: Session, post: Post, viewer: User) -> dict:
    topics = list(
        db.scalars(select(PostTopic.topic).where(PostTopic.post_id == post.id)).all()
    )
    reaction_rows = db.execute(
        select(Reaction.reaction_type, func.count())
        .where(Reaction.post_id == post.id)
        .group_by(Reaction.reaction_type)
    ).all()
    counts = {key: 0 for key in REACTIONS}
    for kind, count in reaction_rows:
        counts[kind] = int(count)
    mine = db.scalars(
        select(Reaction.reaction_type).where(Reaction.post_id == post.id, Reaction.user_id == viewer.id)
    ).first()
    comment_count = db.scalar(
        select(func.count()).select_from(Comment).where(Comment.post_id == post.id, Comment.removed.is_(False))
    )
    saved = db.get(Bookmark, (viewer.id, post.id))
    community = db.get(Community, post.community_id) if post.community_id else None
    return {
        "id": post.id,
        "body": post.body,
        "image_url": post.image_url,
        "visibility": post.visibility,
        "content_warning": post.content_warning,
        "is_anonymous": post.is_anonymous,
        "removed": post.removed,
        "topics": topics,
        "created_at": iso(post.created_at),
        "updated_at": iso(post.updated_at),
        "author": author_card(db, post, viewer),
        "reactions": counts,
        "my_reaction": mine,
        "comment_count": int(comment_count or 0),
        "bookmarked": saved is not None,
        "community": None
        if community is None
        else {"id": community.id, "slug": community.slug, "name": community.name},
        "mine": post.author_id == viewer.id,
    }


def serialize_comment(db: Session, comment: Comment, viewer: User) -> dict:
    author = db.get(User, comment.author_id)
    profile = db.get(Profile, comment.author_id) if author else None
    return {
        "id": comment.id,
        "post_id": comment.post_id,
        "parent_id": comment.parent_id,
        "body": comment.body,
        "created_at": iso(comment.created_at),
        "removed": comment.removed,
        "mine": comment.author_id == viewer.id,
        "author": {
            "id": author.id if author else None,
            "display_name": display_name(db, author),
            "avatar_color": profile.avatar_color if profile else "#0f6e68",
        },
    }


def visible_post_query(db: Session, viewer: User, tab: str, topic: str | None, query: str | None, community_id: int | None):
    hidden = blocked_ids(db, viewer.id)
    communities = member_community_ids(db, viewer.id) or {-1}
    stmt = select(Post).where(Post.removed.is_(False))
    if hidden:
        stmt = stmt.where(Post.author_id.notin_(hidden))
    stmt = stmt.where(
        or_(
            Post.visibility == "public",
            and_(Post.visibility == "private", Post.author_id == viewer.id),
            and_(Post.visibility == "community", Post.community_id.in_(communities)),
        )
    )
    personalized = False
    if community_id is not None:
        stmt = stmt.where(Post.community_id == community_id)
    if topic:
        if topic not in TOPIC_IDS:
            raise HTTPException(status_code=400, detail="Choose a topic from the list.")
        stmt = stmt.where(Post.id.in_(select(PostTopic.post_id).where(PostTopic.topic == topic)))
    if query:
        cleaned = query.replace("%", "").replace("_", "").strip()[:80]
        if cleaned:
            stmt = stmt.where(Post.body.ilike(f"%{cleaned}%"))
    if tab == "following":
        from app.models import Follow

        followed = select(Follow.followed_id).where(Follow.follower_id == viewer.id)
        stmt = stmt.where(Post.author_id.in_(followed))
    elif tab == "communities":
        stmt = stmt.where(Post.visibility == "community")
    elif tab == "for_you":
        consents = consent_map(db, viewer.id)
        topics = interests_for(db, viewer.id)
        if consents.get("personalize_feed") and topics:
            personalized = True
            stmt = stmt.where(Post.id.in_(select(PostTopic.post_id).where(PostTopic.topic.in_(topics))))
    elif tab != "latest":
        raise HTTPException(status_code=400, detail="Unknown feed tab.")
    return stmt, personalized


def validate_topics(topics: list[str]) -> list[str]:
    unique: list[str] = []
    for topic in topics:
        if topic not in TOPIC_IDS:
            raise HTTPException(status_code=400, detail="Choose a topic from the list.")
        if topic not in unique:
            unique.append(topic)
    if len(unique) > 3:
        raise HTTPException(status_code=400, detail="Choose up to three topics.")
    return unique


def validate_visibility(visibility: str) -> str:
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400, detail="Choose a visibility setting.")
    return visibility


def apply_post_fields(
    db: Session,
    post: Post,
    viewer: User,
    body: str,
    visibility: str,
    topics: list[str],
    content_warning: str | None,
    community_id: int | None,
    is_anonymous: bool,
    image_url: str | None,
) -> None:
    post.body = clean_text(body, 4000)
    post.visibility = validate_visibility(visibility)
    post.content_warning = (content_warning or "").strip()[:80] or None
    post.image_url = image_url
    post.updated_at = utcnow()
    if post.visibility == "community":
        if community_id is None:
            raise HTTPException(status_code=400, detail="Choose a community for this post.")
        membership = db.scalars(
            select(Membership).where(
                Membership.community_id == community_id,
                Membership.user_id == viewer.id,
                Membership.status == "member",
            )
        ).first()
        if membership is None and viewer.role not in {"admin", "moderator"}:
            raise HTTPException(status_code=403, detail="Join this community before posting in it.")
        community = db.get(Community, community_id)
        if community is None:
            raise HTTPException(status_code=404, detail="That community is unavailable.")
        post.community_id = community.id
        post.is_anonymous = bool(is_anonymous and community.allow_anonymous)
    elif post.visibility == "private":
        post.community_id = None
        post.is_anonymous = False
    else:
        post.community_id = None
        post.is_anonymous = False
    if post.image_url and (not post.image_url.startswith("/uploads/") or ".." in post.image_url):
        raise HTTPException(status_code=400, detail="Upload an image before attaching it.")
    chosen = validate_topics(topics)
    db.flush()
    existing = db.scalars(select(PostTopic).where(PostTopic.post_id == post.id)).all()
    for row in existing:
        db.delete(row)
    db.flush()
    for topic in chosen:
        db.add(PostTopic(post_id=post.id, topic=topic))
