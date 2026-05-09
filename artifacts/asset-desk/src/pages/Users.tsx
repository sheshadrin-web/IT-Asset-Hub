import { useState } from "react";
import {
  Plus, Search, MoreHorizontal, Edit, Trash2, Download,
  X, UserX, RefreshCw, AlertTriangle, ShieldAlert, Eye, EyeOff,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
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
import { adminUsersApi } from "@/lib/adminUsersApi";
import { cn } from "@/lib/utils";

// ─── Role / status colours ────────────────────────────────────────────────────
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

// ─── Schemas ──────────────────────────────────────────────────────────────────
const addSchema = z.object({
  full_name:  z.string().min(2, "Full name is required"),
  email:      z.string().email("Invalid email address"),
  role:       z.enum(["super_admin", "it_admin", "it_agent", "end_user"]),
  department: z.string().min(1, "Department is required"),
  location:   z.string().min(1, "Location is required"),
  password:   z.string().min(8, "Password must be at least 8 characters"),
});
type AddFormValues = z.infer<typeof addSchema>;

const editSchema = z.object({
  full_name:  z.string().min(2, "Required"),
  role:       z.enum(["super_admin", "it_admin", "it_agent", "end_user"]),
  department: z.string().min(1, "Required"),
  location:   z.string().min(1, "Required"),
  status:     z.enum(["Active", "Inactive"]),
});
type EditFormValues = z.infer<typeof editSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────
function generatePassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$";
  return Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportUsers(users: Profile[]) {
  const header = ["User ID", "Name", "Email", "Role", "Department", "Location", "Status"];
  const rows   = users.map(u => [u.id, u.full_name, u.email, ROLE_LABELS[u.role], u.department, u.location, u.status]);
  const csv    = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_export_${new Date().toISOString().split("T")[0]}.csv`);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Users() {
  const { users, loading, refresh, updateUser, removeUser } = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search,         setSearch]         = useState("");
  const [roleFilter,     setRoleFilter]     = useState("all");
  const [statusFilter,   setStatusFilter]   = useState("all");

  // Dialogs
  const [addOpen,        setAddOpen]        = useState(false);
  const [editingUser,    setEditingUser]     = useState<Profile | null>(null);
  const [editOpen,       setEditOpen]        = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deleteTarget,   setDeleteTarget]   = useState<Profile | null>(null);

  // Loading states
  const [addSaving,      setAddSaving]      = useState(false);
  const [editSaving,     setEditSaving]     = useState(false);
  const [actionSaving,   setActionSaving]   = useState<string | null>(null); // userId being actioned

  // Edge Function banner
  const [edgeFnMissing,  setEdgeFnMissing]  = useState(false);

  // Password visibility in Add form
  const [showPw,         setShowPw]         = useState(false);

  const isSuperAdmin = currentUser?.role === "super_admin";

  // ── Forms ──────────────────────────────────────────────────────────────────
  const addForm = useForm<AddFormValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { full_name: "", email: "", role: "end_user", department: "", location: "", password: "" },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { full_name: "", role: "end_user", department: "", location: "", status: "Active" },
  });

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
    const matchRole   = roleFilter   === "all" || u.role   === roleFilter;
    const matchStatus = statusFilter === "all" || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const roleCounts = {
    superAdmins: users.filter(u => u.role === "super_admin").length,
    itAdmins:    users.filter(u => u.role === "it_admin").length,
    itAgents:    users.filter(u => u.role === "it_agent").length,
    endUsers:    users.filter(u => u.role === "end_user").length,
    active:      users.filter(u => u.status === "Active").length,
    inactive:    users.filter(u => u.status === "Inactive").length,
  };

  // ── Add user ───────────────────────────────────────────────────────────────
  const openAdd = () => {
    addForm.reset({ full_name: "", email: "", role: "end_user", department: "", location: "", password: "" });
    setShowPw(false);
    setAddOpen(true);
  };

  const onAddSubmit = async (values: AddFormValues) => {
    setAddSaving(true);
    const result = await adminUsersApi.createUser(values);
    setAddSaving(false);

    if (result.notDeployed) {
      setEdgeFnMissing(true);
      setAddOpen(false);
      return;
    }

    if (!result.success) {
      toast({ title: "Failed to create user", description: result.error ?? "Unknown error", variant: "destructive" });
      return;
    }

    toast({ title: "User created", description: `${values.email} has been added and can log in now.` });
    setAddOpen(false);
    await refresh();
  };

  // ── Edit user ──────────────────────────────────────────────────────────────
  const openEdit = (user: Profile) => {
    setEditingUser(user);
    editForm.reset({
      full_name:  user.full_name,
      role:       user.role,
      department: user.department,
      location:   user.location,
      status:     user.status,
    });
    setEditOpen(true);
  };

  const onEditSubmit = async (values: EditFormValues) => {
    if (!editingUser) return;

    // Warn if super_admin is removing their own role
    const removingOwnAdmin =
      editingUser.id === currentUser?.userId &&
      editingUser.role === "super_admin" &&
      values.role !== "super_admin";

    if (removingOwnAdmin) {
      const confirmed = window.confirm(
        "Warning: You are about to remove your own Super Admin access. You will lose admin privileges immediately. Continue?"
      );
      if (!confirmed) return;
    }

    setEditSaving(true);
    try {
      await updateUser(editingUser.id, values);
      toast({ title: "User updated successfully" });
      setEditOpen(false);
    } catch (err) {
      toast({
        title: "Failed to update user",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setEditSaving(false);
    }
  };

  // ── Deactivate user ────────────────────────────────────────────────────────
  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setActionSaving(deactivateTarget.id);
    try {
      await updateUser(deactivateTarget.id, {
        full_name:  deactivateTarget.full_name,
        role:       deactivateTarget.role,
        department: deactivateTarget.department,
        location:   deactivateTarget.location,
        status:     "Inactive",
      });
      toast({ title: "User deactivated", description: `${deactivateTarget.full_name} can no longer log in.` });
    } catch (err) {
      toast({ title: "Failed to deactivate", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setActionSaving(null);
      setDeactivateTarget(null);
    }
  };

  // ── Delete user (hard delete via Edge Function) ────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionSaving(deleteTarget.id);

    const result = await adminUsersApi.deleteUser(deleteTarget.id);
    setActionSaving(null);
    setDeleteTarget(null);

    if (result.notDeployed) {
      setEdgeFnMissing(true);
      return;
    }

    if (!result.success) {
      toast({ title: "Failed to delete user", description: result.error ?? "Unknown error", variant: "destructive" });
      return;
    }

    removeUser(deleteTarget.id);
    toast({ title: "User deleted", description: `${deleteTarget.full_name} has been permanently removed.` });
  };

  // ── Reactivate ────────────────────────────────────────────────────────────
  const handleReactivate = async (user: Profile) => {
    setActionSaving(user.id);
    try {
      await updateUser(user.id, { ...user, status: "Active" });
      toast({ title: "User reactivated", description: `${user.full_name} can now log in.` });
    } catch (err) {
      toast({ title: "Failed to reactivate", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setActionSaving(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Edge Function not deployed banner */}
      {edgeFnMissing && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <ShieldAlert className="h-5 w-5 flex-shrink-0 text-amber-500 mt-0.5" />
          <div className="flex-1 text-sm">
            <p className="font-semibold text-amber-800">Admin user management backend is not configured yet.</p>
            <p className="text-amber-700 mt-0.5">
              Creating and deleting users requires the <code className="bg-amber-100 px-1 rounded">admin-users</code> Supabase Edge Function to be deployed.
              See <strong>SUPABASE_SETUP.md — Section 10</strong> for deployment instructions.
            </p>
            <p className="text-amber-600 text-xs mt-1">
              Editing, deactivating, and viewing users still works without the Edge Function.
            </p>
          </div>
          <button onClick={() => setEdgeFnMissing(false)} className="text-amber-400 hover:text-amber-600 flex-shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refresh()} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => exportUsers(filtered)} data-testid="button-export-users">
            <Download className="h-4 w-4" /> Export
          </Button>
          {isSuperAdmin && (
            <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-user">
              <Plus className="h-4 w-4" /> Add User
            </Button>
          )}
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
          { label: "Inactive",    val: roleCounts.inactive,    color: "bg-red-50 text-red-700 border-red-200" },
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-36" data-testid="select-status-filter">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Active">Active</SelectItem>
                <SelectItem value="Inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["User", "Role", "Department", "Location", "Status", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">Loading users…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      {users.length === 0 ? "No users found. Add your first user above." : "No users match the current filters."}
                    </td>
                  </tr>
                ) : filtered.map(user => {
                  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
                  const isSelf   = user.id === currentUser?.userId;
                  const busy     = actionSaving === user.id;

                  return (
                    <tr
                      key={user.id}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/30 transition-colors",
                        user.status === "Inactive" && "opacity-60"
                      )}
                      data-testid={`row-user-${user.id}`}
                    >
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
                      <td className="px-4 py-3 text-muted-foreground">{user.department || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{user.location || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", statusColors[user.status])}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {isSuperAdmin ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} data-testid={`btn-actions-${user.id}`}>
                                {busy
                                  ? <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                                  : <MoreHorizontal className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(user)} className="gap-2 cursor-pointer">
                                <Edit className="h-3.5 w-3.5" /> Edit Profile
                              </DropdownMenuItem>
                              {!isSelf && user.status === "Active" && (
                                <DropdownMenuItem onClick={() => setDeactivateTarget(user)} className="gap-2 cursor-pointer text-amber-600 focus:text-amber-600">
                                  <UserX className="h-3.5 w-3.5" /> Deactivate
                                </DropdownMenuItem>
                              )}
                              {!isSelf && user.status === "Inactive" && (
                                <DropdownMenuItem onClick={() => handleReactivate(user)} className="gap-2 cursor-pointer text-emerald-600 focus:text-emerald-600">
                                  <RefreshCw className="h-3.5 w-3.5" /> Reactivate
                                </DropdownMenuItem>
                              )}
                              {!isSelf && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => setDeleteTarget(user)}
                                    className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" /> Delete User
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(user)} title="Edit">
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && !loading && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {users.length} user{users.length !== 1 ? "s" : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add User Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={addOpen} onOpenChange={v => !addSaving && setAddOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>
              Creates a Supabase Auth account and profile in one step.
              The user can log in immediately with the password you set.
            </DialogDescription>
          </DialogHeader>
          <Form {...addForm}>
            <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
              <FormField control={addForm.control} name="full_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input placeholder="Rahul Sharma" {...field} data-testid="input-add-fullname" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={addForm.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl><Input type="email" placeholder="rahul.s@mileseducation.com" {...field} data-testid="input-add-email" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-add-role"><SelectValue /></SelectTrigger></FormControl>
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
                <FormField control={addForm.control} name="department" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl><Input placeholder="IT, Finance…" {...field} data-testid="input-add-dept" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={addForm.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input placeholder="Bangalore, Mumbai…" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={addForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Temporary Password</FormLabel>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => {
                        const pw = generatePassword();
                        addForm.setValue("password", pw, { shouldValidate: true });
                        setShowPw(true);
                      }}
                    >
                      Generate random
                    </button>
                  </div>
                  <div className="relative">
                    <FormControl>
                      <Input
                        type={showPw ? "text" : "password"}
                        placeholder="Min. 8 characters"
                        className="pr-10"
                        {...field}
                        data-testid="input-add-password"
                      />
                    </FormControl>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-100 rounded px-3 py-2">
                Share the temporary password with the user securely. They should change it after first login.
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAddOpen(false)} disabled={addSaving}>Cancel</Button>
                <Button type="submit" disabled={addSaving} data-testid="button-submit-add-user">
                  {addSaving ? (
                    <span className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                      Creating…
                    </span>
                  ) : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={v => !editSaving && setEditOpen(v)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit User Profile</DialogTitle>
            {editingUser && (
              <DialogDescription>{editingUser.email}</DialogDescription>
            )}
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField control={editForm.control} name="full_name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
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
                <FormField control={editForm.control} name="status" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={editingUser?.id === currentUser?.userId}
                    >
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
              <FormField control={editForm.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input placeholder="Engineering, HR…" {...field} data-testid="input-user-department" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={editForm.control} name="location" render={({ field }) => (
                <FormItem><FormLabel>Location</FormLabel><FormControl><Input placeholder="Bangalore, Mumbai…" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              {editingUser?.id === currentUser?.userId && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  You cannot deactivate your own account from here.
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving}>Cancel</Button>
                <Button type="submit" disabled={editSaving} data-testid="button-save-user">
                  {editSaving ? "Saving…" : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Deactivate Confirm ────────────────────────────────────────────────── */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={v => !v && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.full_name}</strong> will be set to Inactive and will no longer be able to log in.
              You can reactivate them at any time from the Edit menu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleDeactivate}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Confirm ────────────────────────────────────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Permanently Delete User
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.full_name}</strong> ({deleteTarget?.email}) from
              Supabase Auth and remove their profile. This action cannot be undone.
              <br /><br />
              If you only want to block access temporarily, use <strong>Deactivate</strong> instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
