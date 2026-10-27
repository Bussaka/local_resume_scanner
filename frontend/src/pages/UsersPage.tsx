import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Loader2, MoreHorizontal, UserPlus } from "lucide-react"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"

import { PageBody, PageHeader } from "@/components/shared"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useAuth } from "@/hooks/use-auth"
import { api, type Role, type User } from "@/lib/api"
import { formatDate, initials } from "@/lib/format"
import { cn } from "@/lib/utils"

export function UsersPage() {
  const queryClient = useQueryClient()
  const { user: me } = useAuth()
  const users = useQuery({ queryKey: ["users"], queryFn: api.users })
  const [creating, setCreating] = useState(false)
  const [resetting, setResetting] = useState<User | null>(null)

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Parameters<typeof api.updateUser>[1]) => api.updateUser(id, body),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success(`${user.full_name} updated`)
    },
  })

  return (
    <>
      <PageHeader
        title="Team"
        description="HR staff who can sign in. Admins can also manage the team and delete jobs."
        actions={<Button onClick={() => setCreating(true)}><UserPlus /> Add user</Button>}
      />
      <PageBody>
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-5">Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="hidden md:table-cell">Added</TableHead>
                <TableHead className="w-12 pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data?.map((u) => (
                <TableRow key={u.id} className={cn(!u.is_active && "opacity-60")}>
                  <TableCell className="pl-5">
                    <div className="flex items-center gap-3">
                      <div className="grid size-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(u.full_name)}</div>
                      <div>
                        <div className="font-medium">{u.full_name} {u.id === me?.id && <span className="text-xs text-muted-foreground">(you)</span>}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"} className="capitalize">{u.role}</Badge>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <span className={cn("inline-flex items-center gap-1.5 text-sm", u.is_active ? "text-success" : "text-muted-foreground")}>
                      <span className={cn("size-1.5 rounded-full", u.is_active ? "bg-success" : "bg-muted-foreground")} />
                      {u.is_active ? "Active" : "Deactivated"}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{formatDate(u.created_at)}</TableCell>
                  <TableCell className="pr-5">
                    {u.id !== me?.id && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Actions for ${u.full_name}`}><MoreHorizontal /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => update.mutate({ id: u.id, role: u.role === "admin" ? "recruiter" : "admin" })}>
                            Make {u.role === "admin" ? "recruiter" : "admin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setResetting(u)}><KeyRound /> Reset password</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant={u.is_active ? "destructive" : "default"} onSelect={() => update.mutate({ id: u.id, is_active: !u.is_active })}>
                            {u.is_active ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </PageBody>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
    </>
  )
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const empty = { full_name: "", email: "", password: "", role: "recruiter" as Role }
  const [form, setForm] = useState(empty)

  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["users"] })
      toast.success(`${user.full_name} can now sign in`, { description: "Share the temporary password securely and ask them to change it." })
      setForm(empty)
      onOpenChange(false)
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    create.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>They sign in with this email and a temporary password you set.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="u-name">Full name</Label>
            <Input id="u-name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-email">Work email</Label>
            <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <div className="space-y-2">
              <Label htmlFor="u-pass">Temporary password</Label>
              <Input id="u-pass" type="text" autoComplete="off" minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as Role })}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="recruiter">Recruiter</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending && <Loader2 className="animate-spin" />} Add user</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [password, setPassword] = useState("")
  const reset = useMutation({
    mutationFn: () => api.updateUser(user!.id, { password }),
    onSuccess: () => {
      toast.success(`Password reset for ${user!.full_name}`, { description: "They have been signed out everywhere." })
      setPassword("")
      onClose()
    },
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    reset.mutate()
  }

  return (
    <Dialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>Set a new temporary password for {user?.full_name}.</DialogDescription>
          </DialogHeader>
          <Input type="text" autoComplete="off" minLength={10} placeholder="At least 10 characters" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          <DialogFooter>
            <Button type="submit" disabled={reset.isPending}>Reset password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
