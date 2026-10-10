from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User
from app.security import decode_token


def _token_from_request(request: Request) -> str | None:
    token = request.cookies.get("hb_session")
    if token:
        return token
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip()
    return None


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in.")
    try:
        payload = decode_token(token)
        user_id = int(payload["sub"])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Please sign in again.") from exc
    user = db.get(User, user_id)
    if user is None or user.status != "active":
        raise HTTPException(status_code=401, detail="Please sign in again.")
    return user


def require_moderator(user: User = Depends(get_current_user)) -> User:
    if user.role not in {"moderator", "admin"}:
        raise HTTPException(status_code=403, detail="You do not have permission to do that.")
    return user


def client_ip(request: Request) -> str:
    if request.client and request.client.host:
        return request.client.host
    return "unknown"
