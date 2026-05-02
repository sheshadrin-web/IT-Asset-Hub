import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Paperclip, Upload, AlertCircle, AlertTriangle, Info, Zap } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { useAssets } from "@/context/AssetContext";
import { useTickets } from "@/context/TicketContext";
import { TICKET_CATEGORIES, TicketPriority } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const schema = z.object({
  assetId:     z.string().min(1, "Please select an asset or choose N/A"),
  category:    z.string().min(1, "Category is required"),
  subcategory: z.string().min(1, "Subcategory is required"),
  priority:    z.enum(["Low", "Medium", "High", "Critical"]),
  description: z.string().min(15, "Please provide at least 15 characters describing the issue"),
});

type FormValues = z.infer<typeof schema>;

const PRIORITY_OPTIONS: {
  value: TicketPriority;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  active: string;
}[] = [
  {
    value:  "Low",
    label:  "Low",
    desc:   "Non-urgent, can wait a few days",
    icon:   <Info className="h-4 w-4" />,
    color:  "border-gray-200 text-gray-500 hover:border-gray-300",
    active: "border-gray-400 bg-gray-50 text-gray-700 ring-1 ring-gray-400",
  },
  {
    value:  "Medium",
    label:  "Medium",
    desc:   "Affects work but has a workaround",
    icon:   <AlertCircle className="h-4 w-4" />,
    color:  "border-blue-200 text-blue-500 hover:border-blue-300",
    active: "border-blue-500 bg-blue-50 text-blue-700 ring-1 ring-blue-500",
  },
  {
    value:  "High",
    label:  "High",
    desc:   "Blocking work — urgent attention needed",
    icon:   <AlertTriangle className="h-4 w-4" />,
    color:  "border-amber-200 text-amber-500 hover:border-amber-300",
    active: "border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-500",
  },
  {
    value:  "Critical",
    label:  "Critical",
    desc:   "Complete outage — immediate action required",
    icon:   <Zap className="h-4 w-4" />,
    color:  "border-red-200 text-red-400 hover:border-red-300",
    active: "border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500",
  },
];

export default function RaiseTicket() {
  const { currentUser } = useAuth();
  const { assets } = useAssets();
  const { addTicket } = useTickets();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);

  const isEndUser = currentUser?.role === "end_user";

  // End users only see their assigned assets; admins/agents see all
  const availableAssets = isEndUser
    ? assets.filter((a) => a.assignedTo === currentUser?.name)
    : assets;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      assetId:     "",
      category:    "",
      subcategory: "",
      priority:    "Medium",
      description: "",
    },
  });

  const handleCategoryChange = (cat: string) => {
    form.setValue("category", cat);
    form.setValue("subcategory", "");
    setSubcategories(TICKET_CATEGORIES[cat] ?? []);
  };

  const onSubmit = (values: FormValues) => {
    if (!currentUser) return;
    const ticket = addTicket({
      raisedBy:    currentUser.name,
      assetId:     values.assetId,
      category:    values.category,
      subcategory: values.subcategory,
      priority:    values.priority,
      description: values.description,
    });
    toast({
      title: "Ticket submitted",
      description: `${ticket.ticketId} has been raised. An agent will be assigned shortly.`,
    });
    setLocation(`/tickets/${ticket.ticketId}`);
  };

  const watchedPriority = form.watch("priority");

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/tickets">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Raise a Ticket</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Report an issue or submit a request</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Ticket Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

              {/* Raised By (read-only) */}
              <div>
                <label className="text-sm font-medium text-foreground block mb-1.5">Raised By</label>
                <Input value={currentUser?.name ?? ""} disabled data-testid="input-raised-by" />
              </div>

              {/* Section: Asset & Category */}
              <div className="space-y-4">
                <div className="border-b border-border pb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Asset & Category</span>
                </div>

                <FormField control={form.control} name="assetId" render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Asset {isEndUser && <span className="text-xs text-muted-foreground font-normal">(your assigned assets)</span>}
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-asset-id">
                          <SelectValue placeholder="Select an asset, or N/A for new requests" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="N/A">N/A — New request (no asset)</SelectItem>
                        {availableAssets.map((a) => (
                          <SelectItem key={a.assetId} value={a.assetId}>
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">{a.assetId}</span>
                              <span>{a.brand} {a.model}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isEndUser && availableAssets.length === 0 && (
                      <p className="text-xs text-amber-600 mt-1">No assets are currently assigned to you. Choose N/A for a new request.</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="category" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select value={field.value} onValueChange={handleCategoryChange}>
                        <FormControl>
                          <SelectTrigger data-testid="select-category">
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {Object.keys(TICKET_CATEGORIES).map((cat) => (
                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="subcategory" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subcategory</FormLabel>
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                        disabled={subcategories.length === 0}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-subcategory">
                            <SelectValue placeholder={subcategories.length === 0 ? "Select category first" : "Select subcategory"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {subcategories.map((sub) => (
                            <SelectItem key={sub} value={sub}>{sub}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>

              {/* Section: Priority */}
              <div className="space-y-3">
                <div className="border-b border-border pb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority</span>
                </div>
                <FormField control={form.control} name="priority" render={({ field }) => (
                  <FormItem>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {PRIORITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => field.onChange(opt.value)}
                          className={cn(
                            "flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-3 text-center transition-all",
                            watchedPriority === opt.value ? opt.active : opt.color
                          )}
                          data-testid={`priority-${opt.value.toLowerCase()}`}
                        >
                          {opt.icon}
                          <span className="text-xs font-bold">{opt.label}</span>
                          <span className="text-[10px] leading-tight opacity-80">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Section: Description */}
              <div className="space-y-3">
                <div className="border-b border-border pb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Description</span>
                </div>
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Describe the issue <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Describe the problem in as much detail as possible. Include when it started, what you've already tried, and the impact on your work."
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              {/* Section: Attachment */}
              <div className="space-y-3">
                <div className="border-b border-border pb-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Attachment (optional)</span>
                </div>
                <div
                  className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all"
                  data-testid="attachment-placeholder"
                  onClick={() => {
                    setAttachmentName("screenshot_2024.png");
                    toast({ title: "File selected", description: "screenshot_2024.png (demo)" });
                  }}
                >
                  {attachmentName ? (
                    <div className="flex flex-col items-center gap-2">
                      <Paperclip className="h-6 w-6 text-primary" />
                      <p className="text-sm font-medium text-foreground">{attachmentName}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setAttachmentName(null); }}
                        className="text-xs text-muted-foreground hover:text-destructive"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <p className="text-sm font-medium text-foreground">Click to attach a file</p>
                      <p className="text-xs text-muted-foreground">PNG, JPG, PDF up to 10 MB</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
                <Button type="button" variant="outline" onClick={() => setLocation("/tickets")}>
                  Cancel
                </Button>
                <Button type="submit" data-testid="button-submit-ticket">
                  Submit Ticket
                </Button>
              </div>

            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
