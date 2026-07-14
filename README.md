# Local AI Recruiter Screener & Analyzer

A privacy-first, local resume parsing and dynamic screening pipeline running entirely on your machine. It extracts text from multi-column PDFs, stores them in a local SQLite database, and evaluates them against custom, dynamic criteria on-the-fly using **Ollama** (Llama 3.1).

---

## Key Features

* **100% Privacy-First:** Resumes never leave your local machine. Perfect for handling sensitive personal data and compliance.
* **Dynamic Criteria Evaluation:** Recruiters can type custom requirements on-the-fly (e.g., "Must know Docker", "Must reside in Nairobi") without modifying the codebase.
* **Multi-Column Layout Parsing:** Clean layout-aware text extraction that prevents columns from being merged horizontally.
* **Interactive Visual Analytics:** High-level candidate leaderboards (built with Plotly) and side-by-side KPI metric cards.
* **Structured Output Engine:** Constrains Ollama's local GPU output to strict, verifiable JSON schemas.

---

## System Architecture

1.  **Parser (`p_parser/`):** Strips formatting and extracts layout-correct text using `pypdf`.
2.  **Database (`p_database/`):** A local SQLite database utilizing a relational schema (`candidates`, `jobs`, `evaluations`).
3.  **Evaluator (`p_evaluator/`):** Configures local system instructions and schema bindings via `ollama-python`.
4.  **Dashboard (`p_dashboard/`):** An intuitive Streamlit interface featuring analytical tracking tools and metric comparisons.

---

## Setup & Installation

### Prerequisite: Install Ollama
Download and install [Ollama](https://ollama.com/) for your operating system. Once installed, pull your model of choice:
```bash
ollama pull llama3.1