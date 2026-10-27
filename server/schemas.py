from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Role = Literal["admin", "recruiter"]
Category = Literal["skill", "experience", "education", "certification", "language", "location", "other"]
Decision = Literal["undecided", "shortlisted", "rejected"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Users & auth ---
class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(ORM):
    id: int
    email: str
    full_name: str
    role: Role
    is_active: bool
    created_at: datetime


class UserCreate(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=10, max_length=200)
    role: Role = "recruiter"


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    role: Role | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=10, max_length=200)


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=200)


# --- Jobs ---
class JobIn(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    department: str = Field(default="", max_length=255)
    description: str = ""


class JobUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    department: str | None = Field(default=None, max_length=255)
    description: str | None = None
    status: Literal["open", "closed"] | None = None


class JobSummary(ORM):
    id: int
    title: str
    department: str
    status: str
    created_at: datetime
    created_by_name: str | None = None
    candidate_count: int = 0
    screened_count: int = 0
    shortlisted_count: int = 0
    in_queue_count: int = 0
    requirement_count: int = 0


class DocumentOut(ORM):
    id: int
    filename: str
    uploaded_at: datetime
    char_count: int
    preview: str


class JobDetail(JobSummary):
    description: str
    extraction_status: str
    extraction_error: str | None
    requirements_updated_at: datetime | None
    documents: list[DocumentOut]


class RequirementIn(BaseModel):
    id: int | None = None  # Present for existing requirements, omitted for new ones
    text: str = Field(min_length=1)
    category: Category = "other"
    must_have: bool = False
    weight: int = Field(default=3, ge=1, le=5)


class RequirementOut(ORM):
    id: int
    text: str
    category: Category
    must_have: bool
    weight: int


# --- Applications ---
class ApplicationRow(BaseModel):
    id: int
    candidate_id: int
    candidate_name: str
    filename: str
    screening_status: str
    screening_error: str | None
    decision: Decision
    score: int | None
    passes_must_haves: bool | None
    matched_count: int
    requirement_count: int
    missing_must_haves: list[str]
    stale: bool
    created_at: datetime


class EvaluationOut(BaseModel):
    requirement_id: int
    requirement_text: str
    category: str
    must_have: bool
    weight: int
    is_matched: bool
    score: int
    evidence: str


class ApplicationDetail(ApplicationRow):
    job_id: int
    job_title: str
    summary: str
    screened_at: datetime | None
    model_name: str | None
    notes: str
    decided_by_name: str | None
    decided_at: datetime | None
    file_ext: str
    resume_text: str
    evaluations: list[EvaluationOut]


class ApplicationUpdate(BaseModel):
    decision: Decision | None = None
    notes: str | None = None


class ScreenRequest(BaseModel):
    # unscreened: never screened or failed; stale: also re-screen outdated results; all: everyone
    scope: Literal["unscreened", "stale", "all"] = "unscreened"
    application_ids: list[int] | None = None


class UploadFailure(BaseModel):
    filename: str
    error: str


class UploadResult(BaseModel):
    added: int
    duplicates: list[str]
    failed: list[UploadFailure]
    queued: bool = False
