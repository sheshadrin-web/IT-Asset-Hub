import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { useUsers } from "@/context/UsersContext";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { UserRole, ROLE_LABELS } from "@/data/mockData";
import { Shield, UserCheck, User, Camera, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const schema = z.object({
  full_name:         z.string().min(2, "Name is required"),
  ecode:             z.string().optional(),
  department:        z.string().optional(),
  location:          z.string().optional(),
  reporting_manager: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

const roleBadgeColors: Record<UserRole, string> = {
  super_admin: "bg-purple-100 text-purple-700 border-purple-200",
  it_admin:    "bg-blue-100 text-blue-700 border-blue-200",
  it_agent:    "bg-cyan-100 text-cyan-700 border-cyan-200",
  end_user:    "bg-emerald-100 text-emerald-700 border-emerald-200",
};
const roleIconMap: Record<UserRole, React.ElementType> = {
  super_admin: Shield, it_admin: Shield, it_agent: UserCheck, end_user: User,
};

interface Props {
  open:    boolean;
  onClose: () => void;
}

export default function ProfileSettingsModal({ open, onClose }: Props) {
  const { currentUser, refreshProfile } = useAuth();
  const { users }                        = useUsers();
  const { toast }                        = useToast();
  const [saving,      setSaving]         = useState(false);
  const [uploading,   setUploading]      = useState(false);
  const [previewUrl,  setPreviewUrl]     = useState<string | undefined>();
  const fileInputRef                     = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name:         "",
      ecode:             "",
      department:        "",
      location:          "",
      reporting_manager: "",
    },
  });

  useEffect(() => {
    if (open && currentUser) {
      form.reset({
        full_name:         currentUser.name,
        ecode:             currentUser.ecode             ?? "",
        department:        currentUser.department        ?? "",
        location:          currentUser.location          ?? "",
        reporting_manager: currentUser.reportingManager  ?? "",
      });
      setPreviewUrl(currentUser.avatarUrl);
    }
  }, [open, currentUser]);

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentUser) return;

    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please choose an image under 2 MB.", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const ext  = file.name.split(".").pop() ?? "jpg";
      const path = `${currentUser.userId}/avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });

      if (uploadError) throw new Error(uploadError.message);

      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);

      // Force cache-bust so the new image loads immediately
      const bustUrl = `${publicUrl}?t=${Date.now()}`;

      await supabase.from("profiles")
        .update({ profile_photo_url: bustUrl, updated_at: new Date().toISOString() })
        .eq("id", currentUser.userId);

      setPreviewUrl(bustUrl);
      await refreshProfile();
      toast({ title: "Photo updated", description: "Your profile photo has been saved." });
    } catch (err) {
      toast({
        title:       "Upload failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant:     "destructive",
      });
    } finally {
      setUploading(false);
      // Reset the input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name:         values.full_name,
          ecode:             values.ecode             ?? "",
          department:        values.department         ?? "",
          location:          values.location           ?? "",
          reporting_manager: values.reporting_manager  ?? "",
          updated_at:        new Date().toISOString(),
        })
        .eq("id", currentUser.userId);

      if (error) throw new Error(error.message);

      await refreshProfile();
      toast({ title: "Profile updated", description: "Your changes have been saved." });
      onClose();
    } catch (err) {
      toast({
        title:       "Failed to save profile",
        description: err instanceof Error ? err.message : "Please try again.",
        variant:     "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!currentUser) return null;

  const initials  = currentUser.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  const RoleIcon  = roleIconMap[currentUser.role];
  const roleLabel = ROLE_LABELS[currentUser.role];
  const photoUrl  = previewUrl ?? currentUser.avatarUrl;

  return (
    <Dialog open={open} onOpenChange={v => !saving && !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Profile Settings</DialogTitle>
          <DialogDescription>Update your personal profile information.</DialogDescription>
        </DialogHeader>

        {/* Avatar with upload button */}
        <div className="flex items-center gap-4 py-2">
          <div className="relative flex-shrink-0">
            <Avatar className="h-16 w-16">
              {photoUrl && <AvatarImage src={photoUrl} alt={currentUser.name} className="object-cover" />}
              <AvatarFallback className="bg-primary text-white text-xl font-bold">{initials}</AvatarFallback>
            </Avatar>
            {/* Camera overlay button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
              title="Upload photo"
            >
              {uploading
                ? <Loader2 className="h-5 w-5 text-white animate-spin" />
                : <Camera className="h-5 w-5 text-white" />
              }
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handlePhotoChange}
            />
          </div>
          <div>
            <p className="font-semibold text-foreground">{currentUser.name}</p>
            <p className="text-xs text-muted-foreground mb-1">{currentUser.email}</p>
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
              roleBadgeColors[currentUser.role]
            )}>
              <RoleIcon className="h-3 w-3" />
              {roleLabel}
            </span>
            <p className="text-xs text-muted-foreground mt-1.5">
              Hover over photo to change · Max 2 MB
            </p>
          </div>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="full_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl><Input {...field} data-testid="input-profile-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ecode" render={({ field }) => (
                <FormItem>
                  <FormLabel>E-Code</FormLabel>
                  <FormControl><Input placeholder="e.g. EMP-001" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            {/* Email — read-only */}
            <div className="space-y-2">
              <label className="text-sm font-medium leading-none text-muted-foreground">Email Address</label>
              <Input value={currentUser.email} disabled className="bg-muted text-muted-foreground" />
              <p className="text-xs text-muted-foreground">Email cannot be changed here.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem>
                  <FormLabel>Department</FormLabel>
                  <FormControl><Input placeholder="e.g. Engineering" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Location</FormLabel>
                  <FormControl><Input placeholder="e.g. Bangalore" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="reporting_manager" render={({ field }) => (
              <FormItem>
                <FormLabel>Reporting Manager</FormLabel>
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="">— None —</SelectItem>
                    {users.filter(u => u.status === "active" && u.email !== currentUser?.email).map(u => (
                      <SelectItem key={u.id} value={u.email}>{u.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button type="submit" disabled={saving || uploading} data-testid="button-save-profile">
                {saving ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
