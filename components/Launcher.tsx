"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type CharacterRow, type StageKey } from "@/lib/db";
import { createCharacter, createProject } from "@/lib/pipeline";
import { activeVersion, getStage } from "@/lib/stages";
import { exportProject, importBundle } from "@/lib/bundle";
import { askConfirm, askPrompt } from "@/lib/dialog";
import { useAppStore } from "@/lib/store";
import AssetImage from "./AssetImage";

// Project launcher (wireframe 2a): the front door. Your projects as cards —
// open one, forge a new one, or import a .poseforge bundle.

function projectMeta(characters: CharacterRow[], genCountByChar: Map<string, number>) {
  let editedAt = 0;
  let thumbAssetId: string | null = null;
  for (const ch of characters) {
    for (const key of ["source", "extract", "sheet", "mesh", "rig"] as StageKey[]) {
      for (const v of getStage(ch, key).versions) editedAt = Math.max(editedAt, v.createdAt);
    }
    if (!thumbAssetId) {
      const sheet = activeVersion(ch, "sheet");
      const src = activeVersion(ch, "extract") ?? activeVersion(ch, "source");
      thumbAssetId = sheet?.viewIds?.[0] ?? src?.assetId ?? null;
    }
    editedAt = Math.max(editedAt, ch.createdAt);
  }
  const genCount = characters.reduce((n, c) => n + (genCountByChar.get(c.id) ?? 0), 0);
  return { editedAt, thumbAssetId, genCount };
}

if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __pfBundle?: unknown }).__pfBundle = { exportProject, importBundle };
}

export default function Launcher() {
  const setProject = useAppStore((s) => s.setProject);
  const setCharacter = useAppStore((s) => s.setCharacter);
  const setSelectedStep = useAppStore((s) => s.setSelectedStep);

  const projects = useLiveQuery(() => db.projects.orderBy("createdAt").toArray(), []);
  const characters = useLiveQuery(() => db.characters.toArray(), []);
  const generations = useLiveQuery(() => db.generations.toArray(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const genCountByChar = new Map<string, number>();
  for (const g of generations ?? []) {
    genCountByChar.set(g.characterId, (genCountByChar.get(g.characterId) ?? 0) + 1);
  }

  const open = async (projectId: string) => {
    let chars = (characters ?? [])
      .filter((c) => c.projectId === projectId)
      .sort((a, b) => a.createdAt - b.createdAt);
    if (chars.length === 0) chars = [await createCharacter(projectId, "Character 1")];
    const last = await db.settings.get("lastCharacterId");
    const ch = chars.find((c) => c.id === last?.value) ?? chars[0];
    setProject(projectId);
    setCharacter(ch.id);
    if (activeVersion(ch, "rig")?.assetId) setSelectedStep("pose");
    else if (activeVersion(ch, "sheet")) setSelectedStep("meshrig");
    else if (activeVersion(ch, "source")) setSelectedStep("extract");
    else setSelectedStep("source");
  };

  const forgeNew = async () => {
    const name = await askPrompt("Project name:", `Project ${(projects?.length ?? 0) + 1}`);
    if (!name?.trim()) return;
    const p = await createProject(name.trim());
    await createCharacter(p.id, "Character 1");
    await open(p.id);
  };

  const doExport = async (projectId: string) => {
    setBusy(projectId);
    setError(null);
    try {
      const { blob, name } = await exportProject(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (projectId: string, name: string) => {
    if (!(await askConfirm(`Delete "${name}" and its characters? Assets stay in the library.`))) return;
    const chars = (characters ?? []).filter((c) => c.projectId === projectId);
    for (const ch of chars) {
      await db.generations.where("characterId").equals(ch.id).delete();
      await db.timelines.delete(ch.id);
      await db.characters.delete(ch.id);
    }
    await db.projects.delete(projectId);
  };

  const fmt = (ts: number) =>
    ts
      ? new Date(ts).toLocaleDateString(undefined, { month: "2-digit", day: "2-digit", year: "2-digit" })
      : "—";

  return (
    <div className="flex min-h-0 flex-1 justify-center overflow-y-auto">
      <div className="w-full max-w-4xl px-8 py-12">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
          Your projects
        </div>
        <h1 className="mb-8 font-display text-2xl font-semibold tracking-tight text-neutral-200">
          Pick up where you left off — or forge a new one.
        </h1>

        {error && (
          <div className="mb-4 rounded-lg border border-red-900 bg-red-950/60 p-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {(projects ?? []).map((p) => {
            const chars = (characters ?? []).filter((c) => c.projectId === p.id);
            const meta = projectMeta(chars, genCountByChar);
            return (
              <div
                key={p.id}
                className="group flex flex-col overflow-hidden rounded-[14px] border border-[var(--pf-hair)] bg-neutral-900/60 transition hover:border-azure-600/50"
              >
                <button onClick={() => void open(p.id)} className="text-left">
                  <div className="flex h-32 items-center justify-center bg-neutral-950">
                    {meta.thumbAssetId ? (
                      <AssetImage
                        assetId={meta.thumbAssetId}
                        alt={p.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="font-mono text-[10px] text-neutral-600">empty</span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="truncate text-sm text-neutral-200">{p.name}</div>
                    <div className="mt-0.5 font-mono text-[9.5px] text-neutral-500">
                      {chars.length} character{chars.length === 1 ? "" : "s"} ·{" "}
                      {meta.genCount} gen{meta.genCount === 1 ? "" : "s"} · edited {fmt(meta.editedAt)}
                    </div>
                  </div>
                </button>
                <div className="flex gap-1 border-t border-[var(--pf-hair)] p-1.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    onClick={async () => {
                      const name = await askPrompt("Rename project:", p.name);
                      if (name?.trim()) void db.projects.update(p.id, { name: name.trim() });
                    }}
                    className="rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => void doExport(p.id)}
                    disabled={busy === p.id}
                    className="rounded px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-800"
                    title="Download as a shareable .poseforge bundle"
                  >
                    {busy === p.id ? "Exporting…" : "Export"}
                  </button>
                  <button
                    onClick={() => void doDelete(p.id, p.name)}
                    className="ml-auto rounded px-2 py-0.5 text-[10px] text-neutral-500 hover:bg-red-900 hover:text-red-200"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}

          {/* new project */}
          <button
            onClick={() => void forgeNew()}
            className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--pf-edge)] text-neutral-500 transition hover:border-azure-600/60 hover:text-azure-400"
          >
            <span className="text-2xl">+</span>
            <span className="text-xs">New project</span>
          </button>

          {/* import bundle */}
          <button
            onClick={() => importInput.current?.click()}
            className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-[var(--pf-edge)] text-neutral-500 transition hover:border-azure-600/60 hover:text-azure-400"
          >
            <span className="text-2xl">📦</span>
            <span className="text-xs">Import a .poseforge bundle…</span>
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".poseforge,.zip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setBusy("import");
              setError(null);
              try {
                const project = await importBundle(f);
                await open(project.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(null);
              }
            }}
          />
        </div>

        <div className="mt-8 font-mono text-[9.5px] leading-relaxed text-neutral-600">
          a .poseforge bundle is the whole project — characters, versions, generations, timeline
          and every referenced asset — in one shareable file
        </div>
      </div>
    </div>
  );
}
