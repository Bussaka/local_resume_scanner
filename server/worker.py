"""
Single background thread that drains the AI work queue.

The queue lives in the database (jobs.extraction_status / applications.screening_status = 'queued'),
so work survives closed browser tabs and server restarts. One thread is deliberate: a local
Ollama model processes one request at a time anyway.
"""
import logging
import threading

import ollama
from sqlalchemy import delete, func, select, update

from p_evaluator.eval_engine import evaluate_resume, extract_requirements
from server.config import OLLAMA_MODEL
from server.db import SessionLocal
from server.models import Application, Evaluation, Job, Requirement, utcnow

log = logging.getLogger("resume_scanner.worker")

IDLE_POLL_SECONDS = 5
OLLAMA_DOWN_RETRY_SECONDS = 30


class OllamaUnavailable(Exception):
    """Ollama itself is unusable (not running, model missing): retry later instead of failing the item."""


def _call_ollama(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ConnectionError as e:
        raise OllamaUnavailable("Cannot connect to Ollama. Is it running on the server?") from e
    except ollama.ResponseError as e:
        if e.status_code == 404:
            raise OllamaUnavailable(f"Model '{OLLAMA_MODEL}' is not installed. Run: ollama pull {OLLAMA_MODEL}") from e
        raise


class Worker:
    def __init__(self):
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._thread: threading.Thread | None = None
        self.ollama_error: str | None = None
        self.current_task: str | None = None

    def start(self):
        with SessionLocal() as db:
            # Anything 'running' was interrupted by a restart; put it back in the queue
            db.execute(update(Application).where(Application.screening_status == "running").values(screening_status="queued"))
            db.execute(update(Job).where(Job.extraction_status == "running").values(extraction_status="queued"))
            db.commit()
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="ai-worker", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._wake.set()

    def notify(self):
        """Called after queueing work so it starts immediately instead of on the next poll."""
        self._wake.set()

    def queue_length(self) -> int:
        with SessionLocal() as db:
            screening = db.scalar(select(func.count()).where(Application.screening_status.in_(("queued", "running"))))
            extraction = db.scalar(select(func.count()).where(Job.extraction_status.in_(("queued", "running"))))
            return screening + extraction

    def _run(self):
        while not self._stop.is_set():
            try:
                worked = self._process_next()
                self.ollama_error = None if worked else self.ollama_error
            except OllamaUnavailable as e:
                log.warning(str(e))
                self.ollama_error = str(e)
                worked = False
            except Exception:
                log.exception("Worker loop error")
                worked = False
            finally:
                self.current_task = None
            if not worked:
                self._wake.wait(OLLAMA_DOWN_RETRY_SECONDS if self.ollama_error else IDLE_POLL_SECONDS)
                self._wake.clear()

    def _process_next(self) -> bool:
        with SessionLocal() as db:
            job = db.scalars(select(Job).where(Job.extraction_status == "queued").order_by(Job.id)).first()
            if job:
                self._extract(db, job.id)
                return True
            app = db.scalars(
                select(Application).where(Application.screening_status == "queued").order_by(Application.queued_at, Application.id)
            ).first()
            if app:
                self._screen(db, app.id)
                return True
        return False

    # --- Requirement extraction ---
    def _extract(self, db, job_id: int):
        job = db.get(Job, job_id)
        documents = "\n\n".join(f"### Document: {d.filename}\n{d.text}" for d in job.documents)
        if job.description.strip():
            documents = f"### Job description\n{job.description}\n\n{documents}"
        if not documents.strip():
            job.extraction_status, job.extraction_error = "failed", "Upload at least one document or add a job description first."
            db.commit()
            return

        job.extraction_status, job.extraction_error = "running", None
        db.commit()
        self.current_task = f"Extracting requirements for '{job.title}'"
        log.info(self.current_task)

        try:
            extracted = _call_ollama(extract_requirements, documents, job.title, model_name=OLLAMA_MODEL)
        except OllamaUnavailable:
            job.extraction_status = "queued"
            db.commit()
            raise
        except Exception as e:
            log.exception("Extraction failed for job %s", job_id)
            job.extraction_status, job.extraction_error = "failed", str(e)
            db.commit()
            return

        db.expire_all()
        job = db.get(Job, job_id)
        if job is None:  # Deleted while the model was running
            return
        # Extraction replaces the list; the UI warns before queueing it over existing requirements
        db.execute(delete(Requirement).where(Requirement.job_id == job_id))
        for position, r in enumerate(extracted):
            db.add(Requirement(job_id=job_id, text=r.text, category=r.category, must_have=r.must_have, weight=r.weight, position=position))
        job.extraction_status, job.extraction_error = "idle", None
        job.requirements_updated_at = utcnow()
        db.commit()

    # --- Resume screening ---
    def _screen(self, db, application_id: int):
        app = db.get(Application, application_id)
        requirements = list(app.job.requirements)
        if not requirements:
            app.screening_status, app.screening_error = "failed", "This job has no requirements yet."
            db.commit()
            return

        # Timestamp the start: requirements edited mid-run must still mark this result stale
        started_at = utcnow()
        app.screening_status, app.screening_error = "running", None
        db.commit()
        snapshot = [(r.id, r.text) for r in requirements]
        self.current_task = f"Screening {app.candidate.filename} for '{app.job.title}'"
        log.info(self.current_task)

        try:
            scorecard = _call_ollama(evaluate_resume, app.candidate.raw_text, [text for _, text in snapshot], model_name=OLLAMA_MODEL)
        except OllamaUnavailable:
            app.screening_status = "queued"
            db.commit()
            raise
        except Exception as e:
            log.exception("Screening failed for application %s", application_id)
            app.screening_status, app.screening_error = "failed", str(e)
            db.commit()
            return

        db.expire_all()
        app = db.get(Application, application_id)
        if app is None:  # Removed from the job while the model was running
            return
        still_exists = set(db.scalars(select(Requirement.id).where(Requirement.job_id == app.job_id)))
        db.execute(delete(Evaluation).where(Evaluation.application_id == application_id))
        for (req_id, _), match in zip(snapshot, scorecard.criteria_evaluations):
            if req_id in still_exists:
                db.add(Evaluation(application_id=application_id, requirement_id=req_id,
                                  is_matched=match.is_matched, score=match.score, evidence=match.evidence))
        if not app.candidate.full_name and scorecard.candidate_name.strip():
            app.candidate.full_name = scorecard.candidate_name.strip()[:255]
        app.summary = scorecard.overall_suitability_summary
        app.screening_status, app.screening_error = "done", None
        app.screened_at, app.model_name = started_at, OLLAMA_MODEL
        db.commit()


worker = Worker()
