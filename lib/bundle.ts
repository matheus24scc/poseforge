import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import {
  db,
  type AssetRow,
  type CharacterRow,
  type GenerationRow,
  type ProjectRow,
  type StageKey,
  type TimelineRow,
} from "./db";
import { getStage } from "./stages";
import { getAssetBlob } from "./assets";

// .poseforge bundle: the portable project — a zip with a manifest plus the
// content-addressed blobs it references. Share it like a CAD file; import
// restores a fully working copy (new ids, so re-imports become copies).

const BUNDLE_VERSION = 1;

interface Manifest {
  version: number;
  exportedAt: number;
  project: ProjectRow;
  characters: CharacterRow[];
  generations: GenerationRow[];
  timelines: TimelineRow[];
  assets: AssetRow[];
}

const STAGE_KEYS: StageKey[] = ["source", "extract", "sheet", "mesh", "rig"];

function collectAssetIds(
  characters: CharacterRow[],
  generations: GenerationRow[],
  timelines: TimelineRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const ch of characters) {
    for (const key of STAGE_KEYS) {
      for (const v of getStage(ch, key).versions) {
        if (v.assetId) ids.add(v.assetId);
        for (const id of v.viewIds ?? []) ids.add(id);
      }
    }
  }
  for (const g of generations) {
    ids.add(g.outputAssetId);
    for (const id of g.refAssetIds) ids.add(id);
  }
  for (const t of timelines) {
    for (const kf of t.keyframes) if (kf.stillAssetId) ids.add(kf.stillAssetId);
    for (const seg of Object.values(t.segments)) if (seg.videoAssetId) ids.add(seg.videoAssetId);
  }
  return ids;
}

export async function exportProject(projectId: string): Promise<{ blob: Blob; name: string }> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error("Project not found");
  const characters = await db.characters.where("projectId").equals(projectId).toArray();
  const charIds = new Set(characters.map((c) => c.id));
  const generations = (await db.generations.toArray()).filter((g) => charIds.has(g.characterId));
  const timelines = (await db.timelines.toArray()).filter((t) => charIds.has(t.characterId));

  const assetIds = collectAssetIds(characters, generations, timelines);
  const assets: AssetRow[] = [];
  const files: Record<string, Uint8Array> = {};
  for (const id of assetIds) {
    const row = await db.assets.get(id);
    const blob = await getAssetBlob(id);
    if (!row || !blob) continue; // missing bytes are skipped, not fatal
    assets.push(row);
    files[`blobs/${id}`] = new Uint8Array(await blob.arrayBuffer());
  }

  const manifest: Manifest = {
    version: BUNDLE_VERSION,
    exportedAt: Date.now(),
    project,
    characters,
    generations,
    timelines,
    assets,
  };
  files["manifest.json"] = strToU8(JSON.stringify(manifest));

  const zipped = zipSync(files, { level: 6 });
  const safe = project.name.replace(/[^\w.-]+/g, "_") || "project";
  return {
    blob: new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" }),
    name: `${safe}.poseforge`,
  };
}

export async function importBundle(file: File): Promise<ProjectRow> {
  const unzipped = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const manifestBytes = unzipped["manifest.json"];
  if (!manifestBytes) throw new Error("Not a .poseforge bundle (no manifest)");
  const manifest = JSON.parse(strFromU8(manifestBytes)) as Manifest;
  if (manifest.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported bundle version ${manifest.version}`);
  }

  // assets are content-addressed — put blobs first, skipping ones we have
  for (const asset of manifest.assets) {
    const bytes = unzipped[`blobs/${asset.id}`];
    if (!bytes) continue;
    if (!(await db.assets.get(asset.id))) await db.assets.put(asset);
    if (!(await db.blobs.get(asset.id))) {
      await db.blobs.put({
        id: asset.id,
        blob: new Blob([bytes.buffer as ArrayBuffer], { type: asset.mime }),
      });
    }
  }

  // fresh ids so importing twice makes a copy instead of colliding
  const projectId = crypto.randomUUID();
  const charMap = new Map(manifest.characters.map((c) => [c.id, crypto.randomUUID()]));
  const project: ProjectRow = {
    ...manifest.project,
    id: projectId,
    name: manifest.project.name,
    createdAt: Date.now(),
  };
  await db.projects.add(project);
  for (const ch of manifest.characters) {
    await db.characters.add({ ...ch, id: charMap.get(ch.id)!, projectId });
  }
  for (const g of manifest.generations) {
    const characterId = charMap.get(g.characterId);
    if (characterId) await db.generations.add({ ...g, id: crypto.randomUUID(), characterId });
  }
  for (const t of manifest.timelines) {
    const characterId = charMap.get(t.characterId);
    if (characterId) await db.timelines.put({ ...t, id: characterId, characterId });
  }
  return project;
}
