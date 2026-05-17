import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";
import { Asset, AssetStatus, AssetType } from "@/data/mockData";

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
    monitor_brand:     data.monitorBrand     ?? null,
    monitor_model:     data.monitorModel     ?? null,
    monitor_size:      data.monitorSize      ?? null,
    keyboard:          data.keyboard         ?? null,
    mouse:             data.mouse            ?? null,
    cpu:               data.cpu              ?? null,
    others:            data.others           ?? null,
    purchase_date:     data.purchaseDate,
    warranty_end_date: data.warrantyEndDate,
    vendor:            data.vendor           ?? null,
    invoice:           data.invoice          ?? null,
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
}

const AssetContext = createContext<AssetContextType | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAssets = useCallback(async () => {
    if (!supabaseConfigured) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("assets")
      .select("*, profiles!assets_assigned_to_fkey(full_name, email, ecode)")
      .order("created_at", { ascending: false });
    if (!error && data) setAssets(data.map(mapFromDB));
    setLoading(false);
  }, []);

  // Fetch once on mount, then re-fetch whenever auth session changes (so end
  // users — whose RLS-filtered view depends on having a valid JWT — always see
  // their own assets even if the session was not yet hydrated on first render.
  useEffect(() => { fetchAssets(); }, [fetchAssets]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) fetchAssets();
    });
    return () => subscription.unsubscribe();
  }, [fetchAssets]);

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
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: "Assigned", assignedTo: userName, assignedEmail: userEmail, department, assignedAt, ackToken, acknowledged: false, acknowledgedAt: undefined }
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
      const { data: ecodeRow } = await supabase.from("profiles").select("ecode").eq("id", userId).single();
      const assetObj = assets.find(a => a.assetId === assetId);
      await supabase.from("asset_assignment_history").insert({
        asset_id:   assetId,
        asset_name: assetObj ? `${assetObj.brand} ${assetObj.model}` : assetId,
        user_id:    userId,
        user_name:  userName,
        user_email: userEmail,
        user_ecode: (ecodeRow as { ecode?: string } | null)?.ecode ?? null,
        department: department,
        event_type: "assigned",
        event_by:   authUser?.id ?? null,
        notes:      handoverNote ?? null,
      });
    } catch { /* non-fatal — history logging must not block the assignment */ }
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
      await supabase.from("asset_assignment_history").insert({
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
    } catch { /* non-fatal */ }
  };

  const updateStatus = async (assetId: string, status: AssetStatus): Promise<void> => {
    const { error } = await supabase.from("assets").update({ status }).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a => a.assetId === assetId ? { ...a, status } : a));
  };

  const unassignAsset = async (assetId: string): Promise<void> => {
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
      await supabase.from("asset_assignment_history").insert(
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
    } catch { /* non-fatal */ }
  };

  return (
    <AssetContext.Provider value={{
      assets, loading, getAsset, refresh: fetchAssets,
      addAsset, addAssets, updateAsset, assignAsset, bulkAssignAssets, returnAsset,
      updateStatus, unassignAsset, deleteAssets, resetAcknowledgement,
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
