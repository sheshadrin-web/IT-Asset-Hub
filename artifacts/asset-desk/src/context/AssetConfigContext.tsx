import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode,
} from "react";
import { supabase, supabaseConfigured } from "@/lib/supabaseClient";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GroupName = "Main Devices" | "Accessories" | "Fixed Assets";
export type FieldType =
  | "text" | "number" | "date" | "dropdown"
  | "multi_select" | "checkbox" | "url" | "file_upload";

export interface AssetTypeConfig {
  id:         string;
  name:       string;
  group_name: GroupName;
  emoji:      string;
  sort_order: number;
  is_active:  boolean;
  created_at: string;
  updated_at: string;
}

export interface AssetFieldConfig {
  id:            string;
  asset_type_id: string;
  field_key:     string;
  label:         string;
  field_type:    FieldType;
  is_required:   boolean;
  is_visible:    boolean;
  sort_order:    number;
  options:       string[] | null;
  placeholder:   string | null;
  help_text:     string | null;
  section:       string | null;
  created_at:    string;
  updated_at:    string;
}

export interface GroupedTypes {
  label:  GroupName;
  types:  AssetTypeConfig[];
}

interface AssetConfigContextValue {
  assetTypes:        AssetTypeConfig[];
  assetFields:       AssetFieldConfig[];
  loading:           boolean;
  error:             string | null;
  configured:        boolean;
  reload:            () => void;
  getFieldsForType:  (typeId: string) => AssetFieldConfig[];
  getTypeByName:     (name: string)   => AssetTypeConfig | undefined;
  getTypeById:       (id: string)     => AssetTypeConfig | undefined;
  groupedTypes:      GroupedTypes[];
  allActiveTypes:    AssetTypeConfig[];
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AssetConfigContext = createContext<AssetConfigContextValue | null>(null);

const GROUP_ORDER: GroupName[] = ["Main Devices", "Accessories", "Fixed Assets"];

export function AssetConfigProvider({ children }: { children: ReactNode }) {
  const [assetTypes,  setAssetTypes]  = useState<AssetTypeConfig[]>([]);
  const [assetFields, setAssetFields] = useState<AssetFieldConfig[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [configured,  setConfigured]  = useState(false);

  const load = useCallback(async () => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const [typesRes, fieldsRes] = await Promise.all([
      supabase.from("schema_asset_types").select("*").order("sort_order"),
      supabase.from("schema_asset_fields").select("*").order("sort_order"),
    ]);

    if (typesRes.error) {
      // Table might not exist yet (before migration runs)
      setError(typesRes.error.message);
    } else {
      setAssetTypes(typesRes.data as AssetTypeConfig[]);
      setConfigured(true);
    }

    if (!fieldsRes.error) {
      const normalized = (fieldsRes.data as (Omit<AssetFieldConfig, "options"> & { options: unknown })[]).map(f => ({
        ...f,
        options: Array.isArray(f.options) ? (f.options as string[]) : null,
      }));
      setAssetFields(normalized as AssetFieldConfig[]);
    }

    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const getFieldsForType = useCallback(
    (typeId: string) => assetFields.filter(f => f.asset_type_id === typeId).sort((a, b) => a.sort_order - b.sort_order),
    [assetFields],
  );

  const getTypeByName = useCallback(
    (name: string) => assetTypes.find(t => t.name === name),
    [assetTypes],
  );

  const getTypeById = useCallback(
    (id: string) => assetTypes.find(t => t.id === id),
    [assetTypes],
  );

  const allActiveTypes = assetTypes.filter(t => t.is_active);

  const groupedTypes: GroupedTypes[] = GROUP_ORDER.map(label => ({
    label,
    types: allActiveTypes.filter(t => t.group_name === label),
  })).filter(g => g.types.length > 0);

  return (
    <AssetConfigContext.Provider value={{
      assetTypes, assetFields, loading, error, configured,
      reload: load,
      getFieldsForType, getTypeByName, getTypeById,
      groupedTypes, allActiveTypes,
    }}>
      {children}
    </AssetConfigContext.Provider>
  );
}

export function useAssetConfig() {
  const ctx = useContext(AssetConfigContext);
  if (!ctx) throw new Error("useAssetConfig must be used inside AssetConfigProvider");
  return ctx;
}
