import { useQuery } from "@tanstack/react-query"
import { ChevronLeft } from "lucide-react"
import { Link, useParams, useSearchParams } from "react-router-dom"

import { CandidatesTab } from "@/components/job/CandidatesTab"
import { DetailsTab } from "@/components/job/DetailsTab"
import { RequirementsTab } from "@/components/job/RequirementsTab"
import { PageBody, PageHeader } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/api"

const TABS = ["candidates", "requirements", "details"] as const
type Tab = (typeof TABS)[number]

export function JobPage() {
  const jobId = Number(useParams().jobId)
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.includes(params.get("tab") as Tab) ? (params.get("tab") as Tab) : "candidates"

  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.job(jobId),
    // Follow extraction and screening progress
    refetchInterval: (q) => {
      const data = q.state.data
      return data && (data.in_queue_count > 0 || ["queued", "running"].includes(data.extraction_status)) ? 3000 : false
    },
  })

  if (job.isLoading || !job.data) {
    return (
      <PageBody className="space-y-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </PageBody>
    )
  }
  const data = job.data

  return (
    <Tabs value={tab} onValueChange={(t) => setParams({ tab: t }, { replace: true })} className="gap-0">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {data.title}
            {data.status === "closed" && <Badge variant="outline">Closed</Badge>}
          </span>
        }
        description={[data.department, `${data.candidate_count} candidates`, `${data.requirement_count} requirements`].filter(Boolean).join(" · ")}
        actions={
          <TabsList>
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="requirements">
              Requirements
              {data.requirement_count === 0 && <span className="size-1.5 rounded-full bg-warning" />}
            </TabsTrigger>
            <TabsTrigger value="details">Details</TabsTrigger>
          </TabsList>
        }
      >
        <Link to="/jobs" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> All jobs
        </Link>
      </PageHeader>
      <PageBody>
        <TabsContent value="candidates"><CandidatesTab job={data} onGoToRequirements={() => setParams({ tab: "requirements" })} /></TabsContent>
        <TabsContent value="requirements"><RequirementsTab job={data} /></TabsContent>
        <TabsContent value="details"><DetailsTab job={data} /></TabsContent>
      </PageBody>
    </Tabs>
  )
}
