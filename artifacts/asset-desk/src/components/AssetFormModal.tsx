import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
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

const schema = z.object({
  assetId: z.string().min(1, "Required"),
  assetType: z.enum(["Laptop", "Mobile", "Desktop"]),
  brand: z.string().min(1, "Required"),
  model: z.string().min(1, "Required"),
  serialNumber: z.string().min(1, "Required"),
  imeiNumber: z.string().optional(),
  purchaseDate: z.string().min(1, "Required"),
  warrantyEndDate: z.string().min(1, "Required"),
  status: z.enum(["In Procurement", "Available", "Assigned", "Under Repair", "Lost", "Retired"]),
  assignedTo: z.string().optional(),
  department: z.string().optional(),
  location: z.string().min(1, "Required"),
  accessories: z.string().optional(),
  remarks: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (asset: Asset) => void;
  asset: Asset | null;
  existingIds: string[];
}

export default function AssetFormModal({ open, onClose, onSave, asset, existingIds }: Props) {
  const isEditing = !!asset;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      assetId: "",
      assetType: "Laptop",
      brand: "",
      model: "",
      serialNumber: "",
      imeiNumber: "",
      purchaseDate: "",
      warrantyEndDate: "",
      status: "Available",
      assignedTo: "",
      department: "",
      location: "",
      accessories: "",
      remarks: "",
    },
  });

  useEffect(() => {
    if (asset) {
      form.reset({
        assetId: asset.assetId,
        assetType: asset.assetType,
        brand: asset.brand,
        model: asset.model,
        serialNumber: asset.serialNumber,
        imeiNumber: asset.imeiNumber ?? "",
        purchaseDate: asset.purchaseDate,
        warrantyEndDate: asset.warrantyEndDate,
        status: asset.status,
        assignedTo: asset.assignedTo ?? "",
        department: asset.department ?? "",
        location: asset.location,
        accessories: asset.accessories,
        remarks: asset.remarks,
      });
    } else {
      const nextNum = existingIds.length + 1;
      form.reset({
        assetId: `AST-${String(nextNum).padStart(3, "0")}`,
        assetType: "Laptop",
        brand: "",
        model: "",
        serialNumber: "",
        imeiNumber: "",
        purchaseDate: "",
        warrantyEndDate: "",
        status: "Available",
        assignedTo: "",
        department: "",
        location: "",
        accessories: "",
        remarks: "",
      });
    }
  }, [asset, open]);

  const onSubmit = (values: FormValues) => {
    onSave({
      ...values,
      imeiNumber: values.imeiNumber || undefined,
      assignedTo: values.assignedTo || undefined,
      department: values.department || undefined,
      accessories: values.accessories ?? "",
      remarks: values.remarks ?? "",
    });
  };

  const assetType = form.watch("assetType");

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit Asset" : "Add New Asset"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="assetId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset ID</FormLabel>
                    <FormControl>
                      <Input {...field} disabled={isEditing} data-testid="input-asset-id" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assetType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-asset-type-form">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Laptop">Laptop</SelectItem>
                        <SelectItem value="Mobile">Mobile</SelectItem>
                        <SelectItem value="Desktop">Desktop</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brand"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Brand</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Dell, Apple, Samsung..." data-testid="input-brand" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Model</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Latitude 5520..." data-testid="input-model" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="serialNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Serial Number</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-serial-number" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {assetType === "Mobile" && (
                <FormField
                  control={form.control}
                  name="imeiNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>IMEI Number</FormLabel>
                      <FormControl>
                        <Input {...field} data-testid="input-imei" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="purchaseDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purchase Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-purchase-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="warrantyEndDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Warranty End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} data-testid="input-warranty-date" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-status-form">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="In Procurement">In Procurement</SelectItem>
                        <SelectItem value="Available">Available</SelectItem>
                        <SelectItem value="Assigned">Assigned</SelectItem>
                        <SelectItem value="Under Repair">Under Repair</SelectItem>
                        <SelectItem value="Lost">Lost</SelectItem>
                        <SelectItem value="Retired">Retired</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="assignedTo"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assigned To</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="User name" data-testid="input-assigned-to" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="department"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Department</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Engineering, HR..." data-testid="input-department" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="location"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Location</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="HQ - Floor 2" data-testid="input-location" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="accessories"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Accessories</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Charger, Mouse..." data-testid="input-accessories" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} data-testid="input-remarks" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} data-testid="button-cancel-asset">
                Cancel
              </Button>
              <Button type="submit" data-testid="button-save-asset">
                {isEditing ? "Save Changes" : "Add Asset"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
