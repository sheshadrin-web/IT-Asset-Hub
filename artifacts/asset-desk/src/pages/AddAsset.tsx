import { useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AssetForm, { AssetFormValues } from "@/components/AssetForm";
import { useAssets } from "@/context/AssetContext";
import { useToast } from "@/hooks/use-toast";

export default function AddAsset() {
  const { addAsset } = useAssets();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (values: AssetFormValues) => {
    setSaving(true);
    try {
      const newAsset = await addAsset({
        ...values,
        status:      "Available",
        imeiNumber:  values.imeiNumber  || undefined,
        accessories: values.accessories ?? "",
        remarks:     values.remarks     ?? "",
      });
      toast({
        title:       "Asset added",
        description: `${newAsset.assetId} — ${newAsset.brand} ${newAsset.model} created successfully.`,
      });
      setLocation(`/assets/${newAsset.assetId}`);
    } catch (err) {
      toast({
        title:       "Failed to add asset",
        description: err instanceof Error ? err.message : "Please try again.",
        variant:     "destructive",
      });
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href="/assets">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Add New Asset</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Register a new device in the system</p>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/40 rounded-lg px-4 py-2.5 border border-border">
        <span className="text-primary font-bold">ℹ</span>
        <span>
          Enter a unique <strong className="text-foreground">Asset ID</strong> (e.g. LAP-001, MOB-010, DSK-005).
          The asset will be created with <strong className="text-foreground">Available</strong> status.
        </span>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Asset Details</CardTitle>
        </CardHeader>
        <CardContent>
          <AssetForm
            onSubmit={handleSubmit}
            onCancel={() => setLocation("/assets")}
            submitLabel={saving ? "Saving…" : "Add Asset"}
            disabled={saving}
            assetIdReadOnly={false}
          />
        </CardContent>
      </Card>
    </div>
  );
}
