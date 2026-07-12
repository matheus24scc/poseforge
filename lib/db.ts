import Dexie, { type EntityTable } from "dexie";

// Local-first store. Blob contents live in the `blobs` table (IndexedDB);
// everything else is catalog/state: projects, characters, durable job records,
// libraries (poses/expressions), generation history, and settings.

export type AssetKind = "image" | "mesh" | "video";

export interface AssetRow {
  id: string; // sha-256 hex of contents (content-addressed)
  kind: AssetKind;
  mime: string;
  size: number;
  label?: string;
  createdAt: number;
}

export interface BlobRow {
  id: string; // same content-hash id as the AssetRow
  blob: Blob;
}

export interface ProjectRow {
  id: string;
  name: string;
  createdAt: number;
}

export type StageKey = "source" | "extract" | "sheet" | "mesh" | "rig";

// Every pipeline step keeps a STACK of versions with an active pointer (the
// redesign's iterative-pipeline model). The active version flows downstream;
// changing it marks downstream stages stale — nothing is ever auto-wiped.
export interface StageVersion {
  id: string;
  createdAt: number;
  /** short provenance label: "generated", "upload", "re-roll", "provided"… */
  label?: string;
  /** seeded from the asset library / upload rather than produced by the pipeline */
  external?: boolean;
  /** source/extract: image asset; mesh/rig: GLB asset */
  assetId?: string;
  /** sheet: view images in order front, side, back */
  viewIds?: string[];
  /** mesh: Meshy task (rig input + blob recovery) */
  meshTaskId?: string;
  meshTaskKind?: "image-to-3d" | "multi-image-to-3d";
  /** rig: Meshy rigging task (blob recovery) */
  rigTaskId?: string;
}

export interface StageState {
  versions: StageVersion[];
  activeId?: string;
  /** an upstream active version changed after this stage's active was made */
  stale?: boolean;
}

export interface CharacterRow {
  id: string;
  projectId: string;
  name: string;
  stages: Record<StageKey, StageState>;
  /** The character's persisted working pose (world-space canonical rotations),
   * captured from the live rig on the Pose step / in composition. Absent = the
   * rig's bind (T-)pose. Replays on any rig via applyPose (rig-independent). */
  poseRotations?: PoseRotations;
  createdAt: number;
  /** @deprecated pre-v5 single-pointer fields — migrated into stages. */
  sourceAssetId?: string;
  extractedAssetId?: string;
  sheetViewIds?: string[];
  sheetAssetId?: string;
  meshTaskId?: string;
  meshTaskKind?: "image-to-3d" | "multi-image-to-3d";
  meshAssetId?: string;
  rigTaskId?: string;
  riggedAssetId?: string;
}

export type JobKind = "sourceGen" | "extract" | "sheet" | "mesh" | "rig" | "imageGen" | "videoGen";
export type JobStatus = "queued" | "submitted" | "running" | "succeeded" | "failed";

// One durable record per expensive call. Jobs with a providerTaskId (Meshy)
// survive reload — the provider keeps working and we resume polling on load.
export interface JobRow {
  id: string;
  kind: JobKind;
  status: JobStatus;
  characterId: string;
  providerTaskId?: string;
  inputsHash: string;
  outputAssetId?: string;
  error?: string;
  progress?: number;
  attempts: number;
  /** JSON side-channel for resume (e.g. which timeline segment a videoGen belongs to). */
  meta?: string;
  createdAt: number;
  updatedAt: number;
}

export interface GenerationRow {
  id: string;
  characterId: string;
  prompt: string;
  refAssetIds: string[];
  outputAssetId: string;
  createdAt: number;
}

/** Pose rotations: canonical joint key → XYZ euler offsets from T-pose, in degrees. */
export type PoseRotations = Record<string, [number, number, number]>;

export interface PoseRow {
  id: string;
  name: string;
  tags?: string[];
  rotations: PoseRotations;
  /** body parts this pose covers; absent = full body. A scoped pose applies as
   * a merge (only its joints) so fragments compose. */
  parts?: string[];
  createdAt: number;
}

export interface ExpressionRow {
  id: string;
  name: string;
  promptFragment: string;
  refAssetId?: string;
  createdAt: number;
}

export interface Keyframe {
  id: string;
  /** seconds on the timeline */
  time: number;
  rotations: PoseRotations;
  /** nano-banana still generated for this keyframe (Veo frame input) */
  stillAssetId?: string;
}

export interface SegmentInfo {
  prompt?: string;
  videoAssetId?: string;
  /** non-destructive in/out points into the generated clip, seconds. Undefined
   * = full clip. Respected by the preview player and the stitched export. */
  trimStart?: number;
  trimEnd?: number;
  createdAt?: number;
}

// One timeline per character (id === characterId). Segments are keyed by
// "<fromKeyframeId>:<toKeyframeId>" so re-ordering keyframes keeps results.
export interface TimelineRow {
  id: string;
  characterId: string;
  keyframes: Keyframe[];
  segments: Record<string, SegmentInfo>;
  updatedAt: number;
}

// One placement of a character in a composition scene (a character may appear
// more than once). The pose isn't stored here — it comes from the character's
// persisted poseRotations, so every placement reflects the character's pose.
export interface CompositionItem {
  /** unique per placement */
  id: string;
  characterId: string;
  x: number;
  z: number;
  /** rotation about the vertical axis, radians */
  rotY: number;
  scale: number;
}

export interface EnvTransform {
  scale: number;
  /** vertical offset so the world's floor meets the characters' feet (y=0) */
  y: number;
  rotY: number;
}

// A saved composition (§7b v2): the arrangement of characters on the plane plus
// the Marble-world backdrop transform. Reloading places each character at its
// current persisted pose.
export interface CompositionRow {
  id: string;
  projectId: string;
  name: string;
  items: CompositionItem[];
  env: EnvTransform;
  environmentAssetId: string | null;
  /** "mesh" (GLB) | "splat" (Gaussian splat); absent on pre-§7c rows = mesh */
  environmentKind?: "mesh" | "splat" | null;
  createdAt: number;
  updatedAt: number;
}

export interface SettingRow {
  key: string;
  value: string;
}

export const db = new Dexie("poseforge") as Dexie & {
  assets: EntityTable<AssetRow, "id">;
  blobs: EntityTable<BlobRow, "id">;
  projects: EntityTable<ProjectRow, "id">;
  characters: EntityTable<CharacterRow, "id">;
  jobs: EntityTable<JobRow, "id">;
  generations: EntityTable<GenerationRow, "id">;
  poses: EntityTable<PoseRow, "id">;
  expressions: EntityTable<ExpressionRow, "id">;
  timelines: EntityTable<TimelineRow, "id">;
  compositions: EntityTable<CompositionRow, "id">;
  settings: EntityTable<SettingRow, "key">;
};

db.version(1).stores({
  assets: "id, kind, createdAt",
  characters: "id, createdAt",
  jobs: "id, status, kind, characterId, createdAt",
  generations: "id, characterId, createdAt",
  settings: "key",
});

db.version(2).stores({
  blobs: "id",
});

db.version(3)
  .stores({
    projects: "id, createdAt",
    characters: "id, projectId, createdAt",
    poses: "id, createdAt",
    expressions: "id, createdAt",
  })
  .upgrade(async (tx) => {
    // v2 → v3: single implicit character becomes a character in a default
    // project; single-view sheet becomes the first entry of sheetViewIds.
    const projectId = crypto.randomUUID();
    await tx.table("projects").add({ id: projectId, name: "Project 1", createdAt: Date.now() });
    const characters = await tx.table("characters").toArray();
    for (const ch of characters) {
      await tx.table("characters").update(ch.id, {
        projectId,
        sheetViewIds: ch.sheetAssetId ? [ch.sheetAssetId] : [],
      });
    }
  });

db.version(4).stores({
  timelines: "id, characterId",
});

db.version(5)
  .stores({})
  .upgrade(async (tx) => {
    // v4 → v5: single-pointer character fields become one-version stage stacks.
    const characters = await tx.table("characters").toArray();
    for (const ch of characters) {
      if (ch.stages) continue;
      const mk = (payload: Record<string, unknown>) => ({
        id: crypto.randomUUID(),
        createdAt: ch.createdAt,
        label: "migrated",
        ...payload,
      });
      const one = (v: ReturnType<typeof mk>) => ({ versions: [v], activeId: v.id });
      const none = () => ({ versions: [] });
      const stages = {
        source: ch.sourceAssetId ? one(mk({ assetId: ch.sourceAssetId })) : none(),
        extract: ch.extractedAssetId ? one(mk({ assetId: ch.extractedAssetId })) : none(),
        sheet: ch.sheetViewIds?.length ? one(mk({ viewIds: ch.sheetViewIds })) : none(),
        mesh:
          ch.meshAssetId || ch.meshTaskId
            ? one(mk({ assetId: ch.meshAssetId, meshTaskId: ch.meshTaskId, meshTaskKind: ch.meshTaskKind }))
            : none(),
        rig:
          ch.riggedAssetId || ch.rigTaskId
            ? one(mk({ assetId: ch.riggedAssetId, rigTaskId: ch.rigTaskId }))
            : none(),
      };
      await tx.table("characters").update(ch.id, { stages });
    }
  });

db.version(6).stores({
  compositions: "id, projectId, updatedAt",
});
