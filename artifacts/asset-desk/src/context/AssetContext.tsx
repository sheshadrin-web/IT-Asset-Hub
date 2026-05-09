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
    productNumber:   row.product_number  ? String(row.product_number)  : undefined,
    processor:       row.processor       ? String(row.processor)       : undefined,
    ram:             row.ram             ? String(row.ram)             : undefined,
    operatingSystem: row.operating_system ? String(row.operating_system) : undefined,
    storage:         row.storage         ? String(row.storage)         : undefined,
    imeiNumber:      row.imei_1          ? String(row.imei_1)          : undefined,
    imei2:           row.imei_2          ? String(row.imei_2)          : undefined,
    simNumber:       row.sim_number      ? String(row.sim_number)      : undefined,
    phoneNumber:     row.phone_number    ? String(row.phone_number)    : undefined,
    purchaseDate:    String(row.purchase_date ?? ""),
    warrantyEndDate: String(row.warranty_end_date ?? ""),
    vendor:          row.vendor          ? String(row.vendor)          : undefined,
    invoice:         row.invoice         ? String(row.invoice)         : undefined,
    status:          (row.status as AssetStatus) ?? "Available",
    assignedTo:      row.assigned_to     ? String(row.assigned_to)    : undefined,
    assignedEmail:   row.assigned_email  ? String(row.assigned_email) : undefined,
    department:      row.department      ? String(row.department)     : undefined,
    location:        String(row.location ?? ""),
    accessories:     String(row.accessories ?? ""),
    remarks:         String(row.remarks ?? ""),
  };
}

function mapToDB(data: Omit<Asset, "assetId" | "id">, assetId: string): Record<string, unknown> {
  return {
    asset_id:          assetId,
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
    purchase_date:     data.purchaseDate,
    warranty_end_date: data.warrantyEndDate,
    vendor:            data.vendor           ?? null,
    invoice:           data.invoice          ?? null,
    status:            data.status,
    assigned_to:       data.assignedTo       ?? null,
    assigned_email:    data.assignedEmail    ?? null,
    department:        data.department       ?? null,
    location:          data.location,
    accessories:       data.accessories      ?? "",
    remarks:           data.remarks          ?? "",
  };
}

function nextAssetId(existing: Asset[]): string {
  const nums = existing
    .map(a => parseInt(a.assetId.replace("AST-", ""), 10))
    .filter(n => !isNaN(n));
  const n = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `AST-${String(n).padStart(3, "0")}`;
}

interface AssetContextType {
  assets:        Asset[];
  loading:       boolean;
  getAsset:      (id: string) => Asset | undefined;
  refresh:       () => Promise<void>;
  addAsset:      (data: Omit<Asset, "assetId" | "id">) => Promise<Asset>;
  addAssets:     (dataList: Omit<Asset, "assetId" | "id">[]) => Promise<Asset[]>;
  updateAsset:   (asset: Asset) => Promise<void>;
  assignAsset:   (assetId: string, userName: string, userEmail: string, department: string, handoverNote?: string) => Promise<void>;
  returnAsset:   (assetId: string, finalStatus: AssetStatus, returnNote?: string) => Promise<void>;
  updateStatus:  (assetId: string, status: AssetStatus) => Promise<void>;
  unassignAsset: (assetId: string) => Promise<void>;
  deleteAssets:  (ids: string[]) => Promise<void>;
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
      .select("*")
      .order("created_at", { ascending: false });
    if (!error && data) setAssets(data.map(mapFromDB));
    setLoading(false);
  }, []);

  useEffect(() => { fetchAssets(); }, [fetchAssets]);

  const getAsset = (id: string) => assets.find(a => a.assetId === id);

  const addAsset = async (data: Omit<Asset, "assetId" | "id">): Promise<Asset> => {
    const assetId = nextAssetId(assets);
    const row = mapToDB(data, assetId);
    const { data: inserted, error } = await supabase
      .from("assets").insert(row).select().single();
    if (error || !inserted) throw new Error(error?.message ?? "Failed to add asset");
    const newAsset = mapFromDB(inserted as Record<string, unknown>);
    setAssets(prev => [newAsset, ...prev]);
    return newAsset;
  };

  const addAssets = async (dataList: Omit<Asset, "assetId" | "id">[]): Promise<Asset[]> => {
    const created: Asset[] = [];
    let current = [...assets];
    for (const data of dataList) {
      const assetId = nextAssetId(current);
      const row = mapToDB(data, assetId);
      const { data: inserted, error } = await supabase
        .from("assets").insert(row).select().single();
      if (!error && inserted) {
        const a = mapFromDB(inserted as Record<string, unknown>);
        created.push(a);
        current = [a, ...current];
      }
    }
    await fetchAssets();
    return created;
  };

  const updateAsset = async (asset: Asset): Promise<void> => {
    const row = mapToDB(asset, asset.assetId);
    const { error } = await supabase
      .from("assets").update(row).eq("asset_id", asset.assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a => a.assetId === asset.assetId ? { ...a, ...asset } : a));
  };

  const assignAsset = async (
    assetId: string, userName: string, userEmail: string, department: string, handoverNote?: string
  ): Promise<void> => {
    const updates: Record<string, unknown> = {
      status: "Assigned", assigned_to: userName, assigned_email: userEmail, department,
    };
    if (handoverNote) updates.remarks = handoverNote;
    const { error } = await supabase.from("assets").update(updates).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: "Assigned", assignedTo: userName, assignedEmail: userEmail, department }
        : a
    ));
  };

  const returnAsset = async (assetId: string, finalStatus: AssetStatus, returnNote?: string): Promise<void> => {
    const updates: Record<string, unknown> = {
      status: finalStatus, assigned_to: null, assigned_email: null,
    };
    if (returnNote) updates.remarks = returnNote;
    const { error } = await supabase.from("assets").update(updates).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a =>
      a.assetId === assetId
        ? { ...a, status: finalStatus, assignedTo: undefined, assignedEmail: undefined }
        : a
    ));
  };

  const updateStatus = async (assetId: string, status: AssetStatus): Promise<void> => {
    const { error } = await supabase.from("assets").update({ status }).eq("asset_id", assetId);
    if (error) throw new Error(error.message);
    setAssets(prev => prev.map(a => a.assetId === assetId ? { ...a, status } : a));
  };

  const unassignAsset = async (assetId: string): Promise<void> => {
    const { error } = await supabase
      .from("assets")
      .update({ status: "Available", assigned_to: null, assigned_email: null, department: null })
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

  return (
    <AssetContext.Provider value={{
      assets, loading, getAsset, refresh: fetchAssets,
      addAsset, addAssets, updateAsset, assignAsset, returnAsset,
      updateStatus, unassignAsset, deleteAssets,
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
