"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type PoseRotations } from "@/lib/db";
import { applyPose, applyPoseMerge, capturePose, computePosePreview, resetPose, BUILTIN_POSES } from "@/lib/pose";
import PoseSketch from "./PoseSketch";
import { MOCAP_CLIPS, MOCAP_POSES, type MocapClip } from "@/lib/mocap";
import { insertClip } from "@/lib/timeline";
import { activeVersion } from "@/lib/stages";
import { askPrompt } from "@/lib/dialog";
import { useAppStore, useViewportStore } from "@/lib/store";

// Skeleton thumbnail: FK-evaluated stick figure showing the pose's body
// orientation — the library IS a series of skeletons, per the design.
export function PoseThumb({ rotations }: { rotations: PoseRotations }) {
  const { lines, head } = computePosePreview(rotations);
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full">
      {lines.map(([x1, y1, x2, y2], i) => (
        <line
          key={i}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="currentColor"
          strokeWidth={3.5}
          strokeLinecap="round"
        />
      ))}
      <circle cx={head.x} cy={head.y} r={head.r} fill="currentColor" />
    </svg>
  );
}

/** Clip thumbnail: mid-frame skeleton that plays through the clip on hover. */
function ClipThumb({ clip }: { clip: MocapClip }) {
  const [frame, setFrame] = useState(Math.floor(clip.frames.length / 2));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  return (
    <div
      className="h-full w-full"
      onMouseEnter={() => {
        let i = 0;
        timer.current = setInterval(() => {
          setFrame(i % clip.frames.length);
          i++;
        }, 140);
      }}
      onMouseLeave={() => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        setFrame(Math.floor(clip.frames.length / 2));
      }}
    >
      <PoseThumb rotations={clip.frames[frame].rotations} />
    </div>
  );
}

const STANCE_TAGS = new Set(["neutral", "stand", "rest", "idle", "sit"]);

function Section({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
          {label}
        </span>
        {hint && <span className="text-[9px] text-neutral-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function PosesPanel() {
  const rig = useViewportStore((s) => s.rig);
  const bumpPoseVersion = useViewportStore((s) => s.bumpPoseVersion);
  const setPendingPose = useViewportStore((s) => s.setPendingPose);
  const playhead = useViewportStore((s) => s.playhead);
  const characterId = useAppStore((s) => s.characterId);
  const setSelectedStep = useAppStore((s) => s.setSelectedStep);
  const setTimelineOpen = useAppStore((s) => s.setTimelineOpen);
  const setPoseSel = useAppStore((s) => s.setPoseSel);
  const userPoses = useLiveQuery(() => db.poses.orderBy("createdAt").toArray(), []);
  const character = useLiveQuery(
    () => (characterId ? db.characters.get(characterId) : undefined),
    [characterId],
  );
  const rigged = !!activeVersion(character, "rig")?.assetId;
  const [applied, setApplied] = useState<string | null>(null);
  const [sketching, setSketching] = useState(false);

  // Selecting a pose always affects the center: rigged characters jump to the
  // Pose step and take the pose (immediately if the rig is mounted, else the
  // moment it loads); the selection also arms "Apply pose (2D)" on image steps.
  // A body-part-scoped pose (parts set) merges onto the current pose.
  const apply = (id: string, name: string, rotations: PoseRotations, parts?: string[]) => {
    setPoseSel({ id, name, rotations });
    setApplied(id);
    if (!rigged) return;
    if (rig) {
      if (parts?.length) applyPoseMerge(rig, rotations);
      else applyPose(rig, rotations);
      bumpPoseVersion();
    } else {
      setPendingPose(rotations);
    }
    setSelectedStep("pose");
  };

  // Clips go to the timeline: keyframes land at the playhead, existing
  // keyframes slide right to make room (see insertClip).
  const applyClip = async (clip: MocapClip) => {
    if (!rigged || !characterId) return;
    setApplied(clip.id);
    await insertClip(characterId, playhead, clip.frames);
    if (rig) {
      applyPose(rig, clip.frames[0].rotations);
      bumpPoseVersion();
    }
    setSelectedStep("pose");
    setTimelineOpen(true);
  };

  const saveCurrent = async () => {
    if (!rig) return;
    const name = await askPrompt("Pose name:");
    if (!name?.trim()) return;
    const rotations = capturePose(rig);
    await db.poses.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      rotations,
      createdAt: Date.now(),
    });
  };

  const builtinStances = BUILTIN_POSES.filter((p) => p.tags.some((t) => STANCE_TAGS.has(t)));
  const builtinActions = BUILTIN_POSES.filter((p) => !p.tags.some((t) => STANCE_TAGS.has(t)));
  const stances = [...builtinStances, ...MOCAP_POSES.filter((p) => p.section === "stance")];
  const actions = [...builtinActions, ...MOCAP_POSES.filter((p) => p.section === "action")];

  const poseCard = (pose: { id: string; name: string; rotations: PoseRotations; parts?: string[] }) => (
    <button
      key={pose.id}
      onClick={() => apply(pose.id, pose.name, pose.rotations, pose.parts)}
      className={`w-full rounded-lg border bg-neutral-900/60 p-2 text-azure-400/90 transition hover:border-azure-600 ${
        applied === pose.id ? "border-azure-500" : "border-neutral-800"
      }`}
    >
      <div className="aspect-square">
        <PoseThumb rotations={pose.rotations} />
      </div>
      <div className="mt-1 truncate text-center text-[11px] text-neutral-300">{pose.name}</div>
    </button>
  );

  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Pose library
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => setSketching(true)}
            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
            title="Sketch a pose on a 2D stick figure and save it"
          >
            ✎ Sketch
          </button>
          <button
            onClick={() => void saveCurrent()}
            disabled={!rig}
            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-600"
            title="Save the character's current pose to the library"
          >
            + Save current
          </button>
        </div>
      </div>
      {sketching && <PoseSketch onClose={() => setSketching(false)} />}
      {!rig && (
        <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-500">
          No rig yet — selecting a pose arms the 2D &quot;Apply pose&quot; action on image
          stages. With a rigged character it poses the skeleton directly.
        </div>
      )}

      <Section label="Stances" hint={`${stances.length}`}>
        <div className="grid grid-cols-2 gap-2">{stances.map(poseCard)}</div>
      </Section>

      <Section label="Actions" hint={`${actions.length}`}>
        <div className="grid grid-cols-2 gap-2">{actions.map(poseCard)}</div>
      </Section>

      <Section label="Clips" hint="CMU mocap → timeline">
        <div className="grid grid-cols-2 gap-2">
          {MOCAP_CLIPS.map((clip) => (
            <button
              key={clip.id}
              onClick={() => void applyClip(clip)}
              disabled={!rigged}
              title={
                rigged
                  ? `Insert ${clip.frames.length} keyframes at the playhead (${clip.duration}s)`
                  : "Clips need a rigged character"
              }
              className={`group w-full rounded-lg border bg-neutral-900/60 p-2 text-azure-400/90 transition hover:border-azure-600 disabled:cursor-not-allowed disabled:opacity-40 ${
                applied === clip.id ? "border-azure-500" : "border-neutral-800"
              }`}
            >
              <div className="relative aspect-square">
                <ClipThumb clip={clip} />
                <span className="absolute bottom-0 right-0 rounded bg-neutral-950/80 px-1 text-[9px] tabular-nums text-neutral-400">
                  {clip.duration}s
                </span>
              </div>
              <div className="mt-1 truncate text-center text-[11px] text-neutral-300">
                {clip.name}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <Section label="Yours" hint={userPoses?.length ? `${userPoses.length}` : "save poses you like"}>
        {userPoses?.length ? (
          <div className="grid grid-cols-2 gap-2">
            {userPoses.map((pose) => (
              <div key={pose.id} className="group relative">
                {poseCard(pose)}
                <button
                  onClick={() => void db.poses.delete(pose.id)}
                  className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-neutral-400 hover:bg-red-900 hover:text-red-200 group-hover:flex"
                  title="Delete pose"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-neutral-800 p-2 text-center text-[10px] text-neutral-600">
            Pose the character, then “+ Save current”.
          </div>
        )}
      </Section>

      {rig && (
        <button
          onClick={() => {
            resetPose(rig);
            bumpPoseVersion();
            setApplied(null);
          }}
          className="rounded bg-neutral-800 px-2 py-1.5 text-xs text-neutral-400 hover:bg-neutral-700"
        >
          Reset to T-pose
        </button>
      )}
      <div className="text-[10px] leading-relaxed text-neutral-600">
        Poses are joint-rotation presets — apply one, refine it with the bone controls, then save
        your version. Clips come from the CMU motion-capture library and drop onto the timeline
        as keyframes.
      </div>
    </div>
  );
}
