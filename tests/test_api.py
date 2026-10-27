from conftest import ADMIN, make_docx, resume, wait_until


def test_requires_login(client):
    assert client.get("/api/jobs").status_code == 401
    assert client.post("/api/auth/login", json={**ADMIN, "password": "wrong-password"}).status_code == 401


def test_admin_manages_users_and_recruiter_is_restricted(admin):
    r = admin.post("/api/users", json={"email": "Rec@Example.com", "full_name": "Rec", "password": "recruiter-pass-1"})
    assert r.status_code == 201 and r.json()["email"] == "rec@example.com"
    assert admin.post("/api/users", json={"email": "rec@example.com", "full_name": "x", "password": "recruiter-pass-1"}).status_code == 409

    admin.post("/api/auth/logout")
    assert admin.post("/api/auth/login", json={"email": "rec@example.com", "password": "recruiter-pass-1"}).status_code == 200
    assert admin.get("/api/users").status_code == 403
    assert admin.get("/api/jobs").status_code == 200


def test_admin_cannot_lock_themselves_out(admin):
    me = admin.get("/api/auth/me").json()
    assert admin.patch(f"/api/users/{me['id']}", json={"is_active": False}).status_code == 400


def test_full_workflow_extract_upload_screen_rank_decide(admin):
    job = admin.post("/api/jobs", json={"title": "Security Analyst", "department": "IT"}).json()
    jid = job["id"]

    # Organisation document -> extracted requirements
    files = [("files", ("jd.docx", make_docx("We need a Security Analyst. Must know Kali Linux."), "application/octet-stream"))]
    assert admin.post(f"/api/jobs/{jid}/documents", files=files).json()["added"] == 1
    assert admin.post(f"/api/jobs/{jid}/extract").status_code == 200
    wait_until(lambda: admin.get(f"/api/jobs/{jid}").json()["extraction_status"] == "idle")
    reqs = admin.get(f"/api/jobs/{jid}/requirements").json()
    assert [r["text"] for r in reqs] == ["Experience with Kali Linux", "Holds an OSCP certification"]

    # Resumes are queued automatically because the job has requirements
    alice = resume("Alice", "Kali Linux", "OSCP")
    files = [
        ("files", ("alice.docx", alice, "application/octet-stream")),
        ("files", ("bob.docx", resume("Bob", "Excel"), "application/octet-stream")),
        ("files", ("carol.docx", resume("Carol", "Kali Linux"), "application/octet-stream")),
        ("files", ("notes.txt", b"hello", "text/plain")),
    ]
    result = admin.post(f"/api/jobs/{jid}/applications", files=files).json()
    assert result["added"] == 3 and result["queued"] and result["failed"][0]["filename"] == "notes.txt"

    def all_done():
        return all(a["screening_status"] == "done" for a in admin.get(f"/api/jobs/{jid}/applications").json())
    wait_until(all_done)

    rows = admin.get(f"/api/jobs/{jid}/applications").json()
    # Must-have knockouts rank Bob last; Alice (both matched) beats Carol
    assert [r["candidate_name"] for r in rows] == ["Alice", "Carol", "Bob"]
    assert rows[0]["score"] == 80 and rows[0]["passes_must_haves"] is True
    assert rows[2]["passes_must_haves"] is False and rows[2]["missing_must_haves"] == ["Experience with Kali Linux"]

    # Same file again (even renamed) is a duplicate
    dup = admin.post(f"/api/jobs/{jid}/applications", files=[("files", ("alice2.docx", alice, "x"))]).json()
    assert dup["duplicates"] == ["alice2.docx"] and dup["added"] == 0

    # HR decision is recorded with who made it
    detail = admin.patch(f"/api/applications/{rows[0]['id']}", json={"decision": "shortlisted", "notes": "Strong"}).json()
    assert detail["decision"] == "shortlisted" and detail["decided_by_name"] == "Admin"
    assert len(detail["evaluations"]) == 2 and detail["file_ext"] == ".docx"
    assert admin.get(f"/api/candidates/{rows[0]['candidate_id']}/file").status_code == 200


def test_requirement_edits_mark_results_stale_and_rescreen(admin):
    jid = admin.post("/api/jobs", json={"title": "Analyst", "description": "Kali Linux required"}).json()["id"]
    admin.put(f"/api/jobs/{jid}/requirements", json=[{"text": "Experience with Kali Linux", "must_have": True, "weight": 5}])
    admin.post(f"/api/jobs/{jid}/applications", files=[("files", ("a.docx", resume("Alice", "Kali Linux"), "x"))])
    wait_until(lambda: admin.get(f"/api/jobs/{jid}/applications").json()[0]["screening_status"] == "done")

    reqs = admin.get(f"/api/jobs/{jid}/requirements").json()
    # Weight change alone does not invalidate results
    admin.put(f"/api/jobs/{jid}/requirements", json=[{**reqs[0], "weight": 4}])
    assert admin.get(f"/api/jobs/{jid}/applications").json()[0]["stale"] is False

    # Adding a requirement does
    admin.put(f"/api/jobs/{jid}/requirements", json=[{**reqs[0], "weight": 4}, {"text": "Knows Python"}])
    assert admin.get(f"/api/jobs/{jid}/applications").json()[0]["stale"] is True

    assert admin.post(f"/api/jobs/{jid}/screen", json={"scope": "stale"}).json()["queued"] == 1
    wait_until(lambda: admin.get(f"/api/jobs/{jid}/applications").json()[0]["screening_status"] == "done")
    row = admin.get(f"/api/jobs/{jid}/applications").json()[0]
    assert row["stale"] is False and row["requirement_count"] == 2


def test_screening_without_requirements_is_rejected(admin):
    jid = admin.post("/api/jobs", json={"title": "Empty"}).json()["id"]
    result = admin.post(f"/api/jobs/{jid}/applications", files=[("files", ("a.docx", resume("Alice", "x"), "x"))]).json()
    assert result["added"] == 1 and result["queued"] is False
    assert admin.post(f"/api/jobs/{jid}/screen", json={}).status_code == 400


def test_scanned_resume_is_rejected(admin):
    jid = admin.post("/api/jobs", json={"title": "X"}).json()["id"]
    result = admin.post(f"/api/jobs/{jid}/applications", files=[("files", ("scan.docx", make_docx("Jane"), "x"))]).json()
    assert result["added"] == 0 and "scanned" in result["failed"][0]["error"]
