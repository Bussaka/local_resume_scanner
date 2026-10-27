import { Loader2 } from "lucide-react"
import { Navigate, Route, Routes } from "react-router-dom"

import { AppShell } from "@/components/layout/AppShell"
import { useAuth } from "@/hooks/use-auth"
import { CandidatePage } from "@/pages/CandidatePage"
import { JobPage } from "@/pages/JobPage"
import { JobsPage } from "@/pages/JobsPage"
import { LoginPage } from "@/pages/LoginPage"
import { UsersPage } from "@/pages/UsersPage"

export default function App() {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="grid min-h-svh place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!user) return <LoginPage />

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/jobs" replace />} />
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/jobs/:jobId" element={<JobPage />} />
        <Route path="/jobs/:jobId/candidates/:applicationId" element={<CandidatePage />} />
        {user.role === "admin" && <Route path="/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/jobs" replace />} />
      </Route>
    </Routes>
  )
}
