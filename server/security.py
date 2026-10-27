import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from server.config import SECURE_COOKIES, SESSION_COOKIE, SESSION_HOURS
from server.db import get_db
from server.models import User, UserSession, utcnow

# scrypt from the standard library: memory-hard, no extra dependency
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=32)
    return hmac.compare_digest(candidate.hex(), digest)


def _token_hash(token: str) -> str:
    # Only the hash is stored, so a leaked database cannot be used to hijack sessions
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    db.execute(delete(UserSession).where(UserSession.expires_at < utcnow()))
    db.add(UserSession(token_hash=_token_hash(token), user_id=user.id, expires_at=utcnow() + timedelta(hours=SESSION_HOURS)))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=SESSION_HOURS * 3600, httponly=True, samesite="lax", secure=SECURE_COOKIES,
    )


def end_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        db.commit()
    response.delete_cookie(SESSION_COOKIE)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    session = db.get(UserSession, _token_hash(token)) if token else None
    if session is None or session.expires_at < utcnow() or not session.user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return session.user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
