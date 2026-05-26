import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import {
  ArrowLeft, Upload, FileText, CheckCircle2, AlertTriangle,
  AlertCircle, Download, Info, Loader2, X, UserCheck,
  Monitor, Smartphone, Server, Package, Mail, Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useAssets } from "@/context/AssetContext";
import { useUsers } from "@/context/UsersContext";
import { supabase } from "@/lib/supabaseClient";
import { AssetStatus, AssetType } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { ASSET_TYPE_CATEGORIES, getAssetEmoji } from "@/lib/assetEmoji";

// ─── CSV parser (handles quoted fields) ──────────────────────────────────────
function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const parseRow = (line: string): string[] => {
    const cells: string[] = [];
    let cell = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cell += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell.trim());
    return cells;
  };

  const rawLines: string[] = [];
  let current = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQ = !inQ;
    if ((ch === "\n" || ch === "\r") && !inQ) {
      if (current.trim()) rawLines.push(current);
      current = "";
    } else if (ch !== "\r") {
      current += ch;
    }
  }
  if (current.trim()) rawLines.push(current);

  if (rawLines.length < 2) return { headers: [], rows: [] };
  const headers = parseRow(rawLines[0]);
  const rows = rawLines.slice(1).map(line => {
    const vals = parseRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
  return { headers, rows };
}

// ─── Column detection ─────────────────────────────────────────────────────────
function nk(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }

const COL_ALIASES: Record<string, string[]> = {
  assetId:         [
    "assettag","assetid","assettagno","tagno","tag","asiid",
    "srno","sno","sino","slno","assetno","assetnumber","itassetid",
    "assetcode","itassetcode","deviceid","devicetag","assettagnumber",
  ],
  assetType:       ["type","assettype","devicetype","assetcategory","category"],
  location:        ["location","loc","city","office","branch","place"],
  brand:           ["brand","brandmodel","make","brandname","manufacturer"],
  model:           ["model","modelname","modelno","modelversion","modelnum"],
  serialNumber:    ["serialnumber","serialno","serial","srnumber","serialnum","serialid","sn","snno"],
  imei1:           ["imei1","imei","imeinumber","imeino","imei1number","imei1no","imeinumber1","phoneid"],
  imei2:           ["imei2","imei2number","imei2no","imeinumber2","imei2id"],
  operatingSystem: ["os","operatingsystem","ostype","osname","operatingsystemos"],
  processor:       ["config","processor","configuration","cpu","processorconfig","proc","processortype","specification"],
  ram:             ["ram","memory","ramgb","ramsize"],
  storage:         ["rom","storage","hdd","ssd","disk","romgb","storagegb","harddisk","storagesize","disksize"],
  purchaseDate:    ["purchaseyear","purchasedate","yearofpurchase","buyyear","podate","dateofpurchase","purchasedyear","year"],
  warranty:        ["warranty","warrantyend","warrantyexpiry","warrantyenddate","warrantystatus","warrantyperiod","warrantytype"],
  status:          ["assetstatus","status","currentstatus","assetcurrentstatus","assetstate"],
  condition:       ["assetcondition","condition","physicalcondition","assetstate","devicecondition"],
  vendor:          ["vendor","supplier","vendorname","suppliername"],
  ownership:       ["ownership","ownedby","owner","ownedunder","ownershiptag","ownershiptype"],
  employeeName:    ["employeename","assignedto","username","empname","employeefullname","employeenameassigned","name","fullname","user"],
  employeeCode:    ["employeecode","empcode","employeeid","empid","ecode","employeeno","empno","mpe","mpecode","employeeidcode"],
  department:      ["employeedepartment","department","dept","empdepartment","division"],
};

// Normalize aliases at lookup time so mixed-case aliases always match
function findCol(headers: string[], field: string): string | undefined {
  const normAliases = (COL_ALIASES[field] ?? []).map(nk);
  return headers.find(h => normAliases.includes(nk(h)));
}

// ─── Value mapping ────────────────────────────────────────────────────────────
function mapAssetType(raw: string, assetIdFallback = ""): AssetType {
  // Asset ID prefix is the most reliable signal — always check it first.
  const aid = assetIdFallback.toUpperCase();
  if (/-MOB-|-PHN-/.test(aid))        return "Mobile";
  if (/-TAB-/.test(aid))              return "Tab";
  if (/-DES-|-DSK-/.test(aid))        return "Desktop";
  if (/-LAP-/.test(aid))              return "Laptop";
  if (/-MON-/.test(aid))              return "Monitor";
  if (/-KBD-|-KEY-/.test(aid))        return "Keyboard";
  if (/-MOU-|-MSE-/.test(aid))        return "Mouse";
  if (/-HSE-|-HDS-/.test(aid))        return "Headset";
  if (/-HDD-|-SSD-/.test(aid))        return "Hard Disk";
  if (/-SPK-/.test(aid))              return "Speaker";
  if (/-DCK-|-DOC-/.test(aid))        return "Docking Station";
  if (/-PRN-|-PRT-/.test(aid))        return "Printer";
  if (/-RTR-/.test(aid))              return "Router";
  if (/-SRV-|-SVR-/.test(aid))        return "Server";
  if (/-CAM-/.test(aid))              return "Camera";
  if (/-CCTV-/.test(aid))             return "CCTV";
  if (/-TV-/.test(aid))               return "Smart TV";
  if (/-PRJ-|-PROJ-/.test(aid))       return "Projector";
  if (/-CPU-/.test(aid))              return "CPU";
  if (/-NET-|-SWT-/.test(aid))        return "Network Device";
  if (/-FW-/.test(aid))               return "Firewall";

  // Fall back to whatever the type column says
  const v = raw.toLowerCase().trim();
  if (!v)                                                  return "Laptop";
  if (v.includes("laptop") || v.includes("notebook"))      return "Laptop";
  if (v.includes("desk"))                                  return "Desktop";
  if (v === "tab" || v.includes("tablet"))                 return "Tab";
  if (v.includes("mob") || v.includes("phone"))            return "Mobile";
  if (v.includes("monitor") || v.includes("display"))      return "Monitor";
  if (v.includes("keyboard"))                              return "Keyboard";
  if (v.includes("mouse"))                                 return "Mouse";
  if (v.includes("headset") || v.includes("headphone"))    return "Headset";
  if (v.includes("hard disk") || v.includes("hdd") || v.includes("ssd")) return "Hard Disk";
  if (v.includes("speaker"))                               return "Speaker";
  if (v.includes("docking"))                               return "Docking Station";
  if (v.includes("printer"))                               return "Printer";
  if (v.includes("router"))                                return "Router";
  if (v.includes("server"))                                return "Server";
  if (v.includes("cctv"))                                  return "CCTV";
  if (v.includes("camera"))                                return "Camera";
  if (v.includes("tv") || v.includes("television"))        return "Smart TV";
  if (v.includes("projector"))                             return "Projector";
  if (v.includes("cpu"))                                   return "CPU";
  if (v.includes("firewall"))                              return "Firewall";
  if (v.includes("network") || v.includes("switch"))       return "Network Device";
  if (v.includes("generic"))                               return "Generic Asset";
  return "Laptop";
}

function mapStatus(raw: string): { status: AssetStatus; warning?: string } {
  const v = raw.toLowerCase().trim();
  if (!v) return { status: "Available" };
  if (v === "assigned") return { status: "Assigned" };
  if (v === "available" || v === "in stock" || v === "ready" || v === "in inventory") return { status: "Available" };
  if (v.includes("under repair") || v === "repair") return { status: "Under Repair" };
  if (v.includes("vendor") || v.includes("recovery") || v.includes("mso") || v.includes("given to vendor") || v.includes("returned to vendor"))
    return { status: "Under Repair", warning: `"${raw}" → Under Repair` };
  if (v.includes("scrap") || v.includes("retir") || v.includes("eol") || v === "disposal")
    return { status: "Retired", warning: `"${raw}" → Retired` };
  if (v.includes("lost") || v.includes("missing") || v.includes("stolen") || v.includes("theft"))
    return { status: "Lost" };
  if (v.includes("procure") || v.includes("order") || v.includes("purchase pending"))
    return { status: "In Procurement" };
  return { status: "Available", warning: `Unknown status "${raw}" → Available` };
}

const OWNERSHIP_VALUES = ["Miles","Miles-GCC","Mojo","Rented","Employee Owned","Company Owned"] as const;
function mapOwnership(raw: string): string {
  const v = (raw || "").trim();
  if (!v) return "Miles";
  const nv = nk(v);
  const exact = OWNERSHIP_VALUES.find(o => nk(o) === nv);
  if (exact) return exact;
  if (nv.includes("gcc"))                      return "Miles-GCC";
  if (nv.includes("mojo"))                     return "Mojo";
  if (nv === "miles" || nv.startsWith("miles"))return "Miles";
  if (nv.includes("rent") || nv.includes("lease")) return "Rented";
  if (nv.includes("employee") || nv.includes("personal") || nv.includes("self") || nv.includes("byod")) return "Employee Owned";
  if (nv.includes("company") || nv.includes("organisation") || nv.includes("organization") || nv.includes("corp")) return "Company Owned";
  return "Miles";
}

function parsePurchaseDate(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;
  if (/^\d{2}\/\d{2}\/\d{4}/.test(t)) {
    const [d, m, y] = t.split("/");
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}

function parseWarrantyDate(raw: string, purchaseDateStr: string): string {
  const t = raw.trim();
  if (!t) {
    const yr = purchaseDateStr ? parseInt(purchaseDateStr.slice(0, 4)) : new Date().getFullYear();
    return `${yr + 3}-12-31`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const lower = t.toLowerCase();
  const yr = purchaseDateStr ? parseInt(purchaseDateStr.slice(0, 4)) : new Date().getFullYear();
  if (lower === "under warranty") return `${yr + 3}-12-31`;
  if (lower === "expired" || lower === "out of warranty") return `${yr + 2}-12-31`;
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return `${yr + 3}-12-31`;
}

function normSize(val: string, suffix = "GB"): string {
  if (!val.trim()) return "";
  if (/^\d+$/.test(val.trim())) return `${val.trim()} ${suffix}`;
  return val.trim();
}

function parseBrandModel(brandCol: string, modelCol?: string): { brand: string; model: string } {
  const trimmed = brandCol.trim();
  if (!trimmed) return { brand: "", model: "" };
  if (modelCol?.trim()) return { brand: trimmed, model: modelCol.trim() };
  const knownBrands = ["Lenovo","Dell","HP","Apple","MacBook","Asus","Acer","Samsung","Microsoft","Toshiba","LG"];
  for (const b of knownBrands) {
    if (trimmed.toLowerCase().startsWith(b.toLowerCase())) {
      const model = trimmed.slice(b.length).trim();
      return { brand: b, model: model || b };
    }
  }
  const spaceIdx = trimmed.indexOf(" ");
  if (spaceIdx > 0) return { brand: trimmed.slice(0, spaceIdx), model: trimmed.slice(spaceIdx + 1) };
  return { brand: trimmed, model: trimmed };
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface MappedRow {
  rowNum:          number;
  assetId:         string;
  assetType:       AssetType;
  brand:           string;
  model:           string;
  serialNumber:    string;
  imei1:           string;
  imei2:           string;
  operatingSystem: string;
  processor:       string;
  ram:             string;
  storage:         string;
  purchaseDate:    string;
  warrantyEndDate: string;
  location:        string;
  status:          AssetStatus;
  assignedEmail:   string;
  assignedToId:    string;
  assignedName:    string;
  department:      string;
  vendor:          string;
  ownership:       string;
  remarks:         string;
  employeeCode:    string;
  warnings:        string[];
  errors:          string[];
}

// ─── Asset-tag prefix per type (matches mapAssetType regex above) ────────────
const TAG_PREFIX: Record<string, string> = {
  Laptop:"LAP", Desktop:"DES", Mobile:"MOB", Tab:"TAB", CPU:"CPU",
  Monitor:"MON", Keyboard:"KBD", Mouse:"MOU", Headset:"HSE", "Hard Disk":"HDD",
  Speaker:"SPK", "Docking Station":"DCK", Printer:"PRN",
  Router:"RTR", Server:"SRV", "Network Device":"NET", Firewall:"FW",
  Camera:"CAM", CCTV:"CCTV", "Smart TV":"TV", Projector:"PRJ",
  "Generic Asset":"AST",
};

// Column-set categories that drive the generated template
type ColumnSet = "computer" | "mobile" | "tab" | "monitor" | "simple" | "network";
const COLUMN_SET: Partial<Record<AssetType, ColumnSet>> = {
  Laptop:"computer", Desktop:"computer", CPU:"computer", Server:"computer",
  Mobile:"mobile",
  Tab:"tab",
  Monitor:"monitor",
  Router:"network", "Network Device":"network", Firewall:"network",
};
function columnSetFor(type: AssetType): ColumnSet {
  return COLUMN_SET[type] ?? "simple";
}

// ─── Type-specific templates ──────────────────────────────────────────────────
const TEMPLATES: Partial<Record<AssetType, { headers: string[]; rows: string[]; filename: string }>> = {
  Laptop: {
    filename: "laptop_import_template.csv",
    headers: ["Asset Tag","Brand","Model","Serial Number","Location","OS","Config","RAM","ROM","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Employee Name","Employee Code","Employee Department"],
    rows: [
      "MILES-LAP-001,Lenovo,ThinkPad T16,SN12345,Mumbai,Windows,Intel i7 13th Gen,32,512,2025,Under Warranty,Good,Assigned,C Prompt Solutions,John Doe,MPE1234,Miles GCC Tax",
      "MILES-LAP-002,Dell,Latitude 5540,SN12346,Bangalore,Windows,Intel i5 12th Gen,16,256,2024,Under Warranty,Good,Available,,,,",
      "MILES-LAP-003,HP,EliteBook 845 G9,SN12347,Hyderabad,Windows,AMD Ryzen 5,16,512,2023,Expired,Fair,Under Repair,,,,",
    ],
  },
  Mobile: {
    filename: "mobile_import_template.csv",
    headers: ["Asset Tag","Brand","Model","IMEI 1","IMEI 2","Location","Purchase Year","Warranty","Asset Status","Employee Name","Employee Code","Employee Department"],
    rows: [
      "MILES-MOB-001,Samsung,Galaxy S24,354812345678901,354812345678902,Mumbai,2024,Under Warranty,Assigned,John Doe,MPE1234,Miles GCC Tax",
      "MILES-MOB-002,Apple,iPhone 15,356789012345678,,Bangalore,2025,Under Warranty,Available,,,,",
      "MILES-MOB-003,OnePlus,12R,352345678901234,,Hyderabad,2023,Expired,Available,,,,",
    ],
  },
  Desktop: {
    filename: "desktop_import_template.csv",
    headers: ["Asset Tag","Brand","Model","Serial Number","Location","OS","Config","RAM","ROM","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Employee Name","Employee Code","Employee Department"],
    rows: [
      "MILES-DES-001,Dell,OptiPlex 7090,SN22345,Mumbai,Windows,Intel i7 11th Gen,32,512,2023,Under Warranty,Good,Assigned,C Prompt Solutions,Jane Smith,MPE5678,Finance",
      "MILES-DES-002,HP,EliteDesk 800 G9,SN22346,Bangalore,Windows,Intel i5 12th Gen,16,256,2024,Under Warranty,Good,Available,,,,",
      "MILES-DES-003,Lenovo,ThinkCentre M90q,SN22347,Hyderabad,Windows,Intel i9 12th Gen,64,1024,2022,Expired,Fair,Under Repair,,,,",
    ],
  },
  Tab: {
    filename: "tab_import_template.csv",
    headers: ["Asset Tag","Brand","Model","Serial Number","Location","OS","RAM","ROM","IMEI","Purchase Year","Warranty","Asset Condition","Asset Status","Employee Name","Employee Code","Employee Department"],
    rows: [
      "MILES-TAB-001,Apple,iPad Air 5th Gen,SN33101,Mumbai,iOS,8,256,,2023,Under Warranty,Good,Assigned,John Smith,MPE1234,Sales",
      "MILES-TAB-002,Samsung,Galaxy Tab S9,SN33102,Bangalore,Android,12,128,358765432109876,2024,Under Warranty,Good,Available,,,,",
      "MILES-TAB-003,Lenovo,Tab P12,SN33103,Hyderabad,Android,8,128,,2022,Expired,Fair,Under Repair,,,,",
    ],
  },
};
// Build a generic template for any AssetType that doesn't have a hard-coded one
function buildGenericTemplate(type: AssetType): { headers: string[]; rows: string[]; filename: string } {
  const prefix = TAG_PREFIX[type] ?? "AST";
  const tag = (n: number) => `MILES-${prefix}-${String(n).padStart(3,"0")}`;
  const set = columnSetFor(type);

  const common = ["Asset Tag","Brand","Model","Location","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Employee Name","Employee Code","Employee Department"];

  if (set === "computer") {
    const headers = ["Asset Tag","Brand","Model","Serial Number","Location","OS","Config","RAM","ROM","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Employee Name","Employee Code","Employee Department"];
    return {
      filename: `${type.toLowerCase().replace(/\s+/g,"_")}_import_template.csv`,
      headers,
      rows: [
        `${tag(1)},Dell,Sample Model,SN10001,Mumbai,Windows,Intel i7,16,512,2024,Under Warranty,Good,Assigned,C Prompt Solutions,John Doe,MPE1234,IT`,
        `${tag(2)},HP,Sample Model,SN10002,Bangalore,Windows,Intel i5,8,256,2023,Under Warranty,Good,Available,,,,`,
      ],
    };
  }
  if (set === "mobile") {
    const headers = ["Asset Tag","Brand","Model","IMEI 1","IMEI 2","Location","Purchase Year","Warranty","Asset Status","Employee Name","Employee Code","Employee Department"];
    return { filename: `${type.toLowerCase()}_import_template.csv`, headers, rows: [
      `${tag(1)},Samsung,Sample Model,354812345678901,354812345678902,Mumbai,2024,Under Warranty,Assigned,John Doe,MPE1234,Sales`,
      `${tag(2)},Apple,Sample Model,356789012345678,,Bangalore,2025,Under Warranty,Available,,,,`,
    ]};
  }
  if (set === "tab") {
    const headers = ["Asset Tag","Brand","Model","Serial Number","Location","OS","RAM","ROM","IMEI","Purchase Year","Warranty","Asset Condition","Asset Status","Employee Name","Employee Code","Employee Department"];
    return { filename: `${type.toLowerCase()}_import_template.csv`, headers, rows: [
      `${tag(1)},Apple,iPad Sample,SN20001,Mumbai,iOS,8,256,,2024,Under Warranty,Good,Assigned,John Doe,MPE1234,Sales`,
      `${tag(2)},Samsung,Galaxy Tab Sample,SN20002,Bangalore,Android,8,128,358765432109876,2023,Under Warranty,Good,Available,,,,`,
    ]};
  }
  if (set === "monitor") {
    const headers = ["Asset Tag","Brand","Model","Serial Number","Location","Screen Size","Resolution","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Employee Name","Employee Code","Employee Department"];
    return { filename: `${type.toLowerCase()}_import_template.csv`, headers, rows: [
      `${tag(1)},Dell,UltraSharp U2422H,SN30001,Mumbai,24",1920x1080,2024,Under Warranty,Good,Assigned,Owned,John Doe,MPE1234,IT`,
      `${tag(2)},LG,27UN880,SN30002,Bangalore,27",3840x2160,2023,Under Warranty,Good,Available,Owned,,,,`,
    ]};
  }
  if (set === "network") {
    const headers = ["Asset Tag","Brand","Model","Serial Number","Location","IP Address","Firmware","Purchase Year","Warranty","Asset Condition","Asset Status","Ownership","Remarks"];
    return { filename: `${type.toLowerCase().replace(/\s+/g,"_")}_import_template.csv`, headers, rows: [
      `${tag(1)},Cisco,Sample Model,SN40001,Mumbai HQ,192.168.1.1,1.0.0,2023,Under Warranty,Good,Available,Owned,Core ${type}`,
      `${tag(2)},Fortinet,Sample Model,SN40002,Bangalore Office,192.168.2.1,2.0.0,2024,Under Warranty,Good,Available,Owned,`,
    ]};
  }
  // simple: accessories, fixed assets, etc.
  const headers = ["Asset Tag","Brand","Model","Serial Number", ...common.slice(3)];
  return { filename: `${type.toLowerCase().replace(/\s+/g,"_")}_import_template.csv`, headers, rows: [
    `${tag(1)},Sample Brand,Sample Model,SN50001,Mumbai,2024,Under Warranty,Good,Available,Owned,,,`,
    `${tag(2)},Sample Brand,Sample Model,SN50002,Bangalore,2023,Under Warranty,Good,Assigned,Owned,John Doe,MPE1234,IT`,
  ]};
}

function downloadTemplate(type: AssetType) {
  const t = TEMPLATES[type] ?? buildGenericTemplate(type);
  // Prepend UTF-8 BOM so Excel opens Indian rupee / unicode characters correctly
  const csv = "\ufeff" + [t.headers.join(","), ...t.rows].join("\n");
  const a   = document.createElement("a");
  a.href    = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = t.filename;
  a.click();
}

// ─── Visual styling per asset type (icon + colour for banner/badges) ──────────
type TypeStyle = { Icon: React.ElementType; color: string; ring: string; desc: string };
const DEFAULT_TYPE_STYLE: TypeStyle = {
  Icon: Package,
  color: "bg-slate-50 text-slate-600 border-slate-200",
  ring:  "ring-slate-400",
  desc:  "",
};
const TYPE_STYLE: Partial<Record<AssetType, TypeStyle>> = {
  Laptop:  { Icon: Monitor,    color: "bg-blue-50 text-blue-600 border-blue-200",       ring: "ring-blue-400",   desc: "Laptops & notebooks — MILES-LAP-* tags" },
  Mobile:  { Icon: Smartphone, color: "bg-purple-50 text-purple-600 border-purple-200", ring: "ring-purple-400", desc: "Phones — MILES-MOB-* tags, IMEI columns" },
  Desktop: { Icon: Server,     color: "bg-amber-50 text-amber-600 border-amber-200",    ring: "ring-amber-400",  desc: "Desktops & workstations — MILES-DES-* tags" },
};
function getTypeStyle(type: AssetType): TypeStyle {
  return TYPE_STYLE[type] ?? DEFAULT_TYPE_STYLE;
}

// ─── Component ────────────────────────────────────────────────────────────────
type Step = "select" | "upload" | "preview" | "importing" | "done";

interface ImportedAssigned {
  assetId:         string;
  assetType:       AssetType;
  brand:           string;
  model:           string;
  serialNumber:    string;
  processor:       string;
  ram:             string;
  storage:         string;
  operatingSystem: string;
  imei1:           string;
  imei2:           string;
  accessories:     string;
  assignedEmail:   string;
  assignedName:    string;
  ackToken:        string;
  emailState:      "idle" | "sending" | "sent" | "error";
  ackState:        "idle" | "saving" | "done";
}

export default function BulkImport() {
  const { refresh, markAcknowledged } = useAssets();
  const { users }   = useUsers();
  const { toast }   = useToast();

  const [step,             setStep]            = useState<Step>("select");
  const [assetTypeFilter,  setAssetTypeFilter] = useState<AssetType | null>(null);
  const [file,             setFile]            = useState<File | null>(null);
  const [dragOver,         setDragOver]        = useState(false);
  const [mappedRows,       setMappedRows]      = useState<MappedRow[]>([]);
  const [progress,         setProgress]        = useState(0);
  const [results,          setResults]         = useState<{ success: number; failed: number; skipped: number; errorMessages: string[] }>({ success: 0, failed: 0, skipped: 0, errorMessages: [] });
  const [importedAssigned, setImportedAssigned] = useState<ImportedAssigned[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetToSelect = () => {
    setStep("select"); setAssetTypeFilter(null);
    setFile(null); setMappedRows([]); setImportedAssigned([]);
  };

  // ── Parse file ──────────────────────────────────────────────────────────────
  const processFile = useCallback((f: File) => {
    if (!f.name.endsWith(".csv")) {
      toast({ title: "Please upload a .csv file", variant: "destructive" }); return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = e => {
      const { headers, rows } = parseCSV(e.target?.result as string);
      if (!headers.length) {
        toast({ title: "Could not parse CSV — check the file format", variant: "destructive" }); return;
      }

      const get = (r: Record<string, string>, field: string) => {
        const col = findCol(headers, field);
        return col ? (r[col] ?? "").trim() : "";
      };

      const mapped: MappedRow[] = rows.map((row, idx) => {
        const rawBrand   = get(row, "brand");
        const rawModel   = get(row, "model");
        const { brand, model } = parseBrandModel(rawBrand, rawModel || undefined);
        const rawPurchase   = get(row, "purchaseDate");
        const purchaseDate  = parsePurchaseDate(rawPurchase || get(row, "warranty").replace(/^\d{4}$/, "")) || parsePurchaseDate(rawPurchase);
        const rawWarranty   = get(row, "warranty");
        const warrantyEndDate = parseWarrantyDate(rawWarranty, purchaseDate);
        const rawStatus   = get(row, "status");
        const { status, warning: statusWarn } = mapStatus(rawStatus);

        const empCode    = get(row, "employeeCode");
        const empName    = get(row, "employeeName");
        const department = get(row, "department");

        // Lookup user — try multiple strategies in priority order
        const nkCode = nk(empCode);
        const nkName = nk(empName);
        const matchedUser =
          // 1. Exact ecode match
          (empCode && users.find(u => nk(u.ecode ?? "") === nkCode)) ||
          // 2. Value in "code" column looks like a name → try name lookup too
          (empCode && empCode.includes(" ") && users.find(u => nk(u.full_name) === nkCode)) ||
          // 3. Exact full name match
          (empName && users.find(u => nk(u.full_name) === nkName)) ||
          // 4. Name column contains an ecode-like value
          (empName && !empName.includes(" ") && users.find(u => nk(u.ecode ?? "") === nkName)) ||
          // 5. Partial name match — name starts with the search value
          (empName && users.find(u => nk(u.full_name).startsWith(nkName) && nkName.length >= 4)) ||
          // 6. Name match ignoring middle name (first + last only)
          (empName && (() => {
            const parts = empName.trim().split(/\s+/);
            if (parts.length >= 2) {
              const key = nk(parts[0] + parts[parts.length - 1]);
              return users.find(u => {
                const uparts = u.full_name.trim().split(/\s+/);
                return uparts.length >= 2 && nk(uparts[0] + uparts[uparts.length - 1]) === key;
              });
            }
            return null;
          })()) ||
          null;

        const errors: string[] = [];
        const warnings: string[] = [];

        const assetId   = get(row, "assetId");
        const assetType = mapAssetType(get(row, "assetType"), assetId);
        const isMobile  = assetType === "Mobile";

        // For mobile/phone: use IMEI columns; for laptop/desktop: use serial number
        const rawImei1  = get(row, "imei1") || (isMobile ? get(row, "serialNumber") : "");
        const rawImei2  = get(row, "imei2");
        const serialNumber = isMobile ? rawImei1 : get(row, "serialNumber");

        if (!assetId) errors.push("Asset ID / Tag is required");
        if (!brand)   errors.push("Brand is required");
        if (assetTypeFilter && assetType !== assetTypeFilter)
          errors.push(`Wrong type: this is a ${assetType}, not a ${assetTypeFilter} — will be skipped`);
        if (isMobile && !rawImei1)     warnings.push("IMEI 1 missing");
        else if (!isMobile && !serialNumber && !get(row, "model")) warnings.push("Serial number missing");
        if (!purchaseDate) warnings.push("Could not parse purchase date");
        if (status === "Assigned" && !matchedUser && (empCode || empName))
          warnings.push(`Employee "${empCode || empName}" not found in system — will store name only`);
        if (statusWarn) warnings.push(statusWarn);

        return {
          rowNum:          idx + 2,
          assetId,
          assetType,
          brand,
          model:           model || brand,
          serialNumber,
          imei1:           rawImei1,
          imei2:           rawImei2,
          operatingSystem: get(row, "operatingSystem"),
          processor:       get(row, "processor"),
          ram:             normSize(get(row, "ram")),
          storage:         normSize(get(row, "storage")),
          purchaseDate:    purchaseDate || new Date().toISOString().split("T")[0],
          warrantyEndDate,
          location:        get(row, "location") || "N/A",
          status,
          assignedEmail:   matchedUser?.email ?? (empName || empCode || ""),
          assignedToId:    matchedUser?.id ?? "",
          assignedName:    matchedUser?.full_name ?? empName,
          department:      matchedUser?.department ?? department,
          vendor:          get(row, "vendor"),
          ownership:       mapOwnership(get(row, "ownership")),
          remarks:         [get(row, "condition"), rawStatus !== status ? `Original status: ${rawStatus}` : ""].filter(Boolean).join(" | "),
          employeeCode:    empCode,
          warnings,
          errors,
        };
      });
      setMappedRows(mapped);
      setStep("preview");
    };
    reader.readAsText(f);
  }, [users, toast, assetTypeFilter]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) processFile(f);
  };
  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = "";
  };

  // ── Import ──────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    const validRows = mappedRows.filter(r => r.errors.length === 0);
    if (!validRows.length) return;
    setStep("importing");
    setProgress(0);

    let success = 0;
    let failed  = 0;
    const errorMessages: string[] = [];
    const CHUNK = 50;
    const importedOk: ImportedAssigned[] = [];

    for (let i = 0; i < validRows.length; i += CHUNK) {
      const chunk = validRows.slice(i, i + CHUNK);
      // Per-row token, parallel-indexed with chunk/dbRows so duplicate asset IDs
      // (or any other collisions) cannot cross-contaminate ack tokens.
      const rowTokens: string[] = chunk.map(r => {
        // Require a matched user — `assigned_email` is only persisted when
        // `assignedToId` is set, so we must mirror that condition to keep the
        // DB row's `ack_token` consistent with what we use for the email link.
        const isAssignedWithEmail =
          r.status === "Assigned" && !!r.assignedToId && !!r.assignedEmail && r.assignedEmail.includes("@");
        return isAssignedWithEmail ? crypto.randomUUID() : "";
      });
      const dbRows = chunk.map((r, idx) => {
        const token = rowTokens[idx];
        const isAssignedWithEmail = !!token;
        return ({
        asset_id:          r.assetId,
        asset_type:        r.assetType,
        brand:             r.brand,
        model:             r.model,
        serial_number:     r.assetType === "Mobile" ? "" : (r.serialNumber || ""),
        imei_1:            r.assetType === "Mobile" ? (r.imei1 || null) : null,
        imei_2:            r.assetType === "Mobile" ? (r.imei2 || null) : null,
        // NOT NULL text columns — must be "" not null
        product_number:    "",
        processor:         r.processor        || "",
        ram:               r.ram              || "",
        operating_system:  r.operatingSystem  || "",
        storage:           r.storage          || "",
        sim_number:        "",
        phone_number:      "",
        vendor:            r.vendor           || "",
        ownership:         r.ownership        || "Miles",
        invoice:           "",
        monitor_brand:     "",
        monitor_model:     "",
        monitor_size:      "",
        keyboard:          "",
        mouse:             "",
        cpu:               "",
        others:            "",
        purchase_date:     r.purchaseDate,
        warranty_end_date: r.warrantyEndDate,
        status:            r.status,
        assigned_to:       r.assignedToId     || null,
        assigned_email:    r.assignedToId ? (r.assignedEmail || null) : null,
        assigned_to_name:  r.assignedName     || null,
        assigned_at:       r.status === "Assigned" ? new Date().toISOString() : null,
        // Auto-ack only when there is no email to send to. Otherwise leave pending
        // so admins can either send the ack email or manually mark it acknowledged.
        acknowledged:      r.status === "Assigned" && !isAssignedWithEmail ? true : false,
        acknowledged_at:   r.status === "Assigned" && !isAssignedWithEmail ? new Date().toISOString() : null,
        ack_token:         token || null,
        department:        r.department       || null,
        location:          r.location,
        accessories:       "",
        remarks:           r.remarks          || "",
      });
      });
      const recordOk = (idx: number) => {
        const token = rowTokens[idx];
        if (!token) return;
        const r = chunk[idx];
        importedOk.push({
          assetId:         r.assetId,
          assetType:       r.assetType,
          brand:           r.brand,
          model:           r.model,
          serialNumber:    r.serialNumber,
          processor:       r.processor,
          ram:             r.ram,
          storage:         r.storage,
          operatingSystem: r.operatingSystem,
          imei1:           r.imei1,
          imei2:           r.imei2,
          accessories:     "",
          assignedEmail:   r.assignedEmail,
          assignedName:    r.assignedName,
          ackToken:        token,
          emailState:      "idle",
          ackState:        "idle",
        });
      };
      const { error } = await supabase.from("assets").insert(dbRows);
      if (error) {
        // Try row-by-row for partial success
        for (let j = 0; j < dbRows.length; j++) {
          const row = dbRows[j];
          const { error: e2 } = await supabase.from("assets").insert(row);
          if (e2) {
            failed++;
            if (errorMessages.length < 3) errorMessages.push(`${row.asset_id}: ${e2.message}`);
          } else {
            success++;
            recordOk(j);
          }
        }
      } else {
        success += chunk.length;
        chunk.forEach((_r, j) => recordOk(j));
      }
      setProgress(Math.round(((i + chunk.length) / validRows.length) * 100));
    }

    await refresh();
    setImportedAssigned(importedOk);
    setResults({ success, failed, skipped: mappedRows.filter(r => r.errors.length > 0).length, errorMessages });
    setStep("done");
    if (failed > 0 && errorMessages.length > 0) {
      toast({
        title:       `${failed} row${failed === 1 ? "" : "s"} failed to import`,
        description: errorMessages[0],
        variant:     "destructive",
      });
    }
  };

  const validRows   = mappedRows.filter(r => r.errors.length === 0);
  const warnRows    = mappedRows.filter(r => r.errors.length === 0 && r.warnings.length > 0);
  const errorRows   = mappedRows.filter(r => r.errors.length > 0);
  const assignedRows = validRows.filter(r => r.status === "Assigned");

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/assets">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to Assets
          </Button>
        </Link>
      </div>
      <div>
        <h1 className="text-xl font-bold">Bulk Import Assets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a CSV exported from Google Sheets or Excel — columns are detected automatically.
        </p>
      </div>

      {/* Step progress */}
      <div className="flex items-center gap-2 text-sm flex-wrap">
        {([
          { key: "select",  label: "Select Type" },
          { key: "upload",  label: "Upload" },
          { key: "preview", label: "Review" },
          { key: "done",    label: "Done" },
        ] as const).map(({ key, label }, idx) => {
          const stepOrder = { select: 0, upload: 1, preview: 2, importing: 2, done: 3 };
          const current   = stepOrder[step];
          const mine      = stepOrder[key];
          const active    = current === mine;
          const past      = current > mine;
          return (
            <div key={key} className="flex items-center gap-2">
              {idx > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className={cn("font-medium",
                active ? "text-primary" : past ? "text-muted-foreground line-through" : "text-muted-foreground"
              )}>
                {idx + 1}. {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* ── STEP 0: Select Type ───────────────────────────────────────────────── */}
      {step === "select" && (
        <Card className="max-w-2xl mx-auto">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select asset type for this batch</CardTitle>
            <p className="text-sm text-muted-foreground">Each upload is for one asset type only. Download the template for the type below — the columns match what we'll import.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Asset Type <span className="text-destructive">*</span></label>
              <Select
                value={assetTypeFilter ?? ""}
                onValueChange={(v) => setAssetTypeFilter(v as AssetType)}
              >
                <SelectTrigger className="mt-1.5" data-testid="select-import-type">
                  <SelectValue placeholder="Select asset type…" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {ASSET_TYPE_CATEGORIES.map(({ label, types }) => (
                    <SelectGroup key={label}>
                      <SelectLabel className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</SelectLabel>
                      {types.map((t) => (
                        <SelectItem key={t} value={t}>
                          <span className="inline-flex items-center gap-2">
                            <span aria-hidden>{getAssetEmoji(t)}</span>
                            <span>{t}</span>
                            {TAG_PREFIX[t] && (
                              <span className="text-[10px] text-muted-foreground font-mono">MILES-{TAG_PREFIX[t]}-*</span>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {assetTypeFilter && (() => {
              const style = getTypeStyle(assetTypeFilter);
              const set = columnSetFor(assetTypeFilter);
              const setLabel: Record<ColumnSet,string> = {
                computer:"OS, processor, RAM, storage + serial number",
                mobile:  "IMEI 1 & IMEI 2 columns (no serial number)",
                tab:     "OS, RAM, storage + optional IMEI",
                monitor: "Screen size & resolution",
                network: "IP address & firmware",
                simple:  "Basic asset details (brand, model, serial)",
              };
              return (
                <div className={cn("flex items-start gap-3 rounded-lg border p-3", style.color)}>
                  <span className="text-xl leading-none" aria-hidden>{getAssetEmoji(assetTypeFilter)}</span>
                  <div className="text-sm">
                    <p className="font-semibold">{assetTypeFilter}</p>
                    <p className="text-xs opacity-80 mt-0.5">Template includes: {setLabel[set]}</p>
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              <Button
                variant="outline"
                className="gap-2"
                disabled={!assetTypeFilter}
                onClick={() => assetTypeFilter && downloadTemplate(assetTypeFilter)}
                data-testid="button-download-template"
              >
                <Download className="h-4 w-4" /> Download template
              </Button>
              <Button
                className="gap-2 sm:ml-auto"
                disabled={!assetTypeFilter}
                onClick={() => setStep("upload")}
                data-testid="button-continue-upload"
              >
                Continue to upload →
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 1: Upload ────────────────────────────────────────────────────── */}
      {step === "upload" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            {/* Selected type banner */}
            {assetTypeFilter && (() => {
              const style = getTypeStyle(assetTypeFilter);
              return (
                <div className={cn("flex items-center justify-between rounded-lg border px-4 py-3", style.color)}>
                  <div className="flex items-center gap-2">
                    <style.Icon className="h-4 w-4" />
                    <span className="text-sm font-semibold">Importing: {assetTypeFilter} only</span>
                  </div>
                  <button className="text-xs underline opacity-70 hover:opacity-100" onClick={resetToSelect}>
                    Change type
                  </button>
                </div>
              );
            })()}
            {/* Drop zone */}
            <Card
              className={cn("border-2 border-dashed transition-colors cursor-pointer",
                dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <CardContent className="py-14 flex flex-col items-center gap-3 text-center">
                <div className={cn("h-14 w-14 rounded-full flex items-center justify-center",
                  dragOver ? "bg-primary/20" : "bg-muted"
                )}>
                  <Upload className={cn("h-6 w-6", dragOver ? "text-primary" : "text-muted-foreground")} />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground mt-1">or click to browse</p>
                </div>
                <p className="text-xs text-muted-foreground">Supports .csv files from Google Sheets or Excel</p>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleInput} />
              </CardContent>
            </Card>

            {assetTypeFilter && (
              <Button variant="outline" className="gap-2 w-full sm:w-auto" onClick={() => downloadTemplate(assetTypeFilter)}>
                <Download className="h-4 w-4" /> Download {assetTypeFilter} template
              </Button>
            )}
          </div>

          {/* Column guide */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Info className="h-4 w-4 text-muted-foreground" /> Supported Columns
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {[
                ["Asset Tag",       "Asset ID *"],
                ["Type",            "Laptop / Desktop / Mobile *"],
                ["Brand",           "Brand name *"],
                ["Model",           "Model name"],
                ["Serial Number",   "Serial number"],
                ["Location",        "Office / city"],
                ["OS",              "Operating system"],
                ["Config",          "Processor"],
                ["RAM",             "e.g. 32 → 32 GB"],
                ["ROM / Storage",   "e.g. 512 → 512 GB"],
                ["Purchase Year",   "e.g. 2025 or date"],
                ["Warranty",        "Under Warranty / Expired"],
                ["Asset Status",    "Assigned / Available / etc."],
                ["Asset Condition", "Good / Fair / Damaged"],
                ["Ownership",       "Miles / Miles-GCC / Mojo / Rented / Employee Owned / Company Owned"],
                ["Vendor",          "Supplier name"],
                ["Employee Name",   "For assigned assets"],
                ["Employee Code",   "Matches app user ecode"],
                ["Department",      "Employee department"],
              ].map(([col, desc]) => (
                <div key={col} className="flex justify-between text-xs py-0.5 border-b border-border/40 last:border-0">
                  <span className="font-mono text-muted-foreground">{col}</span>
                  <span className="text-foreground/70 text-right ml-2">{desc}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── STEP 2: Preview ───────────────────────────────────────────────────── */}
      {step === "preview" && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex flex-wrap gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium bg-slate-100 text-slate-700 border-slate-200">
              <FileText className="h-3.5 w-3.5" /> {mappedRows.length} rows parsed
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length} ready to import
            </span>
            {warnRows.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                <AlertTriangle className="h-3.5 w-3.5" /> {warnRows.length} with warnings
              </span>
            )}
            {errorRows.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium bg-red-50 text-red-700 border-red-200">
                <AlertCircle className="h-3.5 w-3.5" /> {errorRows.length} will be skipped (errors)
              </span>
            )}
            {assignedRows.length > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium bg-blue-50 text-blue-700 border-blue-200">
                <UserCheck className="h-3.5 w-3.5" /> {assignedRows.length} assigned
              </span>
            )}
          </div>

          {/* File info + selected-type badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" /> {file?.name}
              </p>
              {assetTypeFilter && (() => {
                const style = getTypeStyle(assetTypeFilter);
                return (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", style.color)}>
                    <style.Icon className="h-3 w-3" /> {assetTypeFilter}
                  </span>
                );
              })()}
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => { setStep("upload"); setMappedRows([]); setFile(null); }}>
              <X className="h-3.5 w-3.5" /> Change file
            </Button>
          </div>

          {/* Preview table */}
          <Card>
            <ScrollArea className="h-[420px]">
              <div className="overflow-x-auto min-w-[900px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground w-8">#</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Asset Tag</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Type</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Brand / Model</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Serial / IMEI</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Location</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Status</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Assigned To</th>
                      <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground">Issues</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {mappedRows.map(row => (
                      <tr
                        key={row.rowNum}
                        className={cn(
                          "hover:bg-muted/30 transition-colors",
                          row.errors.length > 0 ? "bg-red-50/50" : row.warnings.length > 0 ? "bg-amber-50/30" : ""
                        )}
                      >
                        <td className="px-3 py-2 text-muted-foreground">{row.rowNum}</td>
                        <td className="px-3 py-2 font-mono font-medium">{row.assetId || <span className="text-red-500 italic">missing</span>}</td>
                        <td className="px-3 py-2">{row.assetType}</td>
                        <td className="px-3 py-2">
                          <span className="font-medium">{row.brand}</span>
                          {row.model && row.model !== row.brand && <span className="text-muted-foreground"> {row.model}</span>}
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground text-xs">
                          {row.assetType === "Mobile" ? (
                            <div className="space-y-0.5">
                              {row.imei1
                                ? <div><span className="text-foreground/50">1:</span> {row.imei1}</div>
                                : <span className="text-amber-500 not-italic font-sans">IMEI missing</span>}
                              {row.imei2 && <div className="opacity-60"><span className="text-foreground/50">2:</span> {row.imei2}</div>}
                            </div>
                          ) : (row.serialNumber || "—")}
                        </td>
                        <td className="px-3 py-2">{row.location}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className={cn("text-[10px] border font-medium", {
                            "bg-orange-500/10 text-orange-600 border-orange-300": row.status === "In Procurement",
                            "bg-emerald-500/10 text-emerald-700 border-emerald-300": row.status === "Available",
                            "bg-blue-500/10 text-blue-700 border-blue-300":         row.status === "Assigned",
                            "bg-amber-500/10 text-amber-700 border-amber-300":      row.status === "Under Repair",
                            "bg-red-500/10 text-red-700 border-red-300":            row.status === "Lost",
                            "bg-gray-500/10 text-gray-600 border-gray-300":         row.status === "Retired",
                          })}>
                            {row.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          {row.status === "Assigned" && (
                            <div className={cn("text-xs space-y-0.5", row.assignedToId ? "text-emerald-700" : "text-amber-600")}>
                              {row.employeeCode && (
                                <p className="font-mono font-semibold">{row.assignedToId ? "✓ " : ""}{row.employeeCode}</p>
                              )}
                              {row.assignedName && (
                                <p className="text-muted-foreground">{row.assignedName}</p>
                              )}
                              {!row.employeeCode && !row.assignedName && <span>—</span>}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 max-w-[200px]">
                          {row.errors.map((e, i) => (
                            <p key={i} className="text-red-600 flex items-start gap-1"><AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />{e}</p>
                          ))}
                          {row.warnings.map((w, i) => (
                            <p key={i} className="text-amber-600 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" />{w}</p>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ScrollArea>
          </Card>

          {/* Action bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground">
              {errorRows.length > 0 && `${errorRows.length} rows with errors will be skipped. `}
              {validRows.length} rows will be imported.
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setStep("upload"); setMappedRows([]); setFile(null); }}>
                Back
              </Button>
              <Button onClick={handleImport} disabled={validRows.length === 0} className="gap-2">
                Import {validRows.length} {assetTypeFilter ?? ""} Asset{validRows.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP 3: Importing ─────────────────────────────────────────────────── */}
      {step === "importing" && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-5">
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <div className="text-center">
              <p className="font-semibold text-foreground">Importing assets…</p>
              <p className="text-sm text-muted-foreground mt-1">{progress}% complete — please wait</p>
            </div>
            <div className="w-full max-w-sm">
              <Progress value={progress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 4: Done ──────────────────────────────────────────────────────── */}
      {step === "done" && (
        <Card>
          <CardContent className="py-14 flex flex-col items-center gap-6 text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Import complete!</h2>
              <p className="text-sm text-muted-foreground mt-1">Your assets have been added to the system.</p>
            </div>
            <div className="flex flex-wrap gap-4 justify-center">
              <div className="text-center">
                <p className="text-3xl font-bold text-emerald-600">{results.success}</p>
                <p className="text-xs text-muted-foreground mt-1">Imported</p>
              </div>
              {results.failed > 0 && (
                <div className="text-center">
                  <p className="text-3xl font-bold text-red-600">{results.failed}</p>
                  <p className="text-xs text-muted-foreground mt-1">Failed</p>
                </div>
              )}
              {results.skipped > 0 && (
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-600">{results.skipped}</p>
                  <p className="text-xs text-muted-foreground mt-1">Skipped (errors)</p>
                </div>
              )}
            </div>
            {results.failed > 0 && results.errorMessages.length > 0 && (
              <div className="w-full max-w-xl text-left bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3 space-y-1">
                <p className="text-xs font-semibold text-red-700 dark:text-red-300">Why some rows failed:</p>
                {results.errorMessages.map((msg, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-300 font-mono break-words">• {msg}</p>
                ))}
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" onClick={resetToSelect}>
                Import another type
              </Button>
              <Link href="/assets">
                <Button>View all assets</Button>
              </Link>
            </div>
          </CardContent>
          {importedAssigned.length > 0 && (
            <CardContent className="border-t bg-muted/20 pt-6">
              <PendingAckPanel
                items={importedAssigned}
                setItems={setImportedAssigned}
                markAcknowledged={markAcknowledged}
                toast={toast}
              />
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

// ─── Pending acknowledgement panel (shown on Done step) ──────────────────────
interface PendingAckPanelProps {
  items: ImportedAssigned[];
  setItems: React.Dispatch<React.SetStateAction<ImportedAssigned[]>>;
  markAcknowledged: (assetId: string) => Promise<void>;
  toast: ReturnType<typeof useToast>["toast"];
}

function PendingAckPanel({ items, setItems, markAcknowledged, toast }: PendingAckPanelProps) {
  // Group by assignee email — one email is sent per assignee containing all their assets
  const groups = items.reduce<Record<string, ImportedAssigned[]>>((acc, it) => {
    const key = it.assignedEmail.toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(it);
    return acc;
  }, {});

  const pendingCount = items.filter(i => i.ackState !== "done").length;

  const patch = (assetId: string, p: Partial<ImportedAssigned>) =>
    setItems(prev => prev.map(i => i.assetId === assetId ? { ...i, ...p } : i));

  const sendEmailForGroup = async (email: string, groupItems: ImportedAssigned[]) => {
    const targets = groupItems.filter(i => i.emailState !== "sent" && i.ackState !== "done");
    if (targets.length === 0) return;
    targets.forEach(i => patch(i.assetId, { emailState: "sending" }));
    try {
      const first = targets[0];
      const { data, error } = await supabase.functions.invoke("send-bulk-assignment-email", {
        body: {
          toEmail:   first.assignedEmail,
          toName:    first.assignedName || first.assignedEmail,
          reason:    "",
          assets: targets.map(a => ({
            assetId:         a.assetId,
            assetType:       a.assetType,
            brand:           a.brand,
            model:           a.model,
            serialNumber:    a.serialNumber,
            processor:       a.processor,
            ram:             a.ram,
            storage:         a.storage,
            operatingSystem: a.operatingSystem,
            imei1:           a.imei1,
            imei2:           a.imei2,
            accessories:     a.accessories,
            ackToken:        a.ackToken,
          })),
        },
      });
      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string };
      if (d?.error) throw new Error(d.error);
      targets.forEach(i => patch(i.assetId, { emailState: "sent" }));
      toast({
        title: "Acknowledgement email sent",
        description: `Sent ${targets.length} asset${targets.length > 1 ? "s" : ""} to ${email}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send email";
      targets.forEach(i => patch(i.assetId, { emailState: "error" }));
      toast({ title: "Failed to send email", description: msg, variant: "destructive" });
    }
  };

  const sendAllEmails = async () => {
    for (const [email, groupItems] of Object.entries(groups)) {
      await sendEmailForGroup(email, groupItems);
    }
  };

  const markOneAcknowledged = async (it: ImportedAssigned) => {
    patch(it.assetId, { ackState: "saving" });
    try {
      await markAcknowledged(it.assetId);
      patch(it.assetId, { ackState: "done" });
      toast({ title: "Marked acknowledged", description: `${it.assetId} acknowledged on behalf of ${it.assignedName || it.assignedEmail}` });
    } catch (err) {
      patch(it.assetId, { ackState: "idle" });
      toast({
        title: "Failed to mark acknowledged",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-4 text-left max-w-3xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-blue-600" />
            Assigned assets awaiting acknowledgement
            <Badge variant="outline" className="text-[10px]">{pendingCount}</Badge>
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send the acknowledgement email so the assignee can confirm receipt, or mark each asset acknowledged manually if they already received it.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={items.every(i => i.emailState === "sent" || i.ackState === "done" || i.emailState === "sending")}
          onClick={sendAllEmails}
          data-testid="button-send-all-ack-emails"
        >
          <Mail className="h-4 w-4" /> Send all ({Object.keys(groups).length})
        </Button>
      </div>

      <div className="space-y-3">
        {Object.entries(groups).map(([email, groupItems]) => {
          const groupSending = groupItems.some(i => i.emailState === "sending");
          const groupSent = groupItems.every(i => i.emailState === "sent" || i.ackState === "done");
          const firstName = groupItems[0].assignedName || email;
          return (
            <div key={email} className="border rounded-lg p-3 bg-background">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="text-xs">
                  <p className="font-semibold text-foreground">{firstName}</p>
                  <p className="text-muted-foreground font-mono">{email}</p>
                </div>
                <Button
                  size="sm"
                  variant={groupSent ? "outline" : "default"}
                  className="gap-1.5 h-7 text-xs"
                  disabled={groupSending || groupSent}
                  onClick={() => sendEmailForGroup(email, groupItems)}
                  data-testid={`button-send-ack-${email}`}
                >
                  {groupSending ? <Loader2 className="h-3 w-3 animate-spin" /> :
                   groupSent    ? <CheckCircle2 className="h-3 w-3" /> :
                                  <Mail className="h-3 w-3" />}
                  {groupSending ? "Sending…" : groupSent ? "Email sent" : `Send (${groupItems.length})`}
                </Button>
              </div>

              <ul className="divide-y divide-border/60">
                {groupItems.map(it => (
                  <li key={it.assetId} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                    <div className="min-w-0">
                      <p className="font-mono font-medium truncate">{it.assetId}</p>
                      <p className="text-muted-foreground truncate">{it.assetType} · {it.brand} {it.model}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {it.emailState === "sent" && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                          <Mail className="h-3 w-3" /> Sent
                        </span>
                      )}
                      {it.ackState === "done" ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <CheckCircle2 className="h-3 w-3" /> Acknowledged
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 h-6 text-[10px] px-2"
                          disabled={it.ackState === "saving"}
                          onClick={() => markOneAcknowledged(it)}
                          data-testid={`button-mark-ack-${it.assetId}`}
                        >
                          {it.ackState === "saving"
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <Check className="h-3 w-3" />}
                          Mark acknowledged
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
