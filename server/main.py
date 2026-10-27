import logging
from contextlib import asynccontextmanager

import ollama
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse

from server.config import FRONTEND_DIST, OLLAMA_MODEL
from server.db import init_db
from server.routers import applications, auth, jobs, users
from server.security import current_user
from server.worker import worker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    worker.start()
    yield
    worker.stop()


app = FastAPI(title="Resume Scanner", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(jobs.router)
app.include_router(applications.router)


@app.get("/api/system/status", dependencies=[Depends(current_user)])
def system_status():
    """Health of the AI backend, shown in the UI so HR knows why screening isn't moving."""
    try:
        models = ollama.Client(timeout=3).list().models
        names = {m.model for m in models} | {m.model.split(":")[0] for m in models}
        model_ready = OLLAMA_MODEL in names
        ollama_error = None if model_ready else f"Model '{OLLAMA_MODEL}' is not installed. Run: ollama pull {OLLAMA_MODEL}"
    except Exception:
        ollama_error = "Cannot connect to Ollama. Is it running on the server?"
    return {
        "model": OLLAMA_MODEL,
        "ollama_ok": ollama_error is None,
        "ollama_error": ollama_error,
        "queue_length": worker.queue_length(),
        "current_task": worker.current_task,
    }


# --- Built React app (npm run build) served from the same origin, so cookies just work ---
@app.get("/{path:path}", include_in_schema=False)
def frontend(path: str):
    if path.startswith("api/"):
        raise HTTPException(404, "Not found")
    if not FRONTEND_DIST.is_dir():
        raise HTTPException(404, "Frontend not built. Run: cd frontend && npm run build")
    target = (FRONTEND_DIST / path).resolve()
    if path and target.is_file() and target.is_relative_to(FRONTEND_DIST.resolve()):
        return FileResponse(target)
    return FileResponse(FRONTEND_DIST / "index.html")  # Client-side routes
