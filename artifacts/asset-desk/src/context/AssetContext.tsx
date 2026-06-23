import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Asset, AssetStatus, AssetType, AssetOwnership, AssetCondition } from "@/data/mockData";
import { useAuth } from "@/context/AuthContext";
import { toast } from "@/hooks/use-toast";

// Explicit column list for non-privileged (end user) reads. It deliberately
// OMITS `sim_number` (ICCID) — sensitive carrier data that must never reach an
// end-user client, even over the network. Row-level RLS cannot redact columns,
// so we restrict the projection here. Privileged roles select "*" instead.
const SAFE_ASSET_COLUMNS =
  "id, asset_id, asset_type, brand, model, serial_number, product_number, processor, ram, " +
  "operating_system, storage, imei_1, imei_2, phone_number, sim_provider, user_name, use_case, " +
  "billable_name, plan_name, plan_amount, monitor_brand, monitor_model, monitor_size, keyboard, " +
  "mouse, cpu, others, purchase_date, warranty_end_date, vendor, invoice, ownership, status, " +
  "assigned_to, assigned_to_name, assigned_email, assigned_at, ack_token, acknowledged, " +
  "acknowledged_at, asset_photos, department, location, accessories, remarks, created_at, updated_at, " +
  "condition, condition_notes, condition_updated_at, " +
  "profiles!assets_assigned_to_fkey(full_name, email, ecode)";

function mapFromDB(row: Record<string, unknown>): Asset {
  return {
    id:              String(row.id ?? ""),
    assetId:         String(row.asset_id ?? ""),
    assetType:       (row.asset_type as AssetType) ?? "Laptop",
    brand:           String(row.brand ?? ""),
    model:           String(row.model ?? ""),
    serialNumber:    String(row.serial_number ?? ""),
    productNumber:   row.product_number   ? String(row.product_number)   : undefined,
    processor:       row.processor        ? String(row.processor)        : undefined,
    ram:             row.ram              ? String(row.ram)              : undefined,
    operatingSystem: row.operating_system ? String(row.operating_system) : undefined,
    storage:         row.storage          ? String(row.storage)          : undefined,
    imeiNumber:      row.imei_1           ? String(row.imei_1)           : undefined,
    imei2:           row.imei_2           ? String(row.imei_2)           : undefined,
    simNumber:       row.sim_number       ? String(row.sim_number)       : undefined,
    phoneNumber:     row.phone_number     ? String(row.phone_number)     : undefined,
    simProvider:     row.sim_provider     ? String(row.sim_provider)     : undefined,
    userName:        row.user_name        ? String(row.user_name)        : undefined,
    useCase:         row.use_case         ? String(row.use_case)         : undefined,
    billableName:    row.billable_name    ? String(row.billable_name)    : undefined,
    planName:        row.plan_name        ? String(row.plan_name)        : undefined,
    planAmount:      row.plan_amount      ? String(row.plan_amount)      : undefined,
    monitorBrand:    row.monitor_brand    ? String(row.monitor_brand)    : undefined,
    monitorModel:    row.monitor_model    ? String(row.monitor_model)    : undefined,
    monitorSize:     row.monitor_size     ? String(row.monitor_size)     : undefined,
    keyboard:        row.keyboard         ? String(row.keyboard)         : undefined,
    mouse:           row.mouse            ? String(row.mouse)            : undefined,
    cpu:             row.cpu              ? String(row.cpu)              : undefined,
    others:          row.others           ? String(row.others)           : undefined,
    purchaseDate:    String(row.purchase_date ?? ""),
    warrantyEndDate: String(row.warranty_end_date ?? ""),
    vendor:          row.vendor           ? String(row.vendor)           : undefined,
    invoice:         row.invoice          ? String(row.invoice)          : undefined,
    ownership:       (row.ownership as AssetOwnership) ?? "Miles",
    status:          (row.status as AssetStatus) ?? "Available",
    assignedTo:    row.assigned_to_name
      ? String(row.assigned_to_name)
      : (row.profiles as Record<string, unknown> | null)?.full_name
        ? String((row.profiles as Record<string, unknown>).full_name)
        : undefined,
    assignedEmail: row.assigned_email
      ? String(row.assigned_email)
      : (row.profiles as Record<string, unknown> | null)?.email
        ? String((row.profiles as Record<string, unknown>).email)
        : undefined,
    assignedEcode: (row.profiles as Record<string, unknown> | null)?.ecode
      ? String((row.profiles as Record<string, unknown>).ecode)
      : undefined,
    assignedAt:      row.assigned_at      ? String(row.assigned_at)      : undefined,
    ackToken:        row.ack_token        ? String(row.ack_token)        : undefined,
    acknowledged:    row.acknowledged     ? Boolean(row.acknowledged)    : false,
    acknowledgedAt:  row.acknowledged_at  ? String(row.acknowledged_at) : undefined,
    assetPhotos:     Array.isArray(row.asset_photos) ? (row.asset_photos as string[]) : undefined,
    department:      row.department       ? String(row.department)       : undefined,
    location:        String(row.location ?? ""),
    accessories:     String(row.accessories ?? ""),
    remarks:         String(row.remarks ?? ""),
    condition:          row.condition ? (row.condition as AssetCondition) : undefined,
    conditionNotes:     row.condition_notes ? String(row.condition_notes) : undefined,
    conditionUpdatedAt: row.condition_updated_at ? String(row.condition_updated_at) : undefined,
    updatedAt:          row.updated_at ? String(row.updated_at) : undefined,
  };
}

function mapToDB(data: Omit<Asset, "id">): Record<string, unknown> {
  return {
    asset_id:          data.assetId,
    asset_type:        data.assetType,
    brand:             data.brand,
    model:             data.model,
    serial_number:     data.serialNumber,
    product_number:    data.productNumber    ?? null,
    processor:         data.processor        ?? null,
    ram:               data.ram              ?? null,
    operating_system:  data.operatingSystem  ?? null,
    storage:           data.storage          ?? null,
    imei_1:            data.imeiNumber       ?? null,
    imei_2:            data.imei2            ?? null,
    sim_number:        data.simNumber        ?? null,
    phone_number:      data.phoneNumber      ?? null,
    sim_provider:      data.simProvider      ?? null,
    user_name:         data.userName         ?? null,
    use_case:          data.useCase          ?? null,
    billable_name:     data.billableName     ?? null,
    plan_name:         data.planName         ?? null,
    plan_amount:       data.planAmount       ?? null,
    monitor_brand:     data.monitorBrand     ?? null,
    monitor_model:     data.monitorModel     ?? null,
    monitor_size:      data.monitorSize      ?? null,
    keyboard:          data.keyboard         ?? null,
    mouse:             data.mouse            ?? null,
    cpu:               data.cpu              ?? null,
    others:            data.others           ?? null,
    purchase_date:     data.purchaseDate    ? data.purchaseDate    : null,
    warranty_end_date: data.warrantyEndDate ? data.warrantyEndDate : null,
    vendor:            data.vendor           ?? null,
    invoice:           data.invoice          ?? null,
    ownership:         data.ownership        ?? "Miles",
    status:            data.status,
    // NOTE: assigned_to / assigned_email / assigned_to_name are intentionally
    // excluded here. Assignment state is managed exclusively by assignAsset,
    // unassignAsset, and returnAsset. Sending assigned_to: null from every
    // edit would silently clear the assignment.
    department:        data.department       ?? null,
    location:          data.location,
    accessories:       data.accessories      ?? "",
    remarks:           data.remarks          ?? "",
  };
}

interface AssetContextType {
  assets:             Asset[];
  loading:            boolean;
  error:              string | null;
  getAsset:           (id: string) => Asset | undefined;
  refresh:            () => Promise<void>;
  addAsset:           (data: Omit<Asset, "id">) => Promise<Asset>;
  addAssets:          (dataList: Omit<Asset, "id">[]) => Promise<Asset[]>;
  updateAsset:        (asset: Asset) => Promise<void>;
  assignAsset:        (assetId: string, userId: string, userName: string, userEmail: string, department: string, handoverNote?: string, reason?: string) => Promise<void>;
  bulkAssignAssets:   (assetIds: string[], userId: string, userName: string, userEmail: string, department: string, handoverNote?: string, reason?: string) => Promise<void>;
  returnAsset:        (assetId: string, finalStatus: AssetStatus, returnNote?: string) => Promise<void>;
  updateStatus:       (assetId: string, status: AssetStatus) => Promise<void>;
  unassignAsset:            (assetId: string) => Promise<void>;
  deleteAssets:             (ids: string[]) => Promise<void>;
  resetAcknowledgement:     (assetId: string) => Promise<void>;
  markAcknowledged:         (assetId: string) => Promise<void>;
  bulkMarkAcknowledged:     (assetIds: string[]) => Promise<void>;
  updateAssetCondition:     (assetId: string, condition: AssetCondition, notes?: string) => Promise<void>;
}

const AssetContext = createContext<AssetContextType | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const { role, isAuthenticated } = useAuth();

  // Only IT staff may receive the full row (incl. sim_number/ICCID). Default to
  // the redacted projection whenever the role is not yet resolved or is end_user.
  const isPrivileged = role === "super_admin" || role === "it_admin" || role === "it_agent";

  const fetchAssets = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const columns = isPrivileged
      ? "*, profiles!assets_assigned_to_fkey(full_name, email, ecode)"
      : SAFE_ASSET_COLUMNS;

    let count = 0;
    try {
      const { error: countError, count: supabaseCount } = await supabase
        .from("assets")
        .select("id", { head: true, count: "exact" });
      if (!countError && typeof supabaseCount === "number") count = supabaseCount;
      console.log("[AssetContext] SUPABASE COUNT", supabaseCount, { countError: countError?.message });
    } catch (countError) {
      console.log("[AssetContext] SUPABASE COUNT query failed", countError);
      // non-fatal; let page fetch continue even if count fails.
    }

    const PAGE_SIZE = 1000;
    const rows: Record<string, unknown>[] = [];
    let page = 0;

    while (true) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error: fetchError } = await supabase
        .from("assets")
        .select(columns)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (fetchError) {
        // Surface the failure loudly instead of silently rendering an empty list,
        // which is indistinguishable from "no assets" and hides real outages.
        setError(fetchError.message);
        toast({ title: "Failed to load assets", description: fetchError.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      const pageRows = Array.isArray(data) ? data as unknown as Record<string, unknown>[] : [];
      rows.push(...pageRows);
      console.log("[AssetContext] fetchAssets page", page, "pageRows", pageRows.length, "rowsSoFar", rows.length);
      if (pageRows.length === 0 || pageRows.length < PAGE_SIZE) {
        break;
      }
      page += 1;
    }

    const allAssets = rows.map(mapFromDB);
    console.log("PAGE FETCH", rows.length);
    console.log("TOTAL LOADED", allAssets.length);
    console.log("SUPABASE COUNT", count);
    setError(null);
    setAssets(allAssets);
    console.log("AFTER setAssets", allAssets.length);
    setLoading(false);
  }, [isPrivileged]);

  // Only fetch when authenticated. This provider wraps the whole app, including
  // public pages like the acknowledgement link, which must not trigger a full
  // assets read. `isAuthenticated` (session AND profile) only flips true once the
  // profile/role has resolved, so `fetchAssets` already carries the correct
  // role-based projection — a single fetch, no race, no double read.
  useEffect(() => {
    if (!supabaseConfigured) { setLoading(false); return; }
    if (!isAuthenticated) { setLoading(false); return; }
    fetchAssets();
  }, [isAuthenticated, fetchAssets]);

  const getAsset = (id: string) => assets.find(a => a.assetId === id);

  const addAsset = async (data: Omit<Asset, "id">): Promise<Asset> => {
    const row = mapToDB(data);
    const { data: inserted, error } = await supabase
      .from("assets").insert(row).select().single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to add asset");
    const newAsset = mapFromDB(inserted as Record<string, unknown>);
    setAssets(prev => [newAsset, ...prev]);
    return newAsset;
  };

  const addAssets = async (dataList: Omit<Asset, "id">[]): Promise<Asset[]> => {
    if (dataList.length === 0) return [];
    const rows = dataList.map(mapToDB);
    const { data: inserted, error } = await supabase
      .from("assets").insert(rows).select();
    if (error) throw new Error(error.message);
    const created = (inserted ?? []).map(r => mapFromDB(r as Record<string, unknown>));
    await fetchAssets();
    return created;
  };

  const updateAsset = async (asset: Asset): Promise<void> => {
    const row = mapToDB(asset);
    const { error } = await supabase
      .from("assets").update(row).eq("asset_id", asset.assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a => a.assetId === asset.assetId ? { ...a, ...asset } : a));
  };

  const assignAsset = async (
    assetId: string, userId: string, userName: string, userEmail: string, department: string, handoverNote?: string, reason?: string
  ): Promise<void> => {
    const ackToken = crypto.randomUUID();
    const coreUpdates: Record<string, unknown> = {
      status:         "Assigned",
      assigned_to:    userId,     // UUID FK to profiles
      assigned_email: userEmail,  // TEXT — used as display fallback
      department,
      assigned_at:    new Date().toISOString(),
      ack_token:      ackToken,
      acknowledged:   false,
      acknowledged_at: null,
    };
    const { error } = await supabase.from("assets").update(coreUpdates).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    // Persist display name — non-fatal if column doesn't exist yet in the DB.
    // Run: ALTER TABLE assets ADD COLUMN IF NOT EXISTS assigned_to_name TEXT;
    await supabase.from("assets").update({ assigned_to_name: userName }).eq("asset_id", assetId);
    if (handoverNote) {
      await supabase.from("assets").update({ remarks: handoverNote }).eq("asset_id", assetId);
    }
    const assignedAt = new Date().toISOString();
    // Resolve the assignee's ecode now so it is available both for local state
    // and for any later return/unassign history event in this same session
    // (before the next full refetch repopulates it from the profiles join).
    let assignedEcode: string | null = null;
    try {
      const { data: ecodeRow } = await supabase.from("profiles").select("ecode").eq("id", userId).single();
      assignedEcode = (ecodeRow as { ecode?: string } | null)?.ecode ?? null;
    } catch { /* non-fatal */ }
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: "Assigned", assignedTo: userName, assignedEmail: userEmail, assignedEcode: assignedEcode ?? undefined, department, assignedAt, ackToken, acknowledged: false, acknowledgedAt: undefined }
        : a
    ));
    // Send assignment email (non-fatal)
    try {
      const assetObjForEmail = assets.find(a => a.assetId === assetId);
      if (assetObjForEmail && userEmail) {
        // Resolve manager email from the assigned user's reporting_manager field.
        // The field may store an email directly (new behaviour) or a name (legacy).
        let managerEmail: string | undefined;
        try {
          const { data: userProfile } = await supabase
            .from("profiles")
            .select("reporting_manager")
            .eq("id", userId)
            .single();
          const rmValue = (userProfile as { reporting_manager?: string } | null)?.reporting_manager?.trim();
          if (rmValue) {
            if (rmValue.includes("@")) {
              // Stored as email directly — use it
              managerEmail = rmValue;
            } else {
              // Legacy: stored as name — look up email by full_name
              const { data: managerProfile } = await supabase
                .from("profiles")
                .select("email")
                .ilike("full_name", rmValue)
                .maybeSingle();
              managerEmail = (managerProfile as { email?: string } | null)?.email ?? undefined;
            }
          }
        } catch { /* non-fatal */ }

        // Call Supabase Edge Function — works from both dev (Replit) and
        // production (Render static site) since it's server-side.
        await supabase.functions.invoke("send-assignment-email", {
          body: {
            toEmail:         userEmail,
            toName:          userName,
            assetId:         assetObjForEmail.assetId,
            assetType:       assetObjForEmail.assetType,
            brand:           assetObjForEmail.brand,
            model:           assetObjForEmail.model,
            serialNumber:    assetObjForEmail.serialNumber,
            processor:       assetObjForEmail.processor,
            ram:             assetObjForEmail.ram,
            storage:         assetObjForEmail.storage,
            operatingSystem: assetObjForEmail.operatingSystem,
            imei1:           assetObjForEmail.imeiNumber,
            imei2:           assetObjForEmail.imei2,
            phoneNumber:     assetObjForEmail.phoneNumber,
            simProvider:     assetObjForEmail.simProvider,
            keyboard:        assetObjForEmail.keyboard,
            mouse:           assetObjForEmail.mouse,
            monitorBrand:    assetObjForEmail.monitorBrand,
            monitorModel:    assetObjForEmail.monitorModel,
            monitorSize:     assetObjForEmail.monitorSize,
            accessories:     assetObjForEmail.accessories,
            managerEmail,
            reason:          reason ?? "",
            ackToken,
          },
        });
      }
    } catch { /* non-fatal — email must not block the assignment */ }

    // Log assignment to history (non-fatal)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const assetObj = assets.find(a => a.assetId === assetId);
      const { error: histErr } = await supabase.from("asset_assignment_history").insert({
        asset_id:   assetId,
        asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
        user_id:    userId,
        user_name:  userName,
        user_email: userEmail,
        user_ecode: assignedEcode,
        department: department,
        event_type: "assigned",
        event_by:   authUser?.id ?? null,
        notes:      handoverNote ?? null,
      });
      if (histErr) console.warn("[history] failed to log assignment", histErr);
    } catch (e) { console.warn("[history] failed to log assignment", e); /* non-fatal — must not block the assignment */ }
  };

  const returnAsset = async (assetId: string, finalStatus: AssetStatus, returnNote?: string): Promise<void> => {
    // Capture current assignment info before clearing
    const assetObj = assets.find(a => a.assetId === assetId);
    const coreUpdates: Record<string, unknown> = {
      status: finalStatus, assigned_to: null, assigned_email: null, assigned_to_name: null, assigned_at: null, department: null, ack_token: null, acknowledged: false, acknowledged_at: null,
    };
    const { error } = await supabase.from("assets").update(coreUpdates).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    if (returnNote) {
      await supabase.from("assets").update({ remarks: returnNote }).eq("asset_id", assetId);
    }
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: finalStatus, assignedTo: undefined, assignedEmail: undefined, department: undefined }
        : a
    ));
    // Log return to history (non-fatal)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { error: histErr } = await supabase.from("asset_assignment_history").insert({
        asset_id:   assetId,
        asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
        user_name:  assetObj?.assignedTo ?? null,
        user_email: assetObj?.assignedEmail ?? null,
        user_ecode: (assetObj as { assignedEcode?: string } | undefined)?.assignedEcode ?? null,
        department: assetObj?.department ?? null,
        event_type: "returned",
        event_by:   authUser?.id ?? null,
        notes:      returnNote ?? null,
      });
      if (histErr) console.warn("[history] failed to log return", histErr);
    } catch (e) { console.warn("[history] failed to log return", e); /* non-fatal */ }
  };

  const updateStatus = async (assetId: string, status: AssetStatus): Promise<void> => {
    // An asset that returns to "Available" is back in inventory and must NOT
    // keep a stale assigned user. Clear the assignment fields in the same write
    // and log a "returned" history event capturing who it came back from.
    // Any other status change (Under Repair, Retired, Lost…) only touches status.
    if (status === "Available") {
      const assetObj = assets.find(a => a.assetId === assetId);
      const { error } = await supabase
        .from("assets")
        .update({
          status:          "Available",
          assigned_to:     null,
          assigned_email:  null,
          assigned_to_name:null,
          assigned_at:     null,
          department:      null,
          ack_token:       null,
          acknowledged:    false,
          acknowledged_at: null,
        })
        .eq("asset_id", assetId);
      if (error) throw new Error(error.message);
      setAssets(prev => prev.map(a =>
        a.assetId === assetId
          ? { ...a, status: "Available", assignedTo: undefined, assignedEmail: undefined, assignedEcode: undefined, department: undefined, assignedAt: undefined, ackToken: undefined, acknowledged: false, acknowledgedAt: undefined }
          : a
      ));
      // Log return to history only if it was actually assigned to someone (non-fatal)
      if (assetObj?.assignedTo || assetObj?.assignedEmail) {
        try {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          await supabase.from("asset_assignment_history").insert({
            asset_id:   assetId,
            asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
            user_name:  assetObj?.assignedTo ?? null,
            user_email: assetObj?.assignedEmail ?? null,
            user_ecode: (assetObj as { assignedEcode?: string } | undefined)?.assignedEcode ?? null,
            department: assetObj?.department ?? null,
            event_type: "returned",
            event_by:   authUser?.id ?? null,
          });
        } catch (e) { console.warn("[history] failed to log return", e); /* non-fatal */ }
      }
      return;
    }
    const { error } = await supabase.from("assets").update({ status }).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a => a.assetId === assetId ? { ...a, status } : a));
  };

  const unassignAsset = async (assetId: string): Promise<void> => {
    // Capture current assignment info before it is cleared, so we can log who
    // the asset was unassigned from.
    const assetObj = assets.find(a => a.assetId === assetId);
    const { error } = await supabase
      .from("assets")
      .update({ status: "Available", assigned_to: null, assigned_email: null, assigned_to_name: null, assigned_at: null, department: null, ack_token: null, acknowledged: false, acknowledged_at: null })
      .eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: "Available", assignedTo: undefined, assignedEmail: undefined, department: undefined }
        : a
    ));
    // Log unassignment to history (non-fatal)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { error: histErr } = await supabase.from("asset_assignment_history").insert({
        asset_id:   assetId,
        asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
        user_name:  assetObj?.assignedTo ?? null,
        user_email: assetObj?.assignedEmail ?? null,
        user_ecode: (assetObj as { assignedEcode?: string } | undefined)?.assignedEcode ?? null,
        department: assetObj?.department ?? null,
        event_type: "unassigned",
        event_by:   authUser?.id ?? null,
      });
      if (histErr) console.warn("[history] failed to log unassignment", histErr);
    } catch (e) { console.warn("[history] failed to log unassignment", e); /* non-fatal */ }
  };

  const deleteAssets = async (ids: string[]): Promise<void> => {
    const { error } = await supabase.from("assets").delete().in("asset_id", ids);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.filter(a => !ids.includes(a.assetId)));
  };

  const resetAcknowledgement = async (assetId: string): Promise<void> => {
    const { error } = await supabase
      .from("assets")
      .update({ acknowledged: false, acknowledged_at: null, asset_photos: null })
      .eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, acknowledged: false, acknowledgedAt: undefined, assetPhotos: undefined }
        : a
    ));
  };

  const markAcknowledged = async (assetId: string): Promise<void> => {
    const ackAt = new Date().toISOString();
    const { error } = await supabase
      .from("assets")
      .update({ acknowledged: true, acknowledged_at: ackAt })
      .eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, acknowledged: true, acknowledgedAt: ackAt }
        : a
    ));
  };

  const bulkMarkAcknowledged = async (assetIds: string[]): Promise<void> => {
    if (assetIds.length === 0) return;
    const ackAt = new Date().toISOString();
    // Only flip assets that are genuinely Assigned + still pending, so stale
    // selections or races can never acknowledge an ineligible asset.
    const { error } = await supabase
      .from("assets")
      .update({ acknowledged: true, acknowledged_at: ackAt })
      .in("asset_id", assetIds)
      .eq("status", "Assigned")
      .eq("acknowledged", false);
    if (error) throw new Error(error.message);
    const idSet = new Set(assetIds);
    setAssets(prev => prev.map(a =>
      idSet.has(a.assetId) && a.status === "Assigned" && !a.acknowledged
        ? { ...a, acknowledged: true, acknowledgedAt: ackAt }
        : a
    ));
  };

  const bulkAssignAssets = async (
    assetIds: string[], userId: string, userName: string, userEmail: string,
    department: string, handoverNote?: string, reason?: string
  ): Promise<void> => {
    const assignedAt = new Date().toISOString();

    // 1. Assign each asset in DB (parallel) with its own ack token
    const tokens: Record<string, string> = {};
    await Promise.all(assetIds.map(async assetId => {
      const ackToken = crypto.randomUUID();
      tokens[assetId] = ackToken;
      const coreUpdates: Record<string, unknown> = {
        status: "Assigned", assigned_to: userId, assigned_email: userEmail,
        department, assigned_at: assignedAt, ack_token: ackToken,
        acknowledged: false, acknowledged_at: null,
      };
      await supabase.from("assets").update(coreUpdates).eq("asset_id", assetId);
      await supabase.from("assets").update({ assigned_to_name: userName }).eq("asset_id", assetId);
      if (handoverNote) {
        await supabase.from("assets").update({ remarks: handoverNote }).eq("asset_id", assetId);
      }
    }));

    // 2. Update local state for all assigned assets
    setAssets(prev => prev.map(a =>
      assetIds.includes(a.assetId)
        ? { ...a, status: "Assigned" as AssetStatus, assignedTo: userName, assignedEmail: userEmail,
            department, assignedAt, ackToken: tokens[a.assetId], acknowledged: false, acknowledgedAt: undefined }
        : a
    ));

    // 3. Resolve manager email (non-fatal) — email stored directly (new) or name lookup (legacy)
    let managerEmail: string | undefined;
    try {
      const { data: userProfile } = await supabase.from("profiles").select("reporting_manager").eq("id", userId).single();
      const rmValue = (userProfile as { reporting_manager?: string } | null)?.reporting_manager?.trim();
      if (rmValue) {
        if (rmValue.includes("@")) {
          managerEmail = rmValue;
        } else {
          const { data: mgr } = await supabase.from("profiles").select("email").ilike("full_name", rmValue).maybeSingle();
          managerEmail = (mgr as { email?: string } | null)?.email ?? undefined;
        }
      }
    } catch { /* non-fatal */ }

    // 4. Send ONE combined email with all assets (non-fatal)
    try {
      const assetObjs = assetIds.map(id => assets.find(a => a.assetId === id)).filter(Boolean) as typeof assets;
      if (assetObjs.length > 0 && userEmail) {
        await supabase.functions.invoke("send-bulk-assignment-email", {
          body: {
            toEmail: userEmail,
            toName:  userName,
            assets:  assetObjs.map(a => ({
              assetId:          a.assetId,
              assetType:        a.assetType,
              brand:            a.brand,
              model:            a.model,
              serialNumber:     a.serialNumber,
              processor:        a.processor,
              ram:              a.ram,
              storage:          a.storage,
              operatingSystem:  a.operatingSystem,
              imei1:            a.imeiNumber,
              imei2:            a.imei2,
              phoneNumber:      a.phoneNumber,
              simProvider:      a.simProvider,
              keyboard:         a.keyboard,
              mouse:            a.mouse,
              monitorBrand:     a.monitorBrand,
              monitorModel:     a.monitorModel,
              monitorSize:      a.monitorSize,
              accessories:      a.accessories,
              ackToken:         tokens[a.assetId],
            })),
            managerEmail,
            reason:      reason ?? "",
            handoverNote: handoverNote ?? "",
          },
        });
      }
    } catch { /* non-fatal */ }

    // 5. Log history for each asset (non-fatal)
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      const { data: ecodeRow } = await supabase.from("profiles").select("ecode").eq("id", userId).single();
      const { error: histErr } = await supabase.from("asset_assignment_history").insert(
        assetIds.map(assetId => {
          const assetObj = assets.find(a => a.assetId === assetId);
          return {
            asset_id:   assetId,
            asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
            user_id:    userId, user_name: userName, user_email: userEmail,
            user_ecode: (ecodeRow as { ecode?: string } | null)?.ecode ?? null,
            department, event_type: "assigned", event_by: authUser?.id ?? null,
            notes: handoverNote ?? null,
          };
        })
      );
      if (histErr) console.warn("[history] failed to log bulk assignment", histErr);
    } catch (e) { console.warn("[history] failed to log bulk assignment", e); /* non-fatal */ }
  };

  // Condition is written through a SECURITY DEFINER RPC (set_asset_condition) so a
  // location_gm can update condition on their own location's assets without being
  // granted a broad UPDATE on the assets table.
  const updateAssetCondition = async (
    assetId: string, condition: AssetCondition, notes?: string
  ): Promise<void> => {
    const target = assets.find(a => a.assetId === assetId);
    if (!target?.id) throw new Error("Asset not found");
    const { data, error } = await supabase.rpc("set_asset_condition", {
      p_asset_id: target.id, p_condition: condition, p_notes: notes ?? null,
    });
    if (error) throw new Error(error.message);
    const res = data as { success?: boolean; error?: string } | null;
    if (!res?.success) throw new Error(res?.error ?? "Failed to update condition");
    const now = new Date().toISOString();
    setAssets(prev => prev.map(a => a.assetId === assetId
      ? { ...a, condition, conditionNotes: notes, conditionUpdatedAt: now }
      : a));
  };

  return (
    <AssetContext.Provider value={{
      assets, loading, error, getAsset, refresh: fetchAssets,
      addAsset, addAssets, updateAsset, assignAsset, bulkAssignAssets, returnAsset,
      updateStatus, unassignAsset, deleteAssets, resetAcknowledgement, markAcknowledged,
      bulkMarkAcknowledged, updateAssetCondition,
    }}>
      {children}
    </AssetContext.Provider>
  );
}

export function useAssets() {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error("useAssets must be used inside AssetProvider");
  return ctx;
}
