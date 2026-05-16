import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import { supabase } from "@/lib/supabaseClient";
import milesLogo from "/miles-logo.png";
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, Camera, Upload, X as XIcon, ImageIcon,
} from "lucide-react";

type PageState = "loading" | "upload" | "submitting" | "success" | "already" | "error";

interface AssetInfo {
  assetName: string;
  assetType: string;
  userName:  string;
}

export default function AcknowledgePage() {
  const [, params]     = useRoute("/ack/:token");
  const token          = params?.token ?? "";

  const [state,     setState]     = useState<PageState>("loading");
  const [info,      setInfo]      = useState<AssetInfo>({ assetName: "", assetType: "", userName: "" });
  const [errMsg,    setErrMsg]    = useState("");
  const [files,     setFiles]     = useState<File[]>([]);
  const [previews,  setPreviews]  = useState<string[]>([]);
  const [uploadPct, setUploadPct] = useState(0);
  const fileInputRef              = useRef<HTMLInputElement>(null);

  // Step 1: load asset info without marking acknowledged
  useEffect(() => {
    if (!token) { setState("error"); setErrMsg("Invalid link — no token found."); return; }

    supabase.functions.invoke("acknowledge-receipt", { body: { token, action: "info" } })
      .then(({ data, error }) => {
        if (error) { setState("error"); setErrMsg(error.message); return; }
        const d = data as { success?: boolean; error?: string; alreadyAcknowledged?: boolean; assetName?: string; assetType?: string; userName?: string };
        if (!d.success || d.error) { setState("error"); setErrMsg(d.error ?? "Something went wrong."); return; }
        setInfo({ assetName: d.assetName ?? "", assetType: d.assetType ?? "", userName: d.userName ?? "" });
        setState(d.alreadyAcknowledged ? "already" : "upload");
      })
      .catch(err => { setState("error"); setErrMsg(err?.message ?? "Request failed."); });
  }, [token]);

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const valid: File[] = [];
    for (const f of Array.from(incoming)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 5 * 1024 * 1024) continue; // skip >5 MB
      if (files.length + valid.length >= 5) break;
      valid.push(f);
    }
    if (!valid.length) return;
    const next = [...files, ...valid].slice(0, 5);
    setFiles(next);
    setPreviews(next.map(f => URL.createObjectURL(f)));
  };

  const removeFile = (i: number) => {
    const next = files.filter((_, idx) => idx !== i);
    setFiles(next);
    setPreviews(next.map(f => URL.createObjectURL(f)));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setState("submitting");
    setUploadPct(0);

    try {
      const photoUrls: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext  = file.name.split(".").pop() ?? "jpg";
        const path = `${token}/${i + 1}-${Date.now()}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("asset-photos")
          .upload(path, file, { upsert: true, contentType: file.type });

        if (uploadErr) throw new Error(uploadErr.message);

        const { data: { publicUrl } } = supabase.storage.from("asset-photos").getPublicUrl(path);
        photoUrls.push(publicUrl);
        setUploadPct(Math.round(((i + 1) / files.length) * 70));
      }

      setUploadPct(80);

      // Submit acknowledgement + send email
      const { data, error } = await supabase.functions.invoke("acknowledge-receipt", {
        body: { token, action: "submit", photoUrls },
      });

      if (error) throw new Error(error.message);
      const d = data as { success?: boolean; error?: string; alreadyAcknowledged?: boolean; assetName?: string; userName?: string };
      if (!d.success || d.error) throw new Error(d.error ?? "Submission failed.");

      setUploadPct(100);
      setState(d.alreadyAcknowledged ? "already" : "success");
    } catch (err) {
      setState("error");
      setErrMsg(err instanceof Error ? err.message : "Upload failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-8 flex flex-col items-center gap-5">

        <img src={milesLogo} alt="Miles Education" className="h-10 object-contain" />

        {/* ── Loading ── */}
        {state === "loading" && (
          <>
            <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading asset details…</p>
          </>
        )}

        {/* ── Upload step ── */}
        {state === "upload" && (
          <>
            <div className="w-full text-center">
              <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 mb-3">
                <Camera className="h-3.5 w-3.5" />
                Step 1 of 1 — Upload Asset Photos
              </div>
              <h1 className="text-xl font-bold text-foreground">Acknowledge Receipt</h1>
              {info.userName && (
                <p className="text-muted-foreground text-sm mt-1">
                  Hi <strong>{info.userName}</strong> — you're acknowledging receipt of:
                </p>
              )}
              <p className="text-base font-semibold text-primary mt-1">{info.assetName}</p>
            </div>

            {/* Instructions */}
            <div className="w-full rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <strong>Required:</strong> Please take clear photos of the device and upload them below.
              Your IT team needs photo proof before acknowledging receipt.
            </div>

            {/* Drop zone */}
            <div
              className="w-full border-2 border-dashed border-blue-300 rounded-xl p-6 text-center cursor-pointer hover:bg-blue-50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
            >
              <Upload className="h-8 w-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">Click or drag photos here</p>
              <p className="text-xs text-muted-foreground mt-1">
                JPEG, PNG or WebP · Max 5 MB each · Up to 5 photos
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={e => handleFiles(e.target.files)}
              />
            </div>

            {/* Previews */}
            {previews.length > 0 && (
              <div className="w-full grid grid-cols-3 gap-2">
                {previews.map((src, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden border border-border aspect-square">
                    <img src={src} className="w-full h-full object-cover" alt={`Photo ${i + 1}`} />
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <XIcon className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ))}
                {previews.length < 5 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 hover:bg-accent transition-colors"
                  >
                    <ImageIcon className="h-5 w-5 text-muted-foreground" />
                    <span className="text-[10px] text-muted-foreground">Add more</span>
                  </button>
                )}
              </div>
            )}

            {/* Submit button */}
            <button
              type="button"
              disabled={files.length === 0}
              onClick={handleSubmit}
              className="w-full rounded-xl bg-primary text-white font-semibold py-3 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Submit Acknowledgement {files.length > 0 && `(${files.length} photo${files.length > 1 ? "s" : ""})`}
            </button>

            {files.length === 0 && (
              <p className="text-xs text-muted-foreground -mt-2">You must upload at least 1 photo to proceed.</p>
            )}
          </>
        )}

        {/* ── Submitting ── */}
        {state === "submitting" && (
          <>
            <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
            <div className="w-full text-center">
              <p className="font-semibold text-foreground mb-2">
                {uploadPct < 80 ? "Uploading photos…" : "Recording acknowledgement…"}
              </p>
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{uploadPct}%</p>
            </div>
          </>
        )}

        {/* ── Success ── */}
        {state === "success" && (
          <>
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground mb-1">Receipt Acknowledged!</h1>
              {info.userName && <p className="text-muted-foreground text-sm mb-1">Hi <strong>{info.userName}</strong>,</p>}
              <p className="text-muted-foreground text-sm">
                You have successfully acknowledged receipt of <strong>{info.assetName}</strong>.
                Your photos have been sent to the IT team.
              </p>
            </div>
            <div className="w-full rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
              Your IT team has been notified with your photos. If you have any issues with the device, contact{" "}
              <a href="mailto:help.desk@mileseducation.com" className="font-semibold underline">
                help.desk@mileseducation.com
              </a>
            </div>
          </>
        )}

        {/* ── Already acknowledged ── */}
        {state === "already" && (
          <>
            <AlertCircle className="h-16 w-16 text-amber-500" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground mb-1">Already Acknowledged</h1>
              <p className="text-muted-foreground text-sm">
                You have already acknowledged receipt of <strong>{info.assetName || "this asset"}</strong>.
                No further action is needed.
              </p>
            </div>
          </>
        )}

        {/* ── Error ── */}
        {state === "error" && (
          <>
            <XCircle className="h-16 w-16 text-destructive" />
            <div className="text-center">
              <h1 className="text-xl font-bold text-foreground mb-1">Something went wrong</h1>
              <p className="text-muted-foreground text-sm">{errMsg || "This acknowledgement link is invalid or has expired."}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Contact{" "}
              <a href="mailto:help.desk@mileseducation.com" className="underline">help.desk@mileseducation.com</a>
            </p>
          </>
        )}

        <p className="text-[11px] text-muted-foreground border-t border-border pt-4 w-full text-center">
          Miles Education · IT Asset Management
        </p>
      </div>
    </div>
  );
}
