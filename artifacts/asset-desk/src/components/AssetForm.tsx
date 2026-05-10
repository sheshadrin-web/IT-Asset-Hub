import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Laptop, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export const assetFormSchema = z.object({
  assetType:       z.enum(["Laptop", "Mobile"]),
  brand:           z.string().min(1, "Brand is required"),
  model:           z.string().min(1, "Model is required"),
  serialNumber:    z.string().min(1, "Serial number is required"),
  productNumber:   z.string().optional(),
  // Laptop
  processor:       z.string().optional(),
  ram:             z.string().optional(),
  operatingSystem: z.string().optional(),
  // Mobile
  imeiNumber:      z.string().optional(),
  imei2:           z.string().optional(),
  simNumber:       z.string().optional(),
  phoneNumber:     z.string().optional(),
  // Shared
  storage:         z.string().optional(),
  purchaseDate:    z.string().min(1, "Purchase date is required"),
  warrantyEndDate: z.string().min(1, "Warranty end date is required"),
  vendor:          z.string().optional(),
  invoice:         z.string().optional(),
  location:        z.string().min(1, "Location is required"),
  department:      z.string().optional(),
  accessories:     z.string().optional(),
  remarks:         z.string().optional(),
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</span>
      </div>
      {children}
    </section>
  );
}

const RAM_OPTIONS = ["2 GB", "4 GB", "8 GB", "16 GB", "32 GB", "64 GB"];
const STORAGE_OPTIONS = ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB", "2 TB"];
const OS_OPTIONS = ["Windows 10", "Windows 11", "macOS Ventura", "macOS Sonoma", "Ubuntu 22.04", "Other"];

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
      assetType: "Laptop",
      brand: "", model: "", serialNumber: "", productNumber: "",
      processor: "", ram: "", operatingSystem: "",
      imeiNumber: "", imei2: "", simNumber: "", phoneNumber: "",
      storage: "", purchaseDate: "", warrantyEndDate: "",
      vendor: "", invoice: "", location: "", department: "",
      accessories: "", remarks: "",
      ...defaultValues,
    },
  });

  useEffect(() => {
    if (defaultValues) form.reset({ ...form.getValues(), ...defaultValues });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues)]);

  const assetType = form.watch("assetType");
  const isLaptop  = assetType === "Laptop";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        {/* Asset Type */}
        <div>
          <p className="text-sm font-semibold text-foreground mb-3">
            Asset Type <span className="text-destructive">*</span>
          </p>
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
                {type === "Laptop" ? <Laptop className="h-7 w-7" /> : <Smartphone className="h-7 w-7" />}
                <span className="text-sm font-semibold">{type}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Device Identification */}
        <Section title="Device Identification">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="brand" render={({ field }) => (
              <FormItem>
                <FormLabel>Brand <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} placeholder="Dell, Apple, HP, Samsung…" data-testid="input-brand" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="model" render={({ field }) => (
              <FormItem>
                <FormLabel>Model <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} placeholder="e.g. Latitude 5540, iPhone 15 Pro" data-testid="input-model" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="serialNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Serial Number <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} placeholder="Unique serial from device label" data-testid="input-serial-number" /></FormControl>
                <FormDescription className="text-xs">Found on the bottom label or Settings → About</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="productNumber" render={({ field }) => (
              <FormItem>
                <FormLabel>Product Number</FormLabel>
                <FormControl><Input {...field} placeholder="Product / Part number" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </Section>

        {/* Laptop Specs */}
        {isLaptop && (
          <Section title="Hardware Specifications">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="processor" render={({ field }) => (
                <FormItem>
                  <FormLabel>Processor</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Intel Core i5-1235U, Ryzen 5 7530U" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ram" render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={v => field.onChange(v === "__none__" ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select RAM size" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {RAM_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="storage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Storage</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={v => field.onChange(v === "__none__" ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select storage size" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {STORAGE_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="operatingSystem" render={({ field }) => (
                <FormItem>
                  <FormLabel>Operating System</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={v => field.onChange(v === "__none__" ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select OS" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {OS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Section>
        )}

        {/* Mobile Specs */}
        {!isLaptop && (
          <Section title="Mobile Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="imeiNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>IMEI 1</FormLabel>
                  <FormControl><Input {...field} placeholder="15-digit IMEI (dial *#06#)" data-testid="input-imei" /></FormControl>
                  <FormDescription className="text-xs">Dial *#06# on the device</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="imei2" render={({ field }) => (
                <FormItem>
                  <FormLabel>IMEI 2</FormLabel>
                  <FormControl><Input {...field} placeholder="IMEI 2 (dual-SIM devices)" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="simNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>SIM Number</FormLabel>
                  <FormControl><Input {...field} placeholder="SIM card number / ICCID" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl><Input {...field} placeholder="Assigned phone number" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="storage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Storage</FormLabel>
                  <Select
                    value={field.value || "__none__"}
                    onValueChange={v => field.onChange(v === "__none__" ? "" : v)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {["64 GB", "128 GB", "256 GB", "512 GB", "1 TB"].map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Section>
        )}

        {/* Purchase & Warranty */}
        <Section title="Purchase & Warranty">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="purchaseDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Date <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-purchase-date" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="warrantyEndDate" render={({ field }) => (
              <FormItem>
                <FormLabel>Warranty End Date <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input type="date" {...field} data-testid="input-warranty-date" /></FormControl>
                <FormDescription className="text-xs">Usually 3 years from purchase date</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="vendor" render={({ field }) => (
              <FormItem>
                <FormLabel>Vendor</FormLabel>
                <FormControl><Input {...field} placeholder="Supplier / Vendor name" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="invoice" render={({ field }) => (
              <FormItem>
                <FormLabel>Invoice Number</FormLabel>
                <FormControl><Input {...field} placeholder="Invoice or PO number" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </Section>

        {/* Location & Assignment */}
        <Section title="Location & Department">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel>Location <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} placeholder="e.g. IT Storage Room, HQ Floor 2" data-testid="input-location" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="department" render={({ field }) => (
              <FormItem>
                <FormLabel>Department</FormLabel>
                <FormControl><Input {...field} placeholder="e.g. Sales, Finance, Engineering" /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </Section>

        {/* Accessories & Remarks */}
        <Section title="Accessories & Notes">
          <FormField control={form.control} name="accessories" render={({ field }) => (
            <FormItem>
              <FormLabel>Accessories</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g. Charger, Mouse, Laptop Bag, USB Hub" data-testid="input-accessories" />
              </FormControl>
              <FormDescription className="text-xs">List all items bundled with this device</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="remarks" render={({ field }) => (
            <FormItem>
              <FormLabel>Remarks</FormLabel>
              <FormControl>
                <Textarea {...field} rows={3} placeholder="Device condition, history, or special instructions…" data-testid="input-remarks" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </Section>

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
