import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2, ChevronRight, AlertCircle, Loader2, Check, X, ToggleLeft, ToggleRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";
import { useAssetConfig, type AssetTypeConfig, type AssetFieldConfig, type FieldType, type GroupName } from "@/context/AssetConfigContext";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

// ─── Constants ────────────────────────────────────────────────────────────────

const GROUP_OPTIONS: GroupName[] = ["Main Devices", "Accessories", "Fixed Assets"];

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text",        label: "Text" },
  { value: "number",      label: "Number" },
  { value: "date",        label: "Date" },
  { value: "dropdown",    label: "Dropdown" },
  { value: "multi_select",label: "Multi-select" },
  { value: "checkbox",    label: "Checkbox" },
  { value: "url",         label: "URL" },
  { value: "file_upload", label: "File Upload" },
];

const FIELD_TYPE_COLORS: Record<FieldType, string> = {
  text:         "bg-slate-100 text-slate-700",
  number:       "bg-blue-50 text-blue-700",
  date:         "bg-purple-50 text-purple-700",
  dropdown:     "bg-amber-50 text-amber-700",
  multi_select: "bg-orange-50 text-orange-700",
  checkbox:     "bg-green-50 text-green-700",
  url:          "bg-cyan-50 text-cyan-700",
  file_upload:  "bg-pink-50 text-pink-700",
};

const COMMON_EMOJIS = ["💻","🖥️","📱","📲","🪪","📷","🧠","📦","⌨️","🖱️","🎧","💾","🔊","🧰","🖨️","📡","🗄️","📹","📺","🎥","📶","🔒","📌","🔧","⚙️","🖇️"];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function labelToKey(label: string): string {
  const parts = label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return parts.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join("");
}

async function logAudit(
  action: string,
  entityType: string,
  entityId: string,
  description: string,
  metadata?: Record<string, unknown>,
) {
  try {
    await supabase.from("audit_logs").insert({
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
      metadata: metadata ?? null,
    });
  } catch {
    // Audit log failure is non-fatal
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

interface TypeRowProps {
  type: AssetTypeConfig;
  selected: boolean;
  onClick: () => void;
}

function TypeRow({ type, selected, onClick }: TypeRowProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm text-left transition-colors",
        selected
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className="text-base flex-shrink-0" aria-hidden>{type.emoji}</span>
      <span className="flex-1 truncate">{type.name}</span>
      {!type.is_active && (
        <span className="text-xs text-muted-foreground font-normal flex-shrink-0">off</span>
      )}
      <ChevronRight className={cn("h-3.5 w-3.5 flex-shrink-0 transition-opacity", selected ? "opacity-100 text-primary" : "opacity-30")} />
    </button>
  );
}

interface FieldRowProps {
  field: AssetFieldConfig;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisible: () => void;
  onToggleRequired: () => void;
}

function FieldRow({ field, onEdit, onDelete, onToggleVisible, onToggleRequired }: FieldRowProps) {
  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-muted/30 group transition-colors border border-transparent hover:border-card-border/50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{field.label}</span>
          <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-md", FIELD_TYPE_COLORS[field.field_type])}>
            {FIELD_TYPES.find(t => t.value === field.field_type)?.label ?? field.field_type}
          </span>
          {field.is_required && (
            <span className="text-[10px] font-semibold text-destructive px-1.5 py-0.5 rounded-md bg-destructive/10">Required</span>
          )}
          {field.section && (
            <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/60">{field.section}</span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{field.field_key}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onToggleRequired}
          title={field.is_required ? "Mark optional" : "Mark required"}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors text-xs font-medium"
        >
          {field.is_required ? "Req" : "Opt"}
        </button>
        <button
          onClick={onToggleVisible}
          title={field.is_visible ? "Hide field" : "Show field"}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {field.is_visible ? <ToggleRight className="h-4 w-4 text-emerald-500" /> : <ToggleLeft className="h-4 w-4" />}
        </button>
        <button onClick={onEdit} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Add/Edit Type Dialog ─────────────────────────────────────────────────────

interface TypeDialogProps {
  open:      boolean;
  onClose:   () => void;
  onSaved:   () => void;
  existing?: AssetTypeConfig;
}

function TypeDialog({ open, onClose, onSaved, existing }: TypeDialogProps) {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const [name,      setName]      = useState(existing?.name       ?? "");
  const [group,     setGroup]     = useState<GroupName>(existing?.group_name ?? "Main Devices");
  const [emoji,     setEmoji]     = useState(existing?.emoji      ?? "📦");
  const [saving,    setSaving]    = useState(false);
  const isEdit = !!existing;

  const handleOpen = (o: boolean) => {
    if (o) {
      setName(existing?.name       ?? "");
      setGroup(existing?.group_name ?? "Main Devices");
      setEmoji(existing?.emoji      ?? "📦");
    }
  };

  const handleSave = async () => {
    if (!name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    if (isEdit) {
      const { error } = await supabase
        .from("schema_asset_types")
        .update({ name: name.trim(), group_name: group, emoji })
        .eq("id", existing!.id);
      if (error) { toast({ title: "Failed to update", description: error.message, variant: "destructive" }); setSaving(false); return; }
      await logAudit("schema_config.asset_type.updated", "schema_asset_types", existing!.id, `Updated asset type: ${name.trim()}`, { name: name.trim(), group_name: group, emoji });
    } else {
      const { data, error } = await supabase
        .from("schema_asset_types")
        .insert({ name: name.trim(), group_name: group, emoji, created_by: currentUser?.userId })
        .select()
        .single();
      if (error) { toast({ title: "Failed to create", description: error.message, variant: "destructive" }); setSaving(false); return; }
      await logAudit("schema_config.asset_type.created", "schema_asset_types", (data as AssetTypeConfig).id, `Created asset type: ${name.trim()}`, { name: name.trim(), group_name: group, emoji });
    }
    setSaving(false);
    toast({ title: isEdit ? "Asset type updated" : "Asset type created", description: name.trim() });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); handleOpen(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Asset Type" : "Add Asset Type"}</DialogTitle>
          <DialogDescription>{isEdit ? "Update the name, group, and emoji for this asset type." : "Create a new asset type that will appear in the asset form."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Drone, Tablet, UPS" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Group</Label>
            <Select value={group} onValueChange={v => setGroup(v as GroupName)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUP_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Emoji</Label>
            <div className="flex gap-2">
              <Input value={emoji} onChange={e => setEmoji(e.target.value)} className="w-20 text-center text-xl" maxLength={4} />
              <div className="flex flex-wrap gap-1.5 flex-1">
                {COMMON_EMOJIS.map(e => (
                  <button
                    key={e} type="button"
                    onClick={() => setEmoji(e)}
                    className={cn("text-lg rounded-lg p-1 hover:bg-muted transition-colors", emoji === e && "bg-primary/10 ring-1 ring-primary")}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Type an emoji or click one above.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : isEdit ? "Save Changes" : "Add Type"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add/Edit Field Dialog ────────────────────────────────────────────────────

interface FieldDialogProps {
  open:        boolean;
  onClose:     () => void;
  onSaved:     () => void;
  typeId:      string;
  typeName:    string;
  existing?:   AssetFieldConfig;
}

function FieldDialog({ open, onClose, onSaved, typeId, typeName, existing }: FieldDialogProps) {
  const { toast } = useToast();
  const isEdit = !!existing;

  const [label,       setLabel]       = useState(existing?.label        ?? "");
  const [fieldKey,    setFieldKey]    = useState(existing?.field_key     ?? "");
  const [fieldType,   setFieldType]   = useState<FieldType>(existing?.field_type ?? "text");
  const [section,     setSection]     = useState(existing?.section       ?? "");
  const [placeholder, setPlaceholder] = useState(existing?.placeholder   ?? "");
  const [helpText,    setHelpText]    = useState(existing?.help_text     ?? "");
  const [isRequired,  setIsRequired]  = useState(existing?.is_required   ?? false);
  const [isVisible,   setIsVisible]   = useState(existing?.is_visible    ?? true);
  const [optionsText, setOptionsText] = useState(existing?.options?.join("\n") ?? "");
  const [saving,      setSaving]      = useState(false);
  const [keyEdited,   setKeyEdited]   = useState(false);

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!keyEdited) setFieldKey(labelToKey(v));
  };

  const handleReset = () => {
    setLabel(existing?.label ?? "");
    setFieldKey(existing?.field_key ?? "");
    setFieldType(existing?.field_type ?? "text");
    setSection(existing?.section ?? "");
    setPlaceholder(existing?.placeholder ?? "");
    setHelpText(existing?.help_text ?? "");
    setIsRequired(existing?.is_required ?? false);
    setIsVisible(existing?.is_visible ?? true);
    setOptionsText(existing?.options?.join("\n") ?? "");
    setKeyEdited(false);
  };

  const hasOptions = fieldType === "dropdown" || fieldType === "multi_select";

  const handleSave = async () => {
    if (!label.trim())    { toast({ title: "Label is required",     variant: "destructive" }); return; }
    if (!fieldKey.trim()) { toast({ title: "Field key is required", variant: "destructive" }); return; }

    const options = hasOptions
      ? optionsText.split("\n").map(s => s.trim()).filter(Boolean)
      : null;

    setSaving(true);
    const payload = {
      label:       label.trim(),
      field_key:   fieldKey.trim(),
      field_type:  fieldType,
      section:     section.trim() || null,
      placeholder: placeholder.trim() || null,
      help_text:   helpText.trim() || null,
      is_required: isRequired,
      is_visible:  isVisible,
      options:     options,
    };

    if (isEdit) {
      const { error } = await supabase.from("schema_asset_fields").update(payload).eq("id", existing!.id);
      if (error) { toast({ title: "Failed to update field", description: error.message, variant: "destructive" }); setSaving(false); return; }
      await logAudit("schema_config.field.updated", "schema_asset_fields", existing!.id, `Updated field "${label}" on ${typeName}`, payload as Record<string, unknown>);
    } else {
      const { data, error } = await supabase
        .from("schema_asset_fields")
        .insert({ ...payload, asset_type_id: typeId })
        .select().single();
      if (error) { toast({ title: "Failed to add field", description: error.message, variant: "destructive" }); setSaving(false); return; }
      await logAudit("schema_config.field.created", "schema_asset_fields", (data as AssetFieldConfig).id, `Added field "${label}" to ${typeName}`, payload as Record<string, unknown>);
    }
    setSaving(false);
    toast({ title: isEdit ? "Field updated" : "Field added", description: label.trim() });
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) { onClose(); handleReset(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Field" : `Add Field — ${typeName}`}</DialogTitle>
          <DialogDescription>{isEdit ? "Update this field's configuration." : "Define a new field for this asset type."}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-4 py-2 pr-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Label <span className="text-destructive">*</span></Label>
                <Input value={label} onChange={e => handleLabelChange(e.target.value)} placeholder="e.g. IMEI Number" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label>Field Key <span className="text-destructive">*</span></Label>
                <Input
                  value={fieldKey}
                  onChange={e => { setFieldKey(e.target.value); setKeyEdited(true); }}
                  placeholder="e.g. imeiNumber"
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">camelCase, no spaces</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Field Type</Label>
                <Select value={fieldType} onValueChange={v => setFieldType(v as FieldType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Section / Group</Label>
                <Input value={section} onChange={e => setSection(e.target.value)} placeholder="e.g. Mobile Details" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Placeholder</Label>
              <Input value={placeholder} onChange={e => setPlaceholder(e.target.value)} placeholder="Helper text shown inside the input" />
            </div>

            <div className="space-y-1.5">
              <Label>Help Text</Label>
              <Input value={helpText} onChange={e => setHelpText(e.target.value)} placeholder="Short description below the field" />
            </div>

            {hasOptions && (
              <div className="space-y-1.5">
                <Label>Options <span className="text-xs text-muted-foreground">(one per line)</span></Label>
                <Textarea
                  value={optionsText}
                  onChange={e => setOptionsText(e.target.value)}
                  rows={4}
                  placeholder={"Option 1\nOption 2\nOption 3"}
                  className="font-mono text-sm"
                />
              </div>
            )}

            <Separator />

            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Switch id="field-required" checked={isRequired} onCheckedChange={setIsRequired} />
                <Label htmlFor="field-required" className="cursor-pointer">Required</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="field-visible" checked={isVisible} onCheckedChange={setIsVisible} />
                <Label htmlFor="field-visible" className="cursor-pointer">Visible</Label>
              </div>
            </div>
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); handleReset(); }} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !label.trim() || !fieldKey.trim()}>
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : isEdit ? "Save Changes" : "Add Field"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AssetTypesConfig() {
  const { toast } = useToast();
  const { currentUser } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";
  const canEdit = currentUser?.role === "super_admin" || currentUser?.role === "it_admin";

  const { assetTypes, assetFields, loading, error, reload } = useAssetConfig();

  const [selectedTypeId,  setSelectedTypeId]  = useState<string | null>(null);
  const [addTypeOpen,     setAddTypeOpen]      = useState(false);
  const [editTypeTarget,  setEditTypeTarget]   = useState<AssetTypeConfig | null>(null);
  const [addFieldOpen,    setAddFieldOpen]     = useState(false);
  const [editFieldTarget, setEditFieldTarget]  = useState<AssetFieldConfig | null>(null);
  const [deleteFieldId,   setDeleteFieldId]    = useState<string | null>(null);
  const [toggleTypeTarget,setToggleTypeTarget] = useState<AssetTypeConfig | null>(null);
  const [saving,          setSaving]           = useState(false);

  const selectedType   = assetTypes.find(t => t.id === selectedTypeId) ?? null;
  const selectedFields = selectedTypeId
    ? assetFields.filter(f => f.asset_type_id === selectedTypeId).sort((a, b) => a.sort_order - b.sort_order)
    : [];

  // Group types for left panel (show all, including inactive)
  const groupedAll = (["Main Devices", "Accessories", "Fixed Assets"] as const).map(g => ({
    label: g,
    types: assetTypes.filter(t => t.group_name === g),
  })).filter(g => g.types.length > 0);

  const handleToggleActive = useCallback(async () => {
    if (!toggleTypeTarget) return;
    setSaving(true);
    const next = !toggleTypeTarget.is_active;
    const { error: err } = await supabase
      .from("schema_asset_types")
      .update({ is_active: next })
      .eq("id", toggleTypeTarget.id);
    setSaving(false);
    setToggleTypeTarget(null);
    if (err) { toast({ title: "Failed to update", description: err.message, variant: "destructive" }); return; }
    await logAudit(
      next ? "schema_config.asset_type.activated" : "schema_config.asset_type.deactivated",
      "schema_asset_types", toggleTypeTarget.id,
      `${next ? "Activated" : "Deactivated"} asset type: ${toggleTypeTarget.name}`,
    );
    toast({ title: next ? "Asset type activated" : "Asset type deactivated", description: toggleTypeTarget.name });
    reload();
  }, [toggleTypeTarget, toast, reload]);

  const handleToggleFieldVisible = useCallback(async (field: AssetFieldConfig) => {
    const { error: err } = await supabase
      .from("schema_asset_fields")
      .update({ is_visible: !field.is_visible })
      .eq("id", field.id);
    if (err) { toast({ title: "Failed to update", description: err.message, variant: "destructive" }); return; }
    reload();
  }, [toast, reload]);

  const handleToggleFieldRequired = useCallback(async (field: AssetFieldConfig) => {
    const { error: err } = await supabase
      .from("schema_asset_fields")
      .update({ is_required: !field.is_required })
      .eq("id", field.id);
    if (err) { toast({ title: "Failed to update", description: err.message, variant: "destructive" }); return; }
    reload();
  }, [toast, reload]);

  const handleDeleteField = useCallback(async () => {
    if (!deleteFieldId) return;
    setSaving(true);
    const field = assetFields.find(f => f.id === deleteFieldId);
    const { error: err } = await supabase.from("schema_asset_fields").delete().eq("id", deleteFieldId);
    setSaving(false);
    setDeleteFieldId(null);
    if (err) { toast({ title: "Failed to delete field", description: err.message, variant: "destructive" }); return; }
    if (field) {
      await logAudit("schema_config.field.deleted", "schema_asset_fields", deleteFieldId, `Deleted field "${field.label}"`, { field_key: field.field_key });
    }
    toast({ title: "Field deleted" });
    reload();
  }, [deleteFieldId, assetFields, toast, reload]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading configuration…</span>
      </div>
    );
  }

  if (error) {
    const isPermissionError = error.toLowerCase().includes("permission denied");
    const isMissingTable    = error.toLowerCase().includes("does not exist") || error.toLowerCase().includes("schema cache");
    const grantSql = `GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON schema_asset_types  TO anon, authenticated;
GRANT SELECT ON schema_asset_fields TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON schema_asset_types  TO authenticated;
GRANT INSERT, UPDATE, DELETE ON schema_asset_fields TO authenticated;`;

    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-5 py-4 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">Could not load configuration</p>
          <p className="text-xs text-muted-foreground mt-0.5">{error}</p>

          {isMissingTable && (
            <p className="text-xs text-muted-foreground mt-1">
              Run migration <code className="font-mono bg-muted px-1 rounded">001_schema_asset_types.sql</code> in Supabase SQL Editor first.
            </p>
          )}

          {isPermissionError && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">
                The tables exist but are missing role grants. Run this in <strong>Supabase → SQL Editor</strong>:
              </p>
              <pre className="mt-1.5 text-[10px] font-mono bg-muted/80 border border-border rounded-md px-3 py-2 overflow-x-auto whitespace-pre leading-relaxed">
                {grantSql}
              </pre>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={reload} className="mt-3">Retry</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">

      {/* ── Left: Type List ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md shadow-sm overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-card-border/50">
          <p className="text-sm font-semibold text-foreground">Asset Types</p>
          <p className="text-xs text-muted-foreground mt-0.5">{assetTypes.filter(t => t.is_active).length} active · {assetTypes.length} total</p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-4">
            {groupedAll.map(({ label, types }) => (
              <div key={label}>
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                <div className="space-y-0.5">
                  {types.map(type => (
                    <TypeRow
                      key={type.id}
                      type={type}
                      selected={selectedTypeId === type.id}
                      onClick={() => setSelectedTypeId(type.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        {canEdit && (
          <div className="p-3 border-t border-card-border/50">
            <Button variant="outline" size="sm" className="w-full gap-2" onClick={() => setAddTypeOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add Asset Type
            </Button>
          </div>
        )}
      </div>

      {/* ── Right: Type Detail ──────────────────────────────────────────── */}
      <div>
        {!selectedType ? (
          <div className="rounded-2xl border border-dashed border-card-border bg-muted/20 flex flex-col items-center justify-center py-24 gap-3 text-center">
            <div className="text-4xl">📋</div>
            <p className="text-sm font-medium text-foreground">Select an asset type</p>
            <p className="text-xs text-muted-foreground max-w-xs">Choose a type from the list to view and manage its configuration and fields.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-card-border/70 bg-card/85 backdrop-blur-md shadow-sm overflow-hidden">

            {/* Header */}
            <div className="px-5 py-4 border-b border-card-border/50 flex items-center gap-4">
              <span className="text-3xl" aria-hidden>{selectedType.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-semibold text-foreground">{selectedType.name}</h3>
                  <Badge
                    variant="secondary"
                    className={cn("text-xs", selectedType.is_active
                      ? "bg-emerald-500/15 text-emerald-700"
                      : "bg-gray-500/15 text-gray-500")}
                  >
                    {selectedType.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Badge variant="secondary" className="text-xs bg-blue-50 text-blue-700">
                    {selectedType.group_name}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{selectedFields.length} field{selectedFields.length !== 1 ? "s" : ""} configured</p>
              </div>
              {canEdit && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setEditTypeTarget(selectedType)}
                    className="gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    onClick={() => setToggleTypeTarget(selectedType)}
                    className={cn("gap-1.5", selectedType.is_active ? "text-amber-600 hover:text-amber-700" : "text-emerald-600 hover:text-emerald-700")}
                  >
                    {selectedType.is_active ? <ToggleLeft className="h-3.5 w-3.5" /> : <ToggleRight className="h-3.5 w-3.5" />}
                    {selectedType.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              )}
            </div>

            {/* Fields */}
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Fields</p>
                  <p className="text-xs text-muted-foreground">Fields that appear in the Add / Edit Asset form for this type.</p>
                </div>
                {canEdit && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddFieldOpen(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Field
                  </Button>
                )}
              </div>

              {selectedFields.length === 0 ? (
                <div className="rounded-xl border border-dashed border-card-border/60 bg-muted/20 py-10 text-center">
                  <p className="text-sm text-muted-foreground">No fields configured for this type.</p>
                  {canEdit && (
                    <Button variant="ghost" size="sm" className="mt-3 gap-1.5" onClick={() => setAddFieldOpen(true)}>
                      <Plus className="h-3.5 w-3.5" />
                      Add your first field
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {/* Group fields by section */}
                  {Array.from(new Set(selectedFields.map(f => f.section ?? ""))).map(section => {
                    const sectionFields = selectedFields.filter(f => (f.section ?? "") === section);
                    return (
                      <div key={section || "__no_section__"}>
                        {section && (
                          <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {section}
                          </p>
                        )}
                        {sectionFields.map(field => (
                          <FieldRow
                            key={field.id}
                            field={field}
                            onEdit={() => setEditFieldTarget(field)}
                            onDelete={() => setDeleteFieldId(field.id)}
                            onToggleVisible={() => handleToggleFieldVisible(field)}
                            onToggleRequired={() => handleToggleFieldRequired(field)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {!canEdit && (
                <p className="text-xs text-muted-foreground mt-4 text-center">
                  Only Super Admin and IT Admin can modify configuration.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}

      <TypeDialog
        open={addTypeOpen}
        onClose={() => setAddTypeOpen(false)}
        onSaved={reload}
      />

      {editTypeTarget && (
        <TypeDialog
          open={!!editTypeTarget}
          onClose={() => setEditTypeTarget(null)}
          onSaved={reload}
          existing={editTypeTarget}
        />
      )}

      {selectedType && (
        <FieldDialog
          open={addFieldOpen}
          onClose={() => setAddFieldOpen(false)}
          onSaved={reload}
          typeId={selectedType.id}
          typeName={selectedType.name}
        />
      )}

      {editFieldTarget && selectedType && (
        <FieldDialog
          open={!!editFieldTarget}
          onClose={() => setEditFieldTarget(null)}
          onSaved={reload}
          typeId={selectedType.id}
          typeName={selectedType.name}
          existing={editFieldTarget}
        />
      )}

      {/* Toggle active confirm */}
      <AlertDialog open={!!toggleTypeTarget} onOpenChange={v => { if (!v) setToggleTypeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTypeTarget?.is_active ? "Deactivate" : "Activate"} "{toggleTypeTarget?.name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTypeTarget?.is_active
                ? "This type will be hidden from the Add Asset form. Existing assets of this type are NOT affected."
                : "This type will reappear in the Add Asset form and become available for new assets."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleToggleActive} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {toggleTypeTarget?.is_active ? "Deactivate" : "Activate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete field confirm */}
      <AlertDialog open={!!deleteFieldId} onOpenChange={v => { if (!v) setDeleteFieldId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this field?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the field from the configuration only. Any data already saved for this field on existing assets is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteField} disabled={saving} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete Field
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
