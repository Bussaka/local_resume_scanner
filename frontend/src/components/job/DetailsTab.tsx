import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Archive, ArchiveRestore, Loader2, Trash2 } from "lucide-react"
import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAuth } from "@/hooks/use-auth"
import { api, type JobDetail } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function DetailsTab({ job }: { job: JobDetail }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [form, setForm] = useState({ title: job.title, department: job.department, description: job.description })
  useEffect(() => setForm({ title: job.title, department: job.department, description: job.description }), [job.title, job.department, job.description])

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["job", job.id] })
    queryClient.invalidateQueries({ queryKey: ["jobs"] })
  }

  const save = useMutation({
    mutationFn: (body: Parameters<typeof api.updateJob>[1]) => api.updateJob(job.id, body),
    onSuccess: () => {
      refresh()
      toast.success("Job updated")
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteJob(job.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] })
      toast.success("Job deleted")
      navigate("/jobs")
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    save.mutate(form)
  }
  const closed = job.status === "closed"

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Job details</CardTitle>
          <CardDescription>The description is also used when generating requirements.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Job title</Label>
                <Input id="title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="department">Department</Label>
                <Input id="department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Job description</Label>
              <Textarea id="description" rows={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save changes
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
            <CardDescription>
              Created {formatDate(job.created_at)}{job.created_by_name && ` by ${job.created_by_name}`}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" className="w-full" onClick={() => save.mutate({ status: closed ? "open" : "closed" })}>
              {closed ? <><ArchiveRestore /> Reopen job</> : <><Archive /> Close job</>}
            </Button>
          </CardContent>
        </Card>

        {user?.role === "admin" && (
          <Card className="border-destructive/30">
            <CardHeader>
              <CardTitle>Delete job</CardTitle>
              <CardDescription>Removes the job, its documents, requirements and all screening results.</CardDescription>
            </CardHeader>
            <CardContent>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full"><Trash2 /> Delete job</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete “{job.title}”?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes {job.candidate_count} candidate results and HR decisions for this job. Resumes stay
                      available for other jobs. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.mutate()} className="bg-destructive text-white hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
