from pydantic import BaseModel, Field
from typing import List
import json
import ollama

# 1. Declare Pydantic Data Structures for Constrained Decoding
class CriteriaMatch(BaseModel):
    criterion_name: str = Field(description="The exact requirement name evaluated.")
    is_matched: bool = Field(description="Set to True if the candidate possesses this skill/criteria based on explicit resume facts. False otherwise.")
    evidence: str = Field(description="One direct quote or hard fact from the resume. If unmatched, summarize the gap briefly.")
    score: int = Field(description="Score from 0 to 10 on how well they meet this specific criteria based on tenure or depth.")

class ResumeScorecard(BaseModel):
    candidate_name: str = Field(description="The full name of the candidate parsed from the resume.")
    overall_suitability_summary: str = Field(description="A concise 2-sentence structural summary of their overall fit.")
    criteria_evaluations: List[CriteriaMatch]

# 2. Main Local AI Evaluator function
def evaluate_resume(resume_text: str, criteria_list: List[str], model_name: str = "llama3.1") -> ResumeScorecard:
    formatted_criteria = "\n".join([f"- {c}" for c in criteria_list])
    
    system_prompt = f"""
    You are an extremely objective, skeptical technical recruiter evaluating candidate profiles.
    Analyze the candidate's resume text and evaluate them strictly against these requirements:
    
    {formatted_criteria}
    
    Rules:
    - Set is_matched to True ONLY if there is explicit, undeniable proof in the text.
    - If a requirement is missing or only vaguely implied, mark is_matched as False.
    - Do not make assumptions or extrapolate outside of stated resume text facts.
    """
    
    response = ollama.chat(
        model=model_name,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Candidate Resume Text:\n---\n{resume_text}\n---"}
        ],
        # Force Ollama to return structured, typed JSON
        format=ResumeScorecard.model_json_schema(),
        options={"temperature": 0.0}  # Ensure deterministic, objective factual grading
    )
    
    return ResumeScorecard.model_validate_json(response['message']['content'])