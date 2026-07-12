import { create } from "zustand";
import type * as THREE from "three";
import type { CanonKey } from "./pose";

// Ephemeral UI state (live three.js refs, selections). Durable state lives in
// Dexie; selections are mirrored to settings so sessions reopen where you left.

export interface Rig {
  bones: THREE.Bone[];
  initial: Map<string, THREE.Euler>; // bind-pose local rotations, keyed by bone uuid
  byKey: Map<CanonKey, THREE.Bone>; // canonical joint → bone
}

export interface StagePreview {
  assetId: string;
  label: string;
  kind?: "image" | "video";
  /** for video previews: clamp playback to this window (seconds) */
  trimStart?: number;
  trimEnd?: number;
}

interface ViewportStore {
  rig: Rig | null;
  setRig: (rig: Rig | null) => void;
  capture: (() => string) | null;
  setCapture: (fn: (() => string) | null) => void;
  resetView: (() => void) | null;
  setResetView: (fn: (() => void) | null) => void;
  showSkeleton: boolean;
  setShowSkeleton: (show: boolean) => void;
  poseVersion: number;
  bumpPoseVersion: () => void;
  preview: StagePreview | null;
  setPreview: (preview: StagePreview | null) => void;
  /** last captured pose render (PNG data URI). Lives here so the thumb survives
   * step nav and rail collapse; StageActions clears it when the character changes. */
  lastRender: string | null;
  setLastRender: (uri: string | null) => void;
  /** pose to apply once the rig mounts (selection can happen on any step) */
  pendingPose: Record<string, [number, number, number]> | null;
  setPendingPose: (rotations: Record<string, [number, number, number]> | null) => void;
  /** joint selected for direct manipulation (shared by gizmo + refine panel) */
  selectedBoneUuid: string | null;
  setSelectedBoneUuid: (uuid: string | null) => void;
  /** timeline playhead in seconds (shared: transport scrubs it, clip-apply inserts at it) */
  playhead: number;
  setPlayhead: (t: number) => void;
  /** gizmo rotation snapping to 15° */
  snap: boolean;
  setSnap: (snap: boolean) => void;
}

export const useViewportStore = create<ViewportStore>((set) => ({
  rig: null,
  setRig: (rig) => set({ rig }),
  capture: null,
  setCapture: (capture) => set({ capture }),
  resetView: null,
  setResetView: (resetView) => set({ resetView }),
  showSkeleton: false,
  setShowSkeleton: (showSkeleton) => set({ showSkeleton }),
  poseVersion: 0,
  bumpPoseVersion: () => set((s) => ({ poseVersion: s.poseVersion + 1 })),
  preview: null,
  setPreview: (preview) => set({ preview }),
  lastRender: null,
  setLastRender: (lastRender) => set({ lastRender }),
  pendingPose: null,
  setPendingPose: (pendingPose) => set({ pendingPose }),
  selectedBoneUuid: null,
  setSelectedBoneUuid: (selectedBoneUuid) => set({ selectedBoneUuid }),
  playhead: 0,
  setPlayhead: (playhead) => set({ playhead }),
  snap: true,
  setSnap: (snap) => set({ snap }),
}));

/** Pipeline steps as shown in the Process rail (mesh+rig share one step). */
export type ProcessStep = "source" | "extract" | "sheet" | "meshrig" | "pose" | "generate";

export type ReferencesTab = "poses" | "faces" | "inputs";

export type Theme = "dark" | "light";

interface AppStore {
  projectId: string | null;
  characterId: string | null;
  setProject: (projectId: string | null) => void;
  setCharacter: (characterId: string | null) => void;
  /** UI theme; dark is default. Persisted in db.settings, applied as html.light. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  selectedStep: ProcessStep;
  setSelectedStep: (step: ProcessStep) => void;
  referencesTab: ReferencesTab;
  setReferencesTab: (tab: ReferencesTab) => void;
  /** floating bone-refine panel over the stage */
  bonesOpen: boolean;
  setBonesOpen: (open: boolean) => void;
  /** pane collapse state */
  leftOpen: boolean;
  setLeftOpen: (open: boolean) => void;
  rightOpen: boolean;
  setRightOpen: (open: boolean) => void;
  dockOpen: boolean;
  setDockOpen: (open: boolean) => void;
  timelineOpen: boolean;
  setTimelineOpen: (open: boolean) => void;
  /** composition mode: arrange multiple characters on a plane */
  composeOpen: boolean;
  setComposeOpen: (open: boolean) => void;
  /** Selected expression: builtin id or user ExpressionRow id; null = none. */
  expressionId: string | null;
  setExpressionId: (id: string | null) => void;
  /** Selected pose (for 2D re-posing and rig application). */
  poseSel: { id: string; name: string; rotations: Record<string, [number, number, number]> } | null;
  setPoseSel: (pose: { id: string; name: string; rotations: Record<string, [number, number, number]> } | null) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  projectId: null,
  characterId: null,
  setProject: (projectId) => set({ projectId }),
  setCharacter: (characterId) => set({ characterId }),
  theme: "dark",
  setTheme: (theme) => set({ theme }),
  selectedStep: "source",
  setSelectedStep: (selectedStep) => set({ selectedStep }),
  referencesTab: "inputs",
  setReferencesTab: (referencesTab) => set({ referencesTab }),
  bonesOpen: false,
  setBonesOpen: (bonesOpen) => set({ bonesOpen }),
  leftOpen: true,
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  rightOpen: true,
  setRightOpen: (rightOpen) => set({ rightOpen }),
  dockOpen: true,
  setDockOpen: (dockOpen) => set({ dockOpen }),
  timelineOpen: true,
  setTimelineOpen: (timelineOpen) => set({ timelineOpen }),
  composeOpen: false,
  setComposeOpen: (composeOpen) => set({ composeOpen }),
  expressionId: null,
  setExpressionId: (expressionId) => set({ expressionId }),
  poseSel: null,
  setPoseSel: (poseSel) => set({ poseSel }),
}));
