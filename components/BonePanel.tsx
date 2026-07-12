"use client";

import { useEffect, useState } from "react";
import { useViewportStore } from "@/lib/store";
import { keyForBone, mirrorBonePose, mirrorKey, resetBone, resetPose } from "@/lib/pose";

const RAD = Math.PI / 180;

// REFINE panel (design §05): the numeric view of the same bone the gizmo is
// holding — click a joint on the model or pick one here; slider and gizmo are
// two views of one selection.
export default function BonePanel() {
  const rig = useViewportStore((s) => s.rig);
  const poseVersion = useViewportStore((s) => s.poseVersion);
  const bumpPoseVersion = useViewportStore((s) => s.bumpPoseVersion);
  const showSkeleton = useViewportStore((s) => s.showSkeleton);
  const setShowSkeleton = useViewportStore((s) => s.setShowSkeleton);
  const selectedUuid = useViewportStore((s) => s.selectedBoneUuid);
  const setSelectedUuid = useViewportStore((s) => s.setSelectedBoneUuid);
  const snap = useViewportStore((s) => s.snap);
  const setSnap = useViewportStore((s) => s.setSnap);

  const [deg, setDeg] = useState<[number, number, number]>([0, 0, 0]);

  const selected = rig?.bones.find((b) => b.uuid === selectedUuid) ?? null;
  const canonKey = rig && selectedUuid ? keyForBone(rig, selectedUuid) : null;
  const mirrorable = canonKey ? mirrorKey(canonKey) : null;

  useEffect(() => {
    if (!selected) return;
    setDeg([
      Math.round(selected.rotation.x / RAD),
      Math.round(selected.rotation.y / RAD),
      Math.round(selected.rotation.z / RAD),
    ]);
  }, [selected, poseVersion]);

  if (!rig) {
    return (
      <div className="p-3 text-xs text-neutral-600">
        Bone controls unlock once a rigged character is loaded.
      </div>
    );
  }

  const setAxis = (axis: 0 | 1 | 2, value: number) => {
    if (!selected) return;
    const next: [number, number, number] = [...deg];
    next[axis] = value;
    setDeg(next);
    selected.rotation.set(next[0] * RAD, next[1] * RAD, next[2] * RAD);
    selected.updateMatrixWorld(true);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">
          Refine{selected ? ` · ${selected.name}` : ""}
        </span>
        <button
          onClick={() => {
            resetPose(rig);
            bumpPoseVersion();
          }}
          className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-700"
          title="Reset the whole pose to the T-pose bind"
        >
          Reset all
        </button>
      </div>

      <div className="flex items-center gap-3 text-xs text-neutral-400">
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={showSkeleton}
            onChange={(e) => setShowSkeleton(e.target.checked)}
          />
          Skeleton
        </label>
        <label className="flex items-center gap-1" title="Gizmo drags snap to 15° steps">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          Snap 15°
        </label>
      </div>

      <select
        value={selectedUuid ?? ""}
        onChange={(e) => setSelectedUuid(e.target.value || null)}
        className="w-full rounded bg-neutral-800 px-2 py-1 text-xs"
      >
        <option value="">— click a joint on the model, or pick ({rig.bones.length}) —</option>
        {rig.bones.map((b) => (
          <option key={b.uuid} value={b.uuid}>
            {b.name || b.uuid.slice(0, 8)}
          </option>
        ))}
      </select>

      {selected && (
        <>
          <div className="flex flex-col gap-2">
            {(["X", "Y", "Z"] as const).map((label, i) => (
              <label key={label} className="flex items-center gap-2 text-xs text-neutral-400">
                <span className="w-3">{label}</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  value={deg[i]}
                  onChange={(e) => setAxis(i as 0 | 1 | 2, Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-9 text-right font-mono text-[11px] tabular-nums">{deg[i]}°</span>
              </label>
            ))}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => {
                if (canonKey && mirrorBonePose(rig, canonKey)) bumpPoseVersion();
              }}
              disabled={!mirrorable}
              title={
                mirrorable
                  ? `Copy this joint's pose, mirrored, to ${mirrorable.replace("_", " ")}`
                  : "Center bones have no mirror side"
              }
              className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600"
            >
              Mirror ⇋
            </button>
            <button
              onClick={() => {
                resetBone(rig, selected);
                bumpPoseVersion();
              }}
              className="flex-1 rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
            >
              Reset joint
            </button>
          </div>
        </>
      )}
    </div>
  );
}
