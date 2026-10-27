import { useQuery } from "@tanstack/react-query"
import { BriefcaseBusiness, ChevronsUpDown, FileCheck2, KeyRound, LogOut, Monitor, Moon, Sun, Users } from "lucide-react"
import { useTheme } from "next-themes"
import { useState } from "react"
import { NavLink, Outlet } from "react-router-dom"

import { ChangePasswordDialog } from "@/components/layout/ChangePasswordDialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { api } from "@/lib/api"
import { initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export function AppShell() {
  const { user } = useAuth()

  const nav = [
    { to: "/jobs", label: "Jobs", icon: BriefcaseBusiness },
    ...(user?.role === "admin" ? [{ to: "/users", label: "Team", icon: Users }] : []),
  ]

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-svh md:w-60">
        <div className="flex items-center gap-2.5 px-5 py-4 md:py-5">
          <div className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <FileCheck2 className="size-4.5" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">TalentScreen</div>
            <div className="text-[11px] text-sidebar-muted">Private AI screening</div>
          </div>
        </div>

        <nav className="flex gap-1 px-3 pb-3 md:flex-1 md:flex-col md:pb-0">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-white",
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden space-y-2 border-t border-white/10 p-3 md:block">
          <EngineStatus />
          <UserMenu />
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}

/** Shows whether the local AI engine is reachable and how much work is queued. */
function EngineStatus() {
  const { data } = useQuery({ queryKey: ["system-status"], queryFn: api.systemStatus, refetchInterval: 10_000 })
  if (!data) return null

  const busy = data.queue_length > 0
  const label = !data.ollama_ok ? "AI engine offline" : busy ? `Screening · ${data.queue_length} in queue` : "AI engine ready"

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-sidebar-muted">
          <span className="relative flex size-2">
            {data.ollama_ok && busy && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
            <span className={cn("relative inline-flex size-2 rounded-full", data.ollama_ok ? "bg-success" : "bg-destructive")} />
          </span>
          <span className="truncate">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-64">
        {data.ollama_error ?? data.current_task ?? `Model: ${data.model}. All resumes are processed on this server.`}
      </TooltipContent>
    </Tooltip>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const { theme, setTheme } = useTheme()
  const [passwordOpen, setPasswordOpen] = useState(false)
  if (!user) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-white">
            {initials(user.full_name)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-white">{user.full_name}</div>
            <div className="truncate text-xs text-sidebar-muted capitalize">{user.role}</div>
          </div>
          <ChevronsUpDown className="size-4 text-sidebar-muted" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <div className="text-sm font-medium">{user.full_name}</div>
            <div className="text-xs text-muted-foreground">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="light"><Sun /> Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon /> Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor /> System</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setPasswordOpen(true)}><KeyRound /> Change password</DropdownMenuItem>
          <DropdownMenuItem onSelect={logout}><LogOut /> Sign out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  )
}
