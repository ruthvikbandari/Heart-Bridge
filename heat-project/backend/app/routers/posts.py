from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants import REACTIONS, REPORT_REASONS
from app.database import get_db, utcnow
from app.deps import get_current_user
from app.models import Bookmark, Comment, Post, Reaction, Report, User
from app.rate_limit import limiter
from app.services.common import audit, notify
from app.services.social import (
    apply_post_fields,
    can_view_post,
    serialize_comment,
    serialize_post,
    visible_post_query,
)

router = APIRouter(tags=["feed"])


class PostIn(BaseModel):
    body: str
    visibility: str = "public"
    topics: list[str] = []
    content_warning: str | None = None
    community_id: int | None = None
    is_anonymous: bool = False
    image_url: str | None = None


class CommentIn(BaseModel):
    body: str
    parent_id: int | None = None


class ReactionIn(BaseModel):
    reaction_type: str


class ReportIn(BaseModel):
    target_type: str
    target_id: int
    reason: str
    details: str = Field(default="", max_length=500)


def _get_visible_post(db: Session, post_id: int, viewer: User) -> Post:
    post = db.get(Post, post_id)
    if post is None or not can_view_post(db, post, viewer):
        raise HTTPException(status_code=404, detail="That post is unavailable.")
    return post


@router.get("/posts")
def list_posts(
    tab: str = "latest",
    topic: str | None = None,
    q: str | None = None,
    community_id: int | None = None,
    page: int = 1,
    page_size: int = 10,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    page = max(1, page)
    page_size = min(30, max(1, page_size))
    stmt, personalized = visible_post_query(db, user, tab, topic, q, community_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Post.created_at.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return {
        "items": [serialize_post(db, post, user) for post in rows],
        "page": page,
        "page_size": page_size,
        "total": int(total),
        "personalized": personalized,
        "tab": tab,
    }


@router.post("/posts")
def create_post(body: PostIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    limiter.check(f"post:{user.id}", 15)
    post = Post(author_id=user.id, body="draft", visibility="public", created_at=utcnow(), updated_at=utcnow())
    db.add(post)
    db.flush()
    apply_post_fields(
        db,
        post,
        user,
        body.body,
        body.visibility,
        body.topics,
        body.content_warning,
        body.community_id,
        body.is_anonymous,
        body.image_url,
    )
    audit(db, user.id, "post_created", "post", post.id)
    db.commit()
    db.refresh(post)
    return serialize_post(db, post, user)


@router.get("/posts/{post_id}")
def read_post(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = _get_visible_post(db, post_id, user)
    return serialize_post(db, post, user)


@router.patch("/posts/{post_id}")
def update_post(post_id: int, body: PostIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.get(Post, post_id)
    if post is None or post.removed:
        raise HTTPException(status_code=404, detail="That post is unavailable.")
    if post.author_id != user.id:
        raise HTTPException(status_code=403, detail="You can only edit your own post.")
    apply_post_fields(
        db,
        post,
        user,
        body.body,
        body.visibility,
        body.topics,
        body.content_warning,
        body.community_id,
        body.is_anonymous,
        body.image_url,
    )
    audit(db, user.id, "post_updated", "post", post.id)
    db.commit()
    return serialize_post(db, post, user)


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="That post is unavailable.")
    if post.author_id != user.id and user.role not in {"admin", "moderator"}:
        raise HTTPException(status_code=403, detail="You can only delete your own post.")
    post.removed = True
    post.body = "[deleted]"
    audit(db, user.id, "post_deleted", "post", post.id)
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/reactions")
def react(post_id: int, body: ReactionIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.reaction_type not in REACTIONS:
        raise HTTPException(status_code=400, detail="Choose a reaction from the list.")
    post = _get_visible_post(db, post_id, user)
    if post.removed:
        raise HTTPException(status_code=404, detail="That post is unavailable.")
    existing = db.get(Reaction, (post.id, user.id))
    if existing and existing.reaction_type == body.reaction_type:
        db.delete(existing)
    elif existing:
        existing.reaction_type = body.reaction_type
    else:
        db.add(Reaction(post_id=post.id, user_id=user.id, reaction_type=body.reaction_type))
    db.commit()
    return serialize_post(db, post, user)


@router.get("/posts/{post_id}/comments")
def list_comments(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = _get_visible_post(db, post_id, user)
    rows = db.scalars(
        select(Comment).where(Comment.post_id == post.id, Comment.removed.is_(False)).order_by(Comment.created_at.asc())
    ).all()
    return {"items": [serialize_comment(db, row, user) for row in rows]}


@router.post("/posts/{post_id}/comments")
def create_comment(post_id: int, body: CommentIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    limiter.check(f"comment:{user.id}", 30)
    post = _get_visible_post(db, post_id, user)
    if post.removed or post.visibility == "private" and post.author_id != user.id:
        raise HTTPException(status_code=404, detail="That post is unavailable.")
    parent_id = body.parent_id
    if parent_id is not None:
        parent = db.get(Comment, parent_id)
        if parent is None or parent.post_id != post.id or parent.parent_id is not None:
            raise HTTPException(status_code=400, detail="Reply to an original comment.")
    from app.services.common import clean_text

    comment = Comment(
        post_id=post.id,
        author_id=user.id,
        parent_id=parent_id,
        body=clean_text(body.body, 2000),
        created_at=utcnow(),
    )
    db.add(comment)
    db.flush()
    if post.author_id != user.id:
        notify(
            db,
            post.author_id,
            "comment",
            "New reply on your post",
            "Someone replied. The message itself is not included in this alert.",
            f"/posts/{post.id}",
        )
    audit(db, user.id, "comment_created", "comment", comment.id)
    db.commit()
    db.refresh(comment)
    return serialize_comment(db, comment, user)


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    comment = db.get(Comment, comment_id)
    if comment is None or comment.removed:
        raise HTTPException(status_code=404, detail="That comment is unavailable.")
    if comment.author_id != user.id and user.role not in {"admin", "moderator"}:
        raise HTTPException(status_code=403, detail="You can only delete your own comment.")
    comment.removed = True
    comment.body = "[deleted]"
    db.commit()
    return {"ok": True}


@router.post("/posts/{post_id}/bookmark")
def bookmark(post_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    post = _get_visible_post(db, post_id, user)
    existing = db.get(Bookmark, (user.id, post.id))
    if existing:
        db.delete(existing)
        saved = False
    else:
        db.add(Bookmark(user_id=user.id, post_id=post.id, created_at=utcnow()))
        saved = True
    db.commit()
    return {"bookmarked": saved}


@router.get("/bookmarks")
def bookmarks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Bookmark).where(Bookmark.user_id == user.id).order_by(Bookmark.created_at.desc())).all()
    items = []
    for row in rows:
        post = db.get(Post, row.post_id)
        if post and can_view_post(db, post, user) and not post.removed:
            items.append(serialize_post(db, post, user))
    return {"items": items}


@router.post("/reports")
def report(body: ReportIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    limiter.check(f"report:{user.id}", 10)
    if body.target_type not in {"post", "comment", "message", "user"}:
        raise HTTPException(status_code=400, detail="Choose what you are reporting.")
    if body.reason not in REPORT_REASONS:
        raise HTTPException(status_code=400, detail="Choose a reason from the list.")
    if body.target_type == "user" and body.target_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot report yourself.")
    row = Report(
        reporter_id=user.id,
        target_type=body.target_type,
        target_id=body.target_id,
        reason=body.reason,
        details=body.details.strip(),
        status="open",
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    db.add(row)
    db.flush()
    moderators = db.scalars(select(User).where(User.role.in_(["moderator", "admin"]), User.status == "active")).all()
    for moderator in moderators:
        notify(
            db,
            moderator.id,
            "report",
            "New report",
            "A member submitted a report. Open the moderation queue. The content is not copied into this alert.",
            "/admin",
        )
    audit(db, user.id, "report_filed", body.target_type, body.target_id)
    db.commit()
    return {"ok": True, "id": row.id}
