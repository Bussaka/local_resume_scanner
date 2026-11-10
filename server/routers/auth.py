import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from server.db import get_db
from server.models import User
from server.schemas import LoginIn, PasswordChange, UserOut
from server.security import current_user, end_session, hash_password, start_session, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED_LOGINS = 10
LOCKOUT_SECONDS = 15 * 60
# Per client IP, so a guesser only locks themselves out, never the account owner.
# shortcut: in-memory, so resets on restart and isn't shared across workers; move to the DB if run with several workers.
_failed_logins: dict[str, list[float]] = defaultdict(list)
_failed_lock = threading.Lock()


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _failed_lock:
        recent = _failed_logins[ip] = [t for t in _failed_logins[ip] if now - t < LOCKOUT_SECONDS]
        if len(recent) >= MAX_FAILED_LOGINS:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed sign-in attempts. Try again in 15 minutes.")

    user = db.scalars(select(User).where(func.lower(User.email) == body.email.strip().lower())).first()
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        with _failed_lock:
            _failed_logins[ip].append(now)
        # Same message for every failure so emails can't be probed
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    with _failed_lock:
        _failed_logins.pop(ip, None)
    start_session(db, user, response)
    return user


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    end_session(db, request, response)


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    db.commit()
