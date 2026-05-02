import { createContext, useContext, useState, ReactNode } from "react";
import { Asset, AssetStatus, mockAssets } from "@/data/mockData";

interface AssetContextType {
  assets: Asset[];
  getAsset: (id: string) => Asset | undefined;
  addAsset: (data: Omit<Asset, "assetId">) => Asset;
  updateAsset: (asset: Asset) => void;
  assignAsset: (assetId: string, userName: string, department: string) => void;
  updateStatus: (assetId: string, status: AssetStatus) => void;
  unassignAsset: (assetId: string) => void;
}

const AssetContext = createContext<AssetContextType | null>(null);

export function AssetProvider({ children }: { children: ReactNode }) {
  const [assets, setAssets] = useState<Asset[]>(mockAssets);

  const getAsset = (id: string) => assets.find((a) => a.assetId === id);

  const addAsset = (data: Omit<Asset, "assetId">): Asset => {
    const ids = assets.map((a) => parseInt(a.assetId.replace("AST-", ""), 10));
    const nextNum = ids.length > 0 ? Math.max(...ids) + 1 : 1;
    const newAsset: Asset = {
      ...data,
      assetId: `AST-${String(nextNum).padStart(3, "0")}`,
    };
    setAssets((prev) => [...prev, newAsset]);
    return newAsset;
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

  return (
    <AssetContext.Provider value={{ assets, getAsset, addAsset, updateAsset, assignAsset, updateStatus, unassignAsset }}>
      {children}
    </AssetContext.Provider>
  );
}

export function useAssets() {
  const ctx = useContext(AssetContext);
  if (!ctx) throw new Error("useAssets must be used inside AssetProvider");
  return ctx;
}
