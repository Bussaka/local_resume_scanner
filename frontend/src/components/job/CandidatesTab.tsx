import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, ListChecks, Play, RefreshCw, Search, Users, X } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { DecisionBadge, EmptyState, FileDropzone, ScoreRing, ScreeningStatusLabel } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type ApplicationRow, type JobDetail } from "@/lib/api"
import { describeUpload } from "@/lib/format"
import { cn } from "@/lib/utils"

const FILTERS = {
  all: { label: "All", test: () => true },
  qualified: { label: "Meets must-haves", test: (a: ApplicationRow) => a.passes_must_haves === true },
  shortlisted: { label: "Shortlisted", test: (a: ApplicationRow) => a.decision === "shortlisted" },
  undecided: { label: "Undecided", test: (a: ApplicationRow) => a.decision === "undecided" },
  rejected: { label: "Rejected", test: (a: ApplicationRow) => a.decision === "rejected" },
} as const
type Filter = keyof typeof FILTERS

export function CandidatesTab({ job, onGoToRequirements }: { job: JobDetail; onGoToRequirements: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>("all")
  const [search, setSearch] = useState("")

  const applications = useQuery({
    queryKey: ["applications", job.id],
    queryFn: () => api.applications(job.id),
    refetchInterval: (q) => (q.state.data?.some((a) => ["queued", "running"].includes(a.screening_status)) ? 3000 : false),
  })
  const rows = applications.data ?? []

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["applications", job.id] })
    queryClient.invalidateQueries({ queryKey: ["job", job.id] })
    queryClient.invalidateQueries({ queryKey: ["system-status"] })
  }

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadResumes(job.id, files),
    onSuccess: (result) => {
      refresh()
      result.failed.forEach((f) => toast.error(`${f.filename}: ${f.error}`))
      if (result.added || result.duplicates.length) {
        toast.success(describeUpload(result, "resume"), {
          description: result.added ? (result.queued ? "Screening has started automatically." : "Add requirements to start screening.") : undefined,
        })
      }
    },
  })
  const screen = useMutation({
    mutationFn: (scope: "unscreened" | "stale") => api.screen(job.id, scope),
    onSuccess: ({ queued }) => {
      refresh()
      toast.success(`${queued} candidate${queued === 1 ? "" : "s"} queued for screening`)
    },
  })

  const inQueue = rows.filter((a) => ["queued", "running"].includes(a.screening_status)).length
  const unscreened = rows.filter((a) => ["pending", "failed"].includes(a.screening_status)).length
  const stale = rows.filter((a) => a.screening_status === "done" && a.stale).length
  const screened = rows.filter((a) => a.screening_status === "done").length
  const noRequirements = job.requirement_count === 0

  const visible = rows.filter(
    (a) => FILTERS[filter].test(a) && `${a.candidate_name} ${a.filename}`.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="space-y-5">
      {noRequirements && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="flex-1">This job has no requirements yet. Resumes you upload are kept until requirements are set, then screened.</span>
          <Button size="sm" variant="outline" onClick={onGoToRequirements}><ListChecks /> Set requirements</Button>
        </div>
      )}

      <FileDropzone
        compact={rows.length > 0}
        busy={upload.isPending}
        onFiles={(f) => upload.mutate(f)}
        title="Upload resumes"
        hint="Drop PDF or DOCX resumes here, or click to browse. Duplicates are detected automatically."
      />

      {inQueue > 0 && (
        <Card className="gap-2 px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Screening in progress</span>
            <span className="text-muted-foreground tabular-nums">{screened} of {screened + inQueue} done · about {inQueue} min left</span>
          </div>
          <Progress value={(screened / Math.max(1, screened + inQueue)) * 100} />
          <p className="text-xs text-muted-foreground">Runs on the server. You can close this page and come back later.</p>
        </Card>
      )}

      {rows.length === 0 ? (
        !applications.isLoading && (
          <EmptyState icon={Users} title="No candidates yet" description="Upload resumes above. Each one is read and scored against this job's requirements." />
        )
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <Button key={f} size="sm" variant={filter === f ? "secondary" : "ghost"} onClick={() => setFilter(f)} className={cn(filter !== f && "text-muted-foreground")}>
                  {FILTERS[f].label}
                  <span className="text-xs text-muted-foreground tabular-nums">{rows.filter(FILTERS[f].test).length}</span>
                </Button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-56">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search candidates" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 pl-9" />
            </div>
            {stale > 0 && (
              <Button size="sm" variant="outline" disabled={screen.isPending} onClick={() => screen.mutate("stale")}>
                <RefreshCw /> Re-screen {stale} outdated
              </Button>
            )}
            {unscreened > 0 && !noRequirements && (
              <Button size="sm" disabled={screen.isPending} onClick={() => screen.mutate("unscreened")}>
                <Play /> Screen {unscreened}
              </Button>
            )}
          </div>

          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-12 pl-5">#</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead className="w-20">Match</TableHead>
                <TableHead>Must-haves</TableHead>
                <TableHead className="hidden lg:table-cell">Requirements met</TableHead>
                <TableHead className="hidden md:table-cell">Status</TableHead>
                <TableHead className="w-28 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow
                  key={a.id}
                  className={cn("cursor-pointer", a.decision === "rejected" && "opacity-60")}
                  onClick={() => navigate(`/jobs/${job.id}/candidates/${a.id}`)}
                >
                  <TableCell className="pl-5 text-muted-foreground tabular-nums">{rows.indexOf(a) + 1}</TableCell>
                  <TableCell className="max-w-64">
                    <div className="truncate font-medium">{a.candidate_name}</div>
                    <div className="truncate text-xs text-muted-foreground">{a.filename}</div>
                  </TableCell>
                  <TableCell><ScoreRing score={a.score} size={38} /></TableCell>
                  <TableCell><MustHaves row={a} /></TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {a.screening_status === "done" ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${(a.matched_count / Math.max(1, a.requirement_count)) * 100}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground tabular-nums">{a.matched_count}/{a.requirement_count}</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell"><ScreeningStatusLabel status={a.screening_status} error={a.screening_error} stale={a.stale} /></TableCell>
                  <TableCell className="pr-5 text-right"><DecisionBadge decision={a.decision} /></TableCell>
                </TableRow>
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No candidates match this filter.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}

function MustHaves({ row }: { row: ApplicationRow }) {
  if (row.passes_must_haves === null) return <span className="text-muted-foreground">—</span>
  if (row.passes_must_haves) {
    return <span className="inline-flex items-center gap-1.5 text-sm text-success"><Check className="size-4" /> All met</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <X className="size-4" /> {row.missing_must_haves.length} missing
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        <ul className="list-disc space-y-0.5 pl-4">{row.missing_must_haves.map((m) => <li key={m}>{m}</li>)}</ul>
      </TooltipContent>
    </Tooltip>
  )
}
