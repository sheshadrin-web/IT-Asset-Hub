import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import {
  Plus, Search, MoreHorizontal, Edit, Trash2, Download,
  X, UserX, RefreshCw, AlertTriangle, Eye, EyeOff,
  Upload, CheckSquare, User, KeyRound,
  ChevronUp, ChevronDown, ChevronsUpDown,
  Mail, Building2, MapPin, Hash, Briefcase, UserCircle, Monitor, CalendarDays, Ticket as TicketIcon,
  Users as UsersIcon, ArrowRightLeft, History, ArrowRight, UserCheck, Shield,
} from "lucide-react";
import ColumnFilterDropdown from "@/components/ColumnFilterDropdown";
import TablePagination from "@/components/TablePagination";
import ManagerSearchField from "@/components/ManagerSearchField";
import TransferReporteesModal from "@/components/TransferReporteesModal";
import { LoadErrorBanner } from "@/components/LoadErrorBanner";
import LocationSelect from "@/components/LocationSelect";
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
import { Link } from "wouter";
import { useUsers, ManagerHistoryEntry } from "@/context/UsersContext";
import { getDirectReports } from "@/lib/reportingManager";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { useAuth } from "@/context/AuthContext";
import { Profile, UserRole, UserStatus, ROLE_LABELS, Ticket } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { adminUsersApi } from "@/lib/adminUsersApi";
import { cn } from "@/lib/utils";

// ─── Colours ──────────────────────────────────────────────────────────────────
const roleColors: Record<UserRole, string> = {
  super_admin: "bg-purple-500/15 text-purple-600 border-purple-500/20",
  it_admin:    "bg-blue-500/15 text-blue-600 border-blue-500/20",
  hr_admin:    "bg-pink-500/15 text-pink-600 border-pink-500/20",
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

// ─── Column filter helpers ─────────────────────────────────────────────────────
type UserColKey = "ecode" | "name" | "role" | "department" | "location" | "status";

const USER_COL_DEFS: { label: string; key: UserColKey }[] = [
  { label: "E-Code",     key: "ecode"      },
  { label: "Employee",   key: "name"       },
  { label: "Role",       key: "role"       },
  { label: "Department", key: "department" },
  { label: "Location",   key: "location"   },
  { label: "Status",     key: "status"     },
];

function getUserColValue(u: import("@/data/mockData").Profile, col: UserColKey): string {
  switch (col) {
    case "ecode":      return u.ecode ?? "";
    case "name":       return u.full_name;
    case "role":       return ROLE_LABELS[u.role] ?? u.role;
    case "department": return u.department;
    case "location":   return u.location;
    case "status":     return statusLabel[u.status] ?? u.status;
  }
}

function makeEmptyUserColFilters(): Record<UserColKey, Set<string>> {
  const o = {} as Record<UserColKey, Set<string>>;
  USER_COL_DEFS.forEach(c => { o[c.key] = new Set(); });
  return o;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const addSchema = z.object({
  full_name:         z.string().min(2, "Full name is required"),
  email:             z.string().email("Invalid email address"),
  role:              z.enum(["super_admin", "it_admin", "hr_admin", "it_agent", "end_user"]),
  ecode:             z.string().optional(),
  department:        z.string().min(1, "Department is required"),
  location:          z.string().min(1, "Location is required"),
  reporting_manager: z.string().optional(),
  password:          z.string().min(8, "Password must be at least 8 characters"),
});
type AddFormValues = z.infer<typeof addSchema>;

const editSchema = z.object({
  full_name:         z.string().min(2, "Required"),
  role:              z.enum(["super_admin", "it_admin", "hr_admin", "it_agent", "end_user"]),
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
  const { users, loading, error, refresh, updateUser, deleteUser, changeReportingManager, fetchManagerHistory } = useUsers();
  const { assets, refresh: refreshAssets } = useAssets();
  const { tickets } = useTickets();
  const { currentUser } = useAuth();
  const { toast } = useToast();

  const [search,       setSearch]       = useState("");
  const [roleFilter,   setRoleFilter]   = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [colFilters,   setColFilters]   = useState<Record<UserColKey, Set<string>>>(makeEmptyUserColFilters);
  const [sortCol,      setSortCol]      = useState<UserColKey>("ecode");
  const [sortDir,      setSortDir]      = useState<"asc" | "desc">("asc");
  const [page, setPage]                 = useState(1);
  const [rowsPerPage, setRowsPerPage]   = useState(50);

  const setColFilter = (col: UserColKey, vals: Set<string>) =>
    setColFilters(prev => ({ ...prev, [col]: vals }));

  const anyColFilter = Object.values(colFilters).some(s => s.size > 0);

  const clearAllColFilters = () => setColFilters(makeEmptyUserColFilters());

  const handleSort = (col: UserColKey) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  // Dialogs
  const [addOpen,          setAddOpen]          = useState(false);
  const [editingUser,      setEditingUser]       = useState<Profile | null>(null);
  const [editOpen,         setEditOpen]          = useState(false);
  const [viewingUser,      setViewingUser]       = useState<Profile | null>(null);
  const [viewUserTab,      setViewUserTab]       = useState<"hardware" | "tickets" | "team">("hardware");
  const [deactivateTarget, setDeactivateTarget] = useState<Profile | null>(null);
  const [deleteTarget,     setDeleteTarget]     = useState<Profile | null>(null);

  // Loading states
  const [addSaving,      setAddSaving]      = useState(false);
  const [editSaving,     setEditSaving]     = useState(false);
  const [actionSaving,   setActionSaving]   = useState<string | null>(null);
  const [resetSending,   setResetSending]   = useState(false);

  // Password visibility
  const [showPw, setShowPw] = useState(false);

  // Reset Password dialog
  const [resetPassOpen,   setResetPassOpen]   = useState(false);
  const [resetPassTarget, setResetPassTarget] = useState<Profile | null>(null);
  const [newPassword,     setNewPassword]     = useState("");
  const [resetPassSaving, setResetPassSaving] = useState(false);
  const [showNewPw,       setShowNewPw]       = useState(false);

  // Bulk select
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen]   = useState(false);

  // Reporting manager transfer
  const [transferOpen,        setTransferOpen]        = useState(false);
  const [transferAffected,    setTransferAffected]    = useState<Profile[]>([]);
  const [transferFromManager, setTransferFromManager] = useState<Profile | null>(null);
  const [transferTitle,       setTransferTitle]       = useState<string | undefined>(undefined);

  // Manager-change history (loaded when the View dialog opens)
  const [managerHistory,     setManagerHistory]     = useState<ManagerHistoryEntry[]>([]);
  const [historyLoading,     setHistoryLoading]     = useState(false);
  // Guards against a stale history fetch overwriting a newer one when the user
  // quickly switches between profiles (e.g. clicking through direct reports).
  const historyReqRef = useRef(0);

  // Deactivate-with-reportees warning
  const [deactivateReports,  setDeactivateReports]  = useState<Profile[]>([]);

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
  const isAdmin      = isSuperAdmin || currentUser?.role === "it_admin" || currentUser?.role === "hr_admin";

  // ── Bulk select helpers (uses toggleSelect/toggleSelectAll defined after filtered) ──
  const toggleSelect = (id: string) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedUserIds(new Set());

  // ── Bulk status / role / export actions ──────────────────────────────────────
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeactivateOpen, setBulkDeactivateOpen] = useState(false);

  const bulkSetStatus = async (status: UserStatus) => {
    const targets = users.filter(u => selectedUserIds.has(u.id) && u.status !== status);
    if (targets.length === 0) {
      toast({ title: "Nothing to update", description: `All selected users are already ${status}.` });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const u of targets) {
      try { await updateUser(u.id, { ...u, status }); ok++; } catch { failed.push(u.full_name); }
    }
    setBulkBusy(false);
    const verb = status === "active" ? "activated" : "deactivated";
    if (failed.length === 0) {
      clearSelection();
      toast({ title: status === "active" ? "Users activated" : "Users deactivated", description: `${ok} user${ok !== 1 ? "s" : ""} ${verb}.` });
    } else {
      toast({
        title: "Partial update",
        description: `${ok} ${verb}, ${failed.length} failed${failed.length <= 3 ? ` (${failed.join(", ")})` : ""}. Selection kept so you can retry.`,
        variant: "destructive",
      });
    }
  };

  const bulkAssignRole = async (role: UserRole) => {
    const targets = users.filter(u => selectedUserIds.has(u.id) && u.role !== role);
    if (targets.length === 0) {
      toast({ title: "Nothing to update", description: `All selected users already have the ${ROLE_LABELS[role]} role.` });
      return;
    }
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const u of targets) {
      try { await updateUser(u.id, { ...u, role }); ok++; } catch { failed.push(u.full_name); }
    }
    setBulkBusy(false);
    if (failed.length === 0) {
      clearSelection();
      toast({ title: "Role assigned", description: `${ok} user${ok !== 1 ? "s" : ""} set to ${ROLE_LABELS[role]}.` });
    } else {
      toast({
        title: "Partial update",
        description: `${ok} set to ${ROLE_LABELS[role]}, ${failed.length} failed${failed.length <= 3 ? ` (${failed.join(", ")})` : ""}. Selection kept so you can retry.`,
        variant: "destructive",
      });
    }
  };

  const exportSelected = () => {
    exportUsers(users.filter(u => selectedUserIds.has(u.id)));
  };

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
            password: row.password || "Miles@123",
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
  const baseFiltered = users.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || u.full_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q) || (u.ecode ?? "").toLowerCase().includes(q);
    const matchRole   = roleFilter   === "all" || u.role   === roleFilter;
    const matchStatus = statusFilter === "all" || u.status === statusFilter;
    return matchSearch && matchRole && matchStatus;
  });

  const filtered = baseFiltered.filter(u =>
    USER_COL_DEFS.every(({ key }) => {
      const vals = colFilters[key];
      return vals.size === 0 || vals.has(getUserColValue(u, key));
    })
  );

  const getColAllValues = (col: UserColKey) =>
    [...new Set(baseFiltered.map(u => getUserColValue(u, col)))]
      .filter(v => v !== "")
      .sort((a, b) => a.localeCompare(b));

  const sorted = [...filtered].sort((a, b) => {
    const av = getUserColValue(a, sortCol);
    const bv = getUserColValue(b, sortCol);
    const cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    return sortDir === "asc" ? cmp : -cmp;
  });

  useEffect(() => { setPage(1); }, [search, roleFilter, statusFilter, colFilters]);

  const paged         = sorted.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const pagedIds      = paged.filter(u => u.id !== currentUser?.userId).map(u => u.id);
  const selectableIds = filtered.filter(u => u.id !== currentUser?.userId).map(u => u.id);
  const allSelected   = pagedIds.length > 0 && pagedIds.every(id => selectedUserIds.has(id));
  const someSelected  = pagedIds.some(id => selectedUserIds.has(id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedUserIds(prev => {
        const next = new Set(prev);
        pagedIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const roleCounts = {
    superAdmins: filtered.filter(u => u.role === "super_admin").length,
    itAdmins:    filtered.filter(u => u.role === "it_admin").length,
    hrAdmins:    filtered.filter(u => u.role === "hr_admin").length,
    itAgents:    filtered.filter(u => u.role === "it_agent").length,
    endUsers:    filtered.filter(u => u.role === "end_user").length,
    active:      filtered.filter(u => u.status === "active").length,
    inactive:    filtered.filter(u => u.status === "inactive").length,
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
  const openView = (user: Profile) => {
    setViewUserTab("hardware");
    setViewingUser(user);
    setManagerHistory([]);
    setHistoryLoading(true);
    const reqId = ++historyReqRef.current;
    fetchManagerHistory(user.id)
      .then(h => { if (reqId === historyReqRef.current) setManagerHistory(h); })
      .catch(() => { if (reqId === historyReqRef.current) setManagerHistory([]); })
      .finally(() => { if (reqId === historyReqRef.current) setHistoryLoading(false); });
  };

  // ── Reporting manager transfer ───────────────────────────────────────────────
  // Open the transfer modal for a manager's direct reports.
  const openTransferForManager = (manager: Profile) => {
    const reports = getDirectReports(manager, users);
    setTransferFromManager(manager);
    setTransferAffected(reports);
    setTransferTitle(`Transfer ${manager.full_name}'s Reportees`);
    setTransferOpen(true);
  };

  // Open the transfer modal for an explicit set of selected employees.
  const openTransferForSelection = () => {
    const affected = users.filter(u => selectedUserIds.has(u.id));
    setTransferFromManager(null);
    setTransferAffected(affected);
    setTransferTitle("Change Reporting Manager");
    setTransferOpen(true);
  };

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

  // ── Reset password (super_admin only) ──────────────────────────────────────
  const handleResetPassword = async () => {
    if (!editingUser) return;
    setResetSending(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(editingUser.email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      toast({ title: "Reset link sent", description: `A password reset email has been sent to ${editingUser.email}.` });
    } catch (err) {
      toast({ title: "Failed to send reset email", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setResetSending(false);
    }
  };

  // ── Set new password directly (admin, uses Edge Function) ──────────────────
  const handleSetPassword = async () => {
    if (!resetPassTarget || newPassword.length < 8) return;
    setResetPassSaving(true);
    try {
      const result = await adminUsersApi.resetPassword(resetPassTarget.id, newPassword);
      if (!result.success) throw new Error(result.error ?? "Failed to reset password");
      toast({ title: "Password updated", description: `Password for ${resetPassTarget.full_name} has been updated successfully.` });
      setResetPassOpen(false);
      setNewPassword("");
    } catch (err) {
      toast({
        title: "Failed to set password",
        description: err instanceof Error ? err.message : "Try using the reset link option instead.",
        variant: "destructive",
      });
    } finally {
      setResetPassSaving(false);
    }
  };

  // ── Send reset link (from view dialog) ────────────────────────────────────
  const handleSendResetLink = async () => {
    if (!resetPassTarget) return;
    setResetPassSaving(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetPassTarget.email, {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      toast({ title: "Reset link sent", description: `A password reset email has been sent to ${resetPassTarget.email}.` });
      setResetPassOpen(false);
      setNewPassword("");
    } catch (err) {
      toast({ title: "Failed to send reset email", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setResetPassSaving(false);
    }
  };

  // ── Deactivate ─────────────────────────────────────────────────────────────
  // Core offboarding routine shared by the single- and bulk-deactivate paths so
  // both enforce the identical manager-exit rules. Unassigns the user's direct
  // reports (audit/history written atomically by the RPC), marks the user
  // inactive, flags their assigned assets for Recovery Stage, and locks any
  // managed laptops. Throws if unassigning reportees or the status update fails,
  // so a manager is never left active-looking with reportees half-detached.
  const runDeactivation = async (
    target: Profile,
    roster: Profile[] = users,
  ): Promise<{ recoveryCount: number; lockedCount: number; unassignedIds: string[] }> => {
    // 0. Unassign direct reports so they are not left pointing at an inactive
    //    manager. "Transfer Now" reassigns them first; "Continue Anyway" lands
    //    here and detaches them. Reportee discovery uses the caller-supplied
    //    roster so a sequential bulk loop sees prior iterations' unassignments
    //    rather than a stale render-time snapshot.
    const reports = getDirectReports(target, roster);
    if (reports.length > 0) {
      await changeReportingManager(
        reports.map(r => r.id),
        null,
        `Auto-unassigned: manager ${target.full_name} deactivated`,
      );
    }

    // 1. Mark user inactive (blocks login).
    await updateUser(target.id, { ...target, status: "inactive" });

    // 2. Move currently-Assigned assets to "Recovery Stage" so IT can chase the
    //    recovery without losing assignment history (non-fatal).
    let recoveryCount = 0;
    try {
      const { data: updatedRows, error: recErr } = await supabase
        .from("assets")
        .update({ status: "Recovery Stage" })
        .eq("assigned_to", target.id)
        .eq("status", "Assigned")
        .select("asset_id");
      if (recErr) throw recErr;
      recoveryCount = updatedRows?.length ?? 0;
      if (recoveryCount > 0) await refreshAssets();
    } catch {
      /* non-fatal: user is already inactive */
    }

    // 3. Auto-lock any managed laptop(s) assigned to this user (best-effort).
    let lockedCount = 0;
    try {
      const { data: userAssets } = await supabase
        .from("assets")
        .select("id")
        .eq("assigned_to", target.id);
      for (const a of (userAssets ?? []) as { id: string }[]) {
        const { data: lr } = await supabase.rpc("lock_device", {
          p_asset_id: a.id,
          p_reason: "Employee offboarded",
        });
        if (lr?.success) lockedCount++;
      }
    } catch {
      /* swallow — locking is best-effort and must not block deactivation */
    }

    return { recoveryCount, lockedCount, unassignedIds: reports.map(r => r.id) };
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    const target = deactivateTarget;
    setActionSaving(target.id);
    try {
      const { recoveryCount, lockedCount } = await runDeactivation(target);
      const lockNote = lockedCount > 0
        ? ` ${lockedCount} managed laptop${lockedCount === 1 ? "" : "s"} locked.`
        : "";
      toast({
        title: "User deactivated",
        description: (recoveryCount > 0
          ? `${target.full_name} can no longer log in. ${recoveryCount} asset${recoveryCount === 1 ? "" : "s"} flagged as Recovery Stage.`
          : `${target.full_name} can no longer log in.`) + lockNote,
      });
    } catch (err) {
      toast({ title: "Failed to deactivate", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
    } finally {
      setActionSaving(null);
      setDeactivateTarget(null);
    }
  };

  // Bulk deactivate routes through the same exit workflow: it opens a warning
  // dialog when any selected user manages reportees, then runs runDeactivation
  // per user (which unassigns reportees with history logging).
  const openBulkDeactivate = () => {
    const targets = users.filter(u => selectedUserIds.has(u.id) && u.status !== "inactive");
    if (targets.length === 0) {
      toast({ title: "Nothing to update", description: "All selected users are already inactive." });
      return;
    }
    setBulkDeactivateOpen(true);
  };

  const performBulkDeactivate = async () => {
    const targets = users.filter(u => selectedUserIds.has(u.id) && u.status !== "inactive");
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    // Live working snapshot: each iteration's unassignments are reflected here so
    // subsequent iterations discover reportees against up-to-date relationships
    // instead of the stale render-time `users` array.
    let roster: Profile[] = users.map(u => ({ ...u }));
    for (const u of targets) {
      try {
        const { unassignedIds } = await runDeactivation(u, roster);
        const unassigned = new Set(unassignedIds);
        roster = roster.map(r =>
          r.id === u.id
            ? { ...r, status: "inactive" as UserStatus }
            : unassigned.has(r.id)
              ? { ...r, reporting_manager: "" }
              : r,
        );
        ok++;
      } catch { failed.push(u.full_name); }
    }
    setBulkBusy(false);
    setBulkDeactivateOpen(false);
    if (failed.length === 0) {
      clearSelection();
      toast({ title: "Users deactivated", description: `${ok} user${ok !== 1 ? "s" : ""} deactivated; any reportees were unassigned.` });
    } else {
      toast({
        title: "Partial update",
        description: `${ok} deactivated, ${failed.length} failed${failed.length <= 3 ? ` (${failed.join(", ")})` : ""}. Selection kept so you can retry.`,
        variant: "destructive",
      });
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
      {error && !loading && <LoadErrorBanner message={error} onRetry={refresh} busy={loading} />}

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
            <Button
              variant="outline" size="sm" className="gap-2"
              onClick={() => { setImportRows([]); setImportOpen(true); }}
              data-testid="button-import-users"
            >
              <Upload className="h-4 w-4" /> Import Users
            </Button>
          )}
          {isAdmin && (
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
          { label: "HR Admin",    val: roleCounts.hrAdmins,    color: "bg-pink-50 text-pink-700 border-pink-200" },
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
                <SelectItem value="hr_admin">HR Admin</SelectItem>
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
            {anyColFilter && (
              <Button
                variant="outline" size="sm"
                className="gap-1.5 border-primary/40 text-primary hover:bg-primary/5 whitespace-nowrap"
                onClick={clearAllColFilters}
              >
                <X className="h-3.5 w-3.5" /> Clear Column Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selectedUserIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/20 rounded-lg text-sm">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="font-medium text-primary">{selectedUserIds.size} selected</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={clearSelection} disabled={bulkBusy}>
              <X className="h-3.5 w-3.5" /> Clear
            </Button>
            {isAdmin && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={() => bulkSetStatus("active")} disabled={bulkBusy}>
                  <UserCheck className="h-3.5 w-3.5" /> Activate
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={openBulkDeactivate} disabled={bulkBusy}>
                  <UserX className="h-3.5 w-3.5" /> Deactivate
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={exportSelected} disabled={bulkBusy}>
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" disabled={bulkBusy}>
                      <Shield className="h-3.5 w-3.5" /> Assign Role
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(Object.keys(ROLE_LABELS) as UserRole[]).map(r => (
                      <DropdownMenuItem key={r} onClick={() => bulkAssignRole(r)} className="cursor-pointer">
                        {ROLE_LABELS[r]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs" onClick={openTransferForSelection} disabled={bulkBusy}>
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Change Reporting Manager
                </Button>
              </>
            )}
            {isSuperAdmin && (
              <Button size="sm" variant="destructive" className="gap-1.5 h-7 text-xs" onClick={() => setBulkDeleteOpen(true)} disabled={bulkBusy}>
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
                    {isAdmin && (
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
                  {USER_COL_DEFS.map(col => (
                    <th key={col.key} className="px-4 py-3 text-left whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        <ColumnFilterDropdown
                          label={col.label}
                          allValues={getColAllValues(col.key)}
                          selected={colFilters[col.key]}
                          onApply={vals => setColFilter(col.key, vals)}
                        />
                        <button
                          type="button"
                          onClick={() => handleSort(col.key)}
                          className={cn(
                            "ml-0.5 rounded p-0.5 transition-colors",
                            sortCol === col.key
                              ? "text-primary"
                              : "text-muted-foreground/30 hover:text-muted-foreground"
                          )}
                          title={`Sort by ${col.label}`}
                        >
                          {sortCol === col.key
                            ? (sortDir === "asc"
                                ? <ChevronUp   className="h-3 w-3" />
                                : <ChevronDown className="h-3 w-3" />)
                            : <ChevronsUpDown className="h-3 w-3" />}
                        </button>
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide w-10" />
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
                ) : paged.map(user => {
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
                        {isAdmin && !isSelf && (
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
          {!loading && (
            <TablePagination
              total={filtered.length}
              page={page}
              rowsPerPage={rowsPerPage}
              onPageChange={setPage}
              onRowsPerPageChange={rpp => { setRowsPerPage(rpp); setPage(1); }}
              noun="users"
            />
          )}
        </CardContent>
      </Card>

      {/* ── View User Dialog (TechOps-style two-column profile page) ────────── */}
      <Dialog open={!!viewingUser} onOpenChange={v => !v && setViewingUser(null)}>
        <DialogContent showCloseButton={false} className="max-w-5xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {viewingUser && (() => {
            const vu = viewingUser;
            const initials = vu.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
            const isSelf = vu.id === currentUser?.userId;
            const userAssets = assets.filter(a => a.assignedEmail === vu.email);
            const userTickets = tickets.filter((t: Ticket) =>
              t.raisedBy === vu.email || t.employeeEmail === vu.email
            );
            const activeTab = viewUserTab;
            const ticketPriorityPill = (p: string) =>
              p === "Critical" ? "bg-red-50 text-red-700 border-red-200" :
              p === "High"     ? "bg-orange-50 text-orange-700 border-orange-200" :
              p === "Medium"   ? "bg-amber-50 text-amber-700 border-amber-200" :
                                 "bg-slate-100 text-slate-600 border-slate-200";
            const ticketStatusPill = (s: string) =>
              s === "Open"             ? "bg-blue-50 text-blue-700 border-blue-200" :
              s === "Assigned"         ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
              s === "In Progress"      ? "bg-violet-50 text-violet-700 border-violet-200" :
              s === "Waiting for User" ? "bg-amber-50 text-amber-700 border-amber-200" :
              s === "Resolved"         ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              s === "Closed"           ? "bg-slate-100 text-slate-600 border-slate-200" :
              s === "Rejected"         ? "bg-rose-50 text-rose-700 border-rose-200" :
                                         "bg-muted text-muted-foreground border-border";
            const resolvedManager = (() => {
              const rm = vu.reporting_manager;
              if (!rm) return "—";
              if (rm.includes("@")) {
                const mgr = users.find(u => u.email === rm);
                return mgr ? mgr.full_name : rm;
              }
              return rm;
            })();
            const directReports = getDirectReports(vu, users);
            const addedDate = vu.created_at
              ? new Date(vu.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
              : null;
            const statusPill = vu.status === "active"
              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
              : "bg-slate-100 text-slate-600 border-slate-200";
            const assetTypePill = "bg-violet-50 text-violet-700 border-violet-200";
            const assetStatusPillFor = (s: string) =>
              s === "Assigned"      ? "bg-blue-50 text-blue-700 border-blue-200" :
              s === "Available"     ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
              s === "Under Repair"  ? "bg-amber-50 text-amber-700 border-amber-200" :
              s === "Retired"       ? "bg-slate-100 text-slate-600 border-slate-200" :
                                      "bg-muted text-muted-foreground border-border";

            return (
              <>
                {/* ── Header bar ──────────────────────────────────────────────── */}
                <DialogHeader className="px-6 pt-6 pb-5 border-b border-border/70">
                  {/* a11y title (visually represented by the name row below) */}
                  <DialogTitle className="sr-only">{vu.full_name} — User details</DialogTitle>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0">
                      <button
                        type="button"
                        onClick={() => setViewingUser(null)}
                        className="h-9 w-9 rounded-lg border border-border bg-background hover:bg-muted/60 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                        aria-label="Close"
                        data-testid="button-view-user-back"
                      >
                        <X className="h-4 w-4" />
                      </button>
                      <div className="h-14 w-14 rounded-full bg-primary/15 ring-1 ring-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xl font-bold text-primary">{initials}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-2xl font-bold text-foreground tracking-tight truncate">{vu.full_name}</h2>
                          <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", statusPill)}>
                            {statusLabel[vu.status]}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">You</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">
                          {ROLE_LABELS[vu.role]}{vu.department ? ` in ${vu.department}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isAdmin && !isSelf && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 hover:border-amber-400"
                          onClick={() => { setViewingUser(null); setResetPassTarget(vu); setNewPassword(""); setShowNewPw(false); setResetPassOpen(true); }}
                          data-testid="button-view-user-reset-password"
                        >
                          <KeyRound className="h-3.5 w-3.5" /> Reset Password
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          className="gap-2"
                          onClick={() => { setViewingUser(null); openEdit(vu); }}
                          data-testid="button-view-user-edit"
                        >
                          <Edit className="h-3.5 w-3.5" /> Edit Profile
                        </Button>
                      )}
                    </div>
                  </div>
                </DialogHeader>

                {/* ── Body: sidebar + tabbed main panel ───────────────────────── */}
                <div className="px-6 py-6 grid gap-5 lg:grid-cols-[300px_1fr] items-stretch">
                  {/* Left — profile sidebar */}
                  <div className="flex flex-col gap-4">
                    <Card className="flex-1">
                      <CardContent className="p-5 h-full flex flex-col">
                        <h3 className="text-base font-semibold text-foreground mb-4">Contact &amp; Details</h3>
                        <div className="space-y-4">
                          {[
                            { icon: Mail,         label: "Email",             value: vu.email,              mono: true  },
                            { icon: Hash,         label: "E-Code",            value: vu.ecode || "—",       mono: true  },
                            { icon: Building2,    label: "Department",        value: vu.department || "—" },
                            { icon: Briefcase,    label: "Role",              value: ROLE_LABELS[vu.role] },
                            { icon: MapPin,       label: "Location",          value: vu.location || "—" },
                            { icon: UserCircle,   label: "Reporting Manager", value: resolvedManager },
                          ].map(({ icon: Icon, label, value, mono }) => (
                            <div key={label} className="flex items-start gap-3">
                              <div className="h-8 w-8 rounded-md bg-muted/70 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Icon className="h-4 w-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
                                <p className={cn("text-sm text-foreground leading-snug break-words", mono && "font-mono")}>{value}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {addedDate && (
                          <div className="mt-auto pt-4 border-t border-border/70 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CalendarDays className="h-3.5 w-3.5" />
                            <span>Added {addedDate}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Quick stats — also act as tab shortcuts */}
                    <div className="grid grid-cols-3 gap-3">
                      {[
                        { label: "Reports", value: directReports.length, icon: UsersIcon,   tab: "team"     as const },
                        { label: "Assets",  value: userAssets.length,    icon: Monitor,     tab: "hardware" as const },
                        { label: "Tickets", value: userTickets.length,   icon: TicketIcon,  tab: "tickets"  as const },
                      ].map(({ label, value, icon: Icon, tab }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => setViewUserTab(tab)}
                          data-testid={`stat-user-${tab}`}
                          className={cn(
                            "rounded-xl border bg-card px-3 py-3 text-left transition-all hover:border-primary/40 hover:shadow-sm",
                            activeTab === tab ? "border-primary/50 ring-1 ring-primary/20" : "border-border"
                          )}
                        >
                          <Icon className={cn("h-4 w-4 mb-2", activeTab === tab ? "text-primary" : "text-muted-foreground")} />
                          <p className="text-xl font-bold text-foreground leading-none">{value}</p>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">{label}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Right — main panel with tabs */}
                  <div className="min-w-0 flex flex-col">
                    {/* Tab switcher */}
                    <div role="tablist" aria-label="User details" className="flex items-center gap-1 mb-4 border-b border-border/70 overflow-x-auto">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === "hardware"}
                        onClick={() => setViewUserTab("hardware")}
                        data-testid="tab-user-hardware"
                        className={cn(
                          "inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px whitespace-nowrap transition-colors",
                          activeTab === "hardware"
                            ? "border-b-2 border-primary text-foreground"
                            : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Monitor className={cn("h-4 w-4", activeTab === "hardware" ? "text-primary" : "text-muted-foreground")} />
                        Assigned Hardware ({userAssets.length})
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === "tickets"}
                        onClick={() => setViewUserTab("tickets")}
                        data-testid="tab-user-tickets"
                        className={cn(
                          "inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px whitespace-nowrap transition-colors",
                          activeTab === "tickets"
                            ? "border-b-2 border-primary text-foreground"
                            : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <TicketIcon className={cn("h-4 w-4", activeTab === "tickets" ? "text-primary" : "text-muted-foreground")} />
                        Tickets ({userTickets.length})
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === "team"}
                        onClick={() => setViewUserTab("team")}
                        data-testid="tab-user-team"
                        className={cn(
                          "inline-flex shrink-0 items-center gap-2 px-4 py-2.5 text-sm font-semibold -mb-px whitespace-nowrap transition-colors",
                          activeTab === "team"
                            ? "border-b-2 border-primary text-foreground"
                            : "border-b-2 border-transparent text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <UsersIcon className={cn("h-4 w-4", activeTab === "team" ? "text-primary" : "text-muted-foreground")} />
                        Team &amp; Reporting ({directReports.length})
                      </button>
                    </div>

                    <div role="tabpanel" className="flex-1">

                    {/* Hardware tab */}
                    {activeTab === "hardware" && (
                      userAssets.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 flex flex-col items-center justify-center gap-2 text-center">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <Monitor className="h-5 w-5 text-muted-foreground/60" />
                          </div>
                          <p className="text-sm font-medium text-foreground">No assigned hardware</p>
                          <p className="text-xs text-muted-foreground">This user has no assets currently assigned.</p>
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2">
                          {userAssets.map(a => (
                            <Link
                              key={a.assetId}
                              href={`/assets/${a.assetId}`}
                              onClick={() => setViewingUser(null)}
                              data-testid={`link-user-asset-${a.assetId}`}
                              className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                            >
                              <Card className="hover:shadow-md hover:border-primary/40 transition-all cursor-pointer h-full">
                                <CardContent className="p-4">
                                  <div className="flex items-start justify-between gap-2 mb-3">
                                    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", assetTypePill)}>
                                      {a.assetType}
                                    </span>
                                    <span className="text-[11px] font-mono text-muted-foreground tracking-wide truncate group-hover:text-primary transition-colors">
                                      {a.assetId}
                                    </span>
                                  </div>
                                  <p className="text-base font-semibold text-foreground leading-tight group-hover:text-primary transition-colors">
                                    {a.brand} {a.model}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1 font-mono truncate">
                                    SN: {a.serialNumber || "—"}
                                  </p>
                                  <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between gap-2">
                                    <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium", assetStatusPillFor(a.status))}>
                                      {a.status}
                                    </span>
                                    {a.warrantyEndDate && (
                                      <span className="text-[11px] text-muted-foreground">
                                        Warranty {new Date(a.warrantyEndDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                                      </span>
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            </Link>
                          ))}
                        </div>
                      )
                    )}

                    {/* Tickets tab */}
                    {activeTab === "tickets" && (
                      userTickets.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 flex flex-col items-center justify-center gap-2 text-center">
                          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                            <TicketIcon className="h-5 w-5 text-muted-foreground/60" />
                          </div>
                          <p className="text-sm font-medium text-foreground">No tickets raised</p>
                          <p className="text-xs text-muted-foreground">This user hasn't raised any support tickets yet.</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {[...userTickets]
                            .sort((a, b) => (b.createdDate || "").localeCompare(a.createdDate || ""))
                            .map((t: Ticket) => (
                              <Link
                                key={t.ticketId}
                                href={`/tickets/${t.ticketId}`}
                                onClick={() => setViewingUser(null)}
                                data-testid={`link-user-ticket-${t.ticketId}`}
                                className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
                              >
                                <Card className="hover:shadow-md hover:border-primary/40 transition-all cursor-pointer">
                                  <CardContent className="p-3.5">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 flex-wrap mb-1">
                                          <span className="text-xs font-mono font-semibold text-primary group-hover:underline">{t.ticketId}</span>
                                          <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium", ticketPriorityPill(t.priority))}>
                                            {t.priority}
                                          </span>
                                          <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium", ticketStatusPill(t.status))}>
                                            {t.status}
                                          </span>
                                        </div>
                                        <p className="text-sm font-medium text-foreground truncate">{t.category}{t.subcategory ? ` — ${t.subcategory}` : ""}</p>
                                        {t.description && (
                                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                                        )}
                                      </div>
                                      <div className="text-right text-[11px] text-muted-foreground flex-shrink-0">
                                        {t.assetId && <p className="font-mono">{t.assetId}</p>}
                                        {t.createdDate && (
                                          <p className="mt-0.5">{new Date(t.createdDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
                                        )}
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              </Link>
                            ))}
                        </div>
                      )
                    )}

                    {/* Team & Reporting tab */}
                    {activeTab === "team" && (
                      <div className="space-y-6">
                        {isAdmin && directReports.length > 0 && (
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 h-8 text-xs"
                              onClick={() => { setViewingUser(null); openTransferForManager(vu); }}
                              data-testid="button-view-user-transfer-reportees"
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" /> Transfer Reportees
                            </Button>
                          </div>
                        )}

                        {directReports.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-border bg-muted/20 py-12 flex flex-col items-center justify-center gap-2 text-center">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <UsersIcon className="h-5 w-5 text-muted-foreground/60" />
                            </div>
                            <p className="text-sm font-medium text-foreground">No direct reports</p>
                            <p className="text-xs text-muted-foreground">No employees currently report to this user.</p>
                          </div>
                        ) : (
                          <div>
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Direct Reports ({directReports.length})</h4>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {directReports.map(r => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => openView(r)}
                                  className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-left hover:bg-muted/50 hover:border-primary/40 transition-colors"
                                >
                                  <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                    <UserCircle className="h-4 w-4 text-muted-foreground" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium text-foreground truncate">{r.full_name}</p>
                                    <p className="text-xs text-muted-foreground truncate">{r.department || r.email}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Manager-change history */}
                        <div className="pt-1">
                          <div className="flex items-center gap-1.5 mb-3">
                            <History className="h-3.5 w-3.5 text-muted-foreground" />
                            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manager History</h4>
                          </div>
                          {historyLoading ? (
                            <p className="text-xs text-muted-foreground">Loading history…</p>
                          ) : managerHistory.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No manager changes recorded.</p>
                          ) : (
                            <div className="space-y-3">
                              {managerHistory.map(h => (
                                <div key={h.id} className="flex gap-2.5">
                                  <div className="flex flex-col items-center pt-1">
                                    <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                                    <div className="w-px flex-1 bg-border mt-1" />
                                  </div>
                                  <div className="min-w-0 flex-1 pb-1">
                                    <p className="text-xs text-foreground">
                                      {h.event_type === "unassigned" ? (
                                        <>Manager <span className="font-medium">unassigned</span></>
                                      ) : (
                                        <>
                                          Moved to <span className="font-medium">{h.new_manager_name || h.new_manager_email || "—"}</span>
                                        </>
                                      )}
                                      {h.old_manager_name && (
                                        <span className="text-muted-foreground"> (from {h.old_manager_name})</span>
                                      )}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-0.5">
                                      {new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                                      {h.event_by_name ? ` · by ${h.event_by_name}` : ""}
                                    </p>
                                    {h.notes && <p className="text-[10px] text-muted-foreground italic mt-0.5">"{h.notes}"</p>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ─────────────────────────────────────────────── */}
      <Dialog open={resetPassOpen} onOpenChange={v => { if (!resetPassSaving) { setResetPassOpen(v); if (!v) setNewPassword(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Reset Password
            </DialogTitle>
            {resetPassTarget && (
              <DialogDescription>{resetPassTarget.full_name} · {resetPassTarget.email}</DialogDescription>
            )}
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <div className="relative">
                <Input
                  type={showNewPw ? "text" : "password"}
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="pr-10"
                  disabled={resetPassSaving}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowNewPw(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showNewPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline"
                onClick={() => { setNewPassword(generatePassword()); setShowNewPw(true); }}
              >
                Generate random password
              </button>
            </div>
            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded px-3 py-2">
              Share the new password with the user securely. They should change it after next login.
            </p>
          </div>

          <DialogFooter className="flex-col gap-2">
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setResetPassOpen(false)} disabled={resetPassSaving} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleSetPassword}
                disabled={resetPassSaving || newPassword.length < 8}
                className="flex-1 gap-2"
              >
                {resetPassSaving ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    Setting…
                  </span>
                ) : "Set Password"}
              </Button>
            </div>
            <div className="border-t border-border pt-2 w-full">
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleSendResetLink}
                disabled={resetPassSaving}
              >
                <KeyRound className="h-3 w-3" />
                Or send a reset link to the user's email
              </Button>
            </div>
          </DialogFooter>
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
                        <SelectItem value="hr_admin">HR Admin</SelectItem>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormField control={addForm.control} name="location" render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <LocationSelect value={field.value ?? ""} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={addForm.control} name="reporting_manager" render={({ field }) => (
                  <FormItem className="min-w-0">
                    <FormLabel>Reporting Manager</FormLabel>
                    <FormControl>
                      <ManagerSearchField
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        users={users}
                      />
                    </FormControl>
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

      {/* ── Edit User Dialog (sectioned profile-style editor) ─────────────── */}
      <Dialog open={editOpen} onOpenChange={v => !editSaving && setEditOpen(v)}>
        <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
          {editingUser && (() => {
            const eu = editingUser;
            const editInitials = eu.full_name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
            const isEditingSelf = eu.id === currentUser?.userId;
            return (
              <>
                {/* ── Header bar ──────────────────────────────────────────────── */}
                <DialogHeader className="px-6 pt-6 pb-5 border-b border-border/70">
                  <DialogTitle className="sr-only">Edit {eu.full_name} — User profile</DialogTitle>
                  {eu.email && <DialogDescription className="sr-only">{eu.email}</DialogDescription>}
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="h-14 w-14 rounded-full bg-primary/15 ring-1 ring-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xl font-bold text-primary">{editInitials}</span>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-xl font-bold text-foreground tracking-tight truncate">{eu.full_name}</h2>
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-amber-50 text-amber-700 border-amber-200 gap-1">
                            <Edit className="h-2.5 w-2.5" /> Editing
                          </span>
                          {isEditingSelf && (
                            <span className="text-[10px] bg-primary/10 text-primary rounded px-1.5 py-0.5 font-medium">You</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-0.5 truncate font-mono">{eu.email}</p>
                      </div>
                    </div>
                    {currentUser?.role === "super_admin" && !isEditingSelf && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2 text-amber-600 border-amber-300 hover:bg-amber-50 hover:border-amber-400 flex-shrink-0"
                        disabled={resetSending || editSaving}
                        onClick={handleResetPassword}
                        title="Sends a password reset link to the user's email"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                        {resetSending ? "Sending…" : "Send Reset Link"}
                      </Button>
                    )}
                  </div>
                </DialogHeader>

                {/* ── Form body ───────────────────────────────────────────────── */}
                <Form {...editForm}>
                  <form onSubmit={editForm.handleSubmit(onEditSubmit)}>
                    <div className="px-6 py-6 space-y-5">
                      {/* Section: Identity */}
                      <Card>
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                              <User className="h-4 w-4 text-primary" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">Identity</h3>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={editForm.control} name="full_name" render={({ field }) => (
                              <FormItem><FormLabel>Full Name</FormLabel><FormControl><Input {...field} data-testid="input-user-name" /></FormControl><FormMessage /></FormItem>
                            )} />
                            <FormField control={editForm.control} name="ecode" render={({ field }) => (
                              <FormItem><FormLabel>E-Code</FormLabel><FormControl><Input placeholder="e.g. EMP-001" {...field} data-testid="input-user-ecode" /></FormControl><FormMessage /></FormItem>
                            )} />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Section: Role & Access */}
                      <Card>
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                              <Briefcase className="h-4 w-4 text-primary" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">Role &amp; Access</h3>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <FormField control={editForm.control} name="role" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Role</FormLabel>
                                <Select value={field.value} onValueChange={field.onChange}>
                                  <FormControl><SelectTrigger data-testid="select-user-role"><SelectValue /></SelectTrigger></FormControl>
                                  <SelectContent>
                                    <SelectItem value="super_admin">Super Admin</SelectItem>
                                    <SelectItem value="it_admin">IT Admin</SelectItem>
                                    <SelectItem value="hr_admin">HR Admin</SelectItem>
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
                                <Select value={field.value} onValueChange={field.onChange} disabled={isEditingSelf}>
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
                          {isEditingSelf && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 flex items-center gap-1.5 mt-3">
                              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                              You cannot deactivate your own account from here.
                            </p>
                          )}
                        </CardContent>
                      </Card>

                      {/* Section: Organization */}
                      <Card>
                        <CardContent className="p-5">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center">
                              <Building2 className="h-4 w-4 text-primary" />
                            </div>
                            <h3 className="text-sm font-semibold text-foreground">Organization</h3>
                          </div>
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <FormField control={editForm.control} name="department" render={({ field }) => (
                                <FormItem><FormLabel>Department</FormLabel><FormControl><Input placeholder="Engineering, HR…" {...field} data-testid="input-user-department" /></FormControl><FormMessage /></FormItem>
                              )} />
                              <FormField control={editForm.control} name="location" render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Location</FormLabel>
                                  <FormControl>
                                    <LocationSelect value={field.value ?? ""} onChange={field.onChange} />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )} />
                            </div>
                            <FormField control={editForm.control} name="reporting_manager" render={({ field }) => (
                              <FormItem>
                                <FormLabel>Reporting Manager</FormLabel>
                                <FormControl>
                                  <ManagerSearchField
                                    value={field.value ?? ""}
                                    onChange={field.onChange}
                                    users={users}
                                    excludeEmail={eu.email}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )} />
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* ── Footer ────────────────────────────────────────────── */}
                    <DialogFooter className="px-6 py-4 border-t border-border/70 bg-muted/30 gap-2 sm:gap-2">
                      <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={editSaving || resetSending}>Cancel</Button>
                      <Button type="submit" disabled={editSaving || resetSending} data-testid="button-save-user" className="gap-2">
                        {editSaving ? "Saving…" : (<><CheckSquare className="h-4 w-4" /> Save Changes</>)}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* ── Deactivate Confirm ─────────────────────────────────────────────────── */}
      {(() => {
        const deactReports = deactivateTarget ? getDirectReports(deactivateTarget, users) : [];
        const hasReports = deactReports.length > 0;
        return (
      <AlertDialog open={!!deactivateTarget} onOpenChange={v => !v && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate User</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.full_name}</strong> will be set to Inactive and will no longer be able to log in.
              You can reactivate them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {hasReports && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold">This user manages {deactReports.length} direct report{deactReports.length === 1 ? "" : "s"}.</p>
                  <p className="mt-1 text-amber-700">
                    Transfer their reportees to another manager first. If you continue anyway,
                    those {deactReports.length} employee{deactReports.length === 1 ? "" : "s"} will be left <strong>unassigned</strong>.
                  </p>
                </div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {hasReports && deactivateTarget && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => { const t = deactivateTarget; setDeactivateTarget(null); openTransferForManager(t); }}
              >
                <ArrowRightLeft className="h-4 w-4" /> Transfer Now
              </Button>
            )}
            <AlertDialogAction className="bg-amber-600 hover:bg-amber-700 text-white" onClick={handleDeactivate}>
              {hasReports ? "Continue Anyway" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        );
      })()}

      {/* ── Bulk Deactivate Confirm ────────────────────────────────────────────── */}
      {(() => {
        const targets = users.filter(u => selectedUserIds.has(u.id) && u.status !== "inactive");
        const managersWithReports = targets.filter(u => getDirectReports(u, users).length > 0);
        const totalReports = managersWithReports.reduce((n, u) => n + getDirectReports(u, users).length, 0);
        const hasReports = managersWithReports.length > 0;
        return (
      <AlertDialog open={bulkDeactivateOpen} onOpenChange={v => !v && !bulkBusy && setBulkDeactivateOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {targets.length} User{targets.length === 1 ? "" : "s"}</AlertDialogTitle>
            <AlertDialogDescription>
              The selected user{targets.length === 1 ? "" : "s"} will be set to Inactive and will no longer be able to log in.
              You can reactivate them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {hasReports && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-semibold">
                    {managersWithReports.length} selected user{managersWithReports.length === 1 ? "" : "s"} manage{managersWithReports.length === 1 ? "s" : ""} {totalReports} direct report{totalReports === 1 ? "" : "s"}.
                  </p>
                  <p className="mt-1 text-amber-700">
                    Transfer their reportees to another manager first. If you continue anyway,
                    those {totalReports} employee{totalReports === 1 ? "" : "s"} will be left <strong>unassigned</strong> (recorded in their history).
                  </p>
                </div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
            {hasReports && (
              <Button
                variant="outline"
                className="gap-1.5"
                disabled={bulkBusy}
                onClick={() => {
                  const reportees = managersWithReports.flatMap(m => getDirectReports(m, users));
                  const uniq = Array.from(new Map(reportees.map(r => [r.id, r])).values());
                  setBulkDeactivateOpen(false);
                  setTransferFromManager(null);
                  setTransferAffected(uniq);
                  setTransferTitle("Transfer Reportees Before Deactivation");
                  setTransferOpen(true);
                }}
              >
                <ArrowRightLeft className="h-4 w-4" /> Transfer Now
              </Button>
            )}
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              disabled={bulkBusy}
              onClick={e => { e.preventDefault(); performBulkDeactivate(); }}
            >
              {bulkBusy ? "Deactivating…" : hasReports ? "Continue Anyway" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        );
      })()}

      {/* ── Transfer Reportees ────────────────────────────────────────────────── */}
      <TransferReporteesModal
        open={transferOpen}
        onOpenChange={setTransferOpen}
        affectedUsers={transferAffected}
        fromManager={transferFromManager}
        title={transferTitle}
        onDone={() => { clearSelection(); refresh(); }}
      />

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
              If password is blank, default <code className="text-xs bg-muted px-1 py-0.5 rounded">Miles@123</code> is used.
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
