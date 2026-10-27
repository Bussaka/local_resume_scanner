import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# All runtime data (database + uploaded files) lives here; keep it out of git and back it up.
DATA_DIR = Path(os.environ.get("RS_DATA_DIR", PROJECT_ROOT / "data"))
FILES_DIR = DATA_DIR / "files"
DB_PATH = DATA_DIR / "recruit.db"

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"

OLLAMA_MODEL = os.environ.get("RS_OLLAMA_MODEL", "llama3.1")

SESSION_COOKIE = "rs_session"
SESSION_HOURS = int(os.environ.get("RS_SESSION_HOURS", "12"))
# Set RS_SECURE_COOKIES=1 once the app is served over HTTPS
SECURE_COOKIES = os.environ.get("RS_SECURE_COOKIES", "0") == "1"

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MIN_RESUME_CHARS = 200  # Less than this usually means a scanned/image-only PDF
