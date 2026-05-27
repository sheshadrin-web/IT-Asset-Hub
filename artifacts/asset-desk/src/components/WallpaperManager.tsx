import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Upload, Check, Send, RefreshCw, ImageIcon, CheckCircle2, AlertCircle, Clock,
} from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface Wallpaper {
  id:           string;
  name:         string;
  public_url:   string;
  sha256:       string;
  is_active:    boolean;
  file_size:    number | null;
  uploaded_at:  string;
}
interface WallpaperStatus {
  id:            string;
  wallpaper_id:  string | null;
  status:        "applied" | "failed" | "skipped" | "pending";
  error_message: string | null;
  applied_at:    string;
}

interface Props {
  assetId:           string;
  managedDeviceId:   string | null;   // null = agent not installed yet
  agentInstalled:    boolean;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export default function WallpaperManager({ assetId, managedDeviceId, agentInstalled }: Props) {
  const { role } = useAuth();
  const isSuperAdmin = role === "super_admin";
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [wallpapers, setWallpapers] = useState<Wallpaper[]>([]);
  const [statuses, setStatuses]     = useState<WallpaperStatus[]>([]);
  const [loading, setLoading]       = useState(true);
  const [busy, setBusy]             = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const [w, s] = await Promise.all([
      supabase.from("wallpapers")
        .select("id, name, public_url, sha256, is_active, file_size, uploaded_at")
        .order("uploaded_at", { ascending: false })
        .limit(8),
      managedDeviceId
        ? supabase.from("device_wallpaper_status")
            .select("id, wallpaper_id, status, error_message, applied_at")
            .eq("managed_device_id", managedDeviceId)
            .order("applied_at", { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] as WallpaperStatus[], error: null }),
    ]);
    setWallpapers((w.data as Wallpaper[]) ?? []);
    setStatuses((s.data as WallpaperStatus[]) ?? []);
    setLoading(false);
  }, [managedDeviceId]);

  useEffect(() => { void load(); }, [load]);

  async function handleUpload(file: File, setActive: boolean) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image file (PNG / JPG / BMP)", variant: "destructive" });
      return;
    }
    setBusy(true);
    setUploadProgress("Hashing…");
    try {
      const buf = await file.arrayBuffer();
      const sha = await sha256Hex(buf);
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${Date.now()}_${sha.slice(0, 8)}.${ext}`;

      setUploadProgress("Uploading…");
      const up = await supabase.storage.from("wallpapers").upload(path, file, {
        cacheControl: "31536000",
        upsert: false,
        contentType: file.type,
      });
      if (up.error) throw up.error;

      const { data: pub } = supabase.storage.from("wallpapers").getPublicUrl(path);

      setUploadProgress("Registering…");
      const { data, error } = await supabase.rpc("wallpaper_register", {
        p_name:         file.name,
        p_storage_path: path,
        p_public_url:   pub.publicUrl,
        p_sha256:       sha,
        p_mime_type:    file.type,
        p_file_size:    file.size,
        p_set_active:   setActive,
      });
      if (error || !data?.success) throw new Error(error?.message || data?.error || "register failed");
      toast({ title: setActive ? "Wallpaper uploaded & set active" : "Wallpaper uploaded" });
      await load();
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false); setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function setActive(id: string) {
    setBusy(true);
    const { data, error } = await supabase.rpc("wallpaper_set_active", { p_wallpaper_id: id });
    setBusy(false);
    if (error || !data?.success) {
      toast({ title: "Failed to set active", description: error?.message ?? data?.error, variant: "destructive" });
      return;
    }
    toast({ title: "Set as active wallpaper" });
    await load();
  }

  async function pushToDevice() {
    setBusy(true);
    const { data, error } = await supabase.rpc("wallpaper_push_to_asset", { p_asset_id: assetId });
    setBusy(false);
    if (error || !data?.success) {
      toast({
        title: "Failed to push",
        description: error?.message ?? data?.error ?? "agent not installed yet",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Push queued — device will apply on next sync (≤5 min)" });
  }

  const active = wallpapers.find(w => w.is_active) ?? null;
  const lastStatus = statuses[0];

  // Read-only view for non-admins
  if (!isSuperAdmin) {
    if (!active && !lastStatus) return null;
    return (
      <div className="border-t pt-3 mt-2">
        <p className="text-[11px] font-medium text-muted-foreground mb-2">Company Wallpaper</p>
        {active && (
          <div className="flex items-center gap-3">
            <img src={active.public_url} alt={active.name}
                 className="w-14 h-9 rounded object-cover border bg-muted" />
            <div className="text-xs">
              <div className="font-medium">{active.name}</div>
              <div className="text-muted-foreground">Active company wallpaper</div>
            </div>
          </div>
        )}
        {lastStatus && <StatusRow s={lastStatus} />}
      </div>
    );
  }

  return (
    <div className="border-t pt-3 mt-2 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">Company Wallpaper</p>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs"
                onClick={() => void load()} disabled={busy || loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", (busy || loading) && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Active wallpaper preview */}
      {active ? (
        <div className="flex items-center gap-3 rounded border bg-muted/40 p-2">
          <img src={active.public_url} alt={active.name}
               className="w-20 h-12 rounded object-cover border bg-white" />
          <div className="flex-1 min-w-0 text-xs">
            <div className="font-medium truncate">{active.name}</div>
            <div className="text-muted-foreground">
              Active · {active.file_size ? `${Math.round(active.file_size / 1024)} KB` : "—"}
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-700
                            px-2 py-0.5 text-[10px] font-medium">
            <CheckCircle2 className="h-3 w-3" /> Active
          </span>
        </div>
      ) : (
        <div className="rounded border border-dashed bg-muted/30 p-3 text-center text-xs text-muted-foreground">
          <ImageIcon className="h-4 w-4 mx-auto mb-1 opacity-60" />
          No active wallpaper yet. Upload the Miles logo below.
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/bmp,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleUpload(f, /*setActive*/ true);
          }}
          data-testid="input-wallpaper-file"
        />
        <Button
          className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          data-testid="button-upload-wallpaper"
        >
          <Upload className="h-4 w-4" />
          {uploadProgress ?? "Upload Miles Wallpaper"}
        </Button>
        <Button
          variant="outline"
          className="w-full gap-2"
          onClick={() => void pushToDevice()}
          disabled={busy || !agentInstalled || !active}
          data-testid="button-push-wallpaper"
          title={!agentInstalled ? "Install the agent first" : !active ? "Set an active wallpaper first" : ""}
        >
          <Send className="h-4 w-4" /> Push Wallpaper to Device
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Upload sets the chosen image as the active company wallpaper. On the next agent sync (within 5 min),
        every managed device fetches it and applies it to the desktop. Original image quality is preserved
        (SHA-256 verified). Click <b>Push</b> to apply within seconds instead of waiting.
      </p>

      {/* Previous wallpapers — quick switch */}
      {wallpapers.length > 1 && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Recent Uploads</p>
          <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
            {wallpapers.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => !w.is_active && void setActive(w.id)}
                disabled={busy || w.is_active}
                className={cn(
                  "relative aspect-video rounded border overflow-hidden bg-muted group",
                  w.is_active
                    ? "ring-2 ring-emerald-500 cursor-default"
                    : "hover:ring-2 hover:ring-violet-400 cursor-pointer"
                )}
                title={w.is_active ? `${w.name} (active)` : `Set "${w.name}" as active`}
              >
                <img src={w.public_url} alt={w.name} className="w-full h-full object-cover" />
                {w.is_active && (
                  <span className="absolute top-0.5 right-0.5 bg-emerald-500 text-white rounded-full p-0.5">
                    <Check className="h-2.5 w-2.5" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Wallpaper status log */}
      {agentInstalled && (
        <div>
          <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Wallpaper Status</p>
          {statuses.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              No wallpaper sync attempts yet. After the agent's next sync, status will appear here.
            </p>
          ) : (
            <div className="space-y-1">
              {statuses.map(s => <StatusRow key={s.id} s={s} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusRow({ s }: { s: WallpaperStatus }) {
  const Icon = s.status === "applied" ? CheckCircle2
             : s.status === "failed"  ? AlertCircle
             :                          Clock;
  const color = s.status === "applied" ? "text-emerald-600"
              : s.status === "failed"  ? "text-red-600"
              :                          "text-amber-600";
  const when = new Date(s.applied_at).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "short",
  });
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", color)} />
      <div className="flex-1 min-w-0">
        <span className={cn("font-medium capitalize", color)}>{s.status}</span>
        <span className="text-muted-foreground"> · {when}</span>
        {s.error_message && (
          <div className="text-red-600 break-words">{s.error_message}</div>
        )}
      </div>
    </div>
  );
}
