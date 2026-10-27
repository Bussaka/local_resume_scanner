import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, FileText, ListChecks, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import { EmptyState, FileDropzone } from "@/components/shared"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Category, type JobDetail, type Requirement } from "@/lib/api"
import { CATEGORY_LABELS, describeUpload, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"

export function RequirementsTab({ job }: { job: JobDetail }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <RequirementsEditor job={job} />
      <DocumentsPanel job={job} />
    </div>
  )
}

// --- Organisation documents + AI extraction ---
function DocumentsPanel({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient()
  const [confirmReplace, setConfirmReplace] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["job", job.id] })

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadDocuments(job.id, files),
    onSuccess: (result) => {
      refresh()
      result.failed.forEach((f) => toast.error(`${f.filename}: ${f.error}`))
      if (result.added) toast.success(describeUpload(result, "document"))
    },
  })
  const removeDoc = useMutation({ mutationFn: (docId: number) => api.deleteDocument(job.id, docId), onSuccess: refresh })
  const extract = useMutation({ mutationFn: () => api.extractRequirements(job.id), onSuccess: refresh })

  const extracting = ["queued", "running"].includes(job.extraction_status)
  const hasSource = job.documents.length > 0 || job.description.trim().length > 0
  const startExtraction = () => (job.requirement_count > 0 ? setConfirmReplace(true) : extract.mutate())

  return (
    <Card className="lg:sticky lg:top-6">
      <CardHeader>
        <CardTitle>Organisation documents</CardTitle>
        <CardDescription>Job descriptions, role profiles or competency frameworks. The AI drafts requirements from them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <FileDropzone compact busy={upload.isPending} onFiles={(f) => upload.mutate(f)} title="Add documents" hint="PDF or DOCX, up to 10 MB" />

        {job.documents.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {job.documents.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-3 py-2.5">
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium">{d.filename}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(d.uploaded_at)} · {Math.round(d.char_count / 1000)}k chars</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-80 whitespace-pre-line">{d.preview}…</TooltipContent>
                </Tooltip>
                <Button variant="ghost" size="icon" className="size-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Remove ${d.filename}`} onClick={() => removeDoc.mutate(d.id)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {job.extraction_status === "failed" && job.extraction_error && (
          <p className="flex gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {job.extraction_error}
          </p>
        )}

        <Button className="w-full" disabled={!hasSource || extracting || extract.isPending} onClick={startExtraction}>
          {extracting ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {extracting ? (job.extraction_status === "queued" ? "Waiting in queue…" : "Reading documents…") : "Generate requirements with AI"}
        </Button>
        {!hasSource && <p className="text-center text-xs text-muted-foreground">Upload a document or add a job description first.</p>}
      </CardContent>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace current requirements?</AlertDialogTitle>
            <AlertDialogDescription>
              The AI will generate a new list from the documents and replace the {job.requirement_count} existing requirements,
              including your edits. Existing screening results will need re-screening.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => extract.mutate()}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// --- Editable requirements list ---
type Draft = Requirement & { key: string }
let nextKey = 0
const toDraft = (r: Requirement): Draft => ({ ...r, key: r.id ? `id-${r.id}` : `new-${nextKey++}` })

function RequirementsEditor({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient()
  const requirements = useQuery({ queryKey: ["requirements", job.id], queryFn: () => api.requirements(job.id) })
  const [draft, setDraft] = useState<Draft[]>([])
  const [dirty, setDirty] = useState(false)
  const extracting = ["queued", "running"].includes(job.extraction_status)

  // Reload from the server whenever it changes (e.g. extraction finished), unless the user has unsaved edits
  useEffect(() => {
    if (requirements.data && !dirty) setDraft(requirements.data.map(toDraft))
  }, [requirements.data, dirty])

  const wasExtracting = useRef(extracting)
  useEffect(() => {
    if (wasExtracting.current && !extracting) {
      setDirty(false)
      queryClient.invalidateQueries({ queryKey: ["requirements", job.id] })
      if (job.extraction_status === "idle") toast.success("Requirements generated. Review them before screening.")
    }
    wasExtracting.current = extracting
  }, [extracting, job.extraction_status, job.id, queryClient])

  const save = useMutation({
    mutationFn: () => api.saveRequirements(job.id, draft.filter((d) => d.text.trim()).map(({ key: _key, ...r }) => r)),
    onSuccess: (saved) => {
      queryClient.setQueryData(["requirements", job.id], saved)
      queryClient.invalidateQueries({ queryKey: ["job", job.id] })
      queryClient.invalidateQueries({ queryKey: ["applications", job.id] })
      setDirty(false)
      toast.success("Requirements saved")
    },
  })

  const update = (key: string, patch: Partial<Requirement>) => {
    setDraft((d) => d.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  const add = () => {
    setDraft((d) => [...d, toDraft({ text: "", category: "skill", must_have: false, weight: 3 })])
    setDirty(true)
  }
  const remove = (key: string) => {
    setDraft((d) => d.filter((r) => r.key !== key))
    setDirty(true)
  }

  const mustHaves = draft.filter((r) => r.must_have).length

  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">Screening requirements</h2>
          <p className="text-sm text-muted-foreground">
            {draft.length} requirements · {mustHaves} must-have. Must-haves knock candidates out; weights set importance in the score.
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="ghost" onClick={() => { setDirty(false); setDraft((requirements.data ?? []).map(toDraft)) }}>
              Discard
            </Button>
          )}
          <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending || extracting}>
            {save.isPending && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </div>

      {extracting ? (
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <Loader2 className="size-6 animate-spin text-primary" />
          <div className="font-medium">The AI is reading your documents</div>
          <p className="max-w-sm text-sm text-muted-foreground">This usually takes a minute or two. You can leave this page; it keeps running on the server.</p>
        </div>
      ) : draft.length === 0 ? (
        <div className="p-5">
          <EmptyState
            icon={ListChecks}
            title="No requirements yet"
            description="Generate them from the organisation documents on the right, or add them by hand."
            action={<Button variant="outline" onClick={add}><Plus /> Add requirement</Button>}
          />
        </div>
      ) : (
        <>
          <div className="hidden grid-cols-[minmax(0,1fr)_150px_96px_120px_36px] gap-3 border-b bg-muted/40 px-5 py-2 text-xs font-medium text-muted-foreground md:grid">
            <span>Requirement</span>
            <span>Category</span>
            <span>Must-have</span>
            <span>Weight</span>
            <span />
          </div>
          <ul className="divide-y">
            {draft.map((r) => (
              <li key={r.key} className={cn("grid gap-3 px-5 py-3 md:grid-cols-[minmax(0,1fr)_150px_96px_120px_36px] md:items-center", r.must_have && "bg-primary/[0.03]")}>
                <Input value={r.text} placeholder="e.g. 3+ years of network security experience" onChange={(e) => update(r.key, { text: e.target.value })} aria-label="Requirement" />
                <Select value={r.category} onValueChange={(v) => update(r.key, { category: v as Category })}>
                  <SelectTrigger className="w-full" aria-label="Category"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm md:justify-center">
                  <Switch checked={r.must_have} onCheckedChange={(v) => update(r.key, { must_have: v })} />
                  <span className="md:hidden">Must-have</span>
                </label>
                <WeightPicker value={r.weight} onChange={(w) => update(r.key, { weight: w })} />
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-destructive" aria-label="Remove requirement" onClick={() => remove(r.key)}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <div className="border-t px-5 py-3">
            <Button variant="ghost" size="sm" onClick={add}><Plus /> Add requirement</Button>
          </div>
        </>
      )}
    </Card>
  )
}

const WEIGHT_LABELS = ["", "Minor", "Low", "Normal", "High", "Critical"]

function WeightPicker({ value, onChange }: { value: number; onChange: (w: number) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex h-9 items-center gap-1" role="radiogroup" aria-label="Weight">
          {[1, 2, 3, 4, 5].map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={value === w}
              aria-label={`Weight ${w}: ${WEIGHT_LABELS[w]}`}
              onClick={() => onChange(w)}
              className={cn(
                "h-5 w-4 rounded-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                w <= value ? "bg-primary" : "bg-muted hover:bg-primary/30",
              )}
            />
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>Weight {value} · {WEIGHT_LABELS[value]}</TooltipContent>
    </Tooltip>
  )
}
