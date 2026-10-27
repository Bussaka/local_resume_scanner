import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BriefcaseBusiness, Loader2, Plus, Search } from "lucide-react"
import { useState, type FormEvent } from "react"
import { Link, useNavigate } from "react-router-dom"

import { EmptyState, PageBody, PageHeader } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { api, type JobSummary } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

export function JobsPage() {
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState("")
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    // Keep queue counts live while anything is being screened
    refetchInterval: (q) => (q.state.data?.some((j) => j.in_queue_count > 0) ? 4000 : false),
  })

  const filtered = (jobs.data ?? []).filter((j) =>
    `${j.title} ${j.department}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Open positions and their screening pipelines."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New job
          </Button>
        }
      />
      <PageBody className="space-y-4">
        {jobs.isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
          </div>
        ) : !jobs.data?.length ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No jobs yet"
            description="Create a job, upload its job description, and the AI will draft the screening requirements for you to review."
            action={<Button onClick={() => setCreating(true)}><Plus /> Create the first job</Button>}
          />
        ) : (
          <>
            <div className="relative max-w-xs">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search jobs" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((job) => <JobCard key={job.id} job={job} />)}
            </div>
          </>
        )}
      </PageBody>
      <CreateJobDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function JobCard({ job }: { job: JobSummary }) {
  const closed = job.status === "closed"
  const progress = job.candidate_count ? Math.round((job.screened_count / job.candidate_count) * 100) : 0
  return (
    <Link to={`/jobs/${job.id}`} className="group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("h-full gap-4 p-5 transition-shadow group-hover:shadow-md", closed && "opacity-70")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold group-hover:text-primary">{job.title}</h3>
            <p className="truncate text-sm text-muted-foreground">{job.department || "No department"}</p>
          </div>
          {closed ? (
            <Badge variant="outline">Closed</Badge>
          ) : job.in_queue_count > 0 ? (
            <Badge className="bg-primary/12 text-primary"><Loader2 className="animate-spin" /> Screening</Badge>
          ) : job.requirement_count === 0 ? (
            <Badge variant="outline" className="border-warning/40 text-warning">Needs requirements</Badge>
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Candidates" value={job.candidate_count} />
          <Stat label="Screened" value={job.screened_count} />
          <Stat label="Shortlisted" value={job.shortlisted_count} highlight />
        </dl>

        <div className="space-y-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{job.requirement_count} requirements</span>
            <span>Created {formatDate(job.created_at)}</span>
          </div>
        </div>
      </Card>
    </Link>
  )
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/60 py-2">
      <dd className={cn("text-lg font-semibold tabular-nums", highlight && value > 0 && "text-success")}>{value}</dd>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
    </div>
  )
}

function CreateJobDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState({ title: "", department: "", description: "" })

  const create = useMutation({
    mutationFn: () => api.createJob(form),
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      setForm({ title: "", department: "", description: "" })
      onOpenChange(false)
      navigate(`/jobs/${job.id}?tab=requirements`)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New job</DialogTitle>
            <DialogDescription>
              Next you'll upload the job description and organisation documents to generate requirements.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="job-title">Job title</Label>
              <Input id="job-title" placeholder="e.g. Security Analyst" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="job-dept">Department</Label>
              <Input id="job-dept" placeholder="e.g. IT & Security" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="job-desc">Job description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="job-desc" rows={5} placeholder="Paste the job advert here, or upload documents on the next screen." value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Loader2 className="animate-spin" />} Create job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
