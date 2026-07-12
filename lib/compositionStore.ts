import { create } from "zustand";
import type { CompositionItem, EnvTransform } from "./db";

// The live composition scene (§7b): a set of characters placed on a ground
// plane, each independently selectable + posable. This store holds the LIVE
// arrangement; lib/compositions.ts saves/loads it to the `compositions` table
// so a scene (with each character's persisted pose) survives across sessions.

export type { CompositionItem, EnvTransform } from "./db";

export type ComposeMode = "place" | "pose";

/** How the imported world renders: a GLB triangle mesh, or a Gaussian splat
 * (drei <Splat>, the compact .splat format). Detected by file extension. */
export type EnvironmentKind = "mesh" | "splat";

interface CompositionStore {
  items: CompositionItem[];
  selectedId: string | null;
  mode: ComposeMode;
  /** imported World Labs Marble world (asset id), a fixed backdrop */
  environmentAssetId: string | null;
  /** GLB mesh vs Gaussian splat, so the scene picks the right renderer */
  environmentKind: EnvironmentKind | null;
  env: EnvTransform;
  /** id of the saved CompositionRow currently loaded (null = unsaved scene) */
  loadedId: string | null;
  addItem: (characterId: string) => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<CompositionItem>) => void;
  select: (id: string | null) => void;
  setMode: (mode: ComposeMode) => void;
  setEnvironment: (assetId: string | null, kind?: EnvironmentKind | null) => void;
  updateEnv: (patch: Partial<EnvTransform>) => void;
  /** replace the live scene with a saved arrangement */
  hydrate: (state: {
    items: CompositionItem[];
    env: EnvTransform;
    environmentAssetId: string | null;
    environmentKind: EnvironmentKind | null;
    loadedId: string | null;
  }) => void;
  setLoadedId: (loadedId: string | null) => void;
  clear: () => void;
}

export const useCompositionStore = create<CompositionStore>((set, get) => ({
  items: [],
  selectedId: null,
  mode: "place",
  environmentAssetId: null,
  environmentKind: null,
  env: { scale: 1, y: 0, rotY: 0 },
  loadedId: null,
  addItem: (characterId) => {
    const id = crypto.randomUUID();
    // stagger new characters along x so they don't stack
    const n = get().items.length;
    const x = ((n % 2 === 0 ? 1 : -1) * Math.ceil(n / 2)) * 0.9;
    set((s) => ({
      items: [...s.items, { id, characterId, x, z: 0, rotY: 0, scale: 1 }],
      selectedId: id,
    }));
  },
  removeItem: (id) =>
    set((s) => ({
      items: s.items.filter((i) => i.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    })),
  updateItem: (id, patch) =>
    set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  select: (selectedId) => set({ selectedId }),
  setMode: (mode) => set({ mode }),
  setEnvironment: (environmentAssetId, environmentKind = null) =>
    set({ environmentAssetId, environmentKind, env: { scale: 1, y: 0, rotY: 0 } }),
  updateEnv: (patch) => set((s) => ({ env: { ...s.env, ...patch } })),
  hydrate: ({ items, env, environmentAssetId, environmentKind, loadedId }) =>
    set({ items, env, environmentAssetId, environmentKind, loadedId, selectedId: null, mode: "place" }),
  setLoadedId: (loadedId) => set({ loadedId }),
  clear: () =>
    set({
      items: [],
      selectedId: null,
      mode: "place",
      environmentAssetId: null,
      environmentKind: null,
      env: { scale: 1, y: 0, rotY: 0 },
      loadedId: null,
    }),
}));
