import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FileCheck2, Loader2, LockKeyhole } from "lucide-react"
import { useState, type FormEvent } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/api"

export function LoginPage() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)

  const login = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (user) => queryClient.setQueryData(["me"], user),
    onError: (e) => setError(e.message),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    login.mutate()
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="pointer-events-none absolute -top-40 -right-40 size-[32rem] rounded-full bg-primary/25 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <FileCheck2 className="size-5" />
          </div>
          <span className="text-lg font-semibold text-white">TalentScreen</span>
        </div>
        <div className="relative max-w-md space-y-4">
          <h2 className="text-3xl leading-tight font-semibold text-white">
            Screen every applicant against your own requirements, consistently.
          </h2>
          <p className="text-sidebar-muted">
            Upload your job documents, review the requirements the AI extracts, and get ranked candidates with the
            evidence behind every score.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-sm text-sidebar-muted">
          <LockKeyhole className="size-4" />
          Runs entirely on your organisation's server. Resumes never leave the network.
        </div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-6">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-sm text-muted-foreground">Use the account your administrator created for you.</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Work email</Label>
              <Input id="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending && <Loader2 className="animate-spin" />}
            Sign in
          </Button>
        </form>
      </div>
    </div>
  )
}
