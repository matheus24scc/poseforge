"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type AssetKind, type AssetRow, type CharacterRow, type StageKey } from "@/lib/db";
import { downloadAsset, putBlob } from "@/lib/assets";
import { createCharacter, createProject } from "@/lib/pipeline";
import { activeVersion, getStage, seedStage } from "@/lib/stages";
import { madeFrom, usagesOf } from "@/lib/lineage";
import { askPrompt } from "@/lib/dialog";
import { useAppStore, useViewportStore } from "@/lib/store";
import AssetImage from "./AssetImage";

// Asset library, grouped by character: the list shows each character's latest
// stage (thumb · stage · edited date); clicking in shows every asset that
// character touched. Filters narrow what you see; grouping stays character-
// first. Loose uploads live under "Unlinked".

const IMAGE_STAGES: { key: StageKey; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "extract", label: "Extracted" },
  { key: "sheet", label: "Sheet (front view)" },
];
const MESH_STAGES: { key: StageKey; label: string }[] = [
  { key: "mesh", label: "3D mesh" },
  { key: "rig", label: "Rigged mesh" },
];

interface CharSummary {
  ch: CharacterRow;
  projectName: string;
  stageNum: number;
  stageLabel: string;
  thumbAssetId: string | null;
  isMeshThumb: boolean;
  editedAt: number;
  assetIds: Set<string>;
}

function summarize(
  ch: CharacterRow,
  projectName: string,
  gens: { outputAssetId: string; refAssetIds: string[]; createdAt: number }[],
  timeline: { keyframes: { stillAssetId?: string }[]; segments: Record<string, { videoAssetId?: string }> } | undefined,
): CharSummary {
  const assetIds = new Set<string>();
  let editedAt = ch.createdAt;
  for (const key of ["source", "extract", "sheet", "mesh", "rig"] as StageKey[]) {
    for (const v of getStage(ch, key).versions) {
      if (v.assetId) assetIds.add(v.assetId);
      for (const id of v.viewIds ?? []) assetIds.add(id);
      editedAt = Math.max(editedAt, v.createdAt);
    }
  }
  for (const g of gens) {
    assetIds.add(g.outputAssetId);
    for (const id of g.refAssetIds) assetIds.add(id);
    editedAt = Math.max(editedAt, g.createdAt);
  }
  for (const kf of timeline?.keyframes ?? []) if (kf.stillAssetId) assetIds.add(kf.stillAssetId);
  for (const seg of Object.values(timeline?.segments ?? {})) if (seg.videoAssetId) assetIds.add(seg.videoAssetId);

  let stageNum = 0;
  let stageLabel = "empty";
  let thumbAssetId: string | null = null;
  let isMeshThumb = false;
  const rig = activeVersion(ch, "rig");
  const mesh = activeVersion(ch, "mesh");
  const sheet = activeVersion(ch, "sheet");
  const extract = activeVersion(ch, "extract");
  const source = activeVersion(ch, "source");
  if (gens.length > 0) {
    stageNum = 6;
    stageLabel = "Generate";
    thumbAssetId = gens[gens.length - 1].outputAssetId;
  } else if (rig?.assetId || mesh?.assetId) {
    stageNum = 4;
    stageLabel = rig?.assetId ? "Rigged" : "3D mesh";
    thumbAssetId = sheet?.viewIds?.[0] ?? extract?.assetId ?? source?.assetId ?? null;
    isMeshThumb = !thumbAssetId;
  } else if (sheet) {
    stageNum = 3;
    stageLabel = "Character sheet";
    thumbAssetId = sheet.viewIds?.[0] ?? null;
  } else if (extract) {
    stageNum = 2;
    stageLabel = "Extract";
    thumbAssetId = extract.assetId ?? null;
  } else if (source) {
    stageNum = 1;
    stageLabel = "Source";
    thumbAssetId = source.assetId ?? null;
  }
  return { ch, projectName, stageNum, stageLabel, thumbAssetId, isMeshThumb, editedAt, assetIds };
}

export default function AssetsPanel() {
  const assets = useLiveQuery(() => db.assets.orderBy("createdAt").reverse().toArray(), []);
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const generations = useLiveQuery(() => db.generations.toArray(), []);
  const timelines = useLiveQuery(() => db.timelines.toArray(), []);

  const characterId = useAppStore((s) => s.characterId);
  const setProject = useAppStore((s) => s.setProject);
  const setCharacter = useAppStore((s) => s.setCharacter);
  const setComposeOpen = useAppStore((s) => s.setComposeOpen);
  const setPreview = useViewportStore((s) => s.setPreview);

  const [drill, setDrill] = useState<string | null>(null); // character id | "__unlinked"
  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stage, setStage] = useState<StageKey>("source");
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? "?";
  const summaries = (characters ?? [])
    .map((ch) =>
      summarize(
        ch,
        projectName(ch.projectId),
        (generations ?? []).filter((g) => g.characterId === ch.id),
        (timelines ?? []).find((t) => t.characterId === ch.id),
      ),
    )
    .sort((a, b) => b.editedAt - a.editedAt);

  const linked = new Set<string>();
  for (const s of summaries) for (const id of s.assetIds) linked.add(id);
  const unlinked = (assets ?? []).filter((a) => !linked.has(a.id));

  const fmtDate = (ts: number) =>
    new Date(ts).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" });

  const selected = (assets ?? []).find((a) => a.id === selectedId) ?? null;
  const usages = selected
    ? usagesOf(selected.id, characters ?? [], generations ?? [], timelines ?? [], projects ?? [])
    : [];
  const provenance = selected ? madeFrom(selected.id, generations ?? []) : null;

  // Jump the whole app to a character where this asset is used.
  const jumpTo = (charId: string) => {
    const ch = (characters ?? []).find((c) => c.id === charId);
    if (!ch) return;
    setComposeOpen(false);
    setProject(ch.projectId);
    setCharacter(charId);
    setDrill(charId);
    setSelectedId(null);
  };

  const stageOptions =
    selected?.kind === "mesh" ? MESH_STAGES : selected?.kind === "image" ? IMAGE_STAGES : [];
  const effectiveStage = stageOptions.some((s) => s.key === stage)
    ? stage
    : (stageOptions[0]?.key ?? "source");

  const seedPayload = (asset: AssetRow, st: StageKey) =>
    st === "sheet" ? { viewIds: [asset.id] } : { assetId: asset.id };

  const insertIntoCharacter = async () => {
    if (!selected || !characterId) return;
    await seedStage(characterId, effectiveStage, { ...seedPayload(selected, effectiveStage), label: "from library" });
    setNote(`Inserted as ${effectiveStage} on the current character.`);
  };

  const newProjectFromAsset = async () => {
    if (!selected) return;
    const name = await askPrompt("New project name:", selected.label?.replace(/\.\w+$/, "") || "New project");
    if (!name?.trim()) return;
    const project = await createProject(name.trim());
    const ch = await createCharacter(project.id, "Character 1");
    await seedStage(ch.id, effectiveStage, { ...seedPayload(selected, effectiveStage), label: "from library" });
    setProject(project.id);
    setCharacter(ch.id);
    setNote(`Started "${name.trim()}" from this asset at ${effectiveStage}.`);
  };

  // ---------- drill-in view: one character's assets ----------
  if (drill) {
    const summary = summaries.find((s) => s.ch.id === drill);
    const pool =
      drill === "__unlinked"
        ? unlinked
        : (assets ?? []).filter((a) => summary?.assetIds.has(a.id));
    const shown = pool.filter((a) => filter === "all" || a.kind === filter);
    return (
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setDrill(null);
              setSelectedId(null);
            }}
            className="rounded-lg bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
          >
            ← All characters
          </button>
          <span className="truncate text-xs text-neutral-200">
            {drill === "__unlinked" ? "Unlinked assets" : summary?.ch.name}
          </span>
        </div>
        <div className="flex gap-1">
          {(["all", "image", "mesh", "video"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k as AssetKind | "all")}
              className={`rounded px-2 py-0.5 text-[11px] ${
                filter === k ? "bg-azure-600 text-white" : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        {selected && (
          <div className="flex flex-col gap-2 rounded-[11px] border border-azure-700/50 bg-neutral-900/80 p-2">
            <div className="truncate text-[11px] text-neutral-300" title={selected.label}>
              {selected.label ?? selected.id.slice(0, 12)}{" "}
              <span className="text-neutral-600">· {selected.kind}</span>
            </div>
            {stageOptions.length > 0 && (
              <>
                <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                  as
                  <select
                    value={effectiveStage}
                    onChange={(e) => setStage(e.target.value as StageKey)}
                    className="flex-1 rounded bg-neutral-800 px-1.5 py-1 text-[11px]"
                  >
                    {stageOptions.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => void insertIntoCharacter()}
                    disabled={!characterId}
                    className="rounded bg-azure-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-azure-500 disabled:bg-neutral-700 disabled:text-neutral-400"
                  >
                    → current character
                  </button>
                  <button
                    onClick={() => void newProjectFromAsset()}
                    className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                  >
                    → new project…
                  </button>
                </div>
              </>
            )}
            <div className="flex gap-1.5">
              {selected.kind !== "mesh" && (
                <button
                  onClick={() =>
                    setPreview({
                      assetId: selected.id,
                      label: selected.label ?? "Asset",
                      kind: selected.kind === "video" ? "video" : "image",
                    })
                  }
                  className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
                >
                  {selected.kind === "video" ? "▶ Play" : "View"}
                </button>
              )}
              <button
                onClick={() =>
                  void downloadAsset(
                    selected.id,
                    selected.label ??
                      `asset.${selected.kind === "mesh" ? "glb" : selected.kind === "video" ? "mp4" : "png"}`,
                  )
                }
                className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
              >
                Download
              </button>
              <button
                onClick={() => {
                  void db.assets.delete(selected.id);
                  void db.blobs.delete(selected.id);
                  setSelectedId(null);
                }}
                className="ml-auto rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-500 hover:bg-red-900 hover:text-red-200"
              >
                Delete
              </button>
            </div>
            {note && <div className="text-[10px] text-ok-500">{note}</div>}

            {/* lineage */}
            <div className="mt-1 border-t border-[var(--pf-hair)] pt-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-500">
                  Used in
                </span>
                <span className="rounded-full bg-neutral-800 px-1.5 text-[9px] text-neutral-400">
                  {usages.length}
                </span>
              </div>
              {usages.length === 0 ? (
                <div className="text-[10px] text-neutral-600">Not referenced anywhere yet.</div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {usages.map((u, i) => (
                    <button
                      key={i}
                      onClick={() => jumpTo(u.characterId)}
                      className="flex items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10px] hover:bg-neutral-800"
                      title={`Go to ${u.characterName} (${u.projectName})`}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-azure-500" />
                      <span className="min-w-0 flex-1 truncate text-neutral-300">
                        {u.characterName} · <span className="text-neutral-500">{u.projectName}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-neutral-500">{u.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {provenance && (
                <div className="mt-2">
                  <div className="mb-1 font-mono text-[9px] uppercase tracking-wider text-neutral-500">
                    Made from
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {provenance.refAssetIds.map((rid) => (
                      <button
                        key={rid}
                        onClick={() => {
                          setSelectedId(rid);
                          setNote(null);
                        }}
                        className="h-10 w-10 overflow-hidden rounded border border-[var(--pf-edge)] hover:border-azure-600"
                        title="Trace this input"
                      >
                        <AssetImage assetId={rid} alt="input" className="h-full w-full bg-neutral-950 object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {shown.length === 0 && <div className="text-[11px] text-neutral-600">Nothing here.</div>}
        <div className="grid grid-cols-3 gap-1.5">
          {shown.map((asset) => (
            <button
              key={asset.id}
              onClick={() => {
                setSelectedId(asset.id === selectedId ? null : asset.id);
                setNote(null);
              }}
              className={`overflow-hidden rounded-lg border ${
                asset.id === selectedId
                  ? "border-azure-600 ring-1 ring-azure-600"
                  : "border-[var(--pf-edge)] hover:border-neutral-600"
              }`}
              title={asset.label}
            >
              {asset.kind === "image" ? (
                <AssetImage assetId={asset.id} alt={asset.label ?? asset.id} className="h-20 w-full bg-neutral-950 object-cover" />
              ) : (
                <div className="flex h-20 w-full items-center justify-center bg-neutral-950 text-xl">
                  {asset.kind === "mesh" ? "🧊" : "🎞"}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ---------- top level: characters ----------
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-neutral-500">
          Assets · by character
        </span>
        <button
          onClick={() => fileInput.current?.click()}
          className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
        >
          + Upload
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,.glb"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              const kind: AssetKind = f.name.toLowerCase().endsWith(".glb") ? "mesh" : "image";
              const asset = await putBlob(f, kind, f.name);
              setDrill("__unlinked");
              setSelectedId(asset.id);
            }
            e.target.value = "";
          }}
        />
      </div>

      {summaries.map((s) => (
        <button
          key={s.ch.id}
          onClick={() => {
            setDrill(s.ch.id);
            setFilter("all");
          }}
          className="flex items-center gap-2.5 rounded-[11px] border border-[var(--pf-hair)] bg-neutral-900/60 p-2 text-left hover:border-neutral-600"
        >
          <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-950">
            {s.thumbAssetId ? (
              <AssetImage assetId={s.thumbAssetId} alt={s.ch.name} className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-lg">
                {s.isMeshThumb ? "🧊" : "·"}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-neutral-200">{s.ch.name}</span>
            <span className="block truncate font-mono text-[9.5px] text-neutral-500">
              {s.projectName} · stage {s.stageNum || "—"} {s.stageLabel} · edited {fmtDate(s.editedAt)}
            </span>
          </span>
          <span className="font-mono text-[10px] text-neutral-600">{s.assetIds.size}</span>
        </button>
      ))}

      {unlinked.length > 0 && (
        <button
          onClick={() => {
            setDrill("__unlinked");
            setFilter("all");
          }}
          className="flex items-center gap-2.5 rounded-[11px] border border-dashed border-[var(--pf-edge)] p-2 text-left hover:border-neutral-600"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-950 text-lg">📥</span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-neutral-300">Unlinked</span>
            <span className="block font-mono text-[9.5px] text-neutral-500">
              uploads not used by any character
            </span>
          </span>
          <span className="font-mono text-[10px] text-neutral-600">{unlinked.length}</span>
        </button>
      )}
    </div>
  );
}
