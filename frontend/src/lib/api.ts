// Typed client for the FastAPI backend. Auth is an httpOnly session cookie, so no tokens are handled here.

export type Role = "admin" | "recruiter"
export type Category = "skill" | "experience" | "education" | "certification" | "language" | "location" | "other"
export type Decision = "undecided" | "shortlisted" | "rejected"
export type ScreeningStatus = "pending" | "queued" | "running" | "done" | "failed"

export interface User {
  id: number
  email: string
  full_name: string
  role: Role
  is_active: boolean
  created_at: string
}

export interface JobSummary {
  id: number
  title: string
  department: string
  status: "open" | "closed"
  created_at: string
  created_by_name: string | null
  candidate_count: number
  screened_count: number
  shortlisted_count: number
  in_queue_count: number
  requirement_count: number
}

export interface JobDocument {
  id: number
  filename: string
  uploaded_at: string
  char_count: number
  preview: string
}

export interface JobDetail extends JobSummary {
  description: string
  extraction_status: "idle" | "queued" | "running" | "failed"
  extraction_error: string | null
  requirements_updated_at: string | null
  documents: JobDocument[]
}

export interface Requirement {
  id?: number
  text: string
  category: Category
  must_have: boolean
  weight: number
}

export interface ApplicationRow {
  id: number
  candidate_id: number
  candidate_name: string
  filename: string
  screening_status: ScreeningStatus
  screening_error: string | null
  decision: Decision
  score: number | null
  passes_must_haves: boolean | null
  matched_count: number
  requirement_count: number
  missing_must_haves: string[]
  stale: boolean
  created_at: string
}

export interface Evaluation {
  requirement_id: number
  requirement_text: string
  category: Category
  must_have: boolean
  weight: number
  is_matched: boolean
  score: number
  evidence: string
}

export interface ApplicationDetail extends ApplicationRow {
  job_id: number
  job_title: string
  summary: string
  screened_at: string | null
  model_name: string | null
  notes: string
  decided_by_name: string | null
  decided_at: string | null
  file_ext: string
  resume_text: string
  evaluations: Evaluation[]
}

export interface UploadResult {
  added: number
  duplicates: string[]
  failed: { filename: string; error: string }[]
  queued: boolean
}

export interface SystemStatus {
  model: string
  ollama_ok: boolean
  ollama_error: string | null
  queue_length: number
  current_task: string | null
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
    body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      // FastAPI: {detail: "msg"} or validation errors {detail: [{msg}]}
      message = typeof data.detail === "string" ? data.detail : data.detail?.[0]?.msg ?? message
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

function filesForm(files: File[]) {
  const form = new FormData()
  files.forEach((f) => form.append("files", f))
  return form
}

export const api = {
  login: (email: string, password: string) => request<User>("POST", "/api/auth/login", { email, password }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  me: () => request<User>("GET", "/api/auth/me"),
  changePassword: (current_password: string, new_password: string) =>
    request<void>("POST", "/api/auth/password", { current_password, new_password }),

  users: () => request<User[]>("GET", "/api/users"),
  createUser: (body: { email: string; full_name: string; password: string; role: Role }) =>
    request<User>("POST", "/api/users", body),
  updateUser: (id: number, body: Partial<{ full_name: string; role: Role; is_active: boolean; password: string }>) =>
    request<User>("PATCH", `/api/users/${id}`, body),

  systemStatus: () => request<SystemStatus>("GET", "/api/system/status"),

  jobs: () => request<JobSummary[]>("GET", "/api/jobs"),
  job: (id: number) => request<JobDetail>("GET", `/api/jobs/${id}`),
  createJob: (body: { title: string; department: string; description: string }) => request<JobDetail>("POST", "/api/jobs", body),
  updateJob: (id: number, body: Partial<{ title: string; department: string; description: string; status: "open" | "closed" }>) =>
    request<JobDetail>("PATCH", `/api/jobs/${id}`, body),
  deleteJob: (id: number) => request<void>("DELETE", `/api/jobs/${id}`),

  uploadDocuments: (jobId: number, files: File[]) => request<UploadResult>("POST", `/api/jobs/${jobId}/documents`, filesForm(files)),
  deleteDocument: (jobId: number, docId: number) => request<void>("DELETE", `/api/jobs/${jobId}/documents/${docId}`),
  extractRequirements: (jobId: number) => request<JobDetail>("POST", `/api/jobs/${jobId}/extract`),

  requirements: (jobId: number) => request<Requirement[]>("GET", `/api/jobs/${jobId}/requirements`),
  saveRequirements: (jobId: number, items: Requirement[]) => request<Requirement[]>("PUT", `/api/jobs/${jobId}/requirements`, items),

  applications: (jobId: number) => request<ApplicationRow[]>("GET", `/api/jobs/${jobId}/applications`),
  uploadResumes: (jobId: number, files: File[]) => request<UploadResult>("POST", `/api/jobs/${jobId}/applications`, filesForm(files)),
  screen: (jobId: number, scope: "unscreened" | "stale" | "all", application_ids?: number[]) =>
    request<{ queued: number }>("POST", `/api/jobs/${jobId}/screen`, { scope, application_ids }),

  application: (id: number) => request<ApplicationDetail>("GET", `/api/applications/${id}`),
  updateApplication: (id: number, body: Partial<{ decision: Decision; notes: string }>) =>
    request<ApplicationDetail>("PATCH", `/api/applications/${id}`, body),
  removeApplication: (id: number) => request<void>("DELETE", `/api/applications/${id}`),
  candidateFileUrl: (candidateId: number) => `/api/candidates/${candidateId}/file`,
}
