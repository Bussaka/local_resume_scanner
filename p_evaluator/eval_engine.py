from datetime import date
from pydantic import BaseModel, Field, create_model
from typing import List, Literal
import ollama

# Ollama's default context window (2048-4096 tokens) silently truncates long resumes.
# Llama 3.1 supports far more, so the window is sized per resume, within these bounds.
MIN_NUM_CTX = 8192
MAX_NUM_CTX = 32768
CHARS_PER_TOKEN = 3          # Conservative; English text averages ~4 chars per Llama 3 token
OUTPUT_TOKENS_PER_CRITERION = 300
OUTPUT_TOKENS_BASE = 500
EXTRACTION_OUTPUT_TOKENS = 3000

# 1. Declare Pydantic Data Structures for Constrained Decoding
class CriterionAssessment(BaseModel):
    # evidence comes first: the model generates fields in order, so it states the facts before judging them
    evidence: str = Field(description="One direct quote or hard fact from the resume. If unmatched, summarize the gap briefly.")
    is_matched: bool = Field(description="Set to True if the candidate possesses this skill/criteria based on explicit resume facts. False otherwise.")
    score: int = Field(description="Score from 0 to 10 on how well they meet this specific criteria based on tenure or depth.")

class CriteriaMatch(CriterionAssessment):
    criterion_name: str = Field(description="The exact requirement name evaluated.")

class ResumeScorecard(BaseModel):
    candidate_name: str = Field(description="The full name of the candidate parsed from the resume.")
    overall_suitability_summary: str = Field(description="A concise 2-sentence structural summary of their overall fit.")
    criteria_evaluations: List[CriteriaMatch]

RequirementCategory = Literal["skill", "experience", "education", "certification", "language", "location", "other"]

class ExtractedRequirement(BaseModel):
    text: str = Field(description="One self-contained, checkable requirement, e.g. '3+ years of Python development'.")
    category: RequirementCategory
    must_have: bool = Field(description="True only if the document states it is required, mandatory or a minimum.")
    weight: int = Field(description="Importance from 1 (minor) to 5 (critical).")

class ExtractedRequirements(BaseModel):
    requirements: List[ExtractedRequirement]

def _build_response_model(criteria_list: List[str]) -> type[BaseModel]:
    """
    Builds a schema with one fixed slot per criterion (criterion_1, criterion_2, ...).
    Constrained decoding then forces the model to answer every criterion exactly once,
    in order, so it can never rename, merge or skip a requirement.
    """
    criterion_fields = {
        f"criterion_{i}": (CriterionAssessment, Field(description=c))
        for i, c in enumerate(criteria_list, start=1)
    }
    return create_model(
        "ResumeEvaluation",
        candidate_name=(str, Field(description="The full name of the candidate parsed from the resume.")),
        overall_suitability_summary=(str, Field(description="A concise 2-sentence structural summary of their overall fit.")),
        **criterion_fields,
    )

def _required_num_ctx(prompt_chars: int, output_tokens: int) -> int:
    """
    Ollama truncates an oversized prompt without erroring (and reports the truncated
    token count), so the window must be sized before the call rather than checked after.
    """
    needed = prompt_chars // CHARS_PER_TOKEN + output_tokens
    if needed > MAX_NUM_CTX:
        raise ValueError(f"Text too long to process without truncation (~{needed} tokens needed, limit {MAX_NUM_CTX}).")
    return max(MIN_NUM_CTX, -(-needed // 1024) * 1024)  # Round up to a multiple of 1024

# 2. Main Local AI Evaluator function
def evaluate_resume(resume_text: str, criteria_list: List[str], model_name: str = "llama3.1") -> ResumeScorecard:
    formatted_criteria = "\n".join([f"- criterion_{i}: {c}" for i, c in enumerate(criteria_list, start=1)])
    response_model = _build_response_model(criteria_list)

    system_prompt = f"""
    You are an extremely objective, skeptical technical recruiter evaluating candidate profiles.
    Analyze the candidate's resume text and evaluate them strictly against these requirements.
    Answer each requirement in the JSON field with the matching key:

    {formatted_criteria}

    Rules:
    - Set is_matched to True ONLY if there is explicit, undeniable proof in the text.
    - If a requirement is missing or only vaguely implied, mark is_matched as False.
    - Do not make assumptions or extrapolate outside of stated resume text facts.
    - Today's date is {date.today():%B %Y}; "Present" or "Current" in a resume means today.
    - For requirements with a duration (e.g. "3+ years"), resumes rarely state the total; work it out.
      In evidence, list each relevant role with its dates and years, then the total,
      e.g. "Analyst, Acme (Jan 2019 - Present) = 7 years; total 7 years". Matched if the total meets it.
    - Otherwise evidence must be a direct quote from the resume when matched, or a one-line description of the gap.
    - Ignore age, gender, marital status, ethnicity, religion, nationality and photos; they are never evidence.

    Score each requirement on this 0-10 scale (never just 0 or 1):
    - 0: no evidence at all
    - 1-3: related or partial exposure only, requirement not met
    - 4-6: requirement met at the minimum level
    - 7-8: clearly exceeds the requirement (longer tenure, more depth or responsibility)
    - 9-10: exceptional, sustained expertise well beyond the requirement
    """
    user_prompt = f"Candidate Resume Text:\n---\n{resume_text}\n---"
    num_ctx = _required_num_ctx(
        len(system_prompt) + len(user_prompt),
        OUTPUT_TOKENS_BASE + OUTPUT_TOKENS_PER_CRITERION * len(criteria_list),
    )

    response = ollama.chat(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        # Force Ollama to return structured, typed JSON
        format=response_model.model_json_schema(),
        options={
            "temperature": 0.0,  # Ensure deterministic, objective factual grading
            "num_ctx": num_ctx,
        }
    )

    parsed = response_model.model_validate_json(response['message']['content'])
    assessments = [getattr(parsed, f"criterion_{i}") for i in range(1, len(criteria_list) + 1)]

    # Map answers back to the recruiter's own criteria text by position
    return ResumeScorecard(
        candidate_name=parsed.candidate_name,
        overall_suitability_summary=parsed.overall_suitability_summary,
        criteria_evaluations=[
            CriteriaMatch(criterion_name=c, is_matched=a.is_matched, evidence=a.evidence, score=min(10, max(0, a.score)))
            for c, a in zip(criteria_list, assessments)
        ],
    )

# 3. Requirement extraction from organisation documents (job descriptions, role profiles, policies)
def extract_requirements(document_text: str, job_title: str, model_name: str = "llama3.1") -> List[ExtractedRequirement]:
    system_prompt = f"""
    You are an experienced HR analyst. From the organisation's documents below, extract the
    requirements a candidate's resume must be checked against for the position: {job_title}.

    Rules:
    - Each requirement must be self-contained and checkable from a resume
      (e.g. "3+ years of experience in network security", "Holds a CPA certification").
    - Split combined requirements into separate items; do not repeat the same requirement.
    - Skip duties, benefits, company descriptions and anything not checkable from a resume.
    - must_have is True only when the document says required, mandatory, must or minimum.
    - weight: 5 for critical must-haves, 3 for normal requirements, 1-2 for nice-to-haves.
    - Never create requirements about age, gender, marital status, ethnicity, religion or nationality.
    - Return at most 15 requirements, most important first.
    """
    user_prompt = f"Organisation documents:\n---\n{document_text}\n---"
    num_ctx = _required_num_ctx(len(system_prompt) + len(user_prompt), EXTRACTION_OUTPUT_TOKENS)

    response = ollama.chat(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        format=ExtractedRequirements.model_json_schema(),
        options={"temperature": 0.0, "num_ctx": num_ctx}
    )

    parsed = ExtractedRequirements.model_validate_json(response['message']['content'])
    return [
        r.model_copy(update={"weight": min(5, max(1, r.weight)), "text": r.text.strip()})
        for r in parsed.requirements
        if r.text.strip()
    ][:15]
