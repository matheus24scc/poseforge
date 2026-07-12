"use client";

import { useMemo, useRef, useState } from "react";
import { db, type PoseRotations } from "@/lib/db";
import { applyPose, capturePose, resetPose } from "@/lib/pose";
import {
  BODY_PARTS,
  DRAG_HANDLES,
  poseToJoints2d,
  scopePose,
  solveBoneToward,
  type BodyPart,
  type Vec2,
} from "@/lib/pose2d";
import { CANON, type CanonKey } from "@/lib/pose";
import { useViewportStore } from "@/lib/store";

// 2D pose sketch surface: drag the joint handles of a front-view stick figure
// to author a pose, scope it to body parts, name it, save it. Sketched poses
// are planar (Z-axis / body-plane) — see lib/pose2d.ts.

const W = 260;
const H = 360;
const VIEW = { minX: -0.85, maxX: 0.85, minY: -1.4, maxY: 0.95 };

const toSvg = ([mx, my]: Vec2): Vec2 => [
  ((mx - VIEW.minX) / (VIEW.maxX - VIEW.minX)) * W,
  ((VIEW.maxY - my) / (VIEW.maxY - VIEW.minY)) * H,
];

// child → parent segments for drawing the skeleton
const SEGMENTS = CANON.filter((j) => j.parent && j.parent !== "root").map(
  (j) => [j.key, j.parent as string] as const,
);
const HANDLES = new Set<string>(DRAG_HANDLES);

export default function PoseSketch({ onClose }: { onClose: () => void }) {
  const rig = useViewportStore((s) => s.rig);
  const bumpPoseVersion = useViewportStore((s) => s.bumpPoseVersion);
  const [rotations, setRotations] = useState<PoseRotations>({});
  const [parts, setParts] = useState<BodyPart[]>(BODY_PARTS.map((p) => p.part));
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragKey = useRef<CanonKey | null>(null);

  const joints = useMemo(() => poseToJoints2d(rotations), [rotations]);

  const live = (next: PoseRotations) => {
    setRotations(next);
    if (rig) {
      applyPose(rig, next);
      bumpPoseVersion();
    }
  };

  const pointerToModel = (e: PointerEvent | React.PointerEvent): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = ((e.clientX - rect.left) / rect.width) * W;
    const sy = ((e.clientY - rect.top) / rect.height) * H;
    return [
      VIEW.minX + (sx / W) * (VIEW.maxX - VIEW.minX),
      VIEW.maxY - (sy / H) * (VIEW.maxY - VIEW.minY),
    ];
  };

  const startDrag = (key: CanonKey) => (e: React.PointerEvent) => {
    e.preventDefault();
    dragKey.current = key;
    const move = (ev: PointerEvent) => {
      if (!dragKey.current) return;
      setRotations((r) => {
        const next = solveBoneToward(r, dragKey.current!, pointerToModel(ev));
        if (rig) {
          applyPose(rig, next);
          bumpPoseVersion();
        }
        return next;
      });
    };
    const up = () => {
      dragKey.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const toggle = (part: BodyPart) =>
    setParts((p) => (p.includes(part) ? p.filter((x) => x !== part) : [...p, part]));

  const startFromCurrent = () => {
    if (!rig) return;
    live(capturePose(rig));
  };

  const reset = () => {
    setRotations({});
    if (rig) {
      resetPose(rig);
      bumpPoseVersion();
    }
  };

  const save = async () => {
    if (!name.trim() || parts.length === 0) return;
    const scoped = scopePose(rotations, parts);
    await db.poses.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      rotations: scoped,
      parts: parts.length === BODY_PARTS.length ? undefined : parts,
      tags: ["custom", "sketch"],
      createdAt: Date.now(),
    });
    setSaved(true);
    setTimeout(onClose, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onPointerDown={onClose}>
      <div
        className="flex max-h-full gap-5 rounded-2xl border border-[var(--pf-edge)] bg-neutral-950 p-5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* canvas */}
        <div className="flex flex-col items-center gap-2">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className="touch-none rounded-xl bg-neutral-900"
          >
            {SEGMENTS.map(([a, b], i) => {
              const pa = joints.get(a);
              const pb = joints.get(b);
              if (!pa || !pb) return null;
              const [x1, y1] = toSvg(pa);
              const [x2, y2] = toSvg(pb);
              return (
                <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6db3d9" strokeWidth={4} strokeLinecap="round" />
              );
            })}
            {/* head */}
            {(() => {
              const h = joints.get("head");
              const t = joints.get("head_top");
              if (!h || !t) return null;
              const [hx, hy] = toSvg(h);
              const [tx, ty] = toSvg(t);
              return <circle cx={(hx + tx) / 2} cy={(hy + ty) / 2} r={Math.hypot(tx - hx, ty - hy) / 1.5} fill="#6db3d9" />;
            })()}
            {/* non-handle joints */}
            {CANON.filter((j) => !HANDLES.has(j.key) && j.key !== "head_top").map((j) => {
              const p = joints.get(j.key);
              if (!p) return null;
              const [x, y] = toSvg(p);
              return <circle key={j.key} cx={x} cy={y} r={2.5} fill="#3a4550" />;
            })}
            {/* draggable handles */}
            {DRAG_HANDLES.map((key) => {
              const p = joints.get(key);
              if (!p) return null;
              const [x, y] = toSvg(p);
              return (
                <circle
                  key={key}
                  cx={x}
                  cy={y}
                  r={8}
                  className="cursor-grab fill-azure-500/80 hover:fill-azure-400"
                  onPointerDown={startDrag(key)}
                />
              );
            })}
          </svg>
          <span className="text-[10px] text-neutral-500">Drag the blue joints · front-view (body-plane) pose</span>
        </div>

        {/* controls */}
        <div className="flex w-56 flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-neutral-200">Sketch a pose</span>
            <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">✕</button>
          </div>

          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Body parts to save
            </div>
            <div className="grid grid-cols-3 gap-1">
              {BODY_PARTS.map((g) => (
                <button
                  key={g.part}
                  onClick={() => toggle(g.part)}
                  className={`rounded px-1.5 py-1 text-[11px] ${
                    parts.includes(g.part)
                      ? "bg-azure-600 text-white"
                      : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                  }`}
                >
                  {g.label}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-neutral-600">
              A scoped pose applies as a merge — only its parts move, so fragments compose.
            </div>
          </div>

          <div className="flex gap-1.5">
            <button onClick={reset} className="flex-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700">
              Reset
            </button>
            <button
              onClick={startFromCurrent}
              disabled={!rig}
              className="flex-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:text-neutral-600"
              title={rig ? "Seed from the character's current pose" : "Needs a rigged character"}
            >
              From current
            </button>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Pose name"
            className="rounded bg-neutral-800 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600"
          />
          <button
            onClick={() => void save()}
            disabled={!name.trim() || parts.length === 0 || saved}
            className="rounded bg-azure-600 px-3 py-2 text-sm font-medium text-white hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {saved ? "Saved ✓" : "Save pose"}
          </button>
          {!rig && (
            <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[10px] text-neutral-500">
              Sketch works without a rig. With a rigged character, the sketch drives the 3D
              skeleton live as you drag.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
