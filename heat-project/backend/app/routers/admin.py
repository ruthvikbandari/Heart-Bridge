from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db, utcnow
from app.deps import require_moderator
from app.models import AuditEvent, Comment, Post, Report, User
from app.services.common import audit, iso

router = APIRouter(tags=["admin"])


class ResolveIn(BaseModel):
    status: str
    resolution: str = Field(default="", max_length=500)
    action: str = "dismiss"


@router.get("/admin/reports")
def list_reports(user: User = Depends(require_moderator), db: Session = Depends(get_db)):
    rows = db.scalars(select(Report).order_by(Report.created_at.desc())).all()
    items = []
    for row in rows:
        excerpt = ""
        if row.target_type == "post":
            post = db.get(Post, row.target_id)
            excerpt = (post.body[:180] + "…") if post and len(post.body) > 180 else (post.body if post else "")
        elif row.target_type == "comment":
            comment = db.get(Comment, row.target_id)
            excerpt = comment.body if comment else ""
        items.append(
            {
                "id": row.id,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "reason": row.reason,
                "details": row.details,
                "status": row.status,
                "resolution": row.resolution,
                "created_at": iso(row.created_at),
                "excerpt": excerpt,
            }
        )
    return {"items": items, "moderator_id": user.id}


@router.patch("/admin/reports/{report_id}")
def resolve_report(
    report_id: int,
    body: ResolveIn,
    user: User = Depends(require_moderator),
    db: Session = Depends(get_db),
):
    if body.status not in {"resolved", "dismissed"}:
        raise HTTPException(status_code=400, detail="Choose resolved or dismissed.")
    if body.action not in {"dismiss", "hide", "restore"}:
        raise HTTPException(status_code=400, detail="Choose an action.")
    row = db.get(Report, report_id)
    if row is None:
        raise HTTPException(status_code=404, detail="That report is unavailable.")
    if body.action == "hide" and row.target_type == "post":
        post = db.get(Post, row.target_id)
        if post is not None:
            post.removed = True
    elif body.action == "hide" and row.target_type == "comment":
        comment = db.get(Comment, row.target_id)
        if comment is not None:
            comment.removed = True
    elif body.action == "restore" and row.target_type == "post":
        post = db.get(Post, row.target_id)
        if post is not None:
            post.removed = False
    elif body.action == "restore" and row.target_type == "comment":
        comment = db.get(Comment, row.target_id)
        if comment is not None:
            comment.removed = False
    row.status = body.status
    row.resolution = body.resolution.strip()
    row.moderator_id = user.id
    row.updated_at = utcnow()
    audit(db, user.id, f"report_{body.action}", row.target_type, row.target_id)
    db.commit()
    return {"ok": True, "status": row.status}


@router.get("/admin/audit")
def list_audit(user: User = Depends(require_moderator), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(100)).all()
    return {
        "items": [
            {
                "id": row.id,
                "actor_id": row.actor_id,
                "action": row.action,
                "target_type": row.target_type,
                "target_id": row.target_id,
                "created_at": iso(row.created_at),
            }
            for row in rows
        ],
        "moderator_id": user.id,
    }


@router.get("/admin/stats")
def stats(user: User = Depends(require_moderator), db: Session = Depends(get_db)):
    def count(model, *criteria):
        stmt = select(func.count()).select_from(model)
        if criteria:
            stmt = stmt.where(*criteria)
        return int(db.scalar(stmt) or 0)

    from app.models import Appointment

    return {
        "members": count(User, User.status == "active", User.role == "member"),
        "open_reports": count(Report, Report.status == "open"),
        "appointments": count(Appointment),
        "moderator_id": user.id,
    }
