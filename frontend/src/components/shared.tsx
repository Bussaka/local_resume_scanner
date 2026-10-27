import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, Upload, XCircle, type LucideIcon } from "lucide-react"
import { useRef, useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { Decision, ScreeningStatus } from "@/lib/api"
import { cn } from "@/lib/utils"

export function PageHeader({ title, description, actions, children }: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-8 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0 space-y-1">
          {children}
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto max-w-7xl px-4 py-6 sm:px-8", className)}>{children}</div>
}

export function EmptyState({ icon: Icon, title, description, action }: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
      <div className="mb-4 grid size-11 place-items-center rounded-full bg-accent text-accent-foreground">
        <Icon className="size-5" />
      </div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Drag-and-drop or click-to-browse upload area for PDF/DOCX files. */
export function FileDropzone({ onFiles, busy, title, hint, compact }: {
  onFiles: (files: File[]) => void
  busy?: boolean
  title: string
  hint: string
  compact?: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const accept = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /\.(pdf|docx)$/i.test(f.name))
    if (files.length) onFiles(files)
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        accept(e.dataTransfer.files)
      }}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border-2 border-dashed text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
        compact ? "px-4 py-3" : "flex-col justify-center px-6 py-10 text-center",
        dragging ? "border-primary bg-accent" : "border-border hover:border-primary/50 hover:bg-accent/40",
      )}
    >
      <div className={cn("grid shrink-0 place-items-center rounded-full bg-accent text-accent-foreground", compact ? "size-9" : "size-11")}>
        {busy ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
      </div>
      <div>
        <div className="text-sm font-medium">{busy ? "Uploading and reading files…" : title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept=".pdf,.docx"
        className="hidden"
        onChange={(e) => {
          accept(e.target.files)
          e.target.value = ""
        }}
      />
    </button>
  )
}

export function scoreTone(score: number) {
  if (score >= 70) return "text-success"
  if (score >= 45) return "text-warning"
  return "text-destructive"
}

/** Circular 0-100 match score. */
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }) {
  const stroke = 4
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {score !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - score / 100)}
            className={cn("stroke-current transition-[stroke-dashoffset] duration-700", scoreTone(score))}
          />
        )}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums" style={{ fontSize: size / 3.6 }}>
        {score ?? "–"}
      </span>
    </div>
  )
}

const STATUS: Record<ScreeningStatus, { label: string; icon: LucideIcon; className: string }> = {
  pending: { label: "Not screened", icon: CircleDashed, className: "text-muted-foreground" },
  queued: { label: "In queue", icon: Clock, className: "text-muted-foreground" },
  running: { label: "Screening", icon: Loader2, className: "text-primary [&_svg]:animate-spin" },
  done: { label: "Screened", icon: CheckCircle2, className: "text-success" },
  failed: { label: "Failed", icon: XCircle, className: "text-destructive" },
}

export function ScreeningStatusLabel({ status, error, stale }: { status: ScreeningStatus; error?: string | null; stale?: boolean }) {
  if (status === "done" && stale) {
    return (
      <Tooltip>
        <TooltipTrigger className="inline-flex items-center gap-1.5 text-xs font-medium text-warning">
          <AlertTriangle className="size-3.5" /> Outdated
        </TooltipTrigger>
        <TooltipContent>Requirements changed after this candidate was screened. Re-screen to update.</TooltipContent>
      </Tooltip>
    )
  }
  const { label, icon: Icon, className } = STATUS[status]
  const content = (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <Icon className="size-3.5" /> {label}
    </span>
  )
  if (!error) return content
  return (
    <Tooltip>
      <TooltipTrigger>{content}</TooltipTrigger>
      <TooltipContent className="max-w-72">{error}</TooltipContent>
    </Tooltip>
  )
}

export function DecisionBadge({ decision }: { decision: Decision }) {
  if (decision === "shortlisted") return <Badge className="border-success/30 bg-success/12 text-success">Shortlisted</Badge>
  if (decision === "rejected") return <Badge variant="outline" className="text-muted-foreground">Rejected</Badge>
  return null
}
