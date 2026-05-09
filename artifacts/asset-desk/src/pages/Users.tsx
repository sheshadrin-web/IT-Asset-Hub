import { useState } from "react";
import { Plus, Search, MoreHorizontal, Edit, Trash2, UserCheck, Download, Info, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useUsers } from "@/context/UsersContext";
import { useAuth } from "@/context/AuthContext";
import { Profile, UserRole, UserStatus, ROLE_LABELS } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  it_admin:    "bg-blue-500/15 text-blue-600 border-blue-500/20",
  it_agent:    "bg-cyan-500/15 text-cyan-600 border-cyan-500/20",
  end_user:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
};
const statusColors: Record<UserStatus, string> = {
  Active:   "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Inactive: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const editSchema = z.object({
  full_name:  z.string().min(2, "Required"),
  role:       z.enum(["super_admin", "it_admin", "it_agent", "end_user"]),
  department: z.string().min(1, "Required"),
  location:   z.string().min(1, "Required"),
  status:     z.enum(["Active", "Inactive"]),
});
type EditFormValues = z.infer<typeof editSchema>;

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportUsers(users: Profile[]) {
  const header = ["User ID","Name","Email","Role","Department","Location","Status"];
  const rows   = users.map(u => [u.id, u.full_name, u.email, ROLE_LABELS[u.role], u.department, u.location, u.status]);
  const csv    = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_export_${new Date().toISOString().split("T")[0]}.csv`);
}

export default function Users() {
  const { users, loading, updateUser, deleteUser } = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search,      setSearch]      = useState("");
  const [roleFilter,  setRoleFilter]  = useState("all");
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  const [modalOpen,   setModalOpen]   = useState(false);
  const [deleteTarget,setDeleteTarget]= useState<Profile | null>(null);
  const [infoOpen,    setInfoOpen]    = useState(false);
  const [saving,      setSaving]      = useState(false);

  const isSuperAdmin = currentUser?.role === "super_admin";

  const form = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { full_name: "", role: "end_user", department: "", location: "", status: "Active" },
  });

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
    const matchRole   = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const roleCounts = {
    superAdmins: users.filter(u => u.role === "super_admin").length,
    itAdmins:    users.filter(u => u.role === "it_admin").length,
    itAgents:    users.filter(u => u.role === "it_agent").length,
    endUsers:    users.filter(u => u.role === "end_user").length,
    active:      users.filter(u => u.status === "Active").length,
  };

  const openEdit = (user: Profile) => {
    setEditingUser(user);
    form.reset({
      full_name:  user.full_name,
      role:       user.role,
      department: user.department,
      location:   user.location,
      status:     user.status,
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: EditFormValues) => {
    if (!editingUser) return;
    setSaving(true);
    try {
      await updateUser(editingUser.id, values);
      toast({ title: "User updated" });
      setModalOpen(false);
    } catch (err) {
      toast({ title: "Failed to update user", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    // Prevent deleting super_admin unless the current user is also super_admin
    if (deleteTarget.role === "super_admin" && !isSuperAdmin) {
      toast({ title: "Permission denied", description: "Only Super Admins can delete Super Admin profiles.", variant: "destructive" });
      setDeleteTarget(null);
      return;
    }
    try {
      await deleteUser(deleteTarget.id);
      toast({ title: "User profile deleted", description: "The Supabase Auth account still exists. Remove it from the Supabase dashboard if needed." });
    } catch (err) {
      toast({ title: "Failed to delete user", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{loading ? "Loading…" : `${users.length} users`}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => exportUsers(filtered)} data-testid="button-export-users">
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setInfoOpen(true)} data-testid="button-add-user">
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Super Admin", val: roleCounts.superAdmins, color: "bg-purple-50 text-purple-700 border-purple-200" },
          { label: "IT Admin",    val: roleCounts.itAdmins,    color: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "IT Agent",    val: roleCounts.itAgents,    color: "bg-cyan-50 text-cyan-700 border-cyan-200" },
          { label: "End User",    val: roleCounts.endUsers,    color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
          { label: "Active",      val: roleCounts.active,      color: "bg-slate-100 text-slate-700 border-slate-200" },
        ].map(chip => (
          <span key={chip.label} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", chip.color)}>
            <span className="font-bold">{chip.val}</span> {chip.label}
          </span>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or department…"
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
                data-testid="input-search-users"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-44" data-testid="select-role-filter">
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Roles</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
                <SelectItem value="it_admin">IT Admin</SelectItem>
                <SelectItem value="it_agent">IT Agent</SelectItem>
                <SelectItem value="end_user">End User</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["User","Role","Department","Location","Status",""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading users…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No users found.</td></tr>
                ) : filtered.map(user => {
                  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase();
                  const isSelf   = user.id === currentUser?.userId;
                  return (
                    <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-user-${user.id}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">{initials}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-foreground flex items-center gap-1.5">
                              {user.full_name}
                              {isSelf && <span className="text-[10px] bg-primary/10 text-primary rounded px-1 py-0.5 font-medium">You</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">{user.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", roleColors[user.role])}>
                          {ROLE_LABELS[user.role]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{user.department}</td>
                      <td className="px-4 py-3 text-muted-foreground">{user.location}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", statusColors[user.status])}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(user)} className="flex items-center gap-2 cursor-pointer">
                              <Edit className="h-3.5 w-3.5" /> Edit Profile
                            </DropdownMenuItem>
                            {!isSelf && !(user.role === "super_admin" && !isSuperAdmin) && (
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(user)}
                                className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete Profile
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && !loading && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {users.length} users
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit User Dialog */}
      <Dialog open={modalOpen} onOpenChange={v => !v && setModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange} disabled={editingUser?.role === "super_admin" && !isSuperAdmin}>
                      <FormControl><SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="super_admin">Super Admin</SelectItem>
                        <SelectItem value="it_admin">IT Admin</SelectItem>
                        <SelectItem value="it_agent">IT Agent</SelectItem>
                        <SelectItem value="end_user">End User</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-user-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="Active">Active</SelectItem>
                        <SelectItem value="Inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} placeholder="Engineering, HR…" data-testid="input-user-department" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem><FormLabel>Location</FormLabel><FormControl><Input {...field} placeholder="Bangalore, Mumbai…" /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving} data-testid="button-save-user">
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Add User Info Dialog */}
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-500" /> How to Add a New User
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground py-2">
            <p>New users must be created through <strong className="text-foreground">Supabase Auth</strong> first, then their profile appears here automatically.</p>
            <ol className="space-y-2 list-decimal list-inside">
              <li>Go to your <strong className="text-foreground">Supabase Dashboard</strong> → Authentication → Users</li>
              <li>Click <strong className="text-foreground">Invite User</strong> and enter their email</li>
              <li>The user receives an invite email and sets their password</li>
              <li>After they log in once, insert their profile row in <code className="bg-muted px-1 rounded">public.profiles</code> with their UUID, name, role, department, and location</li>
              <li>They can then log in to this portal</li>
            </ol>
            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              See <strong>SUPABASE_SETUP.md</strong> in your project repository for the complete setup guide and SQL scripts.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={() => setInfoOpen(false)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User Profile</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete <strong>{deleteTarget?.full_name}</strong>'s profile record from the database.
              Their Supabase Auth account will <strong>not</strong> be deleted — remove it separately from the Supabase dashboard if needed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>
              Delete Profile
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
