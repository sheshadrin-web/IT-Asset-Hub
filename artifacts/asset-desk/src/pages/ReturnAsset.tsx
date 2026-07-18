import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  ArrowLeft, CheckCircle2, AlertTriangle, Package, ClipboardCheck,
  Printer,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAssets } from "@/context/AssetContext";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AssetStatus } from "@/data/mockData";
import { cn } from "@/lib/utils";

type ReturnCondition = "Good" | "Fair" | "Poor" | "Damaged";
const CONDITION_OPTIONS: { value: ReturnCondition; label: string; desc: string; color: string; active: string }[] = [
  { value: "Good",    label: "Good",    desc: "No damage, fully functional",      color: "border-emerald-200 text-emerald-600 hover:border-emerald-300",  active: "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500 text-emerald-700" },
  { value: "Fair",    label: "Fair",    desc: "Minor wear, still functional",      color: "border-blue-200 text-blue-500 hover:border-blue-300",            active: "border-blue-500 bg-blue-50 ring-1 ring-blue-500 text-blue-700" },
  { value: "Poor",    label: "Poor",    desc: "Significant wear or minor damage",  color: "border-amber-200 text-amber-500 hover:border-amber-300",         active: "border-amber-500 bg-amber-50 ring-1 ring-amber-500 text-amber-700" },
  { value: "Damaged", label: "Damaged", desc: "Broken or needs repair",            color: "border-red-200 text-red-400 hover:border-red-300",               active: "border-red-500 bg-red-50 ring-1 ring-red-500 text-red-700" },
];

const CONDITION_TO_STATUS: Record<ReturnCondition, AssetStatus> = {
  Good:    "Available",
  Fair:    "Available",
  Poor:    "Under Repair",
  Damaged: "Under Repair",
};

export default function ReturnAsset() {
  const { id } = useParams<{ id: string }>();
  const { getAsset, returnAsset } = useAssets();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const asset = getAsset(id);

  const [condition,           setCondition]           = useState<ReturnCondition>("Good");
  const [returnedAccessories, setReturnedAccessories] = useState("");
  const [missingAccessories,  setMissingAccessories]  = useState("");
  const [damageNotes,         setDamageNotes]         = useState("");
  const [finalStatus,         setFinalStatus]         = useState<AssetStatus>("Available");
  const [confirmOpen,         setConfirmOpen]         = useState(false);
  const [acknowledged,        setAcknowledged]        = useState(false);
  const [saving,              setSaving]              = useState(false);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Asset not found.</p>
        <Link href="/assets"><Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to Assets</Button></Link>
      </div>
    );
  }

  if (asset.status !== "Assigned") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-amber-500" />
        <p className="font-semibold text-foreground">Asset is not currently assigned</p>
        <p className="text-sm text-muted-foreground">Only assigned assets can be returned.</p>
        <Link href={`/assets/${id}`}><Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> View Asset</Button></Link>
      </div>
    );
  }

  const handleConditionChange = (val: ReturnCondition) => {
    setCondition(val);
    setFinalStatus(CONDITION_TO_STATUS[val]);
  };

  const buildReturnNote = () =>
    [
      `Return by: ${currentUser?.name ?? ""}`,
      `Date: ${new Date().toLocaleDateString("en-IN")}`,
      `Returned by user: ${asset.assignedTo ?? ""}`,
      `Condition: ${condition}`,
      returnedAccessories ? `Returned accessories: ${returnedAccessories}` : "",
      missingAccessories  ? `Missing accessories: ${missingAccessories}` : "",
      damageNotes         ? `Damage notes: ${damageNotes}` : "",
    ].filter(Boolean).join("\n");

  const handleConfirm = async () => {
    setSaving(true);
    try {
      await returnAsset(asset.assetId, finalStatus, buildReturnNote());
      setConfirmOpen(false);
      setAcknowledged(true);
      toast({ title: "Asset returned", description: `${asset.assetId} is now ${finalStatus}.` });
    } catch (err) {
      toast({
        title: "Return failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setSaving(false);
      setConfirmOpen(false);
    }
  };

  // ── Acknowledgement screen ────────────────────────────────────────────────
  if (acknowledged) {
    const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    return (
      <div className="max-w-xl mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <Link href="/assets">
            <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <h1 className="text-xl font-bold text-foreground">Return Acknowledgement</h1>
        </div>
        <Card className="border-2 border-emerald-400 bg-emerald-500/5">
          <CardContent className="pt-8 pb-6 text-center space-y-3">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
            <h2 className="text-lg font-bold text-foreground">Return Recorded Successfully</h2>
            <p className="text-sm text-muted-foreground">The asset has been returned and updated in the system.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" /> Return Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[
              { label: "Asset ID",        value: asset.assetId },
              { label: "Asset",           value: `${asset.brand} ${asset.model}` },
              { label: "Returned By",     value: asset.assignedTo ?? "—" },
              { label: "Processed By",    value: currentUser?.name ?? "—" },
              { label: "Date",            value: today },
              { label: "Condition",       value: condition },
              { label: "Final Status",    value: finalStatus },
              ...(returnedAccessories ? [{ label: "Returned Accessories", value: returnedAccessories }] : []),
              ...(missingAccessories  ? [{ label: "Missing Accessories",  value: missingAccessories  }] : []),
              ...(damageNotes         ? [{ label: "Damage Notes",         value: damageNotes         }] : []),
            ].map(row => (
              <div key={row.label} className="flex justify-between gap-4">
                <span className="text-muted-foreground flex-shrink-0">{row.label}</span>
                <span className="font-medium text-foreground text-right">{row.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="flex items-center gap-3 justify-end">
          <Button variant="outline" className="gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Link href="/assets">
            <Button>Back to Assets</Button>
          </Link>
        </div>
      </div>
    );
  }

  // ── Return form ───────────────────────────────────────────────────────────
  return (
    <div className="max-w-xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/assets/${id}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Asset Return</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {asset.assetId} — {asset.brand} {asset.model}
          </p>
        </div>
      </div>

      {/* User info banner */}
      <Card className="bg-blue-50 border-blue-200">
        <CardContent className="py-3 px-4 flex items-center gap-3">
          <Package className="h-5 w-5 text-blue-500 flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-blue-800">Currently assigned to: </span>
            <span className="text-blue-700">{asset.assignedTo ?? "—"}</span>
            {asset.assignedEmail && <span className="text-blue-500 ml-2">({asset.assignedEmail})</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Return Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Return Condition */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Return Condition <span className="text-destructive">*</span></Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {CONDITION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleConditionChange(opt.value)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all",
                    condition === opt.value ? opt.active : opt.color
                  )}
                >
                  <span className="text-xs font-bold">{opt.label}</span>
                  <span className="text-[10px] leading-tight opacity-80">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Accessories */}
          <div className="space-y-4">
            <div className="border-b border-border pb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Accessories</span>
            </div>
            <div className="space-y-1">
              <Label className="text-sm font-medium">Accessories Originally Issued</Label>
              <p className="text-xs text-muted-foreground">{asset.accessories || "Not recorded"}</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="returned-acc" className="text-sm font-medium">Returned Accessories</Label>
              <Input
                id="returned-acc"
                value={returnedAccessories}
                onChange={e => setReturnedAccessories(e.target.value)}
                placeholder="e.g. Charger, Mouse, Laptop Bag"
              />
              <p className="text-xs text-muted-foreground">List all items being returned</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="missing-acc" className="text-sm font-medium">Missing Accessories</Label>
              <Input
                id="missing-acc"
                value={missingAccessories}
                onChange={e => setMissingAccessories(e.target.value)}
                placeholder="e.g. Charger missing"
              />
              <p className="text-xs text-muted-foreground">Leave blank if nothing is missing</p>
            </div>
          </div>

          {/* Damage Notes */}
          <div className="space-y-2">
            <Label htmlFor="damage-notes" className="text-sm font-medium">Damage Notes</Label>
            <Textarea
              id="damage-notes"
              value={damageNotes}
              onChange={e => setDamageNotes(e.target.value)}
              rows={3}
              placeholder="Describe any physical damage, scratches, or functional issues…"
            />
          </div>

          {/* Final Status */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Final Asset Status After Return</Label>
            <Select value={finalStatus} onValueChange={v => setFinalStatus(v as AssetStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Available">Available — Ready to re-assign</SelectItem>
                <SelectItem value="Under Repair">Under Repair — Needs servicing</SelectItem>
                <SelectItem value="Retired">Retired — End of life</SelectItem>
                <SelectItem value="Lost">Lost — Cannot be located</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Auto-suggested based on condition. Override if needed.
            </p>
          </div>

        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Link href={`/assets/${id}`}>
          <Button variant="outline">Cancel</Button>
        </Link>
        <Button onClick={() => setConfirmOpen(true)} className="gap-2">
          <CheckCircle2 className="h-4 w-4" /> Confirm Return
        </Button>
      </div>

      {/* Confirmation modal */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Asset Return</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>You are about to record the return of:</p>
                <div className="bg-muted rounded-lg px-4 py-3 space-y-1 text-foreground">
                  <div><span className="font-semibold">Asset:</span> {asset.assetId} — {asset.brand} {asset.model}</div>
                  <div><span className="font-semibold">From:</span> {asset.assignedTo}</div>
                  <div><span className="font-semibold">Condition:</span> {condition}</div>
                  <div><span className="font-semibold">Final Status:</span> {finalStatus}</div>
                  {missingAccessories && <div className="text-amber-600"><span className="font-semibold">Missing:</span> {missingAccessories}</div>}
                </div>
                <p>This action will unassign the device and update its status. It cannot be undone.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm} disabled={saving}>
              {saving ? "Processing…" : "Confirm Return"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
