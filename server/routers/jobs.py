import hashlib
import os

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.orm import Session

from p_parser.pdf_parser import SUPPORTED_EXTENSIONS, parse_document_bytes
from server.config import FILES_DIR, MAX_UPLOAD_BYTES, MIN_RESUME_CHARS
from server.db import get_db
from server.models import Application, Candidate, Job, JobDocument, Requirement, User, utcnow
from server.schemas import (
    ApplicationRow, DocumentOut, JobDetail, JobIn, JobSummary, JobUpdate,
    RequirementIn, RequirementOut, ScreenRequest, UploadFailure, UploadResult,
)
from server.scoring import ranking_key, score_application
from server.security import current_user, require_admin
from server.worker import worker

router = APIRouter(prefix="/api/jobs", tags=["jobs"], dependencies=[Depends(current_user)])


def _get_job(db: Session, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return job


def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    """Returns (safe filename, bytes), enforcing type and size limits."""
    filename = os.path.basename(file.filename or "upload")
    if not filename.lower().endswith(SUPPORTED_EXTENSIONS):
        raise ValueError("Only PDF and DOCX files are supported")
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    return filename, data


def _job_stats(db: Session, job_ids: list[int]) -> dict[int, dict]:
    rows = db.execute(
        select(
            Application.job_id,
            func.count(),
            func.sum(case((Application.screening_status == "done", 1), else_=0)),
            func.sum(case((Application.decision == "shortlisted", 1), else_=0)),
            func.sum(case((Application.screening_status.in_(("queued", "running")), 1), else_=0)),
        ).where(Application.job_id.in_(job_ids)).group_by(Application.job_id)
    ).all()
    req_counts = dict(db.execute(
        select(Requirement.job_id, func.count()).where(Requirement.job_id.in_(job_ids)).group_by(Requirement.job_id)
    ).all())
    stats = {job_id: {"candidate_count": total, "screened_count": done, "shortlisted_count": shortlisted, "in_queue_count": queued}
             for job_id, total, done, shortlisted, queued in rows}
    return {job_id: {**stats.get(job_id, {}), "requirement_count": req_counts.get(job_id, 0)} for job_id in job_ids}


def _summary(job: Job, stats: dict) -> dict:
    return {
        "id": job.id, "title": job.title, "department": job.department, "status": job.status,
        "created_at": job.created_at, "created_by_name": job.created_by.full_name if job.created_by else None, **stats,
    }


def _detail(db: Session, job: Job) -> JobDetail:
    return JobDetail(
        **_summary(job, _job_stats(db, [job.id])[job.id]),
        description=job.description,
        extraction_status=job.extraction_status,
        extraction_error=job.extraction_error,
        requirements_updated_at=job.requirements_updated_at,
        documents=[
            DocumentOut(id=d.id, filename=d.filename, uploaded_at=d.uploaded_at, char_count=len(d.text), preview=d.text[:400])
            for d in job.documents
        ],
    )


# --- Jobs ---
@router.get("", response_model=list[JobSummary])
def list_jobs(db: Session = Depends(get_db)):
    jobs = db.scalars(select(Job).order_by(Job.status.desc(), Job.created_at.desc())).all()  # 'open' sorts before 'closed'
    stats = _job_stats(db, [j.id for j in jobs])
    return [JobSummary(**_summary(j, stats[j.id])) for j in jobs]


@router.post("", response_model=JobDetail, status_code=status.HTTP_201_CREATED)
def create_job(body: JobIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = Job(title=body.title.strip(), department=body.department.strip(), description=body.description, created_by_id=user.id)
    db.add(job)
    db.commit()
    return _detail(db, job)


@router.get("/{job_id}", response_model=JobDetail)
def get_job(job_id: int, db: Session = Depends(get_db)):
    return _detail(db, _get_job(db, job_id))


@router.patch("/{job_id}", response_model=JobDetail)
def update_job(job_id: int, body: JobUpdate, db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(job, field, value.strip() if field in ("title", "department") else value)
    db.commit()
    return _detail(db, job)


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_admin)])
def delete_job(job_id: int, db: Session = Depends(get_db)):
    db.delete(_get_job(db, job_id))
    db.commit()


# --- Organisation documents & requirement extraction ---
@router.post("/{job_id}/documents", response_model=UploadResult)
def upload_documents(job_id: int, files: list[UploadFile] = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    result = UploadResult(added=0, duplicates=[], failed=[])
    existing = {d.filename for d in job.documents}
    for file in files:
        try:
            filename, data = _read_upload(file)
            if filename in existing:
                result.duplicates.append(filename)
                continue
            text = parse_document_bytes(data, filename)
            if not text.strip():
                raise ValueError("No text found. Scanned documents are not supported yet.")
        except Exception as e:
            result.failed.append(UploadFailure(filename=file.filename or "upload", error=str(e)))
            continue
        db.add(JobDocument(job_id=job.id, filename=filename, text=text, uploaded_by_id=user.id))
        existing.add(filename)
        result.added += 1
    db.commit()
    return result


@router.delete("/{job_id}/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(job_id: int, document_id: int, db: Session = Depends(get_db)):
    document = db.get(JobDocument, document_id)
    if document is None or document.job_id != job_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    db.delete(document)
    db.commit()


@router.post("/{job_id}/extract", response_model=JobDetail)
def queue_extraction(job_id: int, db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    if job.extraction_status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Extraction is already in progress")
    if not job.documents and not job.description.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload a document or add a job description first")
    job.extraction_status, job.extraction_error = "queued", None
    db.commit()
    worker.notify()
    return _detail(db, job)


# --- Requirements ---
@router.get("/{job_id}/requirements", response_model=list[RequirementOut])
def list_requirements(job_id: int, db: Session = Depends(get_db)):
    return _get_job(db, job_id).requirements


@router.put("/{job_id}/requirements", response_model=list[RequirementOut])
def replace_requirements(job_id: int, body: list[RequirementIn], db: Session = Depends(get_db)):
    """Saves the whole edited list: updates rows with an id, creates rows without, deletes the rest."""
    job = _get_job(db, job_id)
    if job.extraction_status in ("queued", "running"):
        raise HTTPException(status.HTTP_409_CONFLICT, "Wait for requirement extraction to finish")
    current = {r.id: r for r in job.requirements}
    unknown = [r.id for r in body if r.id is not None and r.id not in current]
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown requirement ids: {unknown}")

    # Removing a requirement leaves the remaining evaluations valid; only new or reworded ones need re-screening
    changed = False
    kept = {r.id for r in body if r.id is not None}
    removed = [rid for rid in current if rid not in kept]
    if removed:
        db.execute(delete(Requirement).where(Requirement.id.in_(removed)))
    for position, item in enumerate(body):
        fields = {"text": item.text.strip(), "category": item.category, "must_have": item.must_have, "weight": item.weight}
        if item.id is None:
            db.add(Requirement(job_id=job.id, position=position, **fields))
            changed = True
            continue
        req = current[item.id]
        # Only wording changes invalidate screening results; weights and must-haves are applied at ranking time
        changed = changed or req.text != fields["text"]
        for key, value in fields.items():
            setattr(req, key, value)
        req.position = position
    if changed:
        job.requirements_updated_at = utcnow()
    db.commit()
    db.refresh(job)
    return job.requirements


# --- Candidates & screening ---
@router.get("/{job_id}/applications", response_model=list[ApplicationRow])
def list_applications(job_id: int, db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    requirements = list(job.requirements)
    rows = [application_row(app, requirements) for app in job.applications]
    return sorted(rows, key=ranking_key)


def application_row(app: Application, requirements: list[Requirement]) -> dict:
    return {
        "id": app.id, "candidate_id": app.candidate_id,
        "candidate_name": app.candidate.full_name or os.path.splitext(app.candidate.filename)[0],
        "filename": app.candidate.filename, "screening_status": app.screening_status,
        "screening_error": app.screening_error, "decision": app.decision, "created_at": app.created_at,
        **score_application(app, requirements),
    }


@router.post("/{job_id}/applications", response_model=UploadResult)
def upload_resumes(job_id: int, files: list[UploadFile] = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    # Screening starts automatically once the job has requirements
    auto_queue = bool(job.requirements)
    result = UploadResult(added=0, duplicates=[], failed=[], queued=auto_queue)
    for file in files:
        try:
            filename, data = _read_upload(file)
            file_hash = hashlib.sha256(data).hexdigest()
            candidate = db.scalars(select(Candidate).where(Candidate.file_hash == file_hash)).first()
            if candidate is None:
                text = parse_document_bytes(data, filename)
                if len(text.strip()) < MIN_RESUME_CHARS:
                    raise ValueError("Almost no text could be read. This is probably a scanned or image-only file.")
                ext = os.path.splitext(filename)[1].lower()
                (FILES_DIR / f"{file_hash}{ext}").write_bytes(data)
                candidate = Candidate(filename=filename, file_hash=file_hash, file_ext=ext, raw_text=text, uploaded_by_id=user.id)
                db.add(candidate)
                db.flush()
            elif db.scalar(select(func.count()).where(Application.job_id == job.id, Application.candidate_id == candidate.id)):
                result.duplicates.append(filename)
                continue
        except Exception as e:
            result.failed.append(UploadFailure(filename=file.filename or "upload", error=str(e)))
            continue
        db.add(Application(
            job_id=job.id, candidate_id=candidate.id,
            screening_status="queued" if auto_queue else "pending", queued_at=utcnow() if auto_queue else None,
        ))
        result.added += 1
    db.commit()
    if auto_queue and result.added:
        worker.notify()
    return result


@router.post("/{job_id}/screen")
def queue_screening(job_id: int, body: ScreenRequest, db: Session = Depends(get_db)):
    job = _get_job(db, job_id)
    if not job.requirements:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add requirements before screening")
    requirements = list(job.requirements)
    query = select(Application).where(Application.job_id == job_id, Application.screening_status.not_in(("queued", "running")))
    if body.application_ids:
        query = query.where(Application.id.in_(body.application_ids))
    elif body.scope == "unscreened":
        query = query.where(or_(Application.screening_status == "pending", Application.screening_status == "failed"))

    queued = 0
    now = utcnow()
    for app in db.scalars(query):
        if body.scope == "stale" and not body.application_ids and app.screening_status == "done" \
                and not score_application(app, requirements)["stale"]:
            continue
        app.screening_status, app.screening_error, app.queued_at = "queued", None, now
        queued += 1
    db.commit()
    if queued:
        worker.notify()
    return {"queued": queued}
