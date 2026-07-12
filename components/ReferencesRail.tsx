"use client";

import { useAppStore, useViewportStore, type ReferencesTab } from "@/lib/store";
import PosesPanel from "./PosesPanel";
import ExpressionsPanel from "./ExpressionsPanel";
import AssetsPanel from "./AssetsPanel";
import BonePanel from "./BonePanel";

// RIGHT · References: Poses / Faces / Assets, contextually gated — pure
// reference material. Stage actions and prompting live in the LEFT rail.

export default function ReferencesRail() {
  const tab = useAppStore((s) => s.referencesTab);
  const setTab = useAppStore((s) => s.setReferencesTab);
  const setRightOpen = useAppStore((s) => s.setRightOpen);
  const selectedStep = useAppStore((s) => s.selectedStep);
  const rig = useViewportStore((s) => s.rig);

  // Poses/Faces work pre-rig too (2D img2img apply), so tabs stay unlocked.
  const TABS: { key: ReferencesTab; label: string; locked: boolean; hint?: string }[] = [
    { key: "poses", label: "Poses", locked: false },
    { key: "faces", label: "Faces", locked: false },
    { key: "inputs", label: "Assets", locked: false },
  ];
  const effectiveTab = TABS.find((t) => t.key === tab && !t.locked) ? tab : "inputs";

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-l border-[var(--pf-hair)] bg-[var(--pf-panel)]">
      <div className="flex items-center gap-1 border-b border-[var(--pf-hair)] p-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => !t.locked && setTab(t.key)}
            disabled={t.locked}
            title={t.locked ? t.hint : undefined}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs transition ${
              effectiveTab === t.key
                ? "bg-neutral-800 text-neutral-200"
                : t.locked
                  ? "cursor-not-allowed text-neutral-600"
                  : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
            {t.locked ? " ·🔒" : ""}
          </button>
        ))}
        <button
          onClick={() => setRightOpen(false)}
          title="Collapse references"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 hover:bg-neutral-800"
        >
          »
        </button>
      </div>

      {/* Refine sits above the reference tabs on the Pose step — compact
          until a joint is picked (on the model or via its dropdown). */}
      {selectedStep === "pose" && rig && (
        <div className="shrink-0 border-b border-[var(--pf-hair)]">
          <BonePanel />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {effectiveTab === "poses" && <PosesPanel />}
        {effectiveTab === "faces" && <ExpressionsPanel />}
        {effectiveTab === "inputs" && <AssetsPanel />}
      </div>
    </aside>
  );
}
