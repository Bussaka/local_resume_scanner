import io
import os
import sys
import tempfile
import time
from pathlib import Path

import pytest

# Isolated data dir; must be set before any server module is imported
os.environ["RS_DATA_DIR"] = tempfile.mkdtemp(prefix="rs_test_")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from p_evaluator.eval_engine import CriteriaMatch, ExtractedRequirement, ResumeScorecard  # noqa: E402
from server import worker as worker_module  # noqa: E402
from server.db import Base, SessionLocal, engine, init_db  # noqa: E402
from server.main import app  # noqa: E402
from server.models import User  # noqa: E402
from server.security import hash_password  # noqa: E402

ADMIN = {"email": "admin@example.com", "password": "admin-password-1"}


def fake_extract(document_text, job_title, model_name="llama3.1"):
    return [
        ExtractedRequirement(text="Experience with Kali Linux", category="skill", must_have=True, weight=5),
        ExtractedRequirement(text="Holds an OSCP certification", category="certification", must_have=False, weight=2),
    ]


def fake_evaluate(resume_text, criteria_list, model_name="llama3.1"):
    """Matches a criterion when its capitalised keywords (e.g. 'Kali', 'OSCP') appear in the resume."""
    def matched(criterion):
        keywords = [w for w in criterion.split()[1:] if w[0].isupper()]
        return bool(keywords) and all(k in resume_text for k in keywords)

    return ResumeScorecard(
        candidate_name=resume_text.splitlines()[0],
        overall_suitability_summary="Stub summary.",
        criteria_evaluations=[
            CriteriaMatch(criterion_name=c, is_matched=matched(c), evidence="stub", score=8 if matched(c) else 1)
            for c in criteria_list
        ],
    )


def make_docx(*lines: str) -> bytes:
    import docx
    document = docx.Document()
    for line in lines:
        document.add_paragraph(line)
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def resume(name: str, *skills: str) -> bytes:
    filler = "Professional experience in information security operations, incident response and reporting. " * 3
    return make_docx(name, f"Skills: {', '.join(skills)}", filler)


def wait_until(predicate, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    raise AssertionError("Timed out waiting for background worker")


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr(worker_module, "extract_requirements", fake_extract)
    monkeypatch.setattr(worker_module, "evaluate_resume", fake_evaluate)
    Base.metadata.drop_all(engine)
    init_db()
    with SessionLocal() as db:
        db.add(User(email=ADMIN["email"], full_name="Admin", password_hash=hash_password(ADMIN["password"]), role="admin"))
        db.commit()
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin(client):
    assert client.post("/api/auth/login", json=ADMIN).status_code == 200
    return client
