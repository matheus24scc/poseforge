"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type StageKey } from "@/lib/db";
import {
  COST_HINTS,
  PROMPTS,
  generateSourceImage,
  runExtract,
  runGenerate,
  runMesh,
  runRig,
  runSheet,
  setSourceImage,
} from "@/lib/pipeline";
import { activeVersion, seedStage } from "@/lib/stages";
import { downloadAsset, putBlob } from "@/lib/assets";
import { BUILTIN_EXPRESSIONS, resolveExpression } from "@/lib/expressions";
import { useAppStore, useViewportStore } from "@/lib/store";
import AutoTextarea from "./AutoTextarea";

// The current step's actions + prompting, docked in the LEFT rail under the
// Process list. The stage stays clean; references stay on the right.

const primary =
  "w-full rounded-lg bg-azure-600 px-3 py-2 text-xs font-semibold text-white shadow-[0_0_14px_rgba(79,141,255,0.3)] hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400 disabled:shadow-none";
const ghost =
  "w-full rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600";

export default function StageActions() {
  const selectedStep = useAppStore((s) => s.selectedStep);
  const characterId = useAppStore((s) => s.characterId);
  const expressionId = useAppStore((s) => s.expressionId);
  const setSelectedStep = useAppStore((s) => s.setSelectedStep);
  const capture = useViewportStore((s) => s.capture);
  // Persisted in viewportStore so the pose thumb survives step nav + rail
  // collapse; cleared below when the character changes so it never goes stale.
  const render = useViewportStore((s) => s.lastRender);
  const setRender = useViewportStore((s) => s.setLastRender);

  const character = useLiveQuery(
    () => (characterId ? db.characters.get(characterId) : undefined),
    [characterId],
  );
  const userExpr = useLiveQuery(
    () => (expressionId ? db.expressions.get(expressionId) : undefined),
    [expressionId],
  );
  const exprName =
    BUILTIN_EXPRESSIONS.find((x) => x.id === expressionId)?.name ?? userExpr?.name ?? null;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [srcPrompt, setSrcPrompt] = useState("");
  const [genPrompt, setGenPrompt] = useState(PROMPTS.generateDefault);
  const fileInput = useRef<HTMLInputElement>(null);
  const seedTarget = useRef<StageKey>("source");

  // A render captured for one character is meaningless for the next.
  useEffect(() => {
    setRender(null);
  }, [characterId, setRender]);

  const run = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const openSeed = (stage: StageKey) => {
    seedTarget.current = stage;
    fileInput.current?.click();
  };

  const seedFromFile = async (stage: StageKey, file: File) => {
    if (!characterId) return;
    const isGlb = file.name.toLowerCase().endsWith(".glb");
    const asset = await putBlob(file, isGlb ? "mesh" : "image", `${stage}-upload`);
    if (stage === "sheet") await seedStage(characterId, "sheet", { viewIds: [asset.id], label: "upload" });
    else await seedStage(characterId, stage, { assetId: asset.id, label: "upload" });
  };

  if (!character) return null;

  const srcActive = activeVersion(character, "source");
  const extractActive = activeVersion(character, "extract");
  const sheetActive = activeVersion(character, "sheet");
  const sheetViews = sheetActive?.viewIds ?? [];
  const meshAsset = activeVersion(character, "mesh")?.assetId ?? null;
  const rigAsset = activeVersion(character, "rig")?.assetId ?? null;

  const generateBlock = (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => capture && setRender(capture())}
          disabled={!capture}
          title={capture ? "Renders the viewport as the pose reference" : "Open the Pose step to enable capture"}
          className="rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600"
        >
          Capture pose
        </button>
        {render && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={render} alt="pose render" className="h-10 rounded bg-neutral-950" />
        )}
        <span className="ml-auto truncate font-mono text-[9.5px] text-neutral-500">
          {exprName ? `face: ${exprName}` : "face: —"}
        </span>
      </div>
      <AutoTextarea
        value={genPrompt}
        onChange={(e) => setGenPrompt(e.target.value)}
        minRows={4}
        className="w-full rounded-lg bg-neutral-800 p-2 text-xs leading-relaxed"
      />
      <button
        className={primary}
        disabled={!!busy || (!render && !capture)}
        title={COST_HINTS.gemini}
        onClick={() =>
          run("generate", async () => {
            // auto-capture the current viewport if no pose render was taken
            let poseRender = render;
            if (!poseRender && capture) {
              poseRender = capture();
              setRender(poseRender);
            }
            if (!poseRender) {
              throw new Error("Open the Pose step (5) to frame the character first.");
            }
            const expression = await resolveExpression(expressionId);
            await runGenerate(character.id, genPrompt, poseRender, expression);
            setSelectedStep("generate");
          })
        }
      >
        {busy === "generate" ? "Generating…" : render ? "Generate" : "Generate (auto-captures pose)"}
      </button>
      <div className="text-center font-mono text-[9.5px] text-neutral-500">
        {!render && !capture
          ? "pose the character on step 5 first — capture needs the 3D view"
          : COST_HINTS.gemini}
      </div>
    </>
  );

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--pf-hair)] p-3">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">
        {selectedStep === "pose" || selectedStep === "generate"
          ? "Generate from this pose"
          : "This step"}
      </div>

      {selectedStep === "source" && (
        <>
          <button className={ghost} disabled={!!busy} onClick={() => openSeed("source")}>
            Upload image
          </button>
          <AutoTextarea
            value={srcPrompt}
            onChange={(e) => setSrcPrompt(e.target.value)}
            placeholder="…or describe a character"
            className="w-full rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs"
          />
          <button
            className={primary}
            disabled={!!busy || !srcPrompt.trim()}
            title={COST_HINTS.gemini}
            onClick={() => run("sourceGen", () => generateSourceImage(character.id, srcPrompt.trim()))}
          >
            {busy === "sourceGen" ? "Generating…" : "Generate source"}
          </button>
        </>
      )}

      {selectedStep === "extract" && (
        <>
          <button
            className={primary}
            disabled={!!busy || !srcActive?.assetId}
            title={COST_HINTS.gemini}
            onClick={() => run("extract", () => runExtract(character.id))}
          >
            {busy === "extract" ? "Extracting…" : extractActive ? "Re-roll extract" : "Extract"}
          </button>
          <button className={ghost} disabled={!!busy} onClick={() => openSeed("extract")}>
            Upload instead
          </button>
        </>
      )}

      {selectedStep === "sheet" && (
        <>
          <button
            className={primary}
            disabled={!!busy || !(extractActive?.assetId ?? srcActive?.assetId)}
            title={COST_HINTS.sheet}
            onClick={() => run("sheet", () => runSheet(character.id))}
          >
            {busy === "sheet" ? "Building views…" : sheetActive ? "Re-roll sheet" : "Build sheet"}
          </button>
          <button className={ghost} disabled={!!busy} onClick={() => openSeed("sheet")}>
            Upload instead
          </button>
        </>
      )}

      {selectedStep === "meshrig" && (
        <>
          <button
            className={primary}
            disabled={!!busy || !(sheetViews[0] ?? extractActive?.assetId ?? srcActive?.assetId)}
            title={COST_HINTS.mesh}
            onClick={() => run("mesh", () => runMesh(character.id))}
          >
            {busy === "mesh" ? "Meshing…" : meshAsset ? "Re-mesh" : "Generate mesh"}
          </button>
          <button
            className={primary}
            disabled={!!busy || !meshAsset}
            title={COST_HINTS.rig}
            onClick={() => run("rig", () => runRig(character.id))}
          >
            {busy === "rig" ? "Rigging…" : rigAsset ? "Re-rig" : "Rig character"}
          </button>
          <div className="flex gap-1.5">
            <button className={ghost} disabled={!!busy} onClick={() => openSeed("mesh")}>
              Upload GLB
            </button>
            <button className={ghost} disabled={!!busy} onClick={() => openSeed("rig")}>
              Upload rigged
            </button>
          </div>
          {rigAsset && (
            <button
              className={ghost}
              onClick={() => void downloadAsset(rigAsset, `${character.name}-rigged.glb`)}
            >
              Download rigged GLB
            </button>
          )}
        </>
      )}

      {(selectedStep === "pose" || selectedStep === "generate") && generateBlock}

      {error && <div className="text-[11px] text-red-400">{error}</div>}

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,.glb"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void run("seed", () => seedFromFile(seedTarget.current, f));
          e.target.value = "";
        }}
      />
    </div>
  );
}
