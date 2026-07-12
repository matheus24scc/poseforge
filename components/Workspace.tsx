"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import {
  createCharacter,
  createProject,
  recoverMissingAssets,
  resumePendingJobs,
} from "@/lib/pipeline";
import { askPrompt } from "@/lib/dialog";
import { useAppStore, type Theme } from "@/lib/store";
import AppDialog from "./AppDialog";
import Launcher from "./Launcher";
import ProcessRail from "./ProcessRail";
import StagePane from "./StagePane";
import ReferencesRail from "./ReferencesRail";
import CompositionView from "./CompositionView";
import JobsPill from "./JobsPill";
import SettingsModal, { DISCLAIMER } from "./SettingsModal";

// Workspace shell (design §04): top bar + Process · Stage · References.

export default function Workspace() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  const projectId = useAppStore((s) => s.projectId);
  const characterId = useAppStore((s) => s.characterId);
  const setProject = useAppStore((s) => s.setProject);
  const setCharacter = useAppStore((s) => s.setCharacter);
  const setSelectedStep = useAppStore((s) => s.setSelectedStep);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const setRightOpen = useAppStore((s) => s.setRightOpen);
  const composeOpen = useAppStore((s) => s.composeOpen);
  const setComposeOpen = useAppStore((s) => s.setComposeOpen);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const projects = useLiveQuery(() => db.projects.orderBy("createdAt").toArray(), []);
  const project = useLiveQuery(
    () => (projectId ? db.projects.get(projectId) : undefined),
    [projectId],
  );
  const character = useLiveQuery(
    () => (characterId ? db.characters.get(characterId) : undefined),
    [characterId],
  );

  // Boot: land on the launcher (projects home). Background work — resuming
  // interrupted provider jobs and self-healing missing mesh blobs — starts
  // immediately regardless of which project gets opened.
  useEffect(() => {
    void resumePendingJobs();
    void recoverMissingAssets();
  }, []);

  useEffect(() => {
    if (projectId) void db.settings.put({ key: "lastProjectId", value: projectId });
  }, [projectId]);
  useEffect(() => {
    if (characterId) void db.settings.put({ key: "lastCharacterId", value: characterId });
  }, [characterId]);

  // Theme: restore the persisted choice on boot, then reflect it as html.light
  // (the CSS variable swap in globals.css does the rest). Dark is the default.
  useEffect(() => {
    void db.settings.get("theme").then((row) => {
      if (row?.value === "light" || row?.value === "dark") setTheme(row.value as Theme);
    });
  }, [setTheme]);
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
  }, [theme]);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    void db.settings.put({ key: "theme", value: next });
  };

  const selectProject = async (id: string) => {
    setProject(id);
    let chars = await db.characters.where("projectId").equals(id).sortBy("createdAt");
    if (chars.length === 0) chars = [await createCharacter(id, "Character 1")];
    setCharacter(chars[0].id);
  };

  const addProject = async () => {
    const name = await askPrompt("Project name:", `Project ${(projects?.length ?? 0) + 1}`);
    if (!name?.trim()) return;
    const p = await createProject(name.trim());
    const ch = await createCharacter(p.id, "Character 1");
    setProject(p.id);
    setCharacter(ch.id);
    setSelectedStep("source");
  };

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-[var(--pf-hair)] bg-[var(--pf-panel)] px-4">
        <button
          onClick={() => {
            setProject(null);
            setCharacter(null);
          }}
          title="Projects home"
          className="flex items-center gap-2"
        >
          <span className="h-2 w-2 rounded-full bg-azure-600 shadow-[0_0_10px_rgba(79,141,255,0.8)]" />
          <span className="font-display text-[13px] font-semibold tracking-[0.1em] text-neutral-200">
            POSEFORGE
          </span>
        </button>

        {/* project tabs + breadcrumb */}
        <div className="flex min-w-0 items-center gap-1">
          {(projects ?? []).map((p) => (
            <button
              key={p.id}
              onClick={() => void selectProject(p.id)}
              className={`max-w-36 truncate rounded-lg px-2.5 py-1 text-xs ${
                p.id === projectId
                  ? "bg-neutral-800 text-neutral-200"
                  : "text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
              }`}
            >
              {p.name}
            </button>
          ))}
          <button
            onClick={() => void addProject()}
            className="rounded-lg px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-900 hover:text-neutral-300"
            title="New project"
          >
            +
          </button>
        </div>
        <span className="hidden truncate text-xs text-neutral-500 md:block">
          {project?.name}
          {character ? ` / ${character.name}` : ""}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {projectId && (
            <button
              onClick={() => setComposeOpen(!composeOpen)}
              className={`rounded-lg px-3 py-1 text-xs ${
                composeOpen ? "bg-azure-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
              }`}
              title="Arrange multiple characters in one scene"
            >
              Compose
            </button>
          )}
          <JobsPill />
          <button
            onClick={toggleTheme}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-400 hover:bg-neutral-700"
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button
            onClick={() => setDisclaimerOpen((v) => !v)}
            title="Cost disclaimer"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-xs text-neutral-400 hover:bg-neutral-700"
          >
            i
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="rounded-lg bg-neutral-800 px-3 py-1 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            API keys
          </button>
        </div>
      </header>

      {disclaimerOpen && (
        <div className="absolute right-4 top-14 z-40 w-80 rounded-[14px] border border-[var(--pf-edge)] bg-neutral-900 p-3 text-[11px] leading-relaxed text-neutral-300 shadow-2xl">
          {DISCLAIMER}
        </div>
      )}

      {projectId ? (
        composeOpen ? (
          <CompositionView />
        ) : (
          <main className="relative flex min-h-0 flex-1">
            <ProcessRail />
            <StagePane characterId={characterId} />
            {rightOpen ? (
              <ReferencesRail />
            ) : (
              <button
                onClick={() => setRightOpen(true)}
                title="Open references (Poses · Faces · Assets)"
                className="absolute right-3 top-3 z-20 rounded-full border border-[var(--pf-edge)] bg-[var(--pf-glass)] px-3 py-1.5 font-mono text-[10px] text-neutral-300 backdrop-blur-lg hover:text-white"
              >
                « references
              </button>
            )}
          </main>
        )
      ) : (
        <Launcher />
      )}

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <AppDialog />
    </div>
  );
}
