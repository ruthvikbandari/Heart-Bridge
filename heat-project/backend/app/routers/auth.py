import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.constants import LANGUAGES, TOPIC_IDS
from app.database import get_db
from app.deps import client_ip, get_current_user
from app.models import Follow, Post, Profile, User
from app.rate_limit import limiter
from app.security import create_token, hash_password, verify_password
from app.services.accounts import create_user, delete_account
from app.services.common import (
    audit,
    blocked_ids,
    consent_map,
    display_name,
    interests_for,
    profile_payload,
    replace_interests,
    set_consents,
    user_payload,
)
from app.services.social import can_view_post, serialize_post

router = APIRouter(tags=["auth"])
PASSWORD_RESET_TOKENS: dict[str, tuple[str, datetime]] = {}


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=40)

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if "@" in value:
            raise ValueError("Display name cannot be an email address.")
        if len(value) < 2:
            raise ValueError("Use at least 2 characters.")
        return value

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
            raise ValueError("Use at least one letter and one number.")
        return value


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class ForgotPasswordIn(BaseModel):
    email: EmailStr


class ResetPasswordIn(BaseModel):
    email: EmailStr
    token: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def strong_password(cls, value: str) -> str:
        if not any(char.isalpha() for char in value) or not any(char.isdigit() for char in value):
            raise ValueError("Use at least one letter and one number.")
        return value


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=40)
    bio: str | None = Field(default=None, max_length=280)
    language: str | None = None


class OnboardingIn(BaseModel):
    display_name: str = Field(min_length=2, max_length=40)
    language: str = "en"
    bio: str = Field(default="", max_length=280)
    interests: list[str] = []
    consents: dict[str, bool] = {}

    @field_validator("display_name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = " ".join(value.split())
        if "@" in value:
            raise ValueError("Display name cannot be an email address.")
        return value


class DeleteIn(BaseModel):
    password: str
    confirm: str


def write_session(response: Response, user: User) -> None:
    settings = get_settings()
    response.set_cookie(
        key="hb_session",
        value=create_token(user.id, user.role),
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        max_age=settings.jwt_expire_days * 86400,
        path="/",
    )


def public_user(db: Session, user: User, viewer: User) -> dict:
    consents = consent_map(db, user.id)
    payload = {
        "id": user.id,
        "profile": profile_payload(db, user),
        "interests": interests_for(db, user.id) if consents.get("appear_in_suggestions") or viewer.id == user.id else [],
        "interests_visible": bool(consents.get("appear_in_suggestions") or viewer.id == user.id),
        "followed": db.get(Follow, (viewer.id, user.id)) is not None,
        "mine": viewer.id == user.id,
    }
    if viewer.id == user.id:
        payload["email"] = user.email
        payload["role"] = user.role
    return payload


@router.post("/auth/register")
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limiter.check(f"register:{client_ip(request)}", 10)
    email = body.email.lower()
    if body.password.lower() == email:
        raise HTTPException(status_code=400, detail="Use a password that is not your email.")
    existing = db.scalars(select(User).where(User.email == email)).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="An account with that email already exists.")
    user = create_user(db, email, body.password, body.display_name)
    write_session(response, user)
    return user_payload(db, user)


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    limiter.check(f"login:{client_ip(request)}", 10)
    email = body.email.lower()
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is None or user.status != "active" or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect.")
    audit(db, user.id, "login", "user", user.id)
    db.commit()
    write_session(response, user)
    return user_payload(db, user)


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotPasswordIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is not None and user.status == "active":
        token = uuid.uuid4().hex
        PASSWORD_RESET_TOKENS[email] = (token, datetime.now(timezone.utc) + timedelta(minutes=30))
        return {"ok": True, "message": "A demo reset code is ready. Use it below to choose a new password.", "reset_token": token}
    return {"ok": True, "message": "If that email exists, a demo reset code is ready to use below."}


@router.post("/auth/reset-password")
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    email = body.email.lower()
    if body.password.lower() == email:
        raise HTTPException(status_code=400, detail="Use a password that is not your email.")
    stored = PASSWORD_RESET_TOKENS.get(email)
    if stored is None:
        raise HTTPException(status_code=400, detail="This reset code is invalid or has expired.")
    token, expires_at = stored
    if datetime.now(timezone.utc) > expires_at:
        PASSWORD_RESET_TOKENS.pop(email, None)
        raise HTTPException(status_code=400, detail="This reset code is invalid or has expired.")
    if body.token != token:
        raise HTTPException(status_code=400, detail="This reset code is invalid or has expired.")
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is None or user.status != "active":
        raise HTTPException(status_code=404, detail="We could not find an active account for that email.")
    user.password_hash = hash_password(body.password)
    PASSWORD_RESET_TOKENS.pop(email, None)
    audit(db, user.id, "password_reset", "user", user.id)
    db.commit()
    return {"ok": True, "message": "Your password was updated successfully."}


@router.post("/auth/logout")
def logout(response: Response, user: User = Depends(get_current_user)):
    response.delete_cookie("hb_session", path="/")
    return {"ok": True, "id": user.id}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    payload = user_payload(db, user)
    payload["demo_banner"] = get_settings().demo_banner
    return payload


@router.patch("/me")
def update_me(body: ProfilePatch, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    profile = db.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    if body.display_name is not None:
        name = " ".join(body.display_name.split())
        if "@" in name:
            raise HTTPException(status_code=400, detail="Display name cannot be an email address.")
        profile.display_name = name
    if body.bio is not None:
        profile.bio = body.bio.strip()
    if body.language is not None:
        if body.language not in LANGUAGES:
            raise HTTPException(status_code=400, detail="Choose English, Hindi, or Telugu.")
        profile.language = body.language
    audit(db, user.id, "profile_updated", "user", user.id)
    db.commit()
    return user_payload(db, user)


@router.post("/me/onboarding")
def onboard(body: OnboardingIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.language not in LANGUAGES:
        raise HTTPException(status_code=400, detail="Choose English, Hindi, or Telugu.")
    unknown = [topic for topic in body.interests if topic not in TOPIC_IDS]
    if unknown:
        raise HTTPException(status_code=400, detail="Choose topics from the list.")
    profile = db.get(Profile, user.id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    profile.display_name = " ".join(body.display_name.split())
    profile.language = body.language
    profile.bio = body.bio.strip()
    replace_interests(db, user.id, list(dict.fromkeys(body.interests)))
    set_consents(db, user.id, body.consents)
    user.onboarded = True
    audit(db, user.id, "onboarding_completed", "user", user.id)
    db.commit()
    return user_payload(db, user)


@router.delete("/me")
def remove_me(body: DeleteIn, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.confirm != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm account deletion.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Password is incorrect.")
    delete_account(db, user)
    response.delete_cookie("hb_session", path="/")
    return {"ok": True}


@router.get("/users/suggestions")
def suggestions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    mine = set(interests_for(db, user.id))
    if not mine:
        return {"items": [], "reason": "Select topics in Privacy to see people who chose the same topics."}
    hidden = blocked_ids(db, user.id)
    rows = db.scalars(select(User).where(User.status == "active", User.id != user.id)).all()
    items = []
    for other in rows:
        if other.id in hidden:
            continue
        if not consent_map(db, other.id).get("appear_in_suggestions"):
            continue
        shared = sorted(mine.intersection(interests_for(db, other.id)))
        if not shared:
            continue
        profile = profile_payload(db, other)
        items.append(
            {
                "id": other.id,
                "profile": profile,
                "shared_topics": shared,
                "why": "Matches topics you selected: " + ", ".join(shared),
            }
        )
        if len(items) == 8:
            break
    return {"items": items}


@router.get("/users/{user_id}")
def read_user(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    other = db.get(User, user_id)
    if other is None or other.status != "active" or other.id in blocked_ids(db, user.id):
        raise HTTPException(status_code=404, detail="That profile is unavailable.")
    return public_user(db, other, user)


@router.get("/users/{user_id}/posts")
def user_posts(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    other = db.get(User, user_id)
    if other is None or (other.status != "active" and other.id != user.id) or other.id in blocked_ids(db, user.id):
        raise HTTPException(status_code=404, detail="That profile is unavailable.")
    rows = db.scalars(select(Post).where(Post.author_id == other.id).order_by(Post.created_at.desc())).all()
    visible = [serialize_post(db, post, user) for post in rows if can_view_post(db, post, user)]
    return {"items": visible}


@router.post("/users/{user_id}/follow")
def follow(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="You cannot follow yourself.")
    other = db.get(User, user_id)
    if other is None or other.status != "active" or other.id in blocked_ids(db, user.id):
        raise HTTPException(status_code=404, detail="That profile is unavailable.")
    if db.get(Follow, (user.id, other.id)) is None:
        db.add(Follow(follower_id=user.id, followed_id=other.id))
        audit(db, user.id, "follow", "user", other.id)
        db.commit()
    return {"following": True}


@router.delete("/users/{user_id}/follow")
def unfollow(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row = db.get(Follow, (user.id, user_id))
    if row is not None:
        db.delete(row)
        db.commit()
    return {"following": False}


@router.get("/users/{user_id}/meta")
def user_meta(user_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(Follow).where(Follow.followed_id == user_id))
    return {"followers": int(count or 0), "display_name": display_name(db, db.get(User, user_id) or user)}
