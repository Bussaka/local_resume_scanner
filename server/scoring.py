from server.models import Application, Requirement


def score_application(app: Application, requirements: list[Requirement]) -> dict:
    """
    Turns per-requirement evaluations into ranking numbers:
    - must-haves act as knockouts (passes_must_haves)
    - score is the weighted average of 0-10 scores, as a percentage
    - stale means requirements changed after this candidate was screened
    """
    evals = {e.requirement_id: e for e in app.evaluations}
    result = {
        "score": None,
        "passes_must_haves": None,
        "matched_count": sum(1 for r in requirements if r.id in evals and evals[r.id].is_matched),
        "requirement_count": len(requirements),
        "missing_must_haves": [],
        "stale": False,
    }
    if app.screening_status != "done" or not evals:
        return result

    evaluated = [r for r in requirements if r.id in evals]
    max_points = sum(r.weight * 10 for r in evaluated)
    if max_points:
        result["score"] = round(sum(r.weight * evals[r.id].score for r in evaluated) / max_points * 100)
    result["missing_must_haves"] = [r.text for r in evaluated if r.must_have and not evals[r.id].is_matched]
    result["passes_must_haves"] = not result["missing_must_haves"]

    job_changed = app.job.requirements_updated_at and app.screened_at and app.screened_at < app.job.requirements_updated_at
    result["stale"] = bool(job_changed or len(evaluated) < len(requirements))
    return result


def ranking_key(row: dict):
    """Screened candidates passing every must-have first, then knocked-out ones, then unscreened; best score first."""
    if row["score"] is None:
        return (2, 0)
    return (0 if row["passes_must_haves"] else 1, -row["score"])
