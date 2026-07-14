import sqlite3
import os
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(__file__), "talent_pool.db")

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row  # Enables access columns by name like dictionary keys
    return conn

def initialize_database():
    """Initializes SQLite tables if they do not exist."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Store Candidates
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                raw_text TEXT NOT NULL,
                uploaded_at TEXT NOT NULL
            )
        """)
        
        # 2. Store Job Postings / Dynamic Projects
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        
        # 3. Store Dynamic Evaluation Scorecards
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS evaluations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                candidate_id INTEGER NOT NULL,
                job_id INTEGER NOT NULL,
                criterion_name TEXT NOT NULL,
                is_matched INTEGER NOT NULL, -- SQLite uses 0/1 for booleans
                evidence TEXT NOT NULL,
                score INTEGER NOT NULL,
                FOREIGN KEY (candidate_id) REFERENCES candidates (id) ON DELETE CASCADE,
                FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
            )
        """)
        conn.commit()

def insert_candidate(filename: str, raw_text: str) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO candidates (filename, raw_text, uploaded_at) VALUES (?, ?, ?)",
            (filename, raw_text, datetime.now().isoformat())
        )
        conn.commit()
        return cursor.lastrowid

def insert_job(title: str) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO jobs (title, created_at) VALUES (?, ?)",
            (title, datetime.now().isoformat())
        )
        conn.commit()
        return cursor.lastrowid

def save_evaluation(candidate_id: int, job_id: int, criterion_name: str, is_matched: bool, evidence: str, score: int):
    with get_db_connection() as conn:
        cursor = conn.cursor()
        # Delete prior scorecards for the exact same criterion to avoid duplicates on re-runs
        cursor.execute("""
            DELETE FROM evaluations 
            WHERE candidate_id = ? AND job_id = ? AND criterion_name = ?
        """, (candidate_id, job_id, criterion_name))
        
        cursor.execute("""
            INSERT INTO evaluations (candidate_id, job_id, criterion_name, is_matched, evidence, score)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (candidate_id, job_id, criterion_name, 1 if is_matched else 0, evidence, score))
        conn.commit()