import sys
import os
import streamlit as st
import pandas as pd
import plotly.express as px

# 1. Resolve Pathing Setup First
# This ensures Python can locate sibling directories like 1_parser and 2_database
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.append(PROJECT_ROOT)

from p_parser.pdf_parser import parse_pdf_to_text
from p_database import db_manager
from p_evaluator.eval_engine import evaluate_resume

# 2. Configure Streamlit Web Engine
st.set_page_config(page_title="Local AI Resume Analyzer", layout="wide")
db_manager.initialize_database()

st.title("🎯 Local AI Recruiter Screener & Analyzer")
st.write("An absolute privacy-first, local resume pipeline running completely on your machine using Ollama.")

# Keep track of uploaded files in memory to prevent processing duplicates
if "processed_files" not in st.session_state:
    st.session_state["processed_files"] = set()

# --- SIDEBAR: Ingestion & System Setup ---
with st.sidebar:
    st.header("📂 Ingestion & Setup")
    
    # Section A: Role Setup
    st.subheader("1. Setup Job Role")
    job_title = st.text_input("Enter Job Title", placeholder="e.g., Security Analyst")
    
    st.write("Define Custom Criteria:")
    if "criteria" not in st.session_state:
        st.session_state["criteria"] = []
        
    new_crit = st.text_input("Add Requirement", placeholder="e.g., Experience with Kali Linux")
    if st.button("➕ Add Criteria") and new_crit:
        if new_crit not in st.session_state["criteria"]:
            st.session_state["criteria"].append(new_crit)
            st.rerun()
            
    # Dynamic list output with deletions
    for idx, c in enumerate(st.session_state["criteria"]):
        col1, col2 = st.columns([0.8, 0.2])
        col1.write(f"• {c}")
        if col2.button("❌", key=f"del_{idx}"):
            st.session_state["criteria"].pop(idx)
            st.rerun()

    st.write("---")
    
    # Section B: File Drop-Zone Uploader
    st.subheader("2. Upload Resumes")
    uploaded_files = st.file_uploader("Drop PDF Resumes here", type=["pdf"], accept_multiple_files=True)
    
    if uploaded_files:
        for file in uploaded_files:
            if file.name not in st.session_state["processed_files"]:
                # Securely manage local temporary path block
                temp_path = os.path.join(CURRENT_DIR, file.name)
                with open(temp_path, "wb") as f:
                    f.write(file.getbuffer())
                
                # Ingest through Module 1 Parser and commit to SQLite Database
                with st.spinner(f"Parsing {file.name}..."):
                    raw_text = parse_pdf_to_text(temp_path)
                    db_manager.insert_candidate(file.name, raw_text)
                
                # Clean local storage traces
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                st.session_state["processed_files"].add(file.name)
        st.success(f"Indexed {len(uploaded_files)} candidate profiles in database!")

# --- MAIN DASHBOARD: Display and Calculations ---
if not job_title or not st.session_state["criteria"]:
    st.warning("👈 Please define a Job Title and enter at least one evaluation criteria in the sidebar to begin.")
else:
    st.subheader(f"Current Pipeline: {job_title}")
    
    conn = db_manager.get_db_connection()
    candidates = conn.execute("SELECT * FROM candidates").fetchall()
    
    if not candidates:
        st.info("No candidates uploaded yet. Drop some PDFs in the sidebar to get started.")
    else:
        st.write(f"Available candidates in system: **{len(candidates)}**")
        
        # Trigger Screening
        if st.button("⚡ Run Dynamic AI Screen", type="primary"):
            job_id = db_manager.insert_job(job_title)
            
            progress_bar = st.progress(0)
            status_text = st.empty()
            
            for idx, cand in enumerate(candidates):
                status_text.write(f"Evaluating Candidate {idx + 1}/{len(candidates)} ({cand['filename']})...")
                
                # Run evaluation via local Ollama Engine
                scorecard = evaluate_resume(cand['raw_text'], st.session_state["criteria"])
                
                # Commit individual criteria parameters to Database
                for match in scorecard.criteria_evaluations:
                    db_manager.save_evaluation(
                        candidate_id=cand['id'],
                        job_id=job_id,
                        criterion_name=match.criterion_name,
                        is_matched=match.is_matched,
                        evidence=match.evidence,
                        score=match.score
                    )
                progress_bar.progress((idx + 1) / len(candidates))
                
            status_text.empty()
            progress_bar.empty()
            st.success("Screening Complete!")

        # Pull scorecards for current job context
        eval_data = conn.execute("""
            SELECT c.id, c.filename, e.criterion_name, e.is_matched, e.evidence, e.score 
            FROM candidates c
            JOIN evaluations e ON c.id = e.candidate_id
            JOIN jobs j ON e.job_id = j.id
            WHERE j.title = ?
        """, (job_title,)).fetchall()
        
        if eval_data:
            df = pd.DataFrame(eval_data, columns=["id", "filename", "criteria", "matched", "evidence", "score"])
            
            # Match Percentage Calculation: (True matches / total criteria) * 100
            grouped = df.groupby("filename").agg(
                match_percentage=("matched", lambda x: int((sum(x) / len(x)) * 100)),
                average_score=("score", "mean")
            ).reset_index().sort_values(by="match_percentage", ascending=False)
            
            st.write("---")
            st.header("📊 Analytical Leaderboard")
            
            # Analytical Visualization Chart
            fig = px.bar(
                grouped,
                x="match_percentage",
                y="filename",
                orientation='h',
                labels={"match_percentage": "Requirement Match Rate (%)", "filename": "Candidate File"},
                title="Overall Match Success Across Candidates",
                color="match_percentage",
                color_continuous_scale="Viridis"
            )
            fig.update_layout(yaxis={'categoryorder':'total ascending'}, height=400)
            st.plotly_chart(fig, use_container_width=True)
            
            st.write("---")
            st.subheader("🔍 Deep-Dive Candidate Scorecards")
            
            # Select individual candidates for breakdown metrics
            selected_file = st.selectbox("Select Candidate to Inspect", grouped["filename"].tolist())
            
            if selected_file:
                cand_rows = df[df["filename"] == selected_file]
                cand_match_pct = grouped[grouped["filename"] == selected_file]["match_percentage"].iloc[0]
                
                # Metric Cards
                col1, col2, col3 = st.columns(3)
                col1.metric("Overall Match Rate", f"{cand_match_pct}%")
                col2.metric("Requirements Met", f"{sum(cand_rows['matched'])} of {len(cand_rows)}")
                col3.metric("Avg Competency Score", f"{round(cand_rows['score'].mean(), 1)} / 10")
                
                st.write("**Criteria Performance:**")
                for _, r in cand_rows.iterrows():
                    status_icon = "🟢 MATCHED" if r["matched"] == 1 else "🔴 UNMATCHED"
                    
                    st.write(f"**{r['criteria']}** | {status_icon} | Score: `{r['score']}/10`")
                    st.progress(r["score"] / 10)
                    st.info(f"**Supporting Evidence:** *\"{r['evidence']}\"*")
                    st.write("")
        else:
            st.info("Dynamic screening scorecards have not been calculated for this job yet. Press the '⚡ Run Dynamic AI Screen' button above to generate metrics.")
    conn.close()