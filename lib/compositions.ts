import { db, type CompositionItem, type CompositionRow, type EnvTransform } from "./db";

// Saved compositions (§7b v2). The live arrangement lives in
// lib/compositionStore.ts; these helpers persist it to the `compositions`
// table. Poses aren't stored here — each character's pose lives on the
// character (poseRotations), so reloading places everyone at their pose.

export async function saveComposition(args: {
  id?: string | null;
  projectId: string;
  name: string;
  items: CompositionItem[];
  env: EnvTransform;
  environmentAssetId: string | null;
  environmentKind: "mesh" | "splat" | null;
}): Promise<CompositionRow> {
  const now = Date.now();
  const existing = args.id ? await db.compositions.get(args.id) : undefined;
  const row: CompositionRow = {
    id: existing?.id ?? crypto.randomUUID(),
    projectId: args.projectId,
    name: args.name,
    items: args.items,
    env: args.env,
    environmentAssetId: args.environmentAssetId,
    environmentKind: args.environmentKind,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.compositions.put(row);
  return row;
}

export async function deleteComposition(id: string): Promise<void> {
  await db.compositions.delete(id);
}
