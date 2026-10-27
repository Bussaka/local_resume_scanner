"""
Creates the first admin account (further users are added from the Users page).

Usage: python -m server.create_admin admin@company.com "Full Name"
"""
import getpass
import sys

from sqlalchemy import func, select

from server.db import SessionLocal, init_db
from server.models import User
from server.security import hash_password


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    email, full_name = sys.argv[1].strip().lower(), sys.argv[2].strip()
    password = getpass.getpass("Password (min 10 characters): ")
    if len(password) < 10:
        sys.exit("Password must be at least 10 characters.")
    if password != getpass.getpass("Repeat password: "):
        sys.exit("Passwords do not match.")

    init_db()
    with SessionLocal() as db:
        if db.scalar(select(func.count()).where(func.lower(User.email) == email)):
            sys.exit(f"A user with email {email} already exists.")
        db.add(User(email=email, full_name=full_name, password_hash=hash_password(password), role="admin"))
        db.commit()
    print(f"Admin {email} created.")


if __name__ == "__main__":
    main()
