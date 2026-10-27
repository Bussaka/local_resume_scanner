import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, Loader2, MoreHorizontal, Quote, RefreshCw, Star, Trash2, Undo2, X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { toast } from "sonner"

import { DecisionBadge, PageBody, ScoreRing, ScreeningStatusLabel, scoreTone } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api, type ApplicationDetail, type Decision, type Evaluation } from "@/lib/api"
import { CATEGORY_LABELS, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export function CandidatePage() {
  const jobId = Number(useParams().jobId)
  const applicationId = Number(useParams().applicationId)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const app = useQuery({
    queryKey: ["application", applicationId],
    queryFn: () => api.application(applicationId),
    refetchInterval: (q) => (["queued", "running"].includes(q.state.data?.screening_status ?? "") ? 3000 : false),
  })
  // Ranked list, for previous/next navigation in the same order as the table
  const ranking = useQuery({ queryKey: ["applications", jobId], queryFn: () => api.applications(jobId) })
  const ids = ranking.data?.map((a) => a.id) ?? []
  const index = ids.indexOf(applicationId)
  const prevId = index > 0 ? ids[index - 1] : null
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null

  const onSaved = (detail: ApplicationDetail) => {
    queryClient.setQueryData(["application", applicationId], detail)
    queryClient.invalidateQueries({ queryKey: ["applications", jobId] })
    queryClient.invalidateQueries({ queryKey: ["job", jobId] })
    queryClient.invalidateQueries({ queryKey: ["jobs"] })
  }
  const decide = useMutation({
    mutationFn: (decision: Decision) => api.updateApplication(applicationId, { decision }),
    onSuccess: (detail) => {
      onSaved(detail)
      // Keep reviewing: jump to the next candidate after a decision
      if (detail.decision !== "undecided" && nextId) navigate(`/jobs/${jobId}/candidates/${nextId}`)
    },
  })
  const rescreen = useMutation({
    mutationFn: () => api.screen(jobId, "all", [applicationId]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["application", applicationId] })
      queryClient.invalidateQueries({ queryKey: ["applications", jobId] })
      toast.success("Queued for re-screening")
    },
  })
  const remove = useMutation({
    mutationFn: () => api.removeApplication(applicationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications", jobId] })
      queryClient.invalidateQueries({ queryKey: ["job", jobId] })
      toast.success("Candidate removed from this job")
      navigate(`/jobs/${jobId}`)
    },
  })

  if (app.isLoading || !app.data) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-[60vh]" /><Skeleton className="h-[60vh]" /></div>
      </PageBody>
    )
  }
  const a = app.data
  const busy = ["queued", "running"].includes(a.screening_status)

  return (
    <>
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-4 py-4 sm:px-8">
          <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="size-4" /> {a.job_title}
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ScoreRing score={a.score} size={46} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 truncate text-lg font-semibold">
                {a.candidate_name} <DecisionBadge decision={a.decision} />
              </h1>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="truncate">{a.filename}</span>
                <ScreeningStatusLabel status={a.screening_status} error={a.screening_error} stale={a.stale} />
                {index >= 0 && <span className="tabular-nums">Rank {index + 1} of {ids.length}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {a.decision === "undecided" ? (
              <>
                <Button variant="outline" onClick={() => decide.mutate("rejected")} disabled={decide.isPending}><X /> Reject</Button>
                <Button onClick={() => decide.mutate("shortlisted")} disabled={decide.isPending} className="bg-success text-white hover:bg-success/90"><Star /> Shortlist</Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => decide.mutate("undecided")} disabled={decide.isPending}><Undo2 /> Undo decision</Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={busy} onSelect={() => rescreen.mutate()}><RefreshCw /> Re-screen</DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => remove.mutate()}><Trash2 /> Remove from job</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="ml-1 flex">
              <Button variant="ghost" size="icon" disabled={!prevId} aria-label="Previous candidate" onClick={() => navigate(`/jobs/${jobId}/candidates/${prevId}`)}><ChevronLeft /></Button>
              <Button variant="ghost" size="icon" disabled={!nextId} aria-label="Next candidate" onClick={() => navigate(`/jobs/${jobId}/candidates/${nextId}`)}><ChevronRight /></Button>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-4 py-6 sm:px-8 lg:grid-cols-2">
        <div className="space-y-6">
          {busy ? (
            <Card className="items-center gap-3 py-16 text-center">
              <Loader2 className="size-6 animate-spin text-primary" />
              <div className="font-medium">{a.screening_status === "queued" ? "Waiting in the screening queue" : "Screening this resume…"}</div>
              <p className="text-sm text-muted-foreground">Results appear here automatically.</p>
            </Card>
          ) : a.screening_status !== "done" ? (
            <Card className="items-center gap-3 py-16 text-center">
              <div className="font-medium">{a.screening_status === "failed" ? "Screening failed" : "Not screened yet"}</div>
              {a.screening_error && <p className="max-w-md text-sm text-destructive">{a.screening_error}</p>}
              <Button onClick={() => rescreen.mutate()} disabled={rescreen.isPending}><RefreshCw /> Screen now</Button>
            </Card>
          ) : (
            <Scorecard a={a} />
          )}
          <Notes key={a.id} a={a} onSaved={onSaved} />
        </div>
        <ResumeViewer a={a} />
      </div>
    </>
  )
}

function Scorecard({ a }: { a: ApplicationDetail }) {
  return (
    <>
      {a.stale && (
        <div className="flex items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          Requirements changed since this screening. Re-screen from the menu above to update it.
        </div>
      )}
      <Card>
        <CardHeader className="flex flex-row items-start gap-4">
          <div className="flex-1 space-y-1.5">
            <CardTitle>AI assessment</CardTitle>
            <p className="text-sm leading-relaxed text-muted-foreground">{a.summary}</p>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <Metric label="Match score" value={a.score !== null ? `${a.score}` : "–"} className={a.score !== null ? scoreTone(a.score) : undefined} />
          <Metric label="Requirements met" value={`${a.matched_count}/${a.requirement_count}`} />
          <Metric
            label="Must-haves"
            value={a.passes_must_haves ? "All met" : `${a.missing_must_haves.length} missing`}
            className={a.passes_must_haves ? "text-success" : "text-destructive"}
          />
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground">Evidence by requirement</h2>
        {[...a.evaluations]
          .sort((x, y) => Number(y.must_have) - Number(x.must_have) || y.weight - x.weight)
          .map((e) => <EvaluationCard key={e.requirement_id} e={e} />)}
      </div>
      <p className="text-xs text-muted-foreground">
        Screened {formatDateTime(a.screened_at)} by {a.model_name}. AI scores support, but do not replace, HR judgement.
      </p>
    </>
  )
}

function Metric({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-3 py-2.5">
      <div className={cn("text-lg font-semibold tabular-nums", className)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function EvaluationCard({ e }: { e: Evaluation }) {
  return (
    <Card className={cn("gap-3 border-l-4 p-4", e.is_matched ? "border-l-success" : e.must_have ? "border-l-destructive" : "border-l-border")}>
      <div className="flex items-start gap-3">
        {e.is_matched ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" /> : <CircleX className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{e.requirement_text}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {e.must_have && <Badge variant="outline" className="border-primary/40 text-primary">Must-have</Badge>}
            <Badge variant="secondary">{CATEGORY_LABELS[e.category]}</Badge>
            <Badge variant="secondary">Weight {e.weight}</Badge>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-semibold tabular-nums">{e.score}<span className="text-muted-foreground">/10</span></div>
          <div className="mt-1 flex gap-0.5">
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < e.score ? (e.is_matched ? "bg-success" : "bg-warning") : "bg-muted")} />
            ))}
          </div>
        </div>
      </div>
      {e.evidence && (
        <blockquote className="flex gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
          <Quote className="mt-0.5 size-3.5 shrink-0" />
          <span className={cn(e.is_matched && "italic text-foreground/80")}>{e.evidence}</span>
        </blockquote>
      )}
    </Card>
  )
}

function Notes({ a, onSaved }: { a: ApplicationDetail; onSaved: (d: ApplicationDetail) => void }) {
  const [notes, setNotes] = useState(a.notes)
  useEffect(() => setNotes(a.notes), [a.notes])
  const save = useMutation({ mutationFn: () => api.updateApplication(a.id, { notes }), onSuccess: onSaved })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">HR notes</CardTitle>
        <span className="text-xs text-muted-foreground">
          {save.isPending ? "Saving…" : save.isSuccess && notes === a.notes ? <span className="inline-flex items-center gap-1"><Check className="size-3" /> Saved</span> : null}
          {a.decided_by_name && ` Decision by ${a.decided_by_name}, ${formatDateTime(a.decided_at)}`}
        </span>
      </CardHeader>
      <CardContent>
        <Textarea
          rows={4}
          placeholder="Interview notes, follow-ups, concerns… Saved when you click away."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== a.notes && save.mutate()}
        />
      </CardContent>
    </Card>
  )
}

function ResumeViewer({ a }: { a: ApplicationDetail }) {
  const isPdf = a.file_ext === ".pdf"
  return (
    <Card className="gap-0 overflow-hidden py-0 lg:sticky lg:top-24 lg:h-[calc(100svh-7.5rem)]">
      <Tabs defaultValue={isPdf ? "original" : "text"} className="h-full gap-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-medium">Resume</span>
          <TabsList className="h-8">
            {isPdf && <TabsTrigger value="original" className="text-xs">Original</TabsTrigger>}
            <TabsTrigger value="text" className="text-xs">Extracted text</TabsTrigger>
          </TabsList>
          <Button variant="ghost" size="sm" asChild>
            <a href={api.candidateFileUrl(a.candidate_id)} target="_blank" rel="noreferrer">Open file</a>
          </Button>
        </div>
        {isPdf && (
          <TabsContent value="original" className="min-h-[70vh] flex-1">
            <iframe title="Resume" src={api.candidateFileUrl(a.candidate_id)} className="size-full min-h-[70vh] bg-muted" />
          </TabsContent>
        )}
        <TabsContent value="text" className="min-h-0 flex-1 overflow-auto">
          <pre className="p-5 font-sans text-sm leading-relaxed whitespace-pre-wrap">{a.resume_text}</pre>
        </TabsContent>
      </Tabs>
    </Card>
  )
}
