"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Keyframe } from "@/lib/db";
import { applyPose, capturePose, interpolatePose } from "@/lib/pose";
import { addKeyframe, deleteKeyframe, segmentKey, setSegment, updateKeyframe } from "@/lib/timeline";
import { COST_HINTS, generateKeyframeStill, runVeoSegment } from "@/lib/pipeline";
import { getAssetUrl } from "@/lib/assets";
import { resolveExpression } from "@/lib/expressions";
import { useAppStore, useViewportStore } from "@/lib/store";
import AssetImage from "./AssetImage";
import AutoTextarea from "./AutoTextarea";

const DEFAULT_MOTION_PROMPT =
  "The character moves smoothly and naturally from the first pose to the second pose. Same character, outfit, lighting and background throughout. Realistic, fluid motion.";

// Timeline: pose keyframes → scrub/play via client-side slerp → per-segment
// Veo generation using the keyframe stills as first/last frames.
export default function Timeline({ characterId }: { characterId: string }) {
  const rig = useViewportStore((s) => s.rig);
  const capture = useViewportStore((s) => s.capture);
  const setPreview = useViewportStore((s) => s.setPreview);
  const bumpPoseVersion = useViewportStore((s) => s.bumpPoseVersion);
  const expressionId = useAppStore((s) => s.expressionId);

  const timeline = useLiveQuery(() => db.timelines.get(characterId), [characterId]);
  const keyframes = timeline?.keyframes ?? [];
  const segments = timeline?.segments ?? {};

  const playhead = useViewportStore((s) => s.playhead);
  const setPlayhead = useViewportStore((s) => s.setPlayhead);
  const [playing, setPlaying] = useState(false);
  const [selectedKf, setSelectedKf] = useState<string | null>(null);
  const [selectedSeg, setSelectedSeg] = useState<string | null>(null);
  const [segPrompt, setSegPrompt] = useState(DEFAULT_MOTION_PROMPT);
  const [fastVeo, setFastVeo] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const playState = useRef({ playing: false, start: 0, from: 0 });

  const clipCount = keyframes
    .slice(0, -1)
    .filter((kf, i) => segments[segmentKey(kf.id, keyframes[i + 1].id)]?.videoAssetId).length;

  const exportVideo = async () => {
    setExporting("Loading ffmpeg…");
    setError(null);
    try {
      const { stitchTimeline } = await import("@/lib/export");
      const blob = await stitchTimeline(characterId, (p) => {
        setExporting(
          p.phase === "loading"
            ? "Loading ffmpeg (~30MB, first time)…"
            : p.phase === "trimming"
              ? `Trimming ${p.detail ?? ""}…`
              : p.phase === "stitching"
                ? "Stitching…"
                : "Done",
        );
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "poseforge-timeline.mp4";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };

  const duration = Math.max(keyframes[keyframes.length - 1]?.time ?? 0, 4) + 1;

  const poseAt = (t: number) => {
    if (!rig || keyframes.length === 0) return;
    let before: Keyframe | null = null;
    let after: Keyframe | null = null;
    for (const kf of keyframes) {
      if (kf.time <= t) before = kf;
      else {
        after = kf;
        break;
      }
    }
    if (before && after) {
      const alpha = (t - before.time) / Math.max(after.time - before.time, 1e-6);
      applyPose(rig, interpolatePose(before.rotations, after.rotations, alpha));
    } else if (before) applyPose(rig, before.rotations);
    else if (after) applyPose(rig, after.rotations);
  };

  // playback loop
  useEffect(() => {
    playState.current.playing = playing;
    if (!playing) return;
    playState.current.start = performance.now();
    playState.current.from = playhead >= duration - 0.05 ? 0 : playhead;
    let raf = 0;
    const tick = () => {
      if (!playState.current.playing) return;
      const t = playState.current.from + (performance.now() - playState.current.start) / 1000;
      if (t >= duration) {
        setPlayhead(duration);
        setPlaying(false);
        return;
      }
      setPlayhead(t);
      poseAt(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const scrubTo = (clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1) * duration;
    setPlayhead(t);
    poseAt(t);
  };

  const go = async (name: string, fn: () => Promise<unknown>) => {
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

  const addAtPlayhead = async () => {
    if (!rig) return;
    const kf = await addKeyframe(characterId, Math.round(playhead * 10) / 10, capturePose(rig));
    setSelectedKf(kf.id);
    setSelectedSeg(null);
  };

  // Generate the keyframe's still: apply its pose, wait a frame, capture.
  const makeStill = (kf: Keyframe) =>
    go(`still:${kf.id}`, async () => {
      if (!rig || !capture) throw new Error("Load the rigged character first.");
      applyPose(rig, kf.rotations);
      bumpPoseVersion();
      await new Promise((r) => setTimeout(r, 150));
      const render = capture();
      const expression = await resolveExpression(expressionId);
      await generateKeyframeStill(characterId, kf.id, render, expression);
    });

  const selKf = keyframes.find((k) => k.id === selectedKf) ?? null;
  const pairs = keyframes.slice(0, -1).map((kf, i) => ({
    key: segmentKey(kf.id, keyframes[i + 1].id),
    from: kf,
    to: keyframes[i + 1],
  }));
  const selPair = pairs.find((p) => p.key === selectedSeg) ?? null;

  return (
    <div className="shrink-0 border-t border-neutral-800 bg-neutral-950/80 px-3 pb-2 pt-1.5">
      {/* transport */}
      <div className="flex items-center gap-2 pb-1.5">
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={keyframes.length < 2}
          className="flex h-6 w-6 items-center justify-center rounded bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600"
          title={keyframes.length < 2 ? "Add at least 2 keyframes" : "Play / pause preview"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="w-16 text-[11px] tabular-nums text-neutral-400">
          {playhead.toFixed(1)}s / {duration.toFixed(1)}s
        </span>
        <button
          onClick={() => void addAtPlayhead()}
          disabled={!rig}
          className="rounded bg-azure-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          title="Save the character's current pose as a keyframe at the playhead"
        >
          + Keyframe
        </button>
        <span className="text-[10px] text-neutral-600">
          scrub the ruler to preview interpolation · clips need stills on both keyframes
        </span>
        {clipCount > 0 && (
          <button
            onClick={() => void exportVideo()}
            disabled={!!exporting}
            className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-200 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-500"
            title={`Stitch ${clipCount} clip${clipCount > 1 ? "s" : ""} (trims applied) into one MP4`}
          >
            {exporting ?? `⬇ Export video (${clipCount})`}
          </button>
        )}
        {error && <span className="truncate text-[10px] text-red-400">{error}</span>}
      </div>

      {/* ruler */}
      <div
        ref={rulerRef}
        className="relative h-10 cursor-crosshair rounded bg-neutral-900"
        onMouseDown={(e) => {
          setPlaying(false);
          scrubTo(e.clientX);
          const move = (ev: MouseEvent) => scrubTo(ev.clientX);
          const up = () => {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
          };
          window.addEventListener("mousemove", move);
          window.addEventListener("mouseup", up);
        }}
      >
        {/* segment bars */}
        {pairs.map((p) => {
          const left = (p.from.time / duration) * 100;
          const width = ((p.to.time - p.from.time) / duration) * 100;
          const seg = segments[p.key];
          const ready = p.from.stillAssetId && p.to.stillAssetId;
          return (
            <button
              key={p.key}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedSeg(p.key);
                setSelectedKf(null);
                setSegPrompt(seg?.prompt ?? DEFAULT_MOTION_PROMPT);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm border ${
                seg?.videoAssetId
                  ? "border-emerald-600 bg-emerald-900/60"
                  : ready
                    ? "border-azure-600 bg-azure-900/40"
                    : "border-neutral-700 bg-neutral-800/60"
              } ${selectedSeg === p.key ? "ring-1 ring-azure-400" : ""}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={
                seg?.videoAssetId
                  ? "Clip generated — click for playback"
                  : ready
                    ? "Ready for Veo — click to generate clip"
                    : "Generate stills on both keyframes first"
              }
            />
          );
        })}
        {/* keyframes */}
        {keyframes.map((kf) => (
          <button
            key={kf.id}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedKf(kf.id);
              setSelectedSeg(null);
              setPlayhead(kf.time);
              if (rig) {
                applyPose(rig, kf.rotations);
                bumpPoseVersion();
              }
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border ${
              kf.stillAssetId ? "border-azure-400 bg-azure-500" : "border-neutral-500 bg-neutral-700"
            } ${selectedKf === kf.id ? "ring-2 ring-azure-300" : ""}`}
            style={{ left: `${(kf.time / duration) * 100}%` }}
            title={`${kf.time.toFixed(1)}s${kf.stillAssetId ? " · still ready" : ""}`}
          />
        ))}
        {/* playhead */}
        <div
          className="pointer-events-none absolute top-0 h-full w-px bg-azure-400"
          style={{ left: `${(playhead / duration) * 100}%` }}
        />
      </div>

      {/* detail row */}
      {selKf && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="text-neutral-500">Keyframe</span>
          <label className="flex items-center gap-1 text-neutral-400">
            t=
            <input
              type="number"
              min={0}
              step={0.1}
              value={selKf.time}
              onChange={(e) =>
                void updateKeyframe(characterId, selKf.id, { time: Number(e.target.value) })
              }
              className="w-14 rounded bg-neutral-800 px-1 py-0.5 tabular-nums"
            />
            s
          </label>
          <button
            onClick={() => void makeStill(selKf)}
            disabled={!!busy}
            className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700 disabled:text-neutral-600"
            title={`Nano-banana still for this keyframe — Veo's frame input. ${COST_HINTS.gemini}`}
          >
            {busy === `still:${selKf.id}` ? "Generating…" : selKf.stillAssetId ? "Re-still" : "Generate still"}
          </button>
          {selKf.stillAssetId && (
            <button
              onClick={() =>
                setPreview({ assetId: selKf.stillAssetId!, label: "Keyframe still" })
              }
              className="cursor-zoom-in"
            >
              <AssetImage assetId={selKf.stillAssetId} alt="still" className="h-8 rounded" />
            </button>
          )}
          <button
            onClick={() => {
              setSelectedKf(null);
              void deleteKeyframe(characterId, selKf.id);
            }}
            className="ml-auto rounded bg-neutral-800 px-2 py-0.5 text-neutral-500 hover:bg-red-900 hover:text-red-200"
          >
            Delete
          </button>
        </div>
      )}
      {selPair && (
        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          <span className="shrink-0 text-neutral-500">
            Clip {selPair.from.time.toFixed(1)}s → {selPair.to.time.toFixed(1)}s
          </span>
          <AutoTextarea
            value={segPrompt}
            onChange={(e) => setSegPrompt(e.target.value)}
            className="min-w-0 flex-1 rounded bg-neutral-800 px-2 py-0.5"
            placeholder="Motion prompt"
          />
          <label
            className="flex shrink-0 items-center gap-1 text-neutral-400"
            title="veo-3.1-fast — cheaper and quicker, slightly lower quality"
          >
            <input type="checkbox" checked={fastVeo} onChange={(e) => setFastVeo(e.target.checked)} />
            fast
          </label>
          <button
            onClick={() =>
              go(`seg:${selPair.key}`, () =>
                runVeoSegment(
                  characterId,
                  selPair.key,
                  segPrompt,
                  selPair.from.stillAssetId!,
                  selPair.to.stillAssetId!,
                  fastVeo,
                ),
              )
            }
            disabled={!!busy || !selPair.from.stillAssetId || !selPair.to.stillAssetId}
            className="rounded bg-azure-600 px-2 py-0.5 font-medium text-white hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            title={COST_HINTS.veo}
          >
            {busy === `seg:${selPair.key}` ? "Generating…" : segments[selPair.key]?.videoAssetId ? "Regenerate clip" : "Generate clip (Veo)"}
          </button>
          {segments[selPair.key]?.videoAssetId && (
            <button
              onClick={() =>
                setPreview({
                  assetId: segments[selPair.key].videoAssetId!,
                  label: "Generated clip",
                  kind: "video",
                  trimStart: segments[selPair.key].trimStart,
                  trimEnd: segments[selPair.key].trimEnd,
                })
              }
              className="rounded bg-neutral-800 px-2 py-0.5 text-neutral-300 hover:bg-neutral-700"
            >
              ▶ Play
            </button>
          )}
        </div>
      )}
      {selPair && segments[selPair.key]?.videoAssetId && (
        <TrimEditor
          key={segments[selPair.key].videoAssetId}
          assetId={segments[selPair.key].videoAssetId!}
          trimStart={segments[selPair.key].trimStart}
          trimEnd={segments[selPair.key].trimEnd}
          onChange={(patch) => void setSegment(characterId, selPair.key, patch)}
        />
      )}
    </div>
  );
}

// Non-destructive in/out trim for a generated clip. Drag the handles (or the
// pill body) over a scrub strip; the video seeks live to the grabbed edge so
// you see the exact frame. Persisted as {trimStart, trimEnd} seconds on the
// segment — the preview player and the stitched export both honor them.
function TrimEditor({
  assetId,
  trimStart,
  trimEnd,
  onChange,
}: {
  assetId: string;
  trimStart?: number;
  trimEnd?: number;
  onChange: (patch: { trimStart?: number; trimEnd?: number }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  // local (uncommitted) drag state so the strip is smooth; commit on release.
  // Refs mirror the latest values so the pointer-up handler reads them directly.
  const [inPt, setInPt] = useState(trimStart ?? 0);
  const [outPt, setOutPt] = useState(trimEnd ?? 0);
  const inRef = useRef(inPt);
  const outRef = useRef(outPt);
  inRef.current = inPt;
  outRef.current = outPt;

  useEffect(() => {
    let cancelled = false;
    void getAssetUrl(assetId).then((u) => !cancelled && setUrl(u));
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  const onLoaded = () => {
    const d = videoRef.current?.duration ?? 0;
    if (!d || !isFinite(d)) return;
    setDuration(d);
    setInPt(trimStart ?? 0);
    setOutPt(trimEnd ?? d);
  };

  const trimmed = inPt > 0.05 || outPt < duration - 0.05;

  const drag = (edge: "in" | "out") => (e: React.PointerEvent) => {
    e.preventDefault();
    const track = trackRef.current;
    const video = videoRef.current;
    if (!track || !duration) return;
    const rect = track.getBoundingClientRect();
    const move = (clientX: number) => {
      const frac = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      const t = Math.round(frac * duration * 10) / 10;
      if (edge === "in") setInPt(Math.min(t, outRef.current - 0.1));
      else setOutPt(Math.max(t, inRef.current + 0.1));
      if (video) video.currentTime = t; // live frame feedback
    };
    move(e.clientX);
    const onMove = (ev: PointerEvent) => move(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onChange({
        trimStart: inRef.current > 0.05 ? inRef.current : undefined,
        trimEnd: outRef.current < duration - 0.05 ? outRef.current : undefined,
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const pct = (t: number) => (duration ? (t / duration) * 100 : 0);

  return (
    <div className="mt-1.5 flex items-center gap-2">
      <video
        ref={videoRef}
        src={url ?? undefined}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoaded}
        className="h-12 shrink-0 rounded bg-black object-contain"
      />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between text-[10px] text-neutral-500">
          <span>Trim</span>
          <span className="tabular-nums">
            {inPt.toFixed(1)}s – {outPt.toFixed(1)}s
            {trimmed && <span className="text-azure-400"> · {(outPt - inPt).toFixed(1)}s clip</span>}
          </span>
          {trimmed && (
            <button
              onClick={() => {
                setInPt(0);
                setOutPt(duration);
                onChange({ trimStart: undefined, trimEnd: undefined });
              }}
              className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-700"
            >
              Reset
            </button>
          )}
        </div>
        <div ref={trackRef} className="relative h-6 rounded bg-neutral-900">
          {/* kept region */}
          <div
            className="absolute top-0 h-full rounded bg-azure-900/40"
            style={{ left: `${pct(inPt)}%`, width: `${pct(outPt - inPt)}%` }}
          />
          {/* in handle */}
          <div
            onPointerDown={drag("in")}
            className="absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded-l bg-azure-500 hover:bg-azure-400"
            style={{ left: `${pct(inPt)}%` }}
            title="In point"
          />
          {/* out handle */}
          <div
            onPointerDown={drag("out")}
            className="absolute top-0 z-10 h-full w-2 -translate-x-1/2 cursor-ew-resize rounded-r bg-azure-500 hover:bg-azure-400"
            style={{ left: `${pct(outPt)}%` }}
            title="Out point"
          />
        </div>
      </div>
    </div>
  );
}
