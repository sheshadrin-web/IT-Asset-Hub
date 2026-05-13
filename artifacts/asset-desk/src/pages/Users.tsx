import { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  Plus, Search, MoreHorizontal, Edit, Trash2, Download,
  X, UserX, RefreshCw, AlertTriangle, Eye, EyeOff,
  Upload, CheckSquare, User,
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

// ─── Colours ──────────────────────────────────────────────────────────────────
const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  it_admin:    "bg-blue-500/15 text-blue-600 border-blue-500/20",
  it_agent:    "bg-cyan-500/15 text-cyan-600 border-cyan-500/20",
  end_user:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
};
const statusColors: Record<UserStatus, string> = {
  active:   "bg-emerald-500/15 text-emerald-600 border-emerald-500/20",
  inactive: "bg-gray-500/15 text-gray-500 border-gray-500/20",
};

// Display label for status (capitalise for UI)
const statusLabel: Record<UserStatus, string> = {
  active:   "Active",
  inactive: "Inactive",
};

// ─── Schemas ──────────────────────────────────────────────────────────────────
const addSchema = z.object({
  full_name:         z.string().min(2, "Full name is required"),
  email:             z.string().email("Invalid email address"),
  role:              z.enum(["super_admin", "it_admin", "it_agent", "end_user"]),
  ecode:             z.string().optional(),
  department:        z.string().min(1, "Department is required"),
  location:          z.string().min(1, "Location is required"),
  reporting_manager: z.string().optional(),
  password:          z.string().min(8, "Password must be at least 8 characters"),
});
type AddFormValues = z.infer<typeof addSchema>;

const editSchema = z.object({
  full_name:         z.string().min(2, "Required"),
  role:              z.enum(["super_admin", "it_admin", "it_agent", "end_user"]),
  ecode:             z.string().optional(),
  department:        z.string().min(1, "Required"),
  location:          z.string().min(1, "Required"),
  reporting_manager: z.string().optional(),
  status:            z.enum(["active", "inactive"]),
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
  const header = ["User ID", "E-Code", "Name", "Email", "Role", "Department", "Location", "Reporting Manager", "Status"];
  const rows   = users.map(u => [u.id, u.ecode ?? "", u.full_name, u.email, ROLE_LABELS[u.role], u.department, u.location, u.reporting_manager ?? "", statusLabel[u.status]]);
  const csv    = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
  downloadCsv(csv, `users_export_${new Date().toISOString().split("T")[0]}.csv`);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Users() {
  const { users, loading, refresh, updateUser, deleteUser } = useUsers();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Dialogs
  const [addOpen,          setAddOpen]          = useState(false);
  const [editingUser,      setEditingUser]       = useState<Profile | null>(null);
  const [editOpen,         setEditOpen]          = useState(false);
  const [viewingUser,      setViewingUser]       = useState<Profile | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deleteTarget,     setDeleteTarget]     = useState<Profile | null>(null);

  // Loading states
  const [addSaving,    setAddSaving]    = useState(false);
  const [editSaving,   setEditSaving]   = useState(false);
  const [actionSaving, setActionSaving] = useState<string | null>(null);

  // Password visibility
  const [showPw, setShowPw] = useState(false);

  // Bulk select
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen]   = useState(false);

  // Import
  const [importOpen,    setImportOpen]    = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importRows, setImportRows]       = useState<Array<{
    full_name: string; email: string; role: string; ecode: string;
    department: string; location: string; reporting_manager: string; password: string;
    _status?: "pending" | "ok" | "error" | "skipped" | "retrying"; _error?: string; _retries?: number;
  }>>([]);
  const [importSummary, setImportSummary] = useState<{
    total: number; imported: number; skipped: number; failed: number; retries: number;
  } | null>(null);
  // Tracks which app fields were matched from the CSV headers
  const [importColMap, setImportColMap]   = useState<Record<string, string | null>>({});
  const importFileRef = useRef<HTMLInputElement>(null);

  const isSuperAdmin = currentUser?.role === "super_admin";
  const isAdmin      = isSuperAdmin || currentUser?.role === "it_admin";

  // ── Bulk select helpers (uses toggleSelect/toggleSelectAll defined after filtered) ──
  const toggleSelect = (id: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  const handleBulkDelete = async () => {
    const ids = [...selectedUserIds];
    let successCount = 0;
    let failCount = 0;
    for (const id of ids) {
      // Call the Edge Function first — this permanently removes the Supabase
      // Auth account (plus the cascade-delete removes the profile row too).
      const result = await adminUsersApi.deleteUser(id);
      if (result.success || result.notDeployed) {
        // If Edge Fn not deployed, fall back to profile-only delete so at
        // minimum the user can no longer access the app.
        if (result.notDeployed) await deleteUser(id);
        successCount++;
      } else {
        // Edge Fn returned an error — still try to remove the profile row
        // so the user is at least de-listed from the UI.
        try { await deleteUser(id); } catch { /* ignore */ }
        failCount++;
      }
    }
    clearSelection();
    setBulkDeleteOpen(false);
    if (failCount === 0) {
      toast({ title: "Users permanently deleted", description: `${successCount} user${successCount !== 1 ? "s" : ""} removed from the system.` });
    } else {
      toast({
        title: "Partial deletion",
        description: `${successCount} deleted, ${failCount} failed (auth accounts may still exist).`,
        variant: "destructive",
      });
    }
  };

  // ── Import CSV ──────────────────────────────────────────────────────────────
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;

      // Robust CSV row splitter (handles quoted commas)
      const splitRow = (line: string): string[] => {
        const cells: string[] = [];
        let cell = "", inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { if (inQ && line[i+1] === '"') { cell += '"'; i++; } else inQ = !inQ; }
          else if (ch === ',' && !inQ) { cells.push(cell.trim()); cell = ""; }
          else cell += ch;
        }
        cells.push(cell.trim());
        return cells;
      };

      // Normalize header key for flexible matching
      const nk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

      const FIELD_ALIASES: Record<string, string[]> = {
        full_name:         ["fullname","name","employeename","empname","username","employeefullname","fullnamename","namefull"],
        email:             ["email","emailid","emailaddress","workemail","corporateemail","officeemail","mail","emailid"],
        role:              ["role","userrole","accessrole","designation","jobrole","rolelevel"],
        ecode:             [
          // exact / short
          "ecode","ec","empcode","empid","empno","mpe","mpecode",
          // long forms
          "employeecode","employeeid","employeeno","employeenumber","employeeidcode","employeeidnumber",
          // staff / hr variants
          "staffid","staffcode","staffno","staffnumber",
          // "code" alone (very common in simple HR exports)
          "code","idno","id",
          // common HR system exports
          "personnelno","personnelnumber","hrcode","hrid","workforceid",
          // with underscores/hyphens stripped
          "empcodeno","empidcode","empidentifier",
        ],
        department:        ["department","dept","division","team","employeedepartment","businessunit","bu","costcenter","function"],
        location:          ["location","loc","city","office","branch","worksite","worklocation","site","workcity"],
        reporting_manager: [
          "reportingmanager","manager","reportsto","supervisorname","managername",
          "linemanager","reportstoname","directmanager","supervisor","reportingto","manageremail",
        ],
        password:          ["password","pwd","pass","defaultpassword","temppassword","temporarypassword","initialpassword"],
      };

      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length === 0) { setImportRows([]); return; }

      // Detect if first row is a header
      const firstCols = splitRow(lines[0]);
      const looksLikeHeader = firstCols.some(c => /name|email|role|code|dept|ecode/i.test(c));

      let colIndex: Record<string, number> = {};
      let dataLines: string[];

      // colHeaderMap: field → the original CSV header string that matched (null if not found)
      const colHeaderMap: Record<string, string | null> = {
        full_name: null, email: null, role: null, ecode: null,
        department: null, location: null, reporting_manager: null, password: null,
      };

      if (looksLikeHeader) {
        // Map header names to field keys
        firstCols.forEach((h, i) => {
          const norm = nk(h);
          for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
            if (aliases.includes(norm) && !(field in colIndex)) {
              colIndex[field] = i;
              colHeaderMap[field] = h; // record the original header label
            }
          }
        });
        dataLines = lines.slice(1);
      } else {
        // Positional fallback: name, email, role, ecode, dept, location, manager, password
        colIndex = { full_name: 0, email: 1, role: 2, ecode: 3, department: 4, location: 5, reporting_manager: 6, password: 7 };
        Object.keys(colHeaderMap).forEach(k => { colHeaderMap[k] = `col ${colIndex[k] ?? "?"}`; });
        dataLines = lines;
      }
      setImportColMap(colHeaderMap);

      const get = (cols: string[], field: string) => {
        const idx = colIndex[field];
        return idx !== undefined ? (cols[idx] ?? "").replace(/^"|"$/g, "").trim() : "";
      };

      const mapRole = (raw: string): string => {
        const v = raw.toLowerCase().trim();
        if (v.includes("super") || v.includes("superadmin")) return "super_admin";
        if (v.includes("it admin") || v === "it_admin" || v === "itadmin") return "it_admin";
        if (v.includes("agent") || v === "it_agent") return "it_agent";
        return "end_user";
      };

      const rows = dataLines.map(line => {
        const cols = splitRow(line);
        return {
          full_name:         get(cols, "full_name"),
          email:             get(cols, "email"),
          role:              mapRole(get(cols, "role") || "end_user"),
          ecode:             get(cols, "ecode"),
          department:        get(cols, "department"),
          location:          get(cols, "location"),
          reporting_manager: get(cols, "reporting_manager"),
          password:          get(cols, "password"),
          _status:           "pending" as const,
        };
      }).filter(r => r.email);
      setImportRows(rows);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleImportSubmit = async () => {
    setImportLoading(true);
    setImportSummary(null);
    const updated = [...importRows];

    // ── Constants ────────────────────────────────────────────────────────────
    const BATCH_SIZE               = 5;
    const DELAY_BETWEEN_USERS_MS   = 1200;
    const DELAY_BETWEEN_BATCHES_MS = 5000;
    const MAX_RETRIES              = 3;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const isRateLimit = (msg: string) =>
      msg.toLowerCase().includes("rate limit") ||
      msg.toLowerCase().includes("429")        ||
      msg.toLowerCase().includes("too many");

    // ── Temp client — never overwrites admin session ──────────────────────
    const tempClient = createClient(
      (import.meta.env.VITE_SUPABASE_URL  as string) ?? "",
      (import.meta.env.VITE_SUPABASE_ANON_KEY as string) ?? "",
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
    );

    // ── Pre-fetch existing profiles (email + ecode) to detect duplicates ──
    const { data: existingProfileRows } = await supabase
      .from("profiles")
      .select("id, email, ecode");
    const emailToId = new Map<string, string>(
      (existingProfileRows ?? []).map((p: { id: string; email: string }) => [
        p.email?.toLowerCase().trim(), p.id,
      ])
    );
    const existingEcodes = new Set<string>(
      (existingProfileRows ?? [])
        .filter((p: { ecode?: string }) => p.ecode)
        .map((p: { ecode: string }) => p.ecode.toLowerCase().trim())
    );

    // ── Collect indices that still need processing ────────────────────────
    const toProcess = updated
      .map((_, i) => i)
      .filter(i => updated[i]._status !== "ok" && updated[i]._status !== "skipped");

    let totalRetries = 0;

    // ── Process in batches ────────────────────────────────────────────────
    for (let b = 0; b < toProcess.length; b += BATCH_SIZE) {
      const batch = toProcess.slice(b, b + BATCH_SIZE);

      for (const i of batch) {
        const row = updated[i];
        const cleanEmail = row.email?.toLowerCase().trim();
        const cleanEcode = row.ecode?.toLowerCase().trim();

        // ── Duplicate checks (email + ecode) ────────────────────────────
        if (emailToId.has(cleanEmail)) {
          updated[i] = { ...row, _status: "skipped", _error: "Email already exists — skipped" };
          setImportRows([...updated]);
          continue;
        }
        if (cleanEcode && existingEcodes.has(cleanEcode)) {
          updated[i] = { ...row, _status: "skipped", _error: `E-Code ${row.ecode} already exists — skipped` };
          setImportRows([...updated]);
          continue;
        }

        // ── signUp with exponential-backoff retries ──────────────────────
        let signUpData: Awaited<ReturnType<typeof tempClient.auth.signUp>>["data"] | null = null;
        let signUpErr: Awaited<ReturnType<typeof tempClient.auth.signUp>>["error"] | null = null;
        let attempt = 0;

        while (attempt <= MAX_RETRIES) {
          if (attempt > 0) {
            const waitMs = Math.pow(2, attempt) * 2000; // 4 s, 8 s, 16 s
            updated[i] = {
              ...row,
              _status: "retrying",
              _error: `Rate limited — retrying in ${waitMs / 1000}s (attempt ${attempt}/${MAX_RETRIES})`,
              _retries: attempt,
            };
            setImportRows([...updated]);
            totalRetries++;
            await sleep(waitMs);
          }

          const result = await tempClient.auth.signUp({
            email:    cleanEmail,
            password: row.password || "Miles@12345",
            options:  { data: { full_name: row.full_name, role: row.role } },
          });
          signUpData = result.data;
          signUpErr  = result.error;

          if (!signUpErr) break;
          if (!isRateLimit(signUpErr.message ?? "") || attempt >= MAX_RETRIES) break;
          attempt++;
        }

        if (signUpErr) {
          updated[i] = { ...row, _status: "error", _error: signUpErr.message, _retries: attempt };
          setImportRows([...updated]);
          await sleep(DELAY_BETWEEN_USERS_MS);
          continue;
        }

        // Supabase silently treats duplicate emails as success but returns empty identities
        if (signUpData?.user && (signUpData.user.identities ?? []).length === 0) {
          updated[i] = {
            ...row, _status: "error",
            _error: `${cleanEmail} is already in Auth but has no profile. Delete it from Supabase → Auth → Users and re-import.`,
          };
          setImportRows([...updated]);
          await sleep(DELAY_BETWEEN_USERS_MS);
          continue;
        }

        const userId = signUpData?.user?.id ?? null;
        if (!userId) {
          updated[i] = { ...row, _status: "error", _error: "Could not obtain user ID after signup" };
          setImportRows([...updated]);
          await sleep(DELAY_BETWEEN_USERS_MS);
          continue;
        }

        // ── Upsert profile ────────────────────────────────────────────────
        const { error: profileErr } = await supabase
          .from("profiles")
          .upsert(
            {
              id:                userId,
              email:             cleanEmail,
              full_name:         row.full_name,
              role:              row.role || "end_user",
              ecode:             row.ecode             || "",
              department:        row.department        || "",
              location:          row.location          || "",
              reporting_manager: row.reporting_manager || "",
              status:            "active",
            },
            { onConflict: "id" },
          );

        if (profileErr) {
          updated[i] = { ...row, _status: "error", _error: `Profile error: ${profileErr.message}` };
        } else {
          updated[i] = { ...row, _status: "ok", _retries: attempt > 0 ? attempt : undefined };
          emailToId.set(cleanEmail, userId);
          if (cleanEcode) existingEcodes.add(cleanEcode);
        }
        setImportRows([...updated]);
        await sleep(DELAY_BETWEEN_USERS_MS);
      }

      // Pause between batches (skip after the last one)
      if (b + BATCH_SIZE < toProcess.length) {
        await sleep(DELAY_BETWEEN_BATCHES_MS);
      }
    }

    // ── Final summary ─────────────────────────────────────────────────────
    const finalRows = updated;
    setImportSummary({
      total:    finalRows.length,
      imported: finalRows.filter(r => r._status === "ok").length,
      skipped:  finalRows.filter(r => r._status === "skipped").length,
      failed:   finalRows.filter(r => r._status === "error").length,
      retries:  totalRetries,
    });

    setImportLoading(false);
    await refresh();
  };

  // ── Forms ──────────────────────────────────────────────────────────────────
  const addForm = useForm<AddFormValues>({
    resolver: zodResolver(addSchema),
    defaultValues: { full_name: "", email: "", role: "end_user", ecode: "", department: "", location: "", reporting_manager: "", password: "" },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { full_name: "", role: "end_user", ecode: "", department: "", location: "", reporting_manager: "", status: "active" },
  });

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q) || (u.ecode ?? "").toLowerCase().includes(q);
    const matchRole   = roleFilter   === "all" || u.role   === roleFilter;
    const matchStatus = statusFilter === "all" || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const selectableIds  = filtered.filter(u => u.id !== currentUser?.userId).map(u => u.id);
  const allSelected    = selectableIds.length > 0 && selectableIds.every(id => selectedUserIds.has(id));
  const someSelected   = selectableIds.some(id => selectedUserIds.has(id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const roleCounts = {
    superAdmins: users.filter(u => u.role === "super_admin").length,
    itAdmins:    users.filter(u => u.role === "it_admin").length,
    itAgents:    users.filter(u => u.role === "it_agent").length,
    endUsers:    users.filter(u => u.role === "end_user").length,
    active:      users.filter(u => u.status === "active").length,
    inactive:    users.filter(u => u.status === "inactive").length,
  };

  // ── Add user ───────────────────────────────────────────────────────────────
  const openAdd = () => {
    addForm.reset({ full_name: "", email: "", role: "end_user", ecode: "", department: "", location: "", reporting_manager: "", password: "" });
    setShowPw(false);
    setAddOpen(true);
  };

  const onAddSubmit = async (values: AddFormValues) => {
    setAddSaving(true);
    const result = await adminUsersApi.createUser({
      ...values,
      ecode:             values.ecode             ?? "",
      reporting_manager: values.reporting_manager ?? "",
    });
    setAddSaving(false);

    if (!result.success) {
      toast({ title: "Failed to create user", description: result.error ?? "Unknown error", variant: "destructive" });
      return;
    }

    toast({ title: "User created", description: `${values.email} has been added and can log in immediately.` });
    setAddOpen(false);
    await refresh();
  };

  // ── View user ──────────────────────────────────────────────────────────────
  const openView = (user: Profile) => setViewingUser(user);

  // ── Edit user ──────────────────────────────────────────────────────────────
  const openEdit = (user: Profile) => {
    setEditingUser(user);
    editForm.reset({
      full_name:         user.full_name,
      role:              user.role,
      ecode:             user.ecode             ?? "",
      department:        user.department,
      location:          user.location,
      reporting_manager: user.reporting_manager ?? "",
      status:            user.status,
    });
    setEditOpen(true);
  };

  const onEditSubmit = async (values: EditFormValues) => {
    if (!editingUser) return;
    const removingOwnAdmin =
      editingUser.id === currentUser?.userId &&
      editingUser.role === "super_admin" &&
      values.role !== "super_admin";
    if (removingOwnAdmin) {
      const ok = window.confirm("Warning: You are about to remove your own Super Admin access. Continue?");
      if (!ok) return;
    }
    setEditSaving(true);
    try {
      await updateUser(editingUser.id, {
        ...values,
        ecode:             values.ecode             ?? "",
        reporting_manager: values.reporting_manager ?? "",
      });
      toast({ title: "User updated successfully" });
      setEditOpen(false);
    } catch (err) {
      toast({ title: "Failed to update user", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setEditSaving(false);
    }
  };

  // ── Deactivate ─────────────────────────────────────────────────────────────
  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setActionSaving(deactivateTarget.id);
    try {
      await updateUser(deactivateTarget.id, { ...deactivateTarget, status: "inactive" });
      toast({ title: "User deactivated", description: `${deactivateTarget.full_name} can no longer log in.` });
    } catch (err) {
      toast({ title: "Failed to deactivate", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setActionSaving(null);
      setDeactivateTarget(null);
    }
  };

  // ── Reactivate ─────────────────────────────────────────────────────────────
  const handleReactivate = async (user: Profile) => {
    setActionSaving(user.id);
    try {
      await updateUser(user.id, { ...user, status: "active" });
      toast({ title: "User reactivated", description: `${user.full_name} can now log in.` });
    } catch (err) {
      toast({ title: "Failed to reactivate", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setActionSaving(null);
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setActionSaving(deleteTarget.id);
    const result = await adminUsersApi.deleteUser(deleteTarget.id);
    setActionSaving(null);
    setDeleteTarget(null);

    if (!result.success) {
      // Fallback: delete profile only if Edge Function unavailable
      try {
        await deleteUser(deleteTarget.id);
        toast({ title: "User removed from app", description: "Their Supabase Auth account may still exist — remove it from the Supabase Dashboard if needed." });
      } catch {
        toast({ title: "Failed to delete user", description: result.error ?? "Unknown error", variant: "destructive" });
      }
      return;
    }
    await deleteUser(deleteTarget.id);
    toast({ title: "User deleted", description: `${deleteTarget.full_name} has been permanently removed.` });
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground">User Management</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Loading…" : `${users.length} user${users.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-2" onClick={() => refresh()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => exportUsers(filtered)} data-testid="button-export-users">
            <Download className="h-4 w-4" /> Export
          </Button>
          {isSuperAdmin && (
            <>
              <Button
                variant="outline" size="sm" className="gap-2"
                onClick={() => { setImportRows([]); setImportOpen(true); }}
                data-testid="button-import-users"
              >
                <Upload className="h-4 w-4" /> Import Users
              </Button>
              <Button size="sm" className="gap-2" onClick={openAdd} data-testid="button-add-user">
                <Plus className="h-4 w-4" /> Add User
              </Button>
            </>
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
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selectedUserIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg text-sm">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="font-medium text-primary">{selectedUserIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
            {isSuperAdmin && (
              <Button size="sm" variant="destructive" className="gap-1.5 h-7 text-xs" onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete Selected
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Users Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 w-10">
                    {isSuperAdmin && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border cursor-pointer accent-primary"
                        checked={allSelected}
                        ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    )}
                  </th>
                  {["E-Code", "Employee", "Role", "Department", "Location", "Status", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">Loading users…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      {users.length === 0 ? "No users found. Add your first user above." : "No users match the current filters."}
                    </td>
                  </tr>
                ) : filtered.map(user => {
                  const initials = user.full_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
                  const isSelf   = user.id === currentUser?.userId;
                  const busy     = actionSaving === user.id;
                  const isChecked = selectedUserIds.has(user.id);

                  return (
                    <tr
                      key={user.id}
                      onClick={() => openView(user)}
                      className={cn(
                        "border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer",
                        user.status === "inactive" && "opacity-60",
                        isChecked && "bg-primary/5"
                      )}
                      data-testid={`row-user-${user.id}`}
                    >
                      <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                        {isSuperAdmin && !isSelf && (
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border cursor-pointer accent-primary"
                            checked={isChecked}
                            onChange={() => toggleSelect(user.id)}
                            aria-label={`Select ${user.full_name}`}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {user.ecode ? (
                          <span className="font-mono text-xs font-semibold text-foreground bg-muted px-2 py-1 rounded">{user.ecode}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
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
                          {statusLabel[user.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {isAdmin ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={busy} data-testid={`btn-actions-${user.id}`}>
                                {busy
                                  ? <span className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
                                  : <MoreHorizontal className="h-4 w-4" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openView(user)} className="gap-2 cursor-pointer">
                                <User className="h-3.5 w-3.5" /> View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openEdit(user)} className="gap-2 cursor-pointer">
                                <Edit className="h-3.5 w-3.5" /> Edit Profile
                              </DropdownMenuItem>
                              {!isSelf && user.status === "active" && (
                                <DropdownMenuItem onClick={() => setDeactivateTarget(user)} className="gap-2 cursor-pointer text-amber-600 focus:text-amber-600">
                                  <UserX className="h-3.5 w-3.5" /> Deactivate
                                </DropdownMenuItem>
                              )}
                              {!isSelf && user.status === "inactive" && (
                                <DropdownMenuItem onClick={() => handleReactivate(user)} className="gap-2 cursor-pointer text-emerald-600 focus:text-emerald-600">
                                  <RefreshCw className="h-3.5 w-3.5" /> Reactivate
                                </DropdownMenuItem>
                              )}
                              {/* IT Admin cannot delete Super Admin users */}
                              {!isSelf && isSuperAdmin && (
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

      {/* ── View User Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={!!viewingUser} onOpenChange={v => !v && setViewingUser(null)}>
        <DialogContent className="max-w-md">
          {viewingUser && (() => {
            const vu = viewingUser;
            const initials = vu.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
            const isSelf = vu.id === currentUser?.userId;
            return (
              <>
                <DialogHeader>
                  <div className="flex items-center gap-4">
                    <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-xl font-bold text-primary">{initials}</span>
                    </div>
                    <div className="min-w-0">
                      <DialogTitle className="flex items-center gap-2 flex-wrap">
                        {vu.full_name}
                        {isSelf && <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">You</span>}
                      </DialogTitle>
                      <p className="text-sm text-muted-foreground mt-0.5">{vu.email}</p>
                    </div>
                  </div>
                </DialogHeader>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    { label: "E-Code",            value: vu.ecode || "—" },
                    { label: "Role",              value: ROLE_LABELS[vu.role], badge: roleColors[vu.role] },
                    { label: "Department",        value: vu.department || "—" },
                    { label: "Location",          value: vu.location || "—" },
                    { label: "Reporting Manager", value: vu.reporting_manager || "—" },
                    { label: "Status",            value: statusLabel[vu.status], badge: statusColors[vu.status] },
                  ].map(({ label, value, badge }) => (
                    <div key={label} className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
                      {badge ? (
                        <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", badge)}>{value}</span>
                      ) : (
                        <p className="font-medium text-foreground">{value}</p>
                      )}
                    </div>
                  ))}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setViewingUser(null)}>Close</Button>
                  {isAdmin && (
                    <Button onClick={() => { setViewingUser(null); openEdit(vu); }} className="gap-2">
                      <Edit className="h-4 w-4" /> Edit Profile
                    </Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

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
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="full_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl><Input placeholder="Rahul Sharma" {...field} data-testid="input-add-fullname" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="ecode" render={({ field }) => (
                  <FormItem>
                    <FormLabel>E-Code</FormLabel>
                    <FormControl><Input placeholder="e.g. EMP-001" {...field} data-testid="input-add-ecode" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
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
              <div className="grid grid-cols-2 gap-3">
                <FormField control={addForm.control} name="location" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl><Input placeholder="Bangalore, Mumbai…" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="reporting_manager" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reporting Manager</FormLabel>
                    <FormControl><Input placeholder="Manager name" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <FormField control={addForm.control} name="password" render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Temporary Password</FormLabel>
                    <button
                      type="button"
                      className="text-xs text-blue-600 hover:underline"
                      onClick={() => { addForm.setValue("password", generatePassword(), { shouldValidate: true }); setShowPw(true); }}
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
            {editingUser && <DialogDescription>{editingUser.email}</DialogDescription>}
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="full_name" render={({ field }) => (
                  <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="ecode" render={({ field }) => (
                  <FormItem><FormLabel>E-Code</FormLabel><FormControl><Input placeholder="e.g. EMP-001" {...field} data-testid="input-user-ecode" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
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
                    <Select value={field.value} onValueChange={field.onChange} disabled={editingUser?.id === currentUser?.userId}>
                      <FormControl><SelectTrigger data-testid="select-user-status"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={editForm.control} name="department" render={({ field }) => (
                  <FormItem><FormLabel>Department</FormLabel><FormControl><Input placeholder="Engineering, HR…" {...field} data-testid="input-user-department" /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={editForm.control} name="location" render={({ field }) => (
                  <FormItem><FormLabel>Location</FormLabel><FormControl><Input placeholder="Bangalore, Mumbai…" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={editForm.control} name="reporting_manager" render={({ field }) => (
                <FormItem><FormLabel>Reporting Manager</FormLabel><FormControl><Input placeholder="Manager name" {...field} /></FormControl><FormMessage /></FormItem>
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

      {/* ── Deactivate Confirm ─────────────────────────────────────────────────── */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={v => !v && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.full_name}</strong> will be set to Inactive and will no longer be able to log in.
              You can reactivate them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-amber-600 hover:bg-amber-700 text-white" onClick={handleDeactivate}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bulk Delete Confirm ───────────────────────────────────────────────── */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={v => !v && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete {selectedUserIds.size} User{selectedUserIds.size !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the selected {selectedUserIds.size} user{selectedUserIds.size !== 1 ? "s" : ""} from Supabase Auth and their profiles.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              Delete {selectedUserIds.size} User{selectedUserIds.size !== 1 ? "s" : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Import Users Dialog ───────────────────────────────────────────────── */}
      <Dialog open={importOpen} onOpenChange={v => !importLoading && setImportOpen(v)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Import Users from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file with columns: <code className="text-xs bg-muted px-1 py-0.5 rounded">full_name, email, role, ecode, department, location, reporting_manager, password</code>.
              If password is blank, default <code className="text-xs bg-muted px-1 py-0.5 rounded">Miles@12345</code> is used.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-auto space-y-4">
            {/* File picker */}
            <div className="flex items-center gap-3">
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleImportFile}
              />
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => importFileRef.current?.click()}
                disabled={importLoading}
              >
                <Upload className="h-4 w-4" /> Choose CSV File
              </Button>
              {importRows.length > 0 && (
                <span className="text-sm text-muted-foreground">
                  {importRows.length} row{importRows.length !== 1 ? "s" : ""} detected
                </span>
              )}
            </div>

            {/* Column mapping summary — shown after a file is loaded */}
            {Object.keys(importColMap).length > 0 && importRows.length > 0 && (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                <p className="font-semibold text-muted-foreground mb-1.5">Detected CSV columns</p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { key: "full_name",         label: "Name" },
                    { key: "email",             label: "Email" },
                    { key: "ecode",             label: "E-Code" },
                    { key: "department",        label: "Dept" },
                    { key: "location",          label: "Location" },
                    { key: "reporting_manager", label: "Manager" },
                    { key: "role",              label: "Role" },
                    { key: "password",          label: "Password" },
                  ].map(({ key, label }) => {
                    const matched = importColMap[key];
                    return (
                      <span
                        key={key}
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono ${
                          matched
                            ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                        }`}
                      >
                        {matched ? "✓" : "✗"} {label}
                        {matched ? <span className="opacity-60">← "{matched}"</span> : null}
                      </span>
                    );
                  })}
                </div>
                {!importColMap["ecode"] && (
                  <p className="mt-1.5 text-red-600 dark:text-red-400">
                    ⚠ E-Code column not found — rename your CSV column to one of: <code>E-Code, Emp Code, Employee Code, Emp ID, Code, MPE Code</code>
                  </p>
                )}
              </div>
            )}

            {/* Preview table */}
            {importRows.length > 0 && (
              <div className="border rounded-lg overflow-auto max-h-60">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      {["Status", "Name", "Email", "Role", "E-Code", "Dept", "Location"].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 min-w-[140px]">
                          {row._status === "ok"       && (
                            <span className="text-emerald-600 font-medium">
                              ✓ Done{row._retries ? <span className="text-[10px] text-emerald-500 ml-1">({row._retries} retr{row._retries === 1 ? "y" : "ies"})</span> : null}
                            </span>
                          )}
                          {row._status === "skipped"  && <span className="text-amber-500 font-medium">⟳ Skipped</span>}
                          {row._status === "retrying" && (
                            <div>
                              <span className="text-blue-500 font-medium animate-pulse">↻ Retrying…</span>
                              {row._error && <p className="text-[10px] text-blue-400 leading-tight mt-0.5 max-w-[200px] break-words">{row._error}</p>}
                            </div>
                          )}
                          {row._status === "error"    && (
                            <div>
                              <span className="text-destructive font-medium">✗ Error</span>
                              {row._error && <p className="text-[10px] text-destructive/80 leading-tight mt-0.5 max-w-[200px] break-words">{row._error}</p>}
                            </div>
                          )}
                          {row._status === "pending"  && <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 font-medium">{row.full_name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.email}</td>
                        <td className="px-3 py-2">{row.role}</td>
                        <td className="px-3 py-2 font-mono">{row.ecode || "—"}</td>
                        <td className="px-3 py-2">{row.department || "—"}</td>
                        <td className="px-3 py-2">{row.location || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {importRows.length === 0 && (
              <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Choose a CSV file to preview users before importing</p>
              </div>
            )}
          </div>

          {/* Final summary — shown after import completes */}
          {importSummary && (
            <div className="mx-6 mb-2 rounded-lg border bg-muted/40 px-4 py-3 text-xs grid grid-cols-5 gap-2 text-center">
              <div>
                <p className="text-muted-foreground font-medium">Total</p>
                <p className="text-base font-bold">{importSummary.total}</p>
              </div>
              <div>
                <p className="text-emerald-600 font-medium">Imported</p>
                <p className="text-base font-bold text-emerald-600">{importSummary.imported}</p>
              </div>
              <div>
                <p className="text-amber-500 font-medium">Skipped</p>
                <p className="text-base font-bold text-amber-500">{importSummary.skipped}</p>
              </div>
              <div>
                <p className="text-destructive font-medium">Failed</p>
                <p className="text-base font-bold text-destructive">{importSummary.failed}</p>
              </div>
              <div>
                <p className="text-blue-500 font-medium">Retries</p>
                <p className="text-base font-bold text-blue-500">{importSummary.retries}</p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setImportOpen(false); setImportSummary(null); }}
              disabled={importLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleImportSubmit}
              disabled={
                importRows.length === 0 ||
                importLoading ||
                importRows.every(r => r._status === "ok" || r._status === "skipped")
              }
            >
              {importLoading
                ? `Importing… ${importRows.filter(r => r._status === "ok").length} / ${importRows.filter(r => r._status !== "skipped").length}`
                : importSummary
                  ? `Done — ${importSummary.imported} imported, ${importSummary.skipped} skipped, ${importSummary.failed} failed`
                  : importRows.every(r => r._status === "ok" || r._status === "skipped")
                    ? `Done — ${importRows.filter(r => r._status === "ok").length} imported`
                    : `Import ${importRows.filter(r => r._status !== "ok" && r._status !== "skipped").length} New Users`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
