import type { UploadResult } from "@/lib/api"

const dateFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

export const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : "—")
export const formatDateTime = (iso: string | null) => (iso ? dateTimeFormat.format(new Date(iso)) : "—")

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("")
}

/** One toast-friendly sentence summarising a batch upload. */
export function describeUpload(result: UploadResult, noun: string) {
  const parts = [`${result.added} ${noun}${result.added === 1 ? "" : "s"} added`]
  if (result.duplicates.length) parts.push(`${result.duplicates.length} already present`)
  if (result.failed.length) parts.push(`${result.failed.length} failed`)
  return parts.join(" · ")
}

export const CATEGORY_LABELS = {
  skill: "Skill",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  language: "Language",
  location: "Location",
  other: "Other",
} as const
