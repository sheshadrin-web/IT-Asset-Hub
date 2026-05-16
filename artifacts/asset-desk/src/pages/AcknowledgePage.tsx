import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { supabase } from "@/lib/supabaseClient";
import milesLogo from "/miles-logo.png";
import { CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";

type State = "loading" | "success" | "already" | "error";

export default function AcknowledgePage() {
  const [, params] = useRoute("/ack/:token");
  const token = params?.token ?? "";
  const [state,     setState]     = useState<State>("loading");
  const [assetName, setAssetName] = useState("");
  const [userName,  setUserName]  = useState("");
  const [errMsg,    setErrMsg]    = useState("");

  useEffect(() => {
    if (!token) { setState("error"); setErrMsg("Invalid link — no token found."); return; }

    supabase.functions.invoke("acknowledge-receipt", { body: { token } })
      .then(({ data, error }) => {
        if (error) { setState("error"); setErrMsg(error.message); return; }
        const d = data as { success?: boolean; error?: string; alreadyAcknowledged?: boolean; assetName?: string; userName?: string };
        if (!d.success || d.error) { setState("error"); setErrMsg(d.error ?? "Something went wrong."); return; }
        setAssetName(d.assetName ?? "");
        setUserName(d.userName ?? "");
        setState(d.alreadyAcknowledged ? "already" : "success");
      })
      .catch(err => { setState("error"); setErrMsg(err?.message ?? "Request failed."); });
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex flex-col items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-8 flex flex-col items-center text-center gap-5">
        {/* Logo */}
        <img src={milesLogo} alt="Miles Education" className="h-10 object-contain" />

        {state === "loading" && (
          <>
            <Loader2 className="h-14 w-14 text-blue-500 animate-spin" />
            <p className="text-muted-foreground text-sm">Recording your acknowledgement…</p>
          </>
        )}

        {state === "success" && (
          <>
            <CheckCircle2 className="h-16 w-16 text-emerald-500" />
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Receipt Acknowledged!</h1>
              {userName && (
                <p className="text-muted-foreground text-sm mb-1">Hi <strong>{userName}</strong>,</p>
              )}
              <p className="text-muted-foreground text-sm">
                You have successfully acknowledged receipt of{" "}
                {assetName ? <strong>{assetName}</strong> : "your assigned asset"}.
              </p>
            </div>
            <div className="w-full rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
              Your IT team has been notified. If you have any issues with the device, please raise a
              ticket via the IT Help Desk at{" "}
              <a href="mailto:help.desk@mileseducation.com" className="font-semibold underline">
                help.desk@mileseducation.com
              </a>
              .
            </div>
          </>
        )}

        {state === "already" && (
          <>
            <AlertCircle className="h-16 w-16 text-amber-500" />
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Already Acknowledged</h1>
              <p className="text-muted-foreground text-sm">
                You have already acknowledged receipt of{" "}
                {assetName ? <strong>{assetName}</strong> : "this asset"}.
                No further action is needed.
              </p>
            </div>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle className="h-16 w-16 text-destructive" />
            <div>
              <h1 className="text-xl font-bold text-foreground mb-1">Link Invalid</h1>
              <p className="text-muted-foreground text-sm">{errMsg || "This acknowledgement link is invalid or has expired."}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              For assistance, contact{" "}
              <a href="mailto:help.desk@mileseducation.com" className="underline">
                help.desk@mileseducation.com
              </a>
            </p>
          </>
        )}

        <p className="text-[11px] text-muted-foreground mt-2 border-t border-border pt-4 w-full">
          Miles Education · IT Asset Management
        </p>
      </div>
    </div>
  );
}
