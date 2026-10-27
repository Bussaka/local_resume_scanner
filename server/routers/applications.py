from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from server.config import FILES_DIR
from server.db import get_db
from server.models import Application, Candidate, User, utcnow
from server.routers.jobs import application_row
from server.schemas import ApplicationDetail, ApplicationUpdate, EvaluationOut
from server.security import current_user

router = APIRouter(prefix="/api", tags=["applications"], dependencies=[Depends(current_user)])

MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _get_application(db: Session, application_id: int) -> Application:
    app = db.get(Application, application_id)
    if app is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    return app


def _detail(app: Application) -> ApplicationDetail:
    requirements = list(app.job.requirements)
    evals = {e.requirement_id: e for e in app.evaluations}
    return ApplicationDetail(
        **application_row(app, requirements),
        job_id=app.job_id,
        job_title=app.job.title,
        summary=app.summary,
        screened_at=app.screened_at,
        model_name=app.model_name,
        notes=app.notes,
        decided_by_name=app.decided_by.full_name if app.decided_by else None,
        decided_at=app.decided_at,
        file_ext=app.candidate.file_ext,
        resume_text=app.candidate.raw_text,
        evaluations=[
            EvaluationOut(
                requirement_id=r.id, requirement_text=r.text, category=r.category, must_have=r.must_have, weight=r.weight,
                is_matched=evals[r.id].is_matched, score=evals[r.id].score, evidence=evals[r.id].evidence,
            )
            for r in requirements if r.id in evals
        ],
    )


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
def get_application(application_id: int, db: Session = Depends(get_db)):
    return _detail(_get_application(db, application_id))


@router.patch("/applications/{application_id}", response_model=ApplicationDetail)
def update_application(application_id: int, body: ApplicationUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    app = _get_application(db, application_id)
    if body.decision is not None and body.decision != app.decision:
        app.decision, app.decided_by_id, app.decided_at = body.decision, user.id, utcnow()
    if body.notes is not None:
        app.notes = body.notes
    db.commit()
    db.refresh(app)
    return _detail(app)


@router.delete("/applications/{application_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_application(application_id: int, db: Session = Depends(get_db)):
    """Removes the candidate from this job only; their resume stays available for other jobs."""
    db.delete(_get_application(db, application_id))
    db.commit()


@router.get("/candidates/{candidate_id}/file")
def candidate_file(candidate_id: int, db: Session = Depends(get_db)):
    candidate = db.get(Candidate, candidate_id)
    path = FILES_DIR / f"{candidate.file_hash}{candidate.file_ext}" if candidate else None
    if path is None or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File not found")
    # inline so PDFs render in the browser's viewer next to the scorecard
    return FileResponse(path, media_type=MEDIA_TYPES.get(candidate.file_ext), filename=candidate.filename, content_disposition_type="inline")
