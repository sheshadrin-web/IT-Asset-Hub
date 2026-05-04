import { createContext, useContext, useState, ReactNode } from "react";
import { Asset, AssetStatus, mockAssets } from "@/data/mockData";

interface AssetContextType {
  assets: Asset[];
  getAsset: (id: string) => Asset | undefined;
  addAsset: (data: Omit<Asset, "assetId">) => Asset;
  addAssets: (data: Omit<Asset, "assetId">[]) => Asset[];
  updateAsset: (asset: Asset) => void;
  assignAsset: (assetId: string, userName: string, department: string) => void;
  updateStatus: (assetId: string, status: AssetStatus) => void;
  unassignAsset: (assetId: string) => void;
  deleteAssets: (ids: string[]) => void;
}

const AssetContext = createContext<AssetContextType | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>(mockAssets);

  const getAsset = (id: string) => assets.find((a) => a.assetId === id);

  const nextId = (current: Asset[]) => {
    const ids = current.map((a) => parseInt(a.assetId.replace("AST-", ""), 10));
    return ids.length > 0 ? Math.max(...ids) + 1 : 1;
  };

  const addAsset = (data: Omit<Asset, "assetId">): Asset => {
    let newAsset!: Asset;
    setAssets((prev) => {
      const num = nextId(prev);
      newAsset = { ...data, assetId: `AST-${String(num).padStart(3, "0")}` };
      return [...prev, newAsset];
    });
    return newAsset;
  };

  const addAssets = (dataList: Omit<Asset, "assetId">[]): Asset[] => {
    const created: Asset[] = [];
    setAssets((prev) => {
      let base = nextId(prev);
      const newOnes = dataList.map((data) => {
        const a: Asset = { ...data, assetId: `AST-${String(base).padStart(3, "0")}` };
        base++;
        created.push(a);
        return a;
      });
      return [...prev, ...newOnes];
    });
    return created;
  };

  const updateAsset = (asset: Asset) => {
    setAssets((prev) => prev.map((a) => (a.assetId === asset.assetId ? asset : a)));
  };

  const assignAsset = (assetId: string, userName: string, department: string) => {
    setAssets((prev) =>
      prev.map((a) =>
        a.assetId === assetId
          ? { ...a, status: "Assigned", assignedTo: userName, department }
          : a
      )
    );
  };

  const updateStatus = (assetId: string, status: AssetStatus) => {
    setAssets((prev) =>
      prev.map((a) => (a.assetId === assetId ? { ...a, status } : a))
    );
  };

  const unassignAsset = (assetId: string) => {
    setAssets((prev) =>
      prev.map((a) =>
        a.assetId === assetId
          ? { ...a, status: "Available", assignedTo: undefined, department: undefined }
          : a
      )
    );
  };

  const deleteAssets = (ids: string[]) => {
    setAssets((prev) => prev.filter((a) => !ids.includes(a.assetId)));
  };

  return (
    <AssetContext.Provider
      value={{ assets, getAsset, addAsset, addAssets, updateAsset, assignAsset, updateStatus, unassignAsset, deleteAssets }}
    >
      {children}
    </AssetContext.Provider>
  );
}

export function useAssets() {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error("useAssets must be used inside AssetProvider");
  return ctx;
}
