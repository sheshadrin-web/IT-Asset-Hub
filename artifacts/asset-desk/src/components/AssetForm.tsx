import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Asset } from "@/data/mockData";
import { Laptop, Smartphone, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export const assetFormSchema = z.object({
  assetType:      z.enum(["Laptop", "Mobile"], { required_error: "Select an asset type" }),
  brand:          z.string().min(1, "Brand is required"),
  model:          z.string().min(1, "Model is required"),
  serialNumber:   z.string().min(1, "Serial number is required"),
  imeiNumber:     z.string().optional(),
  purchaseDate:   z.string().min(1, "Purchase date is required"),
  warrantyEndDate:z.string().min(1, "Warranty end date is required"),
  location:       z.string().min(1, "Location is required"),
  accessories:    z.string().optional(),
  remarks:        z.string().optional(),
});

export type AssetFormValues = z.infer<typeof assetFormSchema>;

interface AssetFormProps {
  defaultValues?: Partial<AssetFormValues>;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  disabled?: boolean;
  submitLabel?: string;
}

export default function AssetForm({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting,
  disabled,
  submitLabel = "Save Asset",
}: AssetFormProps) {
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      assetType:       "Laptop",
      brand:           "",
      model:           "",
      serialNumber:    "",
      imeiNumber:      "",
      purchaseDate:    "",
      warrantyEndDate: "",
      location:        "",
      accessories:     "",
      remarks:         "",
      ...defaultValues,
    },
  });

  useEffect(() => {
    if (defaultValues) {
      form.reset({ ...form.getValues(), ...defaultValues });
    }
  }, [JSON.stringify(defaultValues)]);

  const assetType = form.watch("assetType");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        {/* Asset Type selector — large card style */}
        <div>
          <p className="text-sm font-semibold text-foreground mb-3">Asset Type <span className="text-destructive">*</span></p>
          <div className="grid grid-cols-2 gap-3">
            {(["Laptop", "Mobile"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => form.setValue("assetType", type, { shouldValidate: true })}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                  assetType === type
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-muted-foreground/40 text-muted-foreground"
                )}
                data-testid={`type-selector-${type.toLowerCase()}`}
              >
                {type === "Laptop"
                  ? <Laptop className="h-7 w-7" />
                  : <Smartphone className="h-7 w-7" />}
                <span className="text-sm font-semibold">{type}</span>
              </button>
            ))}
          </div>
          {form.formState.errors.assetType && (
            <p className="text-xs text-destructive mt-1">{form.formState.errors.assetType.message}</p>
          )}
        </div>

        {/* Section: Device Info */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Device Information</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="brand" render={({ field }) => (
              <FormItem>
                <FormLabel>Brand <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Dell, Apple, Samsung, HP…" data-testid="input-brand" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="model" render={({ field }) => (
              <FormItem>
                <FormLabel>Model <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g. Latitude 5540, iPhone 15 Pro" data-testid="input-model" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="serialNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Serial Number <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Unique serial from device label" data-testid="input-serial-number" />
                </FormControl>
                <FormDescription className="text-xs">Found on the bottom of the device or Settings → About</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            {assetType === "Mobile" && (
              <FormField control={form.control} name="imeiNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>IMEI Number</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="15-digit IMEI (dial *#06#)" data-testid="input-imei" />
                  </FormControl>
                  <FormDescription className="text-xs">Dial *#06# on the device to get IMEI</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            )}
          </div>
        </section>

        {/* Section: Purchase & Warranty */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Purchase & Warranty</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="purchaseDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Date <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-purchase-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="warrantyEndDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Warranty End Date <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-warranty-date" />
                </FormControl>
                <FormDescription className="text-xs">Usually 3 years from purchase date</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </section>

        {/* Section: Location & Accessories */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location & Accessories</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel>Location <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g. IT Storage Room, HQ Floor 2" data-testid="input-location" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="accessories" render={({ field }) => (
              <FormItem>
                <FormLabel>Accessories</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="e.g. Charger, Mouse, Laptop Bag" data-testid="input-accessories" />
                </FormControl>
                <FormDescription className="text-xs">List all items that come with this device</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </section>

        {/* Section: Remarks */}
        <section className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Additional Notes</span>
          </div>
          <FormField control={form.control} name="remarks" render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={3}
                  placeholder="Any notes about the condition, history, or special instructions for this asset…"
                  data-testid="input-remarks"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </section>

        {/* Info note */}
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <Info className="h-4 w-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700">
            The asset will be created with <strong>Available</strong> status.
            Use the <strong>Assign</strong> action on the asset list to assign it to a user.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-asset">
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || disabled} data-testid="button-save-asset">
            {isSubmitting ? "Saving…" : submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
