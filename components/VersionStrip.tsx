"use client";

import type { CharacterRow, StageKey } from "@/lib/db";
import { activeVersion, getStage } from "@/lib/stages";
import { setActiveVersion } from "@/lib/stages";
import AssetImage from "./AssetImage";

// Horizontal version filmstrip (design §06): every result the stage produced.
// Click a card to make it active — it flows downstream; nothing is deleted.
export default function VersionStrip({
  character,
  stage,
  compact,
}: {
  character: CharacterRow;
  stage: StageKey;
  compact?: boolean;
}) {
  const state = getStage(character, stage);
  if (state.versions.length === 0) return null;
  const active = activeVersion(character, stage);
  const size = compact ? "h-12 w-12" : "h-16 w-16";
  return (
    <div className="flex gap-1.5 overflow-x-auto">
      {state.versions.map((v, i) => {
        const thumbAsset = v.viewIds?.[0] ?? v.assetId;
        const isActive = v.id === active?.id;
        const isMesh = stage === "mesh" || stage === "rig";
        return (
          <button
            key={v.id}
            onClick={() => void setActiveVersion(character.id, stage, v.id)}
            title={`v${i + 1} · ${v.label ?? ""}${isActive ? " · active" : " — click to activate"}`}
            className={`${size} shrink-0 overflow-hidden rounded-lg border ${
              isActive
                ? "border-azure-600 ring-1 ring-azure-600"
                : "border-[var(--pf-edge)] opacity-60 hover:opacity-100"
            }`}
          >
            {isMesh ? (
              <div className="flex h-full w-full items-center justify-center bg-neutral-950 font-mono text-[9px] text-neutral-400">
                v{i + 1}
              </div>
            ) : thumbAsset ? (
              <AssetImage
                assetId={thumbAsset}
                alt={`v${i + 1}`}
                className="h-full w-full bg-neutral-950 object-cover"
              />
            ) : (
              <div className="h-full w-full bg-neutral-950" />
            )}
          </button>
        );
      })}
    </div>
  );
}
