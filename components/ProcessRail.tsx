"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { db, type CharacterRow, type JobRow } from "@/lib/db";
import { createCharacter, forkCharacter } from "@/lib/pipeline";
import { activeVersion, getStage } from "@/lib/stages";
import { askPrompt } from "@/lib/dialog";
import { useAppStore, type ProcessStep } from "@/lib/store";
import StageActions from "./StageActions";

// LEFT · Process — the pipeline as a vertical spine (design §04). Steps show
// done/current/locked state, version counts, in-place job progress and stale
// cues. Clicking a step drives what the Stage shows.

const STEPS: { key: ProcessStep; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "extract", label: "Extract" },
  { key: "sheet", label: "Character sheet" },
  { key: "meshrig", label: "3D mesh & rig" },
  { key: "pose", label: "Pose" },
  { key: "generate", label: "Generate" },
];

const JOB_STEP: Record<string, ProcessStep> = {
  sourceGen: "source",
  extract: "extract",
  sheet: "sheet",
  mesh: "meshrig",
  rig: "meshrig",
  imageGen: "generate",
  videoGen: "pose",
};

function stepInfo(ch: CharacterRow | undefined, step: ProcessStep, genCount: number) {
  const done = (() => {
    switch (step) {
      case "source":
        return !!activeVersion(ch, "source");
      case "extract":
        return !!activeVersion(ch, "extract");
      case "sheet":
        return !!activeVersion(ch, "sheet");
      case "meshrig":
        return !!activeVersion(ch, "rig")?.assetId;
      case "pose":
        return false; // an activity, not an artifact
      case "generate":
        return genCount > 0;
    }
  })();
  const locked = (() => {
    switch (step) {
      // Source/Extract/Sheet/Mesh stay navigable even with nothing upstream, so
      // you can start at any phase — upload a white-background character as the
      // extract, seed a sheet from the library, drop in a GLB. Each step's RUN
      // button is separately gated on its inputs (see StageActions). Only the
      // 3D steps need a rig to do anything.
      case "source":
      case "extract":
      case "sheet":
      case "meshrig":
        return false;
      case "pose":
      case "generate":
        return !activeVersion(ch, "rig")?.assetId;
    }
  })();
  const versions = (() => {
    switch (step) {
      case "source":
      case "extract":
      case "sheet":
        return getStage(ch, step).versions.length;
      case "meshrig":
        return getStage(ch, "mesh").versions.length + getStage(ch, "rig").versions.length;
      case "generate":
        return genCount;
      default:
        return 0;
    }
  })();
  const stale = (() => {
    switch (step) {
      case "extract":
      case "sheet":
        return !!getStage(ch, step).stale;
      case "meshrig":
        return !!getStage(ch, "mesh").stale || !!getStage(ch, "rig").stale;
      default:
        return false;
    }
  })();
  return { done, locked, versions, stale };
}

export default function ProcessRail() {
  const projectId = useAppStore((s) => s.projectId);
  const characterId = useAppStore((s) => s.characterId);
  const setCharacter = useAppStore((s) => s.setCharacter);
  const selectedStep = useAppStore((s) => s.selectedStep);
  const setSelectedStep = useAppStore((s) => s.setSelectedStep);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const setLeftOpen = useAppStore((s) => s.setLeftOpen);

  const characters = useLiveQuery(
    () => (projectId ? db.characters.where("projectId").equals(projectId).sortBy("createdAt") : []),
    [projectId],
  );
  const character = useLiveQuery(
    () => (characterId ? db.characters.get(characterId) : undefined),
    [characterId],
  );
  const genCount =
    useLiveQuery(
      () => (characterId ? db.generations.where("characterId").equals(characterId).count() : 0),
      [characterId],
    ) ?? 0;
  const runningJobs = useLiveQuery(
    () =>
      characterId
        ? db.jobs.where("status").equals("running").and((j) => j.characterId === characterId).toArray()
        : [],
    [characterId],
  );

  const runningByStep = new Map<ProcessStep, JobRow>();
  for (const j of runningJobs ?? []) {
    const s = JOB_STEP[j.kind];
    if (s && !runningByStep.has(s)) runningByStep.set(s, j);
  }

  // Entry point: the first pipeline step that actually has content. If it isn't
  // Source, earlier steps were skipped (started from mesh / a seeded sheet /
  // an uploaded extract) — we gray those and badge the entry step.
  const PIPELINE: ProcessStep[] = ["source", "extract", "sheet", "meshrig"];
  const hasContent = (key: ProcessStep) =>
    key === "meshrig"
      ? getStage(character, "mesh").versions.length > 0 || getStage(character, "rig").versions.length > 0
      : getStage(character, key as "source" | "extract" | "sheet").versions.length > 0;
  const entryIdx = PIPELINE.findIndex(hasContent);
  const startedLater = entryIdx > 0;

  const addCharacter = async () => {
    if (!projectId) return;
    const name = await askPrompt("Character name:", `Character ${(characters?.length ?? 0) + 1}`);
    if (!name?.trim()) return;
    const ch = await createCharacter(projectId, name.trim());
    setCharacter(ch.id);
    setSelectedStep("source");
  };

  // collapsed: an icon strip — step circles stay clickable
  if (!leftOpen) {
    return (
      <aside className="flex w-11 shrink-0 flex-col items-center gap-1.5 border-r border-[var(--pf-hair)] bg-[var(--pf-panel)] py-2">
        <button
          onClick={() => setLeftOpen(true)}
          title="Expand process rail"
          className="mb-1 flex h-6 w-6 items-center justify-center rounded text-neutral-400 hover:bg-neutral-800"
        >
          »
        </button>
        {STEPS.map((step, i) => {
          const { done, locked } = stepInfo(character, step.key, genCount);
          const current = selectedStep === step.key;
          return (
            <button
              key={step.key}
              onClick={() => !locked && setSelectedStep(step.key)}
              disabled={locked}
              title={step.label}
              className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-[10px] font-semibold ${
                done
                  ? "bg-neutral-800 text-ok-500"
                  : current
                    ? "bg-azure-600 text-white"
                    : "border border-dashed border-neutral-600 text-neutral-500"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {done ? "✓" : i + 1}
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <aside className="flex w-[262px] shrink-0 flex-col border-r border-[var(--pf-hair)] bg-[var(--pf-panel)]">
      {/* character switcher */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--pf-hair)] p-3">
        <button
          onClick={() => setLeftOpen(false)}
          title="Collapse process rail"
          className="order-last ml-auto flex h-6 w-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800"
        >
          «
        </button>
        {(characters ?? []).map((ch) => (
          <button
            key={ch.id}
            onClick={() => setCharacter(ch.id)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              ch.id === characterId
                ? "bg-azure-900 text-azure-300 ring-1 ring-azure-600/40"
                : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
            }`}
          >
            {ch.name}
          </button>
        ))}
        <button
          onClick={() => void addCharacter()}
          className="rounded-full bg-neutral-800 px-2.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-700"
          title="New character in this project"
        >
          +
        </button>
        <button
          onClick={async () => {
            if (!characterId || !character) return;
            const name = await askPrompt(
              "Fork name (work on a variant in parallel — stages are shared, work diverges):",
              `${character.name} · variant`,
            );
            if (!name?.trim()) return;
            const fork = await forkCharacter(characterId, name.trim());
            setCharacter(fork.id);
          }}
          disabled={!characterId}
          className="rounded-full bg-neutral-800 px-2.5 py-1 text-[11px] text-neutral-500 hover:bg-neutral-700 disabled:cursor-not-allowed"
          title="Fork this character — e.g. an 'angry' and a 'sad' variant evolving in parallel"
        >
          ⑂
        </button>
      </div>

      <div className="px-4 pb-1 pt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500">
        Process
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
        {STEPS.map((step, i) => {
          const { done, locked, versions, stale } = stepInfo(character, step.key, genCount);
          const running = runningByStep.get(step.key);
          const current = selectedStep === step.key;
          const seedable = step.key !== "pose" && step.key !== "generate";
          const pipeIdx = PIPELINE.indexOf(step.key);
          const skipped = startedLater && pipeIdx >= 0 && pipeIdx < entryIdx;
          const isEntry = startedLater && pipeIdx === entryIdx;
          const sub = running
            ? `${running.kind}… ${running.progress ?? 0}%`
            : stale
              ? "↺ stale — re-run to update"
              : versions > 0
                ? `${versions} version${versions === 1 ? "" : "s"}`
                : locked
                  ? "locked"
                  : skipped
                    ? "skipped · optional backfill"
                    : seedable
                      ? "start or upload"
                      : "—";
          return (
            <button
              key={step.key}
              onClick={() => !locked && setSelectedStep(step.key)}
              disabled={locked}
              className={`relative flex items-center gap-2.5 rounded-[11px] border px-3 py-2 text-left transition ${
                current
                  ? "border-azure-600/40 bg-azure-900"
                  : locked
                    ? "border-transparent opacity-50"
                    : skipped
                      ? "border-transparent opacity-45 hover:opacity-80 hover:bg-neutral-900"
                      : "border-transparent hover:bg-neutral-900"
              } disabled:cursor-not-allowed`}
            >
              <span
                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  done
                    ? "bg-neutral-800 text-ok-500"
                    : current
                      ? "bg-azure-600 text-white"
                      : isEntry
                        ? "bg-azure-900 text-azure-300 ring-1 ring-azure-600/50"
                        : "border border-dashed border-neutral-600 text-neutral-500"
                }`}
              >
                {done ? "✓" : isEntry ? "★" : i + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] text-neutral-200">{step.label}</span>
                  {isEntry && (
                    <span className="shrink-0 rounded-full bg-azure-900 px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-azure-300 ring-1 ring-azure-600/40">
                      started here
                    </span>
                  )}
                </span>
                <span
                  className={`block truncate font-mono text-[10px] ${
                    running ? "text-azure-400" : stale ? "text-azure-300" : "text-neutral-500"
                  }`}
                >
                  {sub}
                </span>
              </span>
              {current && running && (
                <span className="absolute inset-x-3 bottom-0.5 h-[3px] overflow-hidden rounded bg-neutral-800">
                  <span
                    className="block h-full bg-azure-600 transition-all"
                    style={{ width: `${running.progress ?? 5}%` }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* the current step's actions + prompting live here, not on the stage */}
      <div className="max-h-[45%] shrink-0 overflow-y-auto">
        <StageActions />
      </div>

      <div className="border-t border-[var(--pf-hair)] p-3 font-mono text-[9.5px] leading-relaxed text-neutral-500">
        every step keeps its versions — re-roll freely, the active one flows downstream
      </div>
    </aside>
  );
}
