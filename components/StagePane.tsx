"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { applyExpression2d, applyPose2d, refineExpression, setSourceImage } from "@/lib/pipeline";
import { activeVersion } from "@/lib/stages";
import { downloadAsset, getAssetUrl } from "@/lib/assets";
import { resolveExpression } from "@/lib/expressions";
import { capturePose, poseSkeletonPng } from "@/lib/pose";
import { useAppStore, useViewportStore } from "@/lib/store";
import Viewport from "./Viewport";
import Timeline from "./Timeline";
import AssetImage from "./AssetImage";
import VersionStrip from "./VersionStrip";

// CENTER · Stage: the selected step's output, full bleed. Actions/prompting
// live in the LEFT rail; here it's review chrome only — viewport tools, the
// version filmstrip, previews — all collapsible.

const chip =
  "rounded-lg bg-neutral-800/90 px-3 py-1.5 text-xs text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600";
const chipOn =
  "rounded-lg bg-azure-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-azure-500";

function BigImage({ assetId, alt }: { assetId: string; alt: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-8 pb-28">
      <AssetImage assetId={assetId} alt={alt} className="max-h-full max-w-full rounded-xl object-contain" />
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-sm text-neutral-500">
      {text}
    </div>
  );
}

export default function StagePane({ characterId }: { characterId: string | null }) {
  const selectedStep = useAppStore((s) => s.selectedStep);
  const setRightOpen = useAppStore((s) => s.setRightOpen);
  const expressionId = useAppStore((s) => s.expressionId);
  const poseSel = useAppStore((s) => s.poseSel);
  const dockOpen = useAppStore((s) => s.dockOpen);
  const setDockOpen = useAppStore((s) => s.setDockOpen);
  const timelineOpen = useAppStore((s) => s.timelineOpen);
  const setTimelineOpen = useAppStore((s) => s.setTimelineOpen);
  const preview = useViewportStore((s) => s.preview);
  const setPreview = useViewportStore((s) => s.setPreview);
  const resetView = useViewportStore((s) => s.resetView);
  const showSkeleton = useViewportStore((s) => s.showSkeleton);
  const setShowSkeleton = useViewportStore((s) => s.setShowSkeleton);
  const selectedBoneUuid = useViewportStore((s) => s.selectedBoneUuid);
  const rig = useViewportStore((s) => s.rig);
  const poseVersion = useViewportStore((s) => s.poseVersion);
  const selectedBoneName = rig?.bones.find((b) => b.uuid === selectedBoneUuid)?.name ?? null;

  // picking a joint reveals the Refine panel in the right rail
  useEffect(() => {
    if (selectedBoneUuid && selectedStep === "pose") setRightOpen(true);
  }, [selectedBoneUuid, selectedStep, setRightOpen]);

  // Persist the character's working pose on every edit (keystone for §7b): each
  // pose change bumps poseVersion; capture the live rig → character.poseRotations
  // so it reloads here and in every composition placement. Read char/rig/step
  // fresh so a character switch (which doesn't bump poseVersion) can't cross-save.
  useEffect(() => {
    const cid = useAppStore.getState().characterId;
    const liveRig = useViewportStore.getState().rig;
    if (!cid || !liveRig || useAppStore.getState().selectedStep !== "pose") return;
    void db.characters.update(cid, { poseRotations: capturePose(liveRig) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseVersion]);

  const character = useLiveQuery(
    () => (characterId ? db.characters.get(characterId) : undefined),
    [characterId],
  );
  const generations = useLiveQuery(
    () =>
      characterId
        ? db.generations.where("characterId").equals(characterId).reverse().sortBy("createdAt")
        : [],
    [characterId],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedGen, setSelectedGen] = useState<string | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);

  const rigAsset = activeVersion(character, "rig")?.assetId ?? null;
  const meshAsset = activeVersion(character, "mesh")?.assetId ?? null;
  const modelAssetId = rigAsset ?? meshAsset;
  const blobReady = useLiveQuery(
    async () => (modelAssetId ? !!(await db.blobs.get(modelAssetId)) : false),
    [modelAssetId],
  );
  useEffect(() => {
    let cancelled = false;
    if (!modelAssetId || !blobReady) {
      setModelUrl(null);
      return;
    }
    void getAssetUrl(modelAssetId).then((url) => {
      if (!cancelled) setModelUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [modelAssetId, blobReady]);

  useEffect(() => setPreview(null), [characterId, selectedStep, setPreview]);
  useEffect(() => setSelectedGen(null), [characterId]);

  const srcActive = activeVersion(character, "source");
  const extractActive = activeVersion(character, "extract");
  const sheetViews = activeVersion(character, "sheet")?.viewIds ?? [];
  const is3dStep = selectedStep === "meshrig" || selectedStep === "pose";
  const currentGen = (generations ?? []).find((g) => g.id === selectedGen) ?? generations?.[0];

  let content: React.ReactNode = null;
  if (!character) {
    content = <EmptyHint text="Create a character in the Process rail to begin." />;
  } else if (selectedStep === "source") {
    content = srcActive?.assetId ? (
      <BigImage assetId={srcActive.assetId} alt="source" />
    ) : (
      <EmptyHint text="Drop an image here — or describe a character in the left rail." />
    );
  } else if (selectedStep === "extract") {
    content = extractActive?.assetId ? (
      <BigImage assetId={extractActive.assetId} alt="extracted" />
    ) : (
      <EmptyHint text="Extract isolates the character onto a clean background." />
    );
  } else if (selectedStep === "sheet") {
    content =
      sheetViews.length > 0 ? (
        <div className="flex h-full items-center justify-center gap-3 p-8 pb-28">
          {sheetViews.map((id, i) => (
            <button
              key={id}
              onClick={() =>
                setPreview({ assetId: id, label: ["Sheet — front", "Sheet — side", "Sheet — back"][i] ?? "Sheet view" })
              }
              className="min-w-0 flex-1 cursor-zoom-in"
            >
              <AssetImage assetId={id} alt={`view ${i}`} className="max-h-[60vh] w-full rounded-xl bg-neutral-950/40 object-contain" />
            </button>
          ))}
        </div>
      ) : (
        <EmptyHint text="The turnaround sheet: front, side and back T-pose views." />
      );
  } else if (is3dStep) {
    content = (
      <Viewport
        modelUrl={modelUrl}
        poseMode={selectedStep === "pose"}
        initialPose={character?.poseRotations ?? null}
      />
    );
  } else if (selectedStep === "generate") {
    content = currentGen ? (
      <BigImage assetId={currentGen.outputAssetId} alt="generation" />
    ) : (
      <EmptyHint text="Nothing generated yet. The flow: ① pose the character on step 5 · ② hit Generate in the left rail (it captures the pose for you) · ③ results land here, with Download and Refine face below. Pick a face in References first to set the expression." />
    );
  }

  const go = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 2D img2img actions: the selected face/pose from References applies to the
  // image in the center. On source/extract the result is a new stage version;
  // on generate it's a new generation.
  const imageTarget: { assetId: string; stage?: "source" | "extract" } | null =
    selectedStep === "source" && srcActive?.assetId
      ? { assetId: srcActive.assetId, stage: "source" }
      : selectedStep === "extract" && extractActive?.assetId
        ? { assetId: extractActive.assetId, stage: "extract" }
        : selectedStep === "generate" && currentGen
          ? { assetId: currentGen.outputAssetId }
          : null;

  const apply2d: React.ReactNode = !character || !imageTarget ? null : (
    <>
      {expressionId && (
        <button
          className={chip}
          disabled={busy}
          title="img2img: change only the face on this image"
          onClick={() =>
            go(async () => {
              const expression = await resolveExpression(expressionId);
              if (!expression) return;
              await applyExpression2d(character.id, imageTarget.assetId, expression, imageTarget.stage);
              setSelectedGen(null);
            })
          }
        >
          {busy ? "…" : "Apply face (2D)"}
        </button>
      )}
      {poseSel && (
        <button
          className={chip}
          disabled={busy}
          title={`img2img: redraw this image in the "${poseSel.name}" pose using its skeleton`}
          onClick={() =>
            go(async () => {
              await applyPose2d(
                character.id,
                imageTarget.assetId,
                { name: poseSel.name, skeletonPngDataUri: poseSkeletonPng(poseSel.rotations) },
                imageTarget.stage,
              );
              setSelectedGen(null);
            })
          }
        >
          {busy ? "…" : `Apply pose (2D): ${poseSel.name}`}
        </button>
      )}
    </>
  );

  // review chrome: viewport tools on 3D steps, result actions on generate
  const tools: React.ReactNode = !character ? null : (
    <>
      {is3dStep && (
        <>
          <button className={chip} onClick={() => resetView?.()} disabled={!resetView}>
            Reset view
          </button>
          <button className={showSkeleton ? chipOn : chip} onClick={() => setShowSkeleton(!showSkeleton)}>
            Skeleton
          </button>
        </>
      )}
      {selectedStep === "generate" && currentGen && (
        <>
          <button
            className={chip}
            onClick={() => void downloadAsset(currentGen.outputAssetId, "poseforge-generation.png")}
          >
            Download
          </button>
          <button
            className={chip}
            disabled={busy || !expressionId}
            title="Second img2img pass: change only the face (pick one in Faces)"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const expression = await resolveExpression(expressionId);
                if (expression && characterId) {
                  await refineExpression(characterId, currentGen.outputAssetId, expression);
                  setSelectedGen(null);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Refining…" : "Refine face"}
          </button>
        </>
      )}
    </>
  );

  const strips: React.ReactNode = !character ? null : (
    <>
      {(selectedStep === "source" || selectedStep === "extract" || selectedStep === "sheet") && (
        <VersionStrip character={character} stage={selectedStep} compact />
      )}
      {selectedStep === "meshrig" && (
        <div className="flex items-center gap-3">
          <span className="font-mono text-[9px] uppercase text-neutral-500">mesh</span>
          <VersionStrip character={character} stage="mesh" compact />
          <span className="font-mono text-[9px] uppercase text-neutral-500">rig</span>
          <VersionStrip character={character} stage="rig" compact />
        </div>
      )}
      {selectedStep === "generate" && (generations ?? []).length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto">
          {(generations ?? []).slice(0, 12).map((g) => (
            <button
              key={g.id}
              onClick={() => setSelectedGen(g.id)}
              className={`h-12 w-12 shrink-0 overflow-hidden rounded-lg border ${
                currentGen?.id === g.id
                  ? "border-azure-600 ring-1 ring-azure-600"
                  : "border-[var(--pf-edge)] opacity-60 hover:opacity-100"
              }`}
            >
              <AssetImage assetId={g.outputAssetId} alt="gen" className="h-full w-full bg-neutral-950 object-cover" />
            </button>
          ))}
        </div>
      )}
    </>
  );

  const hasDockContent = !!tools || !!strips || !!error || !!apply2d;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div
        className="relative min-h-0 flex-1"
        style={{ background: "var(--pf-stage)" }}
        onDragOver={(e) => selectedStep === "source" && e.preventDefault()}
        onDrop={(e) => {
          if (selectedStep !== "source" || !character) return;
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void setSourceImage(character.id, f).catch((err) => setError(String(err?.message ?? err)));
        }}
      >
        <span className="pointer-events-none absolute left-4 top-3 font-mono text-[9.5px] uppercase tracking-[0.2em] text-neutral-500">
          Stage
        </span>
        {content}

        {/* selected joint label (design §05) */}
        {selectedStep === "pose" && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full border border-[var(--pf-edge)] bg-[var(--pf-glass)] px-3 py-1 font-mono text-[10px] text-neutral-300 backdrop-blur-lg">
              {selectedBoneName
                ? `${selectedBoneName} · drag the gizmo to rotate · click empty space to deselect`
                : "click a joint to pose · scroll to zoom · drag to orbit"}
            </span>
          </div>
        )}

        {/* collapsible review dock */}
        {hasDockContent && (
          <div className="absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
            {dockOpen ? (
              <div className="flex max-w-full flex-col gap-2 rounded-[14px] border border-[var(--pf-edge)] bg-[var(--pf-glass)] p-2.5 backdrop-blur-lg">
                <div className="flex flex-wrap items-center gap-2">
                  {tools}
                  {apply2d}
                  <button
                    onClick={() => setDockOpen(false)}
                    title="Collapse"
                    className="ml-auto flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800"
                  >
                    ⌄
                  </button>
                </div>
                {strips}
                {error && <div className="max-w-md text-[11px] text-red-400">{error}</div>}
              </div>
            ) : (
              <button
                onClick={() => setDockOpen(true)}
                title="Expand"
                className="rounded-full border border-[var(--pf-edge)] bg-[var(--pf-glass)] px-3 py-1 font-mono text-[10px] text-neutral-400 backdrop-blur-lg hover:text-neutral-200"
              >
                ⌃ tools
              </button>
            )}
          </div>
        )}

        {/* asset preview overlay */}
        {preview && (
          <div className="absolute inset-0 z-30 flex flex-col bg-neutral-950">
            <div className="flex items-center justify-between border-b border-[var(--pf-hair)] px-3 py-2">
              <span className="text-xs text-neutral-400">{preview.label}</span>
              <div className="flex gap-1.5">
                <button
                  onClick={() =>
                    void downloadAsset(
                      preview.assetId,
                      preview.kind === "video" ? "poseforge-clip.mp4" : "poseforge-image.png",
                    )
                  }
                  className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  Download
                </button>
                <button
                  onClick={() => setPreview(null)}
                  className="rounded-lg bg-neutral-800 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
                >
                  ✕ Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 p-3">
              {preview.kind === "video" ? (
                <PreviewVideo
                  assetId={preview.assetId}
                  trimStart={preview.trimStart}
                  trimEnd={preview.trimEnd}
                />
              ) : (
                <AssetImage assetId={preview.assetId} alt={preview.label} className="h-full w-full object-contain" />
              )}
            </div>
          </div>
        )}
      </div>

      {/* collapsible timeline drawer on the pose step */}
      {selectedStep === "pose" &&
        characterId &&
        (timelineOpen ? (
          <div className="relative">
            <button
              onClick={() => setTimelineOpen(false)}
              title="Collapse timeline"
              className="absolute right-2 top-1 z-10 flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800"
            >
              ⌄
            </button>
            <Timeline characterId={characterId} />
          </div>
        ) : (
          <button
            onClick={() => setTimelineOpen(true)}
            className="shrink-0 border-t border-[var(--pf-hair)] bg-neutral-950/80 py-1 font-mono text-[10px] text-neutral-500 hover:text-neutral-300"
          >
            ⌃ timeline
          </button>
        ))}
    </section>
  );
}

function PreviewVideo({
  assetId,
  trimStart,
  trimEnd,
}: {
  assetId: string;
  trimStart?: number;
  trimEnd?: number;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let cancelled = false;
    void getAssetUrl(assetId).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // Non-destructive trim: keep playback inside [trimStart, trimEnd] by seeking.
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    const end = trimEnd ?? v.duration;
    const start = trimStart ?? 0;
    if (v.currentTime >= end || v.currentTime < start - 0.05) v.currentTime = start;
  };
  const onLoaded = () => {
    if (videoRef.current && trimStart) videoRef.current.currentTime = trimStart;
  };

  if (!url)
    return <div className="flex h-full items-center justify-center text-xs text-neutral-600">Loading video…</div>;
  return (
    <video
      ref={videoRef}
      src={url}
      controls
      autoPlay
      loop
      onLoadedMetadata={onLoaded}
      onTimeUpdate={onTimeUpdate}
      className="h-full w-full object-contain"
    />
  );
}
