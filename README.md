# TalentScreen: Local AI Resume Screening

A privacy-first screening app for HR teams. Upload a position's job description and organisation documents; a local LLM (via **Ollama**) drafts the screening requirements, HR reviews them, and every resume is scored against them with quoted evidence. Everything runs on one machine in your office network: resumes never leave it.

---

## How it works

1. **Create a job** and upload its organisation documents (job advert, role profile, competency framework; PDF or DOCX).
2. **Generate requirements with AI.** The model extracts checkable requirements, each with a category, must-have flag and weight (1–5). HR edits and approves the list.
3. **Upload resumes.** They are screened automatically in a background queue. Closing the browser does not stop it.
4. **Review the ranking.** Candidates missing a must-have are ranked below those who meet all of them; within each group, the weighted 0–100 score decides. Each requirement shows the evidence quoted from the resume.
5. **Decide.** Shortlist or reject, add notes. Every decision records who made it and when.

Editing requirement wording marks existing results as *outdated* so they can be re-screened; changing weights or must-have flags re-ranks instantly without re-screening.

## Architecture

| Part | Path | Role |
|---|---|---|
| Parser | `p_parser/` | Extracts text from PDF (layout-aware) and DOCX |
| Evaluator | `p_evaluator/` | Ollama prompts with JSON-schema constrained output: requirement extraction and per-requirement resume scoring |
| API | `server/` | FastAPI + SQLAlchemy (SQLite), cookie sessions, roles, background AI worker |
| Web UI | `frontend/` | React + TypeScript + Tailwind + shadcn/ui, served by the API in production |

Runtime data (database and uploaded resumes) lives in `data/`. **Back this folder up**; it contains personal data.

---

## Setup

### 1. Prerequisites
- Python 3.11+ and Node.js 20+
- [Ollama](https://ollama.com/) running on the same machine:
  ```bash
  ollama pull llama3.1
  ```

### 2. Install
```bash
python -m venv venv
venv\Scripts\activate            # Windows  (source venv/bin/activate on macOS/Linux)
pip install -r requirements.txt

cd frontend
npm install
npm run build
cd ..
```

### 3. Create the first admin
```bash
python -m server.create_admin you@company.com "Your Name"
```
Further HR staff are added from the **Team** page in the app.

### 4. Run on the office network
```bash
uvicorn server.main:app --host 0.0.0.0 --port 8000
```
Staff open `http://<this-machine's-IP>:8000`. On Windows, allow port 8000 through the firewall for the *Private* network profile only.

---

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `RS_OLLAMA_MODEL` | `llama3.1` | Ollama model for extraction and screening |
| `RS_DATA_DIR` | `./data` | Where the database and resume files are stored |
| `RS_SESSION_HOURS` | `12` | Sign-in session length |
| `RS_SECURE_COOKIES` | `0` | Set to `1` when serving over HTTPS |

**Security notes:** passwords are hashed with scrypt; sessions are httpOnly cookies. On a shared network, put the app behind HTTPS (e.g. Caddy or IIS reverse proxy) and set `RS_SECURE_COOKIES=1`.

**Speed:** on a CPU-only machine each resume takes about a minute; a GPU with 8 GB+ VRAM makes it several times faster.

---

## Development

```bash
uvicorn server.main:app --reload --port 8000     # API
cd frontend && npm run dev                        # UI with hot reload at http://localhost:5173 (proxies /api)
```

Tests (the AI calls are stubbed, so they run in seconds):
```bash
pytest tests
cd frontend && npm run typecheck
```

## Responsible use

AI scores are decision *support*. The prompts instruct the model to ignore age, gender, marital status, ethnicity, religion, nationality and photos, but a human makes every shortlisting decision. Automated CV screening is regulated in many jurisdictions (for example Kenya's Data Protection Act 2019 and the EU AI Act), so check your obligations around candidate notice, data retention and human review.
