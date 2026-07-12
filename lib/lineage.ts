import type { CharacterRow, GenerationRow, ProjectRow, StageKey, TimelineRow } from "./db";
import { getStage } from "./stages";

// Asset lineage. Assets are content-addressed (sha-256 of the bytes), so the
// SAME asset id can appear in many places — seeded into two characters, reused
// as a generation reference, sitting on a keyframe. These helpers answer two
// questions about an asset: where is it USED, and (if it was generated) what was
// it MADE FROM — the two directions of its lineage graph.

export interface AssetUsage {
  characterId: string;
  characterName: string;
  projectName: string;
  kind: "stage" | "generation-output" | "generation-ref" | "keyframe-still" | "clip";
  label: string;
  /** rough pipeline order for sorting */
  order: number;
}

const STAGE_LABEL: Record<StageKey, string> = {
  source: "Source",
  extract: "Extract",
  sheet: "Sheet",
  mesh: "Mesh",
  rig: "Rig",
};
const STAGE_ORDER: StageKey[] = ["source", "extract", "sheet", "mesh", "rig"];

export function usagesOf(
  assetId: string,
  characters: CharacterRow[],
  generations: GenerationRow[],
  timelines: TimelineRow[],
  projects: ProjectRow[],
): AssetUsage[] {
  const projName = (id: string) => projects.find((p) => p.id === id)?.name ?? "?";
  const charOf = (id: string) => characters.find((c) => c.id === id);
  const usages: AssetUsage[] = [];

  for (const ch of characters) {
    const base = { characterId: ch.id, characterName: ch.name, projectName: projName(ch.projectId) };
    for (const stage of STAGE_ORDER) {
      const st = getStage(ch, stage);
      st.versions.forEach((v, vi) => {
        const many = st.versions.length > 1;
        if (v.assetId === assetId) {
          usages.push({ ...base, kind: "stage", label: `${STAGE_LABEL[stage]}${many ? ` · v${vi + 1}` : ""}`, order: STAGE_ORDER.indexOf(stage) });
        }
        (v.viewIds ?? []).forEach((id, idx) => {
          if (id === assetId) usages.push({ ...base, kind: "stage", label: `Sheet · view ${idx + 1}`, order: 2 });
        });
      });
    }
  }

  for (const g of generations) {
    const ch = charOf(g.characterId);
    if (!ch) continue;
    const base = { characterId: ch.id, characterName: ch.name, projectName: projName(ch.projectId) };
    if (g.outputAssetId === assetId) usages.push({ ...base, kind: "generation-output", label: "Generation output", order: 6 });
    if (g.refAssetIds?.includes(assetId)) usages.push({ ...base, kind: "generation-ref", label: "Reference for a generation", order: 6 });
  }

  for (const t of timelines) {
    const ch = charOf(t.characterId);
    if (!ch) continue;
    const base = { characterId: ch.id, characterName: ch.name, projectName: projName(ch.projectId) };
    for (const kf of t.keyframes ?? []) if (kf.stillAssetId === assetId) usages.push({ ...base, kind: "keyframe-still", label: "Keyframe still", order: 5 });
    for (const seg of Object.values(t.segments ?? {})) if (seg.videoAssetId === assetId) usages.push({ ...base, kind: "clip", label: "Timeline clip", order: 5 });
  }

  return usages.sort((a, b) => a.order - b.order);
}

/** If this asset is a generation output, the inputs it was made from. */
export function madeFrom(
  assetId: string,
  generations: GenerationRow[],
): { refAssetIds: string[]; prompt: string } | null {
  const g = generations.find((x) => x.outputAssetId === assetId);
  return g ? { refAssetIds: g.refAssetIds ?? [], prompt: g.prompt } : null;
}
