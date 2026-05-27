import { useEffect, useState } from "react";
import { getAssetEmoji } from "@/lib/assetEmoji";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import AccessoriesSelector from "@/components/AccessoriesSelector";
import LocationSelect from "@/components/LocationSelect";
import { ASSET_TYPE_CATEGORIES, ALL_ASSET_TYPES } from "@/lib/assetEmoji";
import { ASSET_OWNERSHIP_OPTIONS } from "@/data/mockData";

export const assetFormSchema = z.object({
  assetId:         z.string().min(1, "Asset ID is required (e.g. AST-001)"),
  assetType:       z.enum(ALL_ASSET_TYPES as unknown as [string, ...string[]]),
  brand:           z.string().optional().default(""),
  model:           z.string().optional().default(""),
  serialNumber:    z.string().optional().default(""),
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
  // Sim Card
  simProvider:     z.string().optional(),
  userName:        z.string().optional(),
  useCase:         z.string().optional(),
  billableName:    z.string().optional(),
  planName:        z.string().optional(),
  planAmount:      z.string().optional(),
  // Desktop
  monitorBrand:    z.string().optional(),
  monitorModel:    z.string().optional(),
  monitorSize:     z.string().optional(),
  keyboard:        z.string().optional(),
  mouse:           z.string().optional(),
  cpu:             z.string().optional(),
  others:          z.string().optional(),
  // Shared
  storage:         z.string().optional(),
  purchaseDate:    z.string().min(1, "Purchase date is required"),
  warrantyEndDate: z.string().optional().default(""),
  vendor:          z.string().optional(),
  invoice:         z.string().optional(),
  ownership:       z.enum(ASSET_OWNERSHIP_OPTIONS as unknown as [string, ...string[]]).optional(),
  location:        z.string().min(1, "Location is required"),
  department:      z.string().optional(),
  accessories:     z.string().optional(),
  remarks:         z.string().optional(),
}).superRefine((data, ctx) => {
  // Brand/Model/Serial are required for every asset type except Sim Card.
  if (data.assetType !== "Sim Card") {
    if (!data.brand || data.brand.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["brand"], message: "Brand is required" });
    }
    if (!data.model || data.model.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "Model is required" });
    }
    if (!data.serialNumber || data.serialNumber.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["serialNumber"], message: "Serial number is required" });
    }
    if (!data.warrantyEndDate || data.warrantyEndDate.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["warrantyEndDate"], message: "Warranty end date is required" });
    }
  }
});

export type AssetFormValues = z.infer<typeof assetFormSchema>;

interface AssetFormProps {
  defaultValues?: Partial<AssetFormValues>;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
  isSubmitting?: boolean;
  disabled?: boolean;
  submitLabel?: string;
  assetIdReadOnly?: boolean;
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

const RAM_OPTIONS        = ["2 GB", "4 GB", "6 GB", "8 GB", "12 GB", "16 GB", "24 GB", "32 GB", "64 GB"];
const STORAGE_OPTIONS    = ["64 GB", "128 GB", "256 GB", "512 GB", "1 TB", "2 TB"];
const OS_OPTIONS         = ["Windows 10", "Windows 10 Pro", "Windows 11", "Windows 11 Pro", "macOS", "Ubuntu", "Other"];
const MOBILE_OS_OPTIONS  = ["iOS", "Android"];
const MONITOR_SIZES      = ['17"', '19"', '21"', '22"', '24"', '27"', '32"', 'Other'];

function SelectField({
  label, value, onChange, placeholder, options,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder: string;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium leading-none">{label}</label>
      <Select
        value={value || "__none__"}
        onValueChange={v => onChange(v === "__none__" ? "" : v)}
      >
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Not specified</SelectItem>
          {options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function AssetForm({
  defaultValues,
  onSubmit,
  onCancel,
  isSubmitting,
  disabled,
  submitLabel = "Save Asset",
  assetIdReadOnly = false,
}: AssetFormProps) {
  const form = useForm<AssetFormValues>({
    resolver: zodResolver(assetFormSchema),
    defaultValues: {
      assetId: "", assetType: "Laptop",
      brand: "", model: "", serialNumber: "", productNumber: "",
      processor: "", ram: "", operatingSystem: "",
      imeiNumber: "", imei2: "", simNumber: "", phoneNumber: "",
      simProvider: "", userName: "", useCase: "", billableName: "", planName: "", planAmount: "",
      monitorBrand: "", monitorModel: "", monitorSize: "",
      keyboard: "", mouse: "", cpu: "", others: "",
      storage: "", purchaseDate: "", warrantyEndDate: "",
      vendor: "", invoice: "", ownership: "Miles",
      location: "", department: "",
      accessories: "", remarks: "",
      ...defaultValues,
    },
  });

  useEffect(() => {
    if (defaultValues) form.reset({ ...form.getValues(), ...defaultValues });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(defaultValues)]);

  const [typeOpen, setTypeOpen] = useState(false);
  const assetType = form.watch("assetType");
  const isLaptop  = assetType === "Laptop";
  const isMobile  = assetType === "Mobile";
  const isDesktop = assetType === "Desktop";
  const isTab     = assetType === "Tab";
  const isCPU     = assetType === "CPU";
  const isSimCard = assetType === "Sim Card";
  const showComputerSpecs = isLaptop || isCPU || isDesktop;
  // Suppress unused warnings — these flags are referenced in conditional sections below.
  void isLaptop; void isMobile; void isDesktop; void isTab; void isCPU; void isSimCard; void showComputerSpecs;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">

        {/* Asset ID — manual entry */}
        <Section title="Asset ID">
          <FormField control={form.control} name="assetId" render={({ field }) => (
            <FormItem>
              <FormLabel>Asset ID <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="e.g. AST-001, LAP-042, MOB-010"
                  disabled={assetIdReadOnly}
                  className={assetIdReadOnly ? "bg-muted text-muted-foreground" : ""}
                  data-testid="input-asset-id"
                />
              </FormControl>
              <FormDescription className="text-xs">
                {assetIdReadOnly
                  ? "Asset ID cannot be changed after creation."
                  : "Enter a unique ID for this asset. Use a consistent naming convention (e.g. LAP-001, MOB-001, DSK-001)."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </Section>

        {/* Asset Type */}
        <Section title="Asset Type">
          <FormField control={form.control} name="assetType" render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel>Type <span className="text-destructive">*</span></FormLabel>
              <Popover open={typeOpen} onOpenChange={setTypeOpen}>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button
                      type="button"
                      variant="outline"
                      role="combobox"
                      disabled={assetIdReadOnly}
                      className={cn("w-full justify-between font-normal", !field.value && "text-muted-foreground")}
                      data-testid="select-asset-type"
                    >
                      {field.value
                        ? <span className="flex items-center gap-2"><span aria-hidden>{getAssetEmoji(field.value)}</span>{field.value}</span>
                        : "Select asset type"}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[--radix-popover-trigger-width] p-0"
                  align="start"
                  side="bottom"
                  sideOffset={4}
                  avoidCollisions={false}
                >
                  <Command>
                    <CommandInput placeholder="Search asset type…" />
                    <CommandList className="max-h-72 overflow-y-auto">
                      <CommandEmpty>No asset type found.</CommandEmpty>
                      {ASSET_TYPE_CATEGORIES.map(({ label, types }) => (
                        <CommandGroup key={label} heading={label}>
                          {types.map((t) => (
                            <CommandItem
                              key={t}
                              value={t}
                              onSelect={() => {
                                field.onChange(t);
                                setTypeOpen(false);
                              }}
                            >
                              <span className="mr-2" aria-hidden>{getAssetEmoji(t)}</span>
                              <span>{t}</span>
                              <Check className={cn("ml-auto h-4 w-4", field.value === t ? "opacity-100" : "opacity-0")} />
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ))}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <FormDescription className="text-xs">Choose the category that best describes this asset.</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </Section>

        {/* Device Identification — hidden for Sim Card */}
        {!isSimCard && (
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
                  <FormControl><Input {...field} placeholder="e.g. Latitude 5540, OptiPlex 7090" data-testid="input-model" /></FormControl>
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
        )}

        {/* ── Computer Specs (Laptop / CPU / Desktop) ──────────────────── */}
        {showComputerSpecs && (
          <Section title="Hardware Specifications">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="processor" render={({ field }) => (
                <FormItem>
                  <FormLabel>Processor</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Intel Core i5-1235U" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ram" render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select RAM size" /></SelectTrigger></FormControl>
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
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger></FormControl>
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
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select OS" /></SelectTrigger></FormControl>
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

        {/* ── Mobile Details ───────────────────────────────────────────── */}
        {isMobile && (
          <Section title="Mobile Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="operatingSystem" render={({ field }) => (
                <FormItem>
                  <FormLabel>OS / Version</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select OS" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {MOBILE_OS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ram" render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select RAM" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {RAM_OPTIONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
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
              <FormField control={form.control} name="storage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Storage</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger></FormControl>
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

        {/* ── Sim Card Details ─────────────────────────────────────────── */}
        {isSimCard && (
          <Section title="Sim Card Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="simProvider" render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger data-testid="select-sim-provider"><SelectValue placeholder="Select provider" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {["Airtel", "Jio", "Vodafone"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phoneNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Official Mobile Number</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. 9876543210" data-testid="input-official-mobile" /></FormControl>
                  <FormDescription className="text-xs">Connection / phone number — shown in assignment email.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="simNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>SIM Number (ICCID)</FormLabel>
                  <FormControl><Input {...field} placeholder="19/20-digit SIM card number" /></FormControl>
                  <FormDescription className="text-xs">Internal use only — not included in the assignment email.</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="userName" render={({ field }) => (
                <FormItem>
                  <FormLabel>User Name (on bill)</FormLabel>
                  <FormControl><Input {...field} placeholder="Name registered on telecom bill" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="useCase" render={({ field }) => (
                <FormItem>
                  <FormLabel>Use Case</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Sales, Support, Field Ops" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="billableName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Billable Name</FormLabel>
                  <FormControl><Input {...field} placeholder="Entity billed for the connection" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="planName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan Name</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. Postpaid 499, Corporate CUG" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="planAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Plan Amount</FormLabel>
                  <FormControl><Input {...field} placeholder="e.g. ₹499 / month" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Section>
        )}

        {/* ── Tab Details ──────────────────────────────────────────────── */}
        {isTab && (
          <Section title="Tab Details">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="operatingSystem" render={({ field }) => (
                <FormItem>
                  <FormLabel>OS / Version</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select OS" /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">Not specified</SelectItem>
                      {MOBILE_OS_OPTIONS.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ram" render={({ field }) => (
                <FormItem>
                  <FormLabel>RAM</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select RAM" /></SelectTrigger></FormControl>
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
                  <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger></FormControl>
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
              <FormField control={form.control} name="imeiNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>IMEI (Cellular)</FormLabel>
                  <FormControl><Input {...field} placeholder="IMEI if cellular-enabled tab" data-testid="input-imei" /></FormControl>
                  <FormDescription className="text-xs">Leave blank for Wi-Fi-only tablets</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </Section>
        )}

        {/* ── Desktop Details ──────────────────────────────────────────── */}
        {isDesktop && (
          <>
            <Section title="Monitor">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="monitorBrand" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monitor Brand</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Dell, LG, Samsung, HP" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monitorModel" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monitor Model</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. U2722D, 27UK850" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="monitorSize" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Monitor Size</FormLabel>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select size" /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="__none__">Not specified</SelectItem>
                        {MONITOR_SIZES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Section>

            <Section title="CPU & Memory">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="cpu" render={({ field }) => (
                  <FormItem>
                    <FormLabel>CPU (Processor)</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Intel Core i7-12700, Ryzen 5 5600G" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="ram" render={({ field }) => (
                  <FormItem>
                    <FormLabel>RAM</FormLabel>
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select RAM" /></SelectTrigger></FormControl>
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
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select storage" /></SelectTrigger></FormControl>
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
                    <Select value={field.value || "__none__"} onValueChange={v => field.onChange(v === "__none__" ? "" : v)}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select OS" /></SelectTrigger></FormControl>
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

            <Section title="Peripherals">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField control={form.control} name="keyboard" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Keyboard</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Dell KB216, Logitech K120" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="mouse" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mouse</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Dell MS116, Logitech M100" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="others" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Other Peripherals</FormLabel>
                    <FormControl><Input {...field} placeholder="e.g. Webcam, Headset, USB Hub, Docking Station" /></FormControl>
                    <FormDescription className="text-xs">List any other peripherals included with this desktop</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
            </Section>
          </>
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
            {!isSimCard && (
              <FormField control={form.control} name="warrantyEndDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Warranty End Date</FormLabel>
                  <FormControl><Input type="date" {...field} data-testid="input-warranty-date" /></FormControl>
                  <FormDescription className="text-xs">Usually 3 years from purchase date</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
            )}
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
            <FormField control={form.control} name="ownership" render={({ field }) => (
              <FormItem>
                <FormLabel>Ownership</FormLabel>
                <Select value={field.value || "Miles"} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-testid="select-ownership"><SelectValue placeholder="Miles" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ASSET_OWNERSHIP_OPTIONS.map(o => (
                      <SelectItem key={o} value={o}>{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription className="text-xs">Who owns this asset</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        </Section>

        {/* Location & Department */}
        <Section title="Location & Department">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="location" render={({ field }) => (
              <FormItem>
                <FormLabel>Location <span className="text-destructive">*</span></FormLabel>
                <FormControl>
                  <LocationSelect
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
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

        {/* Accessories & Remarks — Accessories hidden for Sim Card */}
        <Section title={isSimCard ? "Notes" : "Accessories & Notes"}>
          {!isSimCard && (
            <FormField control={form.control} name="accessories" render={({ field }) => (
              <FormItem>
                <FormLabel>Accessories</FormLabel>
                <FormControl>
                  <AccessoriesSelector
                    assetType={assetType}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    disabled={disabled}
                  />
                </FormControl>
                <FormDescription className="text-xs">
                  Select all items bundled with this device. Choose <strong>Others</strong> to enter anything not listed.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )} />
          )}
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
