import { useState } from "react";
import { useLocation, Link } from "wouter";
import { ArrowLeft, Paperclip } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { TICKET_CATEGORIES, mockAssets } from "@/data/mockData";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  assetId: z.string().min(1, "Required"),
  category: z.string().min(1, "Required"),
  subcategory: z.string().min(1, "Required"),
  priority: z.enum(["Low", "Medium", "High", "Critical"]),
  description: z.string().min(10, "Please provide at least 10 characters"),
});

type FormValues = z.infer<typeof schema>;

export default function RaiseTicket() {
  const { currentUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [subcategories, setSubcategories] = useState<string[]>([]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      assetId: "",
      category: "",
      subcategory: "",
      priority: "Medium",
      description: "",
    },
  });

  const handleCategoryChange = (cat: string) => {
    form.setValue("category", cat);
    form.setValue("subcategory", "");
    setSubcategories(TICKET_CATEGORIES[cat] ?? []);
  };

  const onSubmit = (values: FormValues) => {
    toast({
      title: "Ticket submitted",
      description: `Your ticket has been raised successfully. You will be notified when an agent is assigned.`,
    });
    setLocation("/tickets");
  };

  const userAssets = mockAssets.filter(
    (a) => a.assignedTo === currentUser?.name || a.status !== "Assigned"
  );

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/tickets">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-foreground">Raise a Ticket</h1>
          <p className="text-sm text-muted-foreground">Submit an asset-related issue or request</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Ticket Details</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              {/* Raised by (read-only) */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Raised By</label>
                <Input value={currentUser?.name ?? ""} disabled data-testid="input-raised-by" />
              </div>

              <FormField
                control={form.control}
                name="assetId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Asset ID</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-asset-id">
                          <SelectValue placeholder="Select asset (or N/A for requests)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="N/A">N/A (New Request)</SelectItem>
                        {mockAssets.map((a) => (
                          <SelectItem key={a.assetId} value={a.assetId}>
                            {a.assetId} — {a.brand} {a.model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="category"
                  render={({ field }) => (
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
                  )}
                />

                <FormField
                  control={form.control}
                  name="subcategory"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Subcategory</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange} disabled={subcategories.length === 0}>
                        <FormControl>
                          <SelectTrigger data-testid="select-subcategory">
                            <SelectValue placeholder="Select subcategory" />
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
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Priority</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger data-testid="select-priority">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Low">Low</SelectItem>
                        <SelectItem value="Medium">Medium</SelectItem>
                        <SelectItem value="High">High</SelectItem>
                        <SelectItem value="Critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={5}
                        placeholder="Describe the issue in detail..."
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Attachment placeholder */}
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Attachment</label>
                <div
                  className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  data-testid="attachment-placeholder"
                >
                  <Paperclip className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">Click to attach files or drag and drop</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">PNG, JPG, PDF up to 10MB</p>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button type="button" variant="outline" asChild>
                  <Link href="/tickets">Cancel</Link>
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
