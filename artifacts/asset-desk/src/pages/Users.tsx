import { useState, useRef, useCallback } from "react";
import {
  Plus, Search, MoreHorizontal, Edit, Trash2, UserCheck,
  Download, Upload, FileText, CheckCircle2, AlertCircle, X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { mockUsers, User, UserRole, UserStatus, ROLE_LABELS } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  agent:       "bg-blue-500/15 text-blue-600 border-blue-500/20",
  end_user:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
};
const statusColors: Record<UserStatus, string> = {
  Active:   "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  Inactive: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

const userSchema = z.object({
  name:       z.string().min(2, "Required"),
  email:      z.string().email("Invalid email"),
  role:       z.enum(["super_admin", "agent", "end_user"]),
  department: z.string().min(1, "Required"),
  status:     z.enum(["Active", "Inactive"]),
});
type UserFormValues = z.infer<typeof userSchema>;

// ─── CSV helpers ─────────────────────────────────────────────────────────────
const CSV_HEADERS = ["name", "email", "role", "department", "status"];
const CSV_TEMPLATE = [
  CSV_HEADERS.join(","),
  "Jane Smith,jane.smith@company.com,end_user,Engineering,Active",
  "Bob Johnson,bob.johnson@company.com,agent,IT,Active",
].join("\n");

function downloadCsv(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportUsers(users: User[]) {
  const header = ["User ID","Name","Email","Role","Department","Status","Assigned Assets"];
  const rows   = users.map((u) => [
    u.userId, u.name, u.email, ROLE_LABELS[u.role], u.department, u.status, String(u.assignedAssets ?? 0),
  ]);
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_export_${new Date().toISOString().split("T")[0]}.csv`);
}

interface ParsedUser {
  index: number;
  data: Partial<UserFormValues>;
  errors: string[];
}

function parseCsvUsers(text: string): ParsedUser[] {
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const [headerLine, ...dataLines] = lines;
  const headers = headerLine.split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return dataLines.map((line, i) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, j) => { row[h] = values[j] ?? ""; });
    const errors: string[] = [];
    if (!row.name || row.name.length < 2)                          errors.push("name is required (min 2 chars)");
    if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) errors.push("valid email is required");
    if (!["super_admin","agent","end_user"].includes(row.role))    errors.push("role must be super_admin, agent, or end_user");
    if (!row.department)                                           errors.push("department is required");
    if (!["Active","Inactive"].includes(row.status))               errors.push("status must be Active or Inactive");
    return {
      index: i + 1,
      data: {
        name:       row.name,
        email:      row.email,
        role:       (row.role as UserRole) || "end_user",
        department: row.department,
        status:     (row.status as UserStatus) || "Active",
      },
      errors,
    };
  });
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Users() {
  const { toast } = useToast();
  const [users, setUsers]         = useState<User[]>(mockUsers);
  const [search, setSearch]       = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Import state
  const [importOpen, setImportOpen]         = useState(false);
  const [parsedRows, setParsedRows]         = useState<ParsedUser[]>([]);
  const [uploadFileName, setUploadFileName] = useState("");
  const [dragOver, setDragOver]             = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userSchema),
    defaultValues: { name: "", email: "", role: "end_user", department: "", status: "Active" },
  });

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q);
    const matchesRole   = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const openAdd = () => {
    setEditingUser(null);
    form.reset({ name: "", email: "", role: "end_user", department: "", status: "Active" });
    setModalOpen(true);
  };
  const openEdit = (user: User) => {
    setEditingUser(user);
    form.reset({ name: user.name, email: user.email, role: user.role, department: user.department, status: user.status });
    setModalOpen(true);
  };
  const onSubmit = (values: UserFormValues) => {
    if (editingUser) {
      setUsers((prev) => prev.map((u) => u.userId === editingUser.userId ? { ...u, ...values } : u));
      toast({ title: "User updated" });
    } else {
      const ids = users.map((u) => parseInt(u.userId.replace("USR-", ""), 10));
      const next = ids.length > 0 ? Math.max(...ids) + 1 : 1;
      const newUser: User = { ...values, userId: `USR-${String(next).padStart(3, "0")}`, assignedAssets: 0 };
      setUsers((prev) => [...prev, newUser]);
      toast({ title: "User created" });
    }
    setModalOpen(false);
  };
  const deleteUser = (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.userId !== userId));
    toast({ title: "User deleted" });
  };

  // ─── Import handlers ──────────────────────────────────────────────────────
  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please upload a .csv file", variant: "destructive" });
      return;
    }
    setUploadFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => setParsedRows(parseCsvUsers(e.target?.result as string));
    reader.readAsText(file);
  }, [toast]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const validRows   = parsedRows.filter((r) => r.errors.length === 0);
  const invalidRows = parsedRows.filter((r) => r.errors.length > 0);

  const handleImport = () => {
    const ids = users.map((u) => parseInt(u.userId.replace("USR-", ""), 10));
    let next = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const newUsers: User[] = validRows.map((r) => ({
      ...(r.data as UserFormValues),
      userId: `USR-${String(next++).padStart(3, "0")}`,
      assignedAssets: 0,
    }));
    setUsers((prev) => [...prev, ...newUsers]);
    toast({ title: `${newUsers.length} user${newUsers.length !== 1 ? "s" : ""} imported` });
    setImportOpen(false); setParsedRows([]); setUploadFileName("");
  };

  const roleCounts = {
    admins:   users.filter((u) => u.role === "super_admin").length,
    agents:   users.filter((u) => u.role === "agent").length,
    endUsers: users.filter((u) => u.role === "end_user").length,
    active:   users.filter((u) => u.status === "Active").length,
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{users.length} users</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => exportUsers(filtered)}
            data-testid="button-export-users"
          >
            <Download className="h-4 w-4" /> Export
          </Button>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => { setParsedRows([]); setUploadFileName(""); setImportOpen(true); }}
            data-testid="button-import-users"
          >
            <Upload className="h-4 w-4" /> Import
          </Button>
          <Button onClick={openAdd} className="gap-2" data-testid="button-add-user">
            <Plus className="h-4 w-4" /> Add User
          </Button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {[
          { label: "Super Admin", val: roleCounts.admins,   color: "bg-purple-50 text-purple-700 border-purple-200" },
          { label: "IT Agent",    val: roleCounts.agents,   color: "bg-blue-50 text-blue-700 border-blue-200" },
          { label: "End User",    val: roleCounts.endUsers, color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
          { label: "Active",      val: roleCounts.active,   color: "bg-slate-100 text-slate-700 border-slate-200" },
        ].map((chip) => (
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
                onChange={(e) => setSearch(e.target.value)}
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
                <SelectItem value="agent">IT Agent</SelectItem>
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
                  {["User","Role","Department","Assets","Status",""].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">No users found.</td>
                  </tr>
                )}
                {filtered.map((user) => {
                  const initials = user.name.split(" ").map((n) => n[0]).join("").toUpperCase();
                  return (
                    <tr key={user.userId} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-user-${user.userId}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">{initials}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium text-foreground">{user.name}</div>
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
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground font-medium">{user.assignedAssets}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", statusColors[user.status])}>
                          {user.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`button-actions-${user.userId}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(user)} className="flex items-center gap-2 cursor-pointer">
                              <Edit className="h-3.5 w-3.5" /> Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => deleteUser(user.userId)}
                              className="flex items-center gap-2 cursor-pointer text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
              Showing {filtered.length} of {users.length} users
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Add/Edit User Modal ── */}
      <Dialog open={modalOpen} onOpenChange={(v) => !v && setModalOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add New User"}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem><FormLabel>Email</FormLabel><FormControl><Input type="email" {...field} data-testid="input-user-email" /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid grid-cols-2 gap-4">
                <FormField control={form.control} name="role" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="super_admin">Super Admin</SelectItem>
                        <SelectItem value="agent">IT Agent</SelectItem>
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
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" data-testid="button-save-user">{editingUser ? "Save Changes" : "Add User"}</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* ── Import Users Dialog ── */}
      <Dialog open={importOpen} onOpenChange={(v) => { if (!v) { setImportOpen(false); setParsedRows([]); setUploadFileName(""); } }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Import Users
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-2">
            {/* Info */}
            <div className="flex items-start gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
              <FileText className="h-4 w-4 mt-0.5 flex-shrink-0 text-blue-500" />
              <div className="space-y-1">
                <p className="font-medium">CSV Format</p>
                <p className="text-xs text-blue-700">Required columns: <code className="bg-blue-100 px-1 rounded">name</code>, <code className="bg-blue-100 px-1 rounded">email</code>, <code className="bg-blue-100 px-1 rounded">role</code> (super_admin / agent / end_user), <code className="bg-blue-100 px-1 rounded">department</code>, <code className="bg-blue-100 px-1 rounded">status</code> (Active / Inactive)</p>
              </div>
            </div>

            <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadCsv(CSV_TEMPLATE, "user_import_template.csv")}>
              <Download className="h-3.5 w-3.5" /> Download CSV Template
            </Button>

            {/* Drop zone */}
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileInput} />
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all",
                dragOver ? "border-primary bg-primary/5"
                  : uploadFileName ? "border-emerald-400 bg-emerald-50"
                  : "border-border hover:border-primary/40 hover:bg-muted/30"
              )}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              {uploadFileName ? (
                <div className="flex flex-col items-center gap-2">
                  <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                  <p className="text-sm font-semibold text-foreground">{uploadFileName}</p>
                  <p className="text-xs text-muted-foreground">{parsedRows.length} rows detected — click to replace</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm font-semibold text-foreground">Click to upload or drag & drop</p>
                  <p className="text-xs text-muted-foreground">.csv files only</p>
                </div>
              )}
            </div>

            {/* Preview */}
            {parsedRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                    <CheckCircle2 className="h-4 w-4" /> {validRows.length} valid
                  </span>
                  {invalidRows.length > 0 && (
                    <span className="flex items-center gap-1.5 text-red-500 font-medium">
                      <AlertCircle className="h-4 w-4" /> {invalidRows.length} with errors (skipped)
                    </span>
                  )}
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  <div className="overflow-x-auto max-h-52">
                    <table className="w-full text-xs min-w-[500px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {["#","Name","Email","Role","Dept","Status"].map((h) => (
                            <th key={h} className="px-3 py-2 text-left text-muted-foreground font-semibold uppercase">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {parsedRows.map((row) => (
                          <tr key={row.index} className={cn("border-b border-border last:border-0", row.errors.length ? "bg-red-50" : "hover:bg-muted/20")}>
                            <td className="px-3 py-2 text-muted-foreground">{row.index}</td>
                            <td className="px-3 py-2">{row.data.name || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">{row.data.email || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">{row.data.role || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">{row.data.department || <span className="text-red-500">—</span>}</td>
                            <td className="px-3 py-2">
                              {row.errors.length > 0
                                ? <span className="text-red-500 flex items-center gap-1"><AlertCircle className="h-3 w-3" />{row.errors[0]}</span>
                                : <span className="text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />OK</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-border pt-4 mt-2">
            <Button variant="outline" onClick={() => { setImportOpen(false); setParsedRows([]); setUploadFileName(""); }}>Cancel</Button>
            <Button onClick={handleImport} disabled={validRows.length === 0} className="gap-2">
              <Upload className="h-3.5 w-3.5" />
              Import {validRows.length > 0 ? `${validRows.length} User${validRows.length !== 1 ? "s" : ""}` : "Users"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
