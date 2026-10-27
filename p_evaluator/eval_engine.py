from pydantic import BaseModel, Field, create_model
from typing import List
import ollama

# Ollama's default context window (2048-4096 tokens) silently truncates long resumes.
# Llama 3.1 supports far more, so the window is sized per resume, within these bounds.
MIN_NUM_CTX = 8192
MAX_NUM_CTX = 32768
CHARS_PER_TOKEN = 3          # Conservative; English text averages ~4 chars per Llama 3 token
OUTPUT_TOKENS_PER_CRITERION = 300
OUTPUT_TOKENS_BASE = 500

# 1. Declare Pydantic Data Structures for Constrained Decoding
class CriterionAssessment(BaseModel):
    is_matched: bool = Field(description="Set to True if the candidate possesses this skill/criteria based on explicit resume facts. False otherwise.")
    evidence: str = Field(description="One direct quote or hard fact from the resume. If unmatched, summarize the gap briefly.")
    score: int = Field(description="Score from 0 to 10 on how well they meet this specific criteria based on tenure or depth.")

class CriteriaMatch(CriterionAssessment):
    criterion_name: str = Field(description="The exact requirement name evaluated.")

class ResumeScorecard(BaseModel):
    candidate_name: str = Field(description="The full name of the candidate parsed from the resume.")
    overall_suitability_summary: str = Field(description="A concise 2-sentence structural summary of their overall fit.")
    criteria_evaluations: List[CriteriaMatch]

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

# 2. Main Local AI Evaluator function
def _required_num_ctx(prompt_chars: int, criteria_count: int) -> int:
    """
    Ollama truncates an oversized prompt without erroring (and reports the truncated
    token count), so the window must be sized before the call rather than checked after.
    """
    needed = prompt_chars // CHARS_PER_TOKEN + OUTPUT_TOKENS_BASE + OUTPUT_TOKENS_PER_CRITERION * criteria_count
    if needed > MAX_NUM_CTX:
        raise ValueError(f"Resume too long to evaluate without truncation (~{needed} tokens needed, limit {MAX_NUM_CTX}).")
    return max(MIN_NUM_CTX, -(-needed // 1024) * 1024)  # Round up to a multiple of 1024

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
    """
    user_prompt = f"Candidate Resume Text:\n---\n{resume_text}\n---"
    num_ctx = _required_num_ctx(len(system_prompt) + len(user_prompt), len(criteria_list))

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

    # Map answers back to the recruiter's own criteria text by position
    return ResumeScorecard(
        candidate_name=parsed.candidate_name,
        overall_suitability_summary=parsed.overall_suitability_summary,
        criteria_evaluations=[
            CriteriaMatch(criterion_name=c, **getattr(parsed, f"criterion_{i}").model_dump())
            for i, c in enumerate(criteria_list, start=1)
        ],
    )
