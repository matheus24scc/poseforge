import { db, type CharacterRow, type StageKey, type StageState, type StageVersion } from "./db";

// Version-stack mechanics for the iterative pipeline: every stage keeps all
// its results; exactly one is active and flows downstream; changing the
// active version marks downstream stages stale (a cue to re-run, never a wipe).

export const STAGE_ORDER: StageKey[] = ["source", "extract", "sheet", "mesh", "rig"];

export const STAGE_LABELS: Record<StageKey, string> = {
  source: "Source",
  extract: "Extract",
  sheet: "Character sheet",
  mesh: "3D mesh",
  rig: "Rig",
};

export function emptyStages(): Record<StageKey, StageState> {
  return {
    source: { versions: [] },
    extract: { versions: [] },
    sheet: { versions: [] },
    mesh: { versions: [] },
    rig: { versions: [] },
  };
}

export function getStage(ch: CharacterRow | undefined, stage: StageKey): StageState {
  return ch?.stages?.[stage] ?? { versions: [] };
}

export function activeVersion(
  ch: CharacterRow | undefined,
  stage: StageKey,
): StageVersion | undefined {
  const s = getStage(ch, stage);
  return s.versions.find((v) => v.id === s.activeId) ?? s.versions[s.versions.length - 1];
}

async function mutateStages(
  characterId: string,
  fn: (stages: Record<StageKey, StageState>) => void,
): Promise<void> {
  const ch = await db.characters.get(characterId);
  if (!ch) throw new Error("Character not found");
  const stages = ch.stages ?? emptyStages();
  fn(stages);
  await db.characters.update(characterId, { stages });
}

function markDownstream(stages: Record<StageKey, StageState>, stage: StageKey): void {
  for (const s of STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1)) {
    if (stages[s].versions.length) stages[s].stale = true;
  }
}

/** Add a new version to a stage, make it active, and mark downstream stale. */
export async function pushVersion(
  characterId: string,
  stage: StageKey,
  payload: Omit<StageVersion, "id" | "createdAt">,
): Promise<StageVersion> {
  const version: StageVersion = { id: crypto.randomUUID(), createdAt: Date.now(), ...payload };
  await mutateStages(characterId, (stages) => {
    stages[stage].versions.push(version);
    stages[stage].activeId = version.id;
    stages[stage].stale = false;
    markDownstream(stages, stage);
  });
  return version;
}

/** Switch which version is active (the one that flows downstream). */
export async function setActiveVersion(
  characterId: string,
  stage: StageKey,
  versionId: string,
): Promise<void> {
  await mutateStages(characterId, (stages) => {
    const s = stages[stage];
    if (s.activeId === versionId || !s.versions.some((v) => v.id === versionId)) return;
    s.activeId = versionId;
    s.stale = false;
    markDownstream(stages, stage);
  });
}

/** Patch fields on an existing version in place (e.g. blob recovery). */
export async function patchVersion(
  characterId: string,
  stage: StageKey,
  versionId: string,
  patch: Partial<StageVersion>,
): Promise<void> {
  await mutateStages(characterId, (stages) => {
    const v = stages[stage].versions.find((x) => x.id === versionId);
    if (v) Object.assign(v, patch, { id: v.id });
  });
}

/** Seed a stage from outside the pipeline (upload / asset library) — the
 * "start at any stage" path. Earlier stages stay live for later backfill. */
export async function seedStage(
  characterId: string,
  stage: StageKey,
  payload: Omit<StageVersion, "id" | "createdAt" | "external">,
): Promise<StageVersion> {
  return pushVersion(characterId, stage, {
    ...payload,
    external: true,
    label: payload.label ?? "provided",
  });
}
