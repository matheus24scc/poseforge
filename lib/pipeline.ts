import { db, type CharacterRow, type JobKind, type JobRow, type ProjectRow } from "./db";
import {
  assetToDataUri,
  assetToInlineData,
  base64ToBlob,
  blobToInlineData,
  dataUriToBlob,
  getAssetBlob,
  putBlob,
  sha256Hex,
} from "./assets";
import { geminiGenerateImage, type GeminiPart } from "./gemini";
import * as meshy from "./meshy";
import * as veo from "./veo";
import { setSegment, updateKeyframe } from "./timeline";
import { activeVersion, emptyStages, patchVersion, pushVersion } from "./stages";

// Character pipeline over version stacks (lib/stages.ts): every run pushes a
// new version onto its stage and the active version feeds the next stage.
// Stages can also be seeded externally at any point (start-at-any-stage).
//
// Every expensive call gets a durable JobRow. Meshy/Veo jobs persist their
// provider task/operation id so resumePendingJobs() picks them up after reload.

export const PROMPTS = {
  extract:
    "Isolate the main character from this image. Output an image of the exact same character — unchanged design, colors, outfit and proportions — full body visible, standing, centered on a plain uniform light-gray background. Remove all other objects, characters, text and background elements.",
  sheetFront:
    "Create a character reference image of this exact character: full body, FRONT view, standing in a T-pose with both arms extended straight out horizontally, legs slightly apart, neutral expression, even studio lighting, plain uniform light-gray background. Preserve the character's design, colors, outfit and proportions exactly.",
  sheetSide:
    "Using the front-view T-pose reference provided, create the matching LEFT SIDE profile view of the exact same character: full body, standing straight with arms in T-pose, neutral expression, identical outfit, colors and proportions, same even studio lighting, plain uniform light-gray background.",
  sheetBack:
    "Using the front-view T-pose reference provided, create the matching BACK view of the exact same character: full body, standing in a T-pose seen from directly behind, identical outfit, colors and proportions, same even studio lighting, plain uniform light-gray background.",
  generateDefault:
    "Render this exact character (the first reference image is the character sheet) in exactly the body pose shown in the pose reference image, which is a 3D render of the posed character. Match the pose precisely — arm, leg and head positions. Keep the character's design, colors and outfit identical to the character sheet. High-quality, clean plain background.",
};

export const COST_HINTS = {
  gemini: "≈ $0.04 / image on your Gemini key",
  sheet: "≈ $0.12 (3 nano-banana views)",
  mesh: "Meshy credits (image-to-3D)",
  rig: "Meshy credits (auto-rigging)",
  veo: "Veo is pricey — roughly $1–3+ per 8s clip; verify current pricing",
};

/** Rough per-job USD estimates for the JobsPill session tally, derived from
 * COST_HINTS: Gemini image ops ≈ $0.04; the 3-view sheet ≈ $0.12; a Veo clip
 * ≈ $2 (midpoint of the $1–3 range). Meshy mesh/rig bill in provider credits,
 * not USD, so they carry `null` and are surfaced as a separate op count.
 * Deliberately rough — the disclaimer stands: real charges come from providers. */
export const JOB_COST_USD: Record<JobKind, number | null> = {
  sourceGen: 0.04,
  extract: 0.04,
  sheet: 0.12,
  imageGen: 0.04,
  videoGen: 2,
  mesh: null,
  rig: null,
};

export async function getKeys(): Promise<{ gemini?: string; meshy?: string }> {
  const [g, m] = await Promise.all([db.settings.get("geminiKey"), db.settings.get("meshyKey")]);
  return { gemini: g?.value, meshy: m?.value };
}

// --- Projects & characters ---------------------------------------------------

export async function ensureProject(): Promise<ProjectRow> {
  const existing = await db.projects.orderBy("createdAt").first();
  if (existing) return existing;
  const row: ProjectRow = { id: crypto.randomUUID(), name: "Project 1", createdAt: Date.now() };
  await db.projects.add(row);
  return row;
}

export async function createProject(name: string): Promise<ProjectRow> {
  const row: ProjectRow = { id: crypto.randomUUID(), name, createdAt: Date.now() };
  await db.projects.add(row);
  return row;
}

export async function createCharacter(projectId: string, name: string): Promise<CharacterRow> {
  const row: CharacterRow = {
    id: crypto.randomUUID(),
    projectId,
    name,
    stages: emptyStages(),
    createdAt: Date.now(),
  };
  await db.characters.add(row);
  return row;
}

async function getCharacter(characterId: string): Promise<CharacterRow> {
  const ch = await db.characters.get(characterId);
  if (!ch) throw new Error("Character not found — select or create one first.");
  return ch;
}

/** First stage-input asset (by preference order) whose bytes exist locally. */
async function firstAvailableAsset(ids: (string | undefined)[]): Promise<string | undefined> {
  for (const id of ids) {
    if (id && (await getAssetBlob(id))) return id;
  }
  return undefined;
}

// --- Job records ---------------------------------------------------------------

async function startJob(kind: JobKind, characterId: string, inputs: unknown): Promise<JobRow> {
  const inputsHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(inputs)));
  const job: JobRow = {
    id: crypto.randomUUID(),
    kind,
    status: "running",
    characterId,
    inputsHash,
    attempts: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.jobs.add(job);
  return job;
}

async function patchJob(id: string, patch: Partial<JobRow>): Promise<void> {
  await db.jobs.update(id, { ...patch, updatedAt: Date.now() });
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- Gemini image steps --------------------------------------------------------

async function geminiImageStep(
  kind: JobKind,
  characterId: string,
  parts: GeminiPart[],
  label: string,
): Promise<string /* asset id */> {
  const keys = await getKeys();
  if (!keys.gemini) throw new Error("Add your Gemini API key in Settings first.");
  const job = await startJob(kind, characterId, {
    parts: parts.map((p) => p.text ?? `inline:${p.inlineData?.data.slice(0, 40)}`),
  });
  try {
    const { images } = await geminiGenerateImage(keys.gemini, parts);
    const blob = base64ToBlob(images[0].data, images[0].mimeType);
    const asset = await putBlob(blob, "image", label);
    await patchJob(job.id, { status: "succeeded", outputAssetId: asset.id });
    return asset.id;
  } catch (e) {
    await patchJob(job.id, { status: "failed", error: errorMessage(e) });
    throw e;
  }
}

export async function setSourceImage(characterId: string, file: File): Promise<void> {
  const asset = await putBlob(file, "image", "source");
  await pushVersion(characterId, "source", { assetId: asset.id, label: "upload", external: true });
}

export async function generateSourceImage(characterId: string, prompt: string): Promise<void> {
  const assetId = await geminiImageStep("sourceGen", characterId, [{ text: prompt }], "source");
  await pushVersion(characterId, "source", { assetId, label: "generated" });
}

export async function runExtract(characterId: string): Promise<void> {
  const ch = await getCharacter(characterId);
  const inputId = await firstAvailableAsset([activeVersion(ch, "source")?.assetId]);
  if (!inputId) throw new Error("Add a source image first.");
  const inlineData = await assetToInlineData(inputId);
  const assetId = await geminiImageStep(
    "extract",
    ch.id,
    [{ inlineData }, { text: PROMPTS.extract }],
    "extracted",
  );
  await pushVersion(ch.id, "extract", { assetId, label: "generated" });
}

// Character sheet = 3 views. Front first; side and back are generated in
// parallel conditioned on the front result for consistency.
export async function runSheet(characterId: string): Promise<void> {
  const ch = await getCharacter(characterId);
  const inputId = await firstAvailableAsset([
    activeVersion(ch, "extract")?.assetId,
    activeVersion(ch, "source")?.assetId,
  ]);
  if (!inputId) throw new Error("Add a source image first.");
  const input = await assetToInlineData(inputId);

  const frontId = await geminiImageStep(
    "sheet",
    ch.id,
    [{ inlineData: input }, { text: PROMPTS.sheetFront }],
    "sheet-front",
  );
  const front = await assetToInlineData(frontId);
  const [sideId, backId] = await Promise.all([
    geminiImageStep("sheet", ch.id, [{ inlineData: front }, { text: PROMPTS.sheetSide }], "sheet-side"),
    geminiImageStep("sheet", ch.id, [{ inlineData: front }, { text: PROMPTS.sheetBack }], "sheet-back"),
  ]);
  await pushVersion(ch.id, "sheet", { viewIds: [frontId, sideId, backId], label: "generated" });
}

// --- Meshy steps (async provider tasks, resumable) ----------------------------

async function watchMeshTask(
  jobId: string,
  characterId: string,
  taskId: string,
  taskKind: meshy.MeshyTaskKind,
): Promise<void> {
  const keys = await getKeys();
  if (!keys.meshy) throw new Error("Add your Meshy API key in Settings first.");
  try {
    const task = await meshy.pollTask(keys.meshy, taskKind, taskId, (progress) => {
      void patchJob(jobId, { progress });
    });
    const glbUrl = task.model_urls?.glb;
    if (!glbUrl) throw new Error("Meshy task succeeded but returned no GLB URL");
    const blob = await meshy.downloadModel(glbUrl);
    const asset = await putBlob(blob, "mesh", "mesh-glb");
    await pushVersion(characterId, "mesh", {
      assetId: asset.id,
      meshTaskId: taskId,
      meshTaskKind: taskKind as "image-to-3d" | "multi-image-to-3d",
      label: "generated",
    });
    await patchJob(jobId, { status: "succeeded", outputAssetId: asset.id, progress: 100 });
  } catch (e) {
    await patchJob(jobId, { status: "failed", error: errorMessage(e) });
    throw e;
  }
}

export async function runMesh(characterId: string): Promise<void> {
  const ch = await getCharacter(characterId);
  const viewIds = (activeVersion(ch, "sheet")?.viewIds ?? []).filter(Boolean);
  const singleInput = await firstAvailableAsset([
    viewIds[0],
    activeVersion(ch, "extract")?.assetId,
    activeVersion(ch, "source")?.assetId,
  ]);
  if (!singleInput) throw new Error("Add a source image first.");
  const keys = await getKeys();
  if (!keys.meshy) throw new Error("Add your Meshy API key in Settings first.");

  const useMulti = viewIds.length >= 2;
  const taskKind: meshy.MeshyTaskKind = useMulti ? "multi-image-to-3d" : "image-to-3d";
  const job = await startJob("mesh", ch.id, { viewIds, singleInput, taskKind });
  let taskId: string;
  try {
    if (useMulti) {
      const uris = await Promise.all(viewIds.map((id) => assetToDataUri(id)));
      taskId = await meshy.createMultiImageTo3d(keys.meshy, uris);
    } else {
      taskId = await meshy.createImageTo3d(keys.meshy, await assetToDataUri(singleInput));
    }
    await patchJob(job.id, { providerTaskId: taskId, meta: JSON.stringify({ taskKind }) });
  } catch (e) {
    await patchJob(job.id, { status: "failed", error: errorMessage(e) });
    throw e;
  }
  await watchMeshTask(job.id, ch.id, taskId, taskKind);
}

async function watchRigTask(jobId: string, characterId: string, taskId: string): Promise<void> {
  const keys = await getKeys();
  if (!keys.meshy) throw new Error("Add your Meshy API key in Settings first.");
  try {
    const task = await meshy.pollTask(keys.meshy, "rigging", taskId, (progress) => {
      void patchJob(jobId, { progress });
    });
    const glbUrl = task.result?.rigged_character_glb_url;
    if (!glbUrl) throw new Error("Rigging succeeded but returned no rigged GLB URL");
    const blob = await meshy.downloadModel(glbUrl);
    const asset = await putBlob(blob, "mesh", "rigged-glb");
    await pushVersion(characterId, "rig", { assetId: asset.id, rigTaskId: taskId, label: "generated" });
    await patchJob(jobId, { status: "succeeded", outputAssetId: asset.id, progress: 100 });
  } catch (e) {
    await patchJob(jobId, { status: "failed", error: errorMessage(e) });
    throw e;
  }
}

// Rig the active mesh. Prefers the Meshy task id; meshes without one (seeded
// GLB uploads) go through the model_url data-URI path instead.
export async function runRig(characterId: string): Promise<void> {
  const ch = await getCharacter(characterId);
  const mesh = activeVersion(ch, "mesh");
  if (!mesh?.assetId && !mesh?.meshTaskId) throw new Error("Generate or upload a 3D mesh first.");
  const keys = await getKeys();
  if (!keys.meshy) throw new Error("Add your Meshy API key in Settings first.");
  const job = await startJob("rig", ch.id, { meshVersionId: mesh.id });
  let taskId: string;
  try {
    const viaModelUrl = async () => {
      const glb = mesh.assetId ? await getAssetBlob(mesh.assetId) : null;
      if (!glb) throw new Error("Mesh GLB missing from local storage — re-run the Mesh step.");
      const dataUri = await blobToInlineData(glb).then((d) => `data:model/gltf-binary;base64,${d.data}`);
      return meshy.createRigging(keys.meshy!, { modelUrl: dataUri });
    };
    if (mesh.meshTaskId) {
      try {
        taskId = await meshy.createRigging(keys.meshy, { inputTaskId: mesh.meshTaskId });
      } catch {
        taskId = await viaModelUrl();
      }
    } else {
      taskId = await viaModelUrl();
    }
    await patchJob(job.id, { providerTaskId: taskId });
  } catch (e) {
    await patchJob(job.id, { status: "failed", error: errorMessage(e) });
    throw e;
  }
  await watchRigTask(job.id, ch.id, taskId);
}

// --- Final generation ------------------------------------------------------------

export interface ExpressionInput {
  name: string;
  promptFragment: string;
  refAssetId?: string;
}

export async function runGenerate(
  characterId: string,
  prompt: string,
  renderDataUri: string,
  expression?: ExpressionInput,
): Promise<string> {
  const ch = await getCharacter(characterId);
  // A clean identity reference (sheet/extract/source) sharpens identity, but the
  // posed render already shows the character — so it's optional. Characters that
  // started from a raw mesh (no upstream image) still generate from the render.
  const sheetId = await firstAvailableAsset([
    ...(activeVersion(ch, "sheet")?.viewIds ?? []),
    activeVersion(ch, "extract")?.assetId,
    activeVersion(ch, "source")?.assetId,
  ]);
  const renderAsset = await putBlob(dataUriToBlob(renderDataUri), "image", "pose-render");

  let fullPrompt = prompt;
  const parts: GeminiPart[] = [];
  if (expression) {
    fullPrompt += ` The character's face shows ${expression.promptFragment}.`;
    if (expression.refAssetId && (await getAssetBlob(expression.refAssetId))) {
      fullPrompt += " Use the last reference image as the expression reference.";
    }
  }
  parts.push({ text: fullPrompt });
  if (sheetId) parts.push({ inlineData: await assetToInlineData(sheetId) });
  parts.push({ inlineData: await assetToInlineData(renderAsset.id) });
  if (expression?.refAssetId && (await getAssetBlob(expression.refAssetId))) {
    parts.push({ inlineData: await assetToInlineData(expression.refAssetId) });
  }

  const outputAssetId = await geminiImageStep("imageGen", ch.id, parts, "generation");
  await db.generations.add({
    id: crypto.randomUUID(),
    characterId: ch.id,
    prompt: fullPrompt,
    refAssetIds: sheetId ? [sheetId, renderAsset.id] : [renderAsset.id],
    outputAssetId,
    createdAt: Date.now(),
  });
  return outputAssetId;
}

/** Composition generate (§7b v2): unlike runGenerate — which references only the
 * anchor's sheet — this passes EVERY scene character's identity image as a
 * reference so each subject keeps its own design, then the composed render as
 * the layout/pose signal. The generation is recorded on the anchor (first id).
 * Character ids may repeat (a character placed twice); identity refs are deduped. */
export async function runGenerateComposition(
  characterIds: string[],
  prompt: string,
  renderDataUri: string,
): Promise<string> {
  const ordered = characterIds.filter(Boolean);
  if (ordered.length === 0) throw new Error("No characters in the scene.");
  const anchorId = ordered[0];

  // one identity reference per distinct character, in scene order
  const seen = new Set<string>();
  const identityIds: string[] = [];
  for (const cid of ordered) {
    if (seen.has(cid)) continue;
    seen.add(cid);
    const ch = await getCharacter(cid);
    const id = await firstAvailableAsset([
      ...(activeVersion(ch, "sheet")?.viewIds ?? []),
      activeVersion(ch, "extract")?.assetId,
      activeVersion(ch, "source")?.assetId,
    ]);
    if (id) identityIds.push(id);
  }

  const renderAsset = await putBlob(dataUriToBlob(renderDataUri), "image", "scene-render");
  const n = identityIds.length;
  const fullPrompt =
    n > 1
      ? `${prompt} The first ${n} reference images are the ${n} distinct characters in the scene (one each, in order); the final image is a 3D render showing their placement and poses. Reproduce every character with the exact identity, design, colors and outfit from its own reference image.`
      : prompt;

  const parts: GeminiPart[] = [{ text: fullPrompt }];
  for (const id of identityIds) parts.push({ inlineData: await assetToInlineData(id) });
  parts.push({ inlineData: await assetToInlineData(renderAsset.id) });

  const outputAssetId = await geminiImageStep("imageGen", anchorId, parts, "generation");
  await db.generations.add({
    id: crypto.randomUUID(),
    characterId: anchorId,
    prompt: fullPrompt,
    refAssetIds: [...identityIds, renderAsset.id],
    outputAssetId,
    createdAt: Date.now(),
  });
  return outputAssetId;
}

// 2D expression: img2img the face on ANY image. targetStage routes the result
// back as a new version of that stage; without it, it lands as a generation.
export async function applyExpression2d(
  characterId: string,
  imageAssetId: string,
  expression: ExpressionInput,
  targetStage?: "source" | "extract",
): Promise<string> {
  const parts: GeminiPart[] = [
    {
      text: `Edit this image: change ONLY the character's facial expression to ${expression.promptFragment}. Keep the pose, body, outfit, colors, lighting and background exactly identical.`,
    },
    { inlineData: await assetToInlineData(imageAssetId) },
  ];
  if (expression.refAssetId && (await getAssetBlob(expression.refAssetId))) {
    parts[0].text += " Use the last reference image as the expression reference.";
    parts.push({ inlineData: await assetToInlineData(expression.refAssetId) });
  }
  const kind: JobKind = targetStage ? "extract" : "imageGen";
  const outputAssetId = await geminiImageStep(kind, characterId, parts, `face-${expression.name}`);
  if (targetStage) {
    await pushVersion(characterId, targetStage, {
      assetId: outputAssetId,
      label: `face: ${expression.name}`,
    });
  } else {
    await db.generations.add({
      id: crypto.randomUUID(),
      characterId,
      prompt: `[2D expression: ${expression.name}]`,
      refAssetIds: [imageAssetId],
      outputAssetId,
      createdAt: Date.now(),
    });
  }
  return outputAssetId;
}

// 2D pose: img2img with the character image + a rasterized stick-figure
// skeleton of the target pose — the pose library without needing a rig.
export async function applyPose2d(
  characterId: string,
  imageAssetId: string,
  pose: { name: string; skeletonPngDataUri: string },
  targetStage?: "source" | "extract",
): Promise<string> {
  const skeleton = await putBlob(dataUriToBlob(pose.skeletonPngDataUri), "image", `pose-skeleton-${pose.name}`);
  const parts: GeminiPart[] = [
    {
      text: `Redraw this exact character — identical design, outfit, colors, proportions and rendering style — in the body pose shown in the second image, which is a stick-figure skeleton indicating the target body orientation (front view). Match the limb and head positions of the skeleton. Keep the background plain and the framing full-body.`,
    },
    { inlineData: await assetToInlineData(imageAssetId) },
    { inlineData: await assetToInlineData(skeleton.id) },
  ];
  const kind: JobKind = targetStage ? "extract" : "imageGen";
  const outputAssetId = await geminiImageStep(kind, characterId, parts, `pose2d-${pose.name}`);
  if (targetStage) {
    await pushVersion(characterId, targetStage, {
      assetId: outputAssetId,
      label: `pose: ${pose.name}`,
    });
  } else {
    await db.generations.add({
      id: crypto.randomUUID(),
      characterId,
      prompt: `[2D pose: ${pose.name}]`,
      refAssetIds: [imageAssetId, skeleton.id],
      outputAssetId,
      createdAt: Date.now(),
    });
  }
  return outputAssetId;
}

// Fork a character to work on divergent directions (angry vs sad) in
// parallel. Stages copy by reference — content-addressed assets make this
// free — then each fork evolves its own versions, generations and timeline.
export async function forkCharacter(characterId: string, name: string): Promise<CharacterRow> {
  const src = await getCharacter(characterId);
  const row: CharacterRow = {
    id: crypto.randomUUID(),
    projectId: src.projectId,
    name,
    stages: structuredClone(src.stages),
    createdAt: Date.now(),
  };
  await db.characters.add(row);
  const timeline = await db.timelines.get(characterId);
  if (timeline) {
    await db.timelines.put({ ...structuredClone(timeline), id: row.id, characterId: row.id });
  }
  return row;
}

// Second img2img pass: change only the face on an existing generation.
export async function refineExpression(
  characterId: string,
  sourceAssetId: string,
  expression: ExpressionInput,
): Promise<string> {
  const parts: GeminiPart[] = [
    {
      text: `Edit this image: change ONLY the character's facial expression to ${expression.promptFragment}. Keep the pose, body, outfit, colors, lighting and background exactly identical.`,
    },
    { inlineData: await assetToInlineData(sourceAssetId) },
  ];
  if (expression.refAssetId && (await getAssetBlob(expression.refAssetId))) {
    parts[0].text += " Use the last reference image as the expression reference.";
    parts.push({ inlineData: await assetToInlineData(expression.refAssetId) });
  }
  const outputAssetId = await geminiImageStep("imageGen", characterId, parts, "generation");
  await db.generations.add({
    id: crypto.randomUUID(),
    characterId,
    prompt: `[expression refine: ${expression.name}]`,
    refAssetIds: [sourceAssetId],
    outputAssetId,
    createdAt: Date.now(),
  });
  return outputAssetId;
}

// --- Timeline: keyframe stills & Veo segments ---------------------------------

export async function generateKeyframeStill(
  characterId: string,
  keyframeId: string,
  renderDataUri: string,
  expression?: ExpressionInput,
): Promise<string> {
  const assetId = await runGenerate(characterId, PROMPTS.generateDefault, renderDataUri, expression);
  await updateKeyframe(characterId, keyframeId, { stillAssetId: assetId });
  return assetId;
}

async function watchVeoOperation(
  jobId: string,
  characterId: string,
  operationName: string,
  segKey: string,
): Promise<void> {
  const keys = await getKeys();
  if (!keys.gemini) throw new Error("Add your Gemini API key in Settings first.");
  try {
    const uri = await veo.pollVeo(keys.gemini, operationName);
    const blob = await veo.downloadVeoVideo(keys.gemini, uri);
    const asset = await putBlob(blob, "video", "veo-clip");
    await setSegment(characterId, segKey, { videoAssetId: asset.id });
    await patchJob(jobId, { status: "succeeded", outputAssetId: asset.id, progress: 100 });
  } catch (e) {
    await patchJob(jobId, { status: "failed", error: errorMessage(e) });
    throw e;
  }
}

export async function runVeoSegment(
  characterId: string,
  segKey: string,
  prompt: string,
  firstAssetId: string,
  lastAssetId: string,
  fast = false,
): Promise<void> {
  const keys = await getKeys();
  if (!keys.gemini) throw new Error("Add your Gemini API key in Settings first.");
  const job = await startJob("videoGen", characterId, { segKey, firstAssetId, lastAssetId, prompt, fast });
  let operationName: string;
  try {
    const [first, last] = await Promise.all([
      assetToInlineData(firstAssetId),
      assetToInlineData(lastAssetId),
    ]);
    operationName = await veo.startVeo(keys.gemini, {
      prompt,
      firstFrame: first,
      lastFrame: last,
      model: fast ? veo.VEO_MODEL_FAST : veo.VEO_MODEL,
    });
    await patchJob(job.id, { providerTaskId: operationName, meta: JSON.stringify({ segKey }) });
    await setSegment(characterId, segKey, { prompt });
  } catch (e) {
    await patchJob(job.id, { status: "failed", error: errorMessage(e) });
    throw e;
  }
  await watchVeoOperation(job.id, characterId, operationName, segKey);
}

// --- Resume & recovery -------------------------------------------------------------

// Repair active mesh/rig versions whose blobs are gone but whose Meshy tasks
// survive — re-download in place (content-addressing keeps the same asset id
// when the bytes match).
export async function recoverMissingAssets(): Promise<void> {
  const keys = await getKeys();
  if (!keys.meshy) return;
  const characters = await db.characters.toArray();
  for (const ch of characters) {
    for (const stage of ["mesh", "rig"] as const) {
      const v = activeVersion(ch, stage);
      if (!v?.assetId || (await getAssetBlob(v.assetId))) continue;
      const taskId = stage === "mesh" ? v.meshTaskId : v.rigTaskId;
      if (!taskId) continue;
      void (async () => {
        try {
          const kind = stage === "mesh" ? (v.meshTaskKind ?? "image-to-3d") : "rigging";
          const task = await meshy.pollTask(keys.meshy!, kind, taskId);
          const url =
            stage === "mesh" ? task.model_urls?.glb : task.result?.rigged_character_glb_url;
          if (!url) return;
          const blob = await meshy.downloadModel(url);
          const asset = await putBlob(blob, "mesh", stage === "mesh" ? "mesh-glb" : "rigged-glb");
          await patchVersion(ch.id, stage, v.id, { assetId: asset.id });
        } catch {
          /* recovery is best-effort */
        }
      })();
    }
  }
}

export async function resumePendingJobs(): Promise<void> {
  const pending = await db.jobs.where("status").anyOf("queued", "submitted", "running").toArray();
  for (const job of pending) {
    if (job.kind === "mesh" && job.providerTaskId) {
      const meta = job.meta ? (JSON.parse(job.meta) as { taskKind?: meshy.MeshyTaskKind }) : {};
      void watchMeshTask(
        job.id,
        job.characterId,
        job.providerTaskId,
        meta.taskKind ?? "image-to-3d",
      ).catch(() => {});
    } else if (job.kind === "rig" && job.providerTaskId) {
      void watchRigTask(job.id, job.characterId, job.providerTaskId).catch(() => {});
    } else if (job.kind === "videoGen" && job.providerTaskId && job.meta) {
      const { segKey } = JSON.parse(job.meta) as { segKey: string };
      void watchVeoOperation(job.id, job.characterId, job.providerTaskId, segKey).catch(() => {});
    } else {
      await patchJob(job.id, { status: "failed", error: "Interrupted by reload" });
    }
  }
}
