import { useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AssetForm, { AssetFormValues } from "@/components/AssetForm";
import { useAssets } from "@/context/AssetContext";
import { useToast } from "@/hooks/use-toast";

export default function EditAsset() {
  const { id }                          = useParams<{ id: string }>();
  const { getAsset, updateAsset }       = useAssets();
  const [, setLocation]                 = useLocation();
  const { toast }                       = useToast();
  const [saving, setSaving]             = useState(false);

  const asset = getAsset(id);

  if (!asset) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <AlertTriangle className="h-10 w-10 text-muted-foreground" />
        <p className="text-muted-foreground">Asset not found.</p>
        <Link href="/assets">
          <Button variant="outline" className="gap-2"><ArrowLeft className="h-4 w-4" /> Back to Assets</Button>
        </Link>
      </div>
    );
  }

  const handleSubmit = async (values: AssetFormValues) => {
    setSaving(true);
    try {
      await updateAsset({
        ...asset,
        ...values,
        imeiNumber:  values.imeiNumber || undefined,
        accessories: values.accessories ?? "",
        remarks:     values.remarks ?? "",
      });
      toast({ title: "Asset updated", description: `${asset.assetId} has been updated successfully.` });
      setLocation(`/assets/${asset.assetId}`);
    } catch (err) {
      toast({
        title:       "Failed to update asset",
        description: err instanceof Error ? err.message : "Please try again.",
        variant:     "destructive",
      });
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Link href={`/assets/${asset.assetId}`}>
          <Button variant="ghost" size="icon" data-testid="button-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Edit Asset — {asset.assetId}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{asset.brand} {asset.model}</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Update Asset Details</CardTitle>
        </CardHeader>
        <CardContent>
          <AssetForm
            defaultValues={{
              assetType:       asset.assetType,
              brand:           asset.brand,
              model:           asset.model,
              serialNumber:    asset.serialNumber,
              imeiNumber:      asset.imeiNumber ?? "",
              purchaseDate:    asset.purchaseDate,
              warrantyEndDate: asset.warrantyEndDate,
              location:        asset.location,
              accessories:     asset.accessories,
              remarks:         asset.remarks,
            }}
            onSubmit={handleSubmit}
            onCancel={() => setLocation(`/assets/${asset.assetId}`)}
            submitLabel={saving ? "Saving…" : "Save Changes"}
            disabled={saving}
          />
        </CardContent>
      </Card>
    </div>
  );
}
