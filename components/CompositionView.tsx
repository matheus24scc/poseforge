"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, Splat, TransformControls, useGLTF } from "@react-three/drei";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import * as THREE from "three";
import { Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type CompositionRow, type PoseRotations } from "@/lib/db";
import { activeVersion } from "@/lib/stages";
import { getAssetUrl, putBlob } from "@/lib/assets";
import { runGenerateComposition } from "@/lib/pipeline";
import { saveComposition, deleteComposition } from "@/lib/compositions";
import { askPrompt } from "@/lib/dialog";
import { applyPose, buildRig, capturePose, normalizeToGround } from "@/lib/pose";
import { useAppStore, useViewportStore, type Rig } from "@/lib/store";
import { useCompositionStore, type CompositionItem, type EnvironmentKind } from "@/lib/compositionStore";
import { CaptureBridge, JointMarkers, BoneGizmo } from "./Viewport";
import AssetImage from "./AssetImage";
import AutoTextarea from "./AutoTextarea";

// Shared registries so the scene can hand the selected character's rig to the
// existing pose tools (which read viewportStore.rig) and attach the placement
// gizmo to the selected group.
type Registry = { rigs: Map<string, Rig>; groups: Map<string, THREE.Object3D> };

function ComposedCharacter({
  item,
  url,
  pose,
  selected,
  registry,
  onSelect,
}: {
  item: CompositionItem;
  url: string;
  pose: PoseRotations | null;
  selected: boolean;
  registry: Registry;
  onSelect: (id: string) => void;
}) {
  const { scene } = useGLTF(url);
  const groupRef = useRef<THREE.Group>(null);
  // read fresh at mount so live edits to the pose don't re-trigger applyPose
  const poseRef = useRef(pose);
  poseRef.current = pose;

  // Independent clone per placement so each character poses on its own skeleton.
  const model = useMemo(() => {
    const c = cloneSkeleton(scene);
    normalizeToGround(c);
    return c;
  }, [scene]);
  const rig = useMemo(() => buildRig(model), [model]);

  useEffect(() => {
    if (rig) registry.rigs.set(item.id, rig);
    return () => {
      registry.rigs.delete(item.id);
    };
  }, [item.id, rig, registry]);

  // Place each character at its persisted working pose (§7b), once per rig
  // mount so an in-scene pose edit doesn't fight the drag.
  useEffect(() => {
    if (rig && poseRef.current && Object.keys(poseRef.current).length) applyPose(rig, poseRef.current);
  }, [rig]);

  useEffect(() => {
    if (groupRef.current) registry.groups.set(item.id, groupRef.current);
    return () => {
      registry.groups.delete(item.id);
    };
  }, [item.id, registry]);

  // Push this rig to the shared viewport store while selected, so JointMarkers
  // and the BoneGizmo act on it.
  useEffect(() => {
    if (selected && rig) useViewportStore.getState().setRig(rig);
  }, [selected, rig]);

  return (
    <group
      ref={groupRef}
      position={[item.x, 0, item.z]}
      rotation={[0, item.rotY, 0]}
      scale={item.scale}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
    >
      <primitive object={model} />
      {selected && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.5, 40]} />
          <meshBasicMaterial color="#4f8dff" transparent opacity={0.8} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

type EnvRef = RefObject<THREE.Object3D | null>;
type CameraApi = ((pos: [number, number, number], target: [number, number, number]) => void) | null;

// Per-world framing presets (§7c v2). Targets the character area (~1.6 units
// tall at the origin); the user can still orbit/zoom from there.
const CAMERA_PRESETS: {
  name: string;
  pos: [number, number, number];
  target: [number, number, number];
}[] = [
  { name: "Front", pos: [0, 1.4, 4.6], target: [0, 0.9, 0] },
  { name: "3/4", pos: [3.4, 1.7, 3.4], target: [0, 0.9, 0] },
  { name: "Side", pos: [4.8, 1.2, 0.01], target: [0, 0.9, 0] },
  { name: "Top", pos: [0, 4.2, 2.2], target: [0, 0.7, 0] },
];

// Imported World Labs Marble world (GLB mesh) as a fixed backdrop — the
// characters stand in it. Not normalized (it's a world, not a 1.6-unit figure):
// the user fits it with scale/height/turn. Not selectable/posable. The group is
// registered on envRef so "Align ground" can measure its floor.
function EnvironmentModel({ url, envRef }: { url: string; envRef: EnvRef }) {
  const { scene } = useGLTF(url);
  const env = useCompositionStore((s) => s.env);
  const groupRef = useRef<THREE.Group>(null);
  const model = useMemo(() => cloneSkeleton(scene), [scene]);
  useMemo(() => {
    model.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).frustumCulled = false;
    });
  }, [model]);
  useEffect(() => {
    envRef.current = groupRef.current;
    return () => {
      envRef.current = null;
    };
  }, [envRef, model]);
  return (
    <group ref={groupRef} position={[0, env.y, 0]} rotation={[0, env.rotY, 0]} scale={env.scale}>
      <primitive object={model} />
    </group>
  );
}

// Gaussian-splat world (§7c v2): Marble also exports .splat. drei's <Splat>
// renders the compact .splat point cloud. Same transform group + envRef as the
// mesh path so the fit sliders and ground-align work identically.
function EnvironmentSplat({ url, envRef }: { url: string; envRef: EnvRef }) {
  const env = useCompositionStore((s) => s.env);
  const groupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    envRef.current = groupRef.current;
    return () => {
      envRef.current = null;
    };
  }, [envRef]);
  return (
    <group ref={groupRef} position={[0, env.y, 0]} rotation={[0, env.rotY, 0]} scale={env.scale}>
      <Splat src={url} />
    </group>
  );
}

// Exposes an imperative camera-framing API (preset buttons live in the rail,
// outside the Canvas) that repositions the camera + OrbitControls target.
function CameraBridge({ apiRef }: { apiRef: MutableRefObject<CameraApi> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as
    | { target?: THREE.Vector3; update?: () => void }
    | null;
  useEffect(() => {
    apiRef.current = (pos, target) => {
      camera.position.set(pos[0], pos[1], pos[2]);
      if (controls?.target) {
        controls.target.set(target[0], target[1], target[2]);
        controls.update?.();
      }
    };
    return () => {
      apiRef.current = null;
    };
  }, [camera, controls, apiRef]);
  return null;
}

function Scene({
  items,
  urls,
  poses,
  envUrl,
  registry,
  envRef,
  cameraApiRef,
}: {
  items: CompositionItem[];
  urls: Map<string, string>;
  poses: Map<string, PoseRotations | undefined>;
  envUrl: string | null;
  registry: Registry;
  envRef: EnvRef;
  cameraApiRef: MutableRefObject<CameraApi>;
}) {
  const selectedId = useCompositionStore((s) => s.selectedId);
  const mode = useCompositionStore((s) => s.mode);
  const environmentKind = useCompositionStore((s) => s.environmentKind);
  const select = useCompositionStore((s) => s.select);
  const updateItem = useCompositionStore((s) => s.updateItem);
  const [gizmoTick, setGizmoTick] = useState(0);

  // Keep the shared rig in sync with the selection (clears when nothing picked).
  useEffect(() => {
    const rig = (selectedId && registry.rigs.get(selectedId)) || null;
    useViewportStore.getState().setRig(rig);
  }, [selectedId, registry, gizmoTick]);

  const selectedGroup = selectedId ? registry.groups.get(selectedId) : null;

  return (
    <>
      <color attach="background" args={["#3f3f46"]} />
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 4]} intensity={2.2} />
      <directionalLight position={[-4, 3, -3]} intensity={0.8} />
      <gridHelper args={[12, 24, "#52525b", "#3f3f46"]} />
      {envUrl && (
        <Suspense fallback={null}>
          {environmentKind === "splat" ? (
            <EnvironmentSplat url={envUrl} envRef={envRef} />
          ) : (
            <EnvironmentModel url={envUrl} envRef={envRef} />
          )}
        </Suspense>
      )}
      <Suspense fallback={null}>
        {items.map((item) => {
          const url = urls.get(item.id);
          if (!url) return null;
          return (
            <ComposedCharacter
              key={item.id}
              item={item}
              url={url}
              pose={poses.get(item.characterId) ?? null}
              selected={item.id === selectedId}
              registry={registry}
              onSelect={(id) => {
                select(id);
                setGizmoTick((t) => t + 1);
              }}
            />
          );
        })}
      </Suspense>

      {mode === "pose" && <JointMarkers />}
      {mode === "pose" && <BoneGizmo />}
      {mode === "place" && selectedGroup && (
        <TransformControls
          object={selectedGroup}
          mode="translate"
          showY={false}
          size={0.7}
          onMouseUp={() => {
            if (!selectedId || !selectedGroup) return;
            updateItem(selectedId, { x: selectedGroup.position.x, z: selectedGroup.position.z });
          }}
        />
      )}

      <CaptureBridge />
      <OrbitControls target={[0, 0.85, 0]} makeDefault />
      <CameraBridge apiRef={cameraApiRef} />
    </>
  );
}

export default function CompositionView() {
  const projectId = useAppStore((s) => s.projectId);
  const setComposeOpen = useAppStore((s) => s.setComposeOpen);
  const items = useCompositionStore((s) => s.items);
  const selectedId = useCompositionStore((s) => s.selectedId);
  const mode = useCompositionStore((s) => s.mode);
  const environmentAssetId = useCompositionStore((s) => s.environmentAssetId);
  const environmentKind = useCompositionStore((s) => s.environmentKind);
  const env = useCompositionStore((s) => s.env);
  const loadedId = useCompositionStore((s) => s.loadedId);
  const poseVersion = useViewportStore((s) => s.poseVersion);
  const { addItem, removeItem, updateItem, select, setMode, setEnvironment, updateEnv, hydrate, clear, setLoadedId } =
    useCompositionStore();

  const characters = useLiveQuery(
    () => (projectId ? db.characters.where("projectId").equals(projectId).sortBy("createdAt") : []),
    [projectId],
  );
  const charById = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c])),
    [characters],
  );
  const rigged = (characters ?? []).filter((c) => activeVersion(c, "rig")?.assetId);
  // characterId → its persisted working pose, for placing each character posed
  const poseByChar = useMemo(
    () => new Map((characters ?? []).map((c) => [c.id, c.poseRotations])),
    [characters],
  );

  const compositions = useLiveQuery(
    () =>
      projectId
        ? db.compositions.where("projectId").equals(projectId).reverse().sortBy("updatedAt")
        : [],
    [projectId],
  );
  const loadedName = compositions?.find((c) => c.id === loadedId)?.name ?? null;

  // Posing in composition writes to the selected character's persisted pose,
  // so a saved scene reloads everyone as arranged. Read selection/rig fresh so
  // switching the selected character can't cross-save.
  useEffect(() => {
    const cs = useCompositionStore.getState();
    const sel = cs.items.find((i) => i.id === cs.selectedId);
    if (cs.mode !== "pose" || !sel) return;
    const rig = useViewportStore.getState().rig;
    if (!rig) return;
    void db.characters.update(sel.characterId, { poseRotations: capturePose(rig) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseVersion]);

  // Resolve each placement's rig GLB to an object URL.
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = new Map<string, string>();
      for (const item of items) {
        const ch = charById.get(item.characterId);
        const assetId = ch && activeVersion(ch, "rig")?.assetId;
        if (!assetId) continue;
        const url = await getAssetUrl(assetId);
        if (url) next.set(item.id, url);
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items, charById]);

  // Resolve the imported Marble world GLB to an object URL.
  const [envUrl, setEnvUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!environmentAssetId) {
      setEnvUrl(null);
      return;
    }
    void getAssetUrl(environmentAssetId).then((u) => !cancelled && setEnvUrl(u));
    return () => {
      cancelled = true;
    };
  }, [environmentAssetId]);

  const importEnvironment = async (file: File) => {
    setError(null);
    // Marble exports .glb (mesh) and .ply/.splat (Gaussian splat). drei's
    // <Splat> reads the compact .splat format; .ply is accepted but flagged.
    const ext = file.name.toLowerCase().split(".").pop();
    const kind: EnvironmentKind = ext === "splat" || ext === "ply" ? "splat" : "mesh";
    try {
      const asset = await putBlob(file, "mesh", `world (${kind}): ${file.name}`);
      setEnvironment(asset.id, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const registry = useMemo<Registry>(() => ({ rigs: new Map(), groups: new Map() }), []);
  const envRef = useRef<THREE.Object3D | null>(null);
  const cameraApiRef = useRef<CameraApi>(null);

  // Ground auto-align: measure the world's current world-space floor and shift
  // it to y=0 so it meets the characters' feet. Works on the GLB mesh; splats
  // only once loaded (bounds unavailable before then).
  const alignGround = () => {
    const obj = envRef.current;
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (!Number.isFinite(box.min.y)) {
      setError("Couldn't measure the world's floor yet — for splats, let it finish loading or set Height manually.");
      return;
    }
    updateEnv({ y: env.y - box.min.y });
  };

  const frameView = (preset: (typeof CAMERA_PRESETS)[number]) =>
    cameraApiRef.current?.(preset.pos, preset.target);

  // Clear the shared rig when leaving composition.
  useEffect(() => () => useViewportStore.getState().setRig(null), []);

  const [prompt, setPrompt] = useState("A cohesive scene of the characters together, same style and lighting.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultId, setResultId] = useState<string | null>(null);

  const anchorCharacterId = (selectedId && items.find((i) => i.id === selectedId)?.characterId) || items[0]?.characterId;

  const generate = async () => {
    const capture = useViewportStore.getState().capture;
    if (!capture || !anchorCharacterId) return;
    setBusy(true);
    setError(null);
    try {
      const render = capture();
      // anchor first, then every scene character (deduped in the pipeline) so
      // each subject's identity is referenced, not just the anchor's.
      const ordered = [anchorCharacterId, ...items.map((i) => i.characterId)];
      const out = await runGenerateComposition(ordered, prompt, render);
      setResultId(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveScene = async () => {
    if (!projectId) return;
    const cs = useCompositionStore.getState();
    let name = loadedName;
    if (!name) {
      const input = await askPrompt("Scene name:", `Scene ${(compositions?.length ?? 0) + 1}`);
      if (!input?.trim()) return;
      name = input.trim();
    }
    try {
      const row = await saveComposition({
        id: loadedId,
        projectId,
        name,
        items: cs.items,
        env: cs.env,
        environmentAssetId: cs.environmentAssetId,
        environmentKind: cs.environmentKind,
      });
      setLoadedId(row.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const loadScene = (row: CompositionRow) => {
    hydrate({
      items: row.items,
      env: row.env,
      environmentAssetId: row.environmentAssetId,
      // pre-§7c rows have no kind; a world back then was always a GLB mesh
      environmentKind: row.environmentKind ?? (row.environmentAssetId ? "mesh" : null),
      loadedId: row.id,
    });
    setResultId(null);
  };

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  return (
    <main className="relative flex min-h-0 flex-1">
      {/* left rail: cast + controls */}
      <div className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--pf-hair)] bg-[var(--pf-panel)] p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-neutral-300">Composition</span>
          <button
            onClick={() => setComposeOpen(false)}
            className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
          >
            ← Back
          </button>
        </div>

        {/* saved scenes (§7b v2) */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              Scene{loadedName ? `: ${loadedName}` : " · unsaved"}
            </span>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => void saveScene()}
                disabled={items.length === 0 && !environmentAssetId}
                className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="Save this arrangement (characters keep their poses)"
              >
                {loadedId ? "Save" : "Save…"}
              </button>
              <button
                onClick={() => clear()}
                className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-700"
                title="Start a new empty scene"
              >
                New
              </button>
            </div>
          </div>
          {(compositions ?? []).length > 0 && (
            <div className="flex flex-col gap-1">
              {(compositions ?? []).map((c) => (
                <div
                  key={c.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1 text-[11px] ${
                    c.id === loadedId ? "border-azure-500 bg-azure-950/30" : "border-neutral-800 bg-neutral-900/60"
                  }`}
                >
                  <button
                    className="min-w-0 flex-1 truncate text-left text-neutral-200"
                    onClick={() => loadScene(c)}
                  >
                    {c.name}
                  </button>
                  <span className="shrink-0 font-mono text-[9px] text-neutral-600">{c.items.length}</span>
                  <button
                    onClick={() => {
                      void deleteComposition(c.id);
                      if (c.id === loadedId) setLoadedId(null);
                    }}
                    className="shrink-0 text-neutral-500 hover:text-red-300"
                    title="Delete scene"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            Add a character
          </div>
          {rigged.length === 0 ? (
            <div className="rounded border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-500">
              No rigged characters in this project yet. Rig a character first, then add it here.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {rigged.map((c) => (
                <button
                  key={c.id}
                  onClick={() => addItem(c.id)}
                  className="rounded bg-neutral-800 px-2 py-1.5 text-left text-[12px] text-neutral-200 hover:bg-neutral-700"
                >
                  + {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* scene items */}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            In the scene ({items.length})
          </div>
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const ch = charById.get(item.characterId);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 rounded border px-2 py-1.5 text-[12px] ${
                    item.id === selectedId ? "border-azure-500 bg-azure-950/30" : "border-neutral-800 bg-neutral-900/60"
                  }`}
                >
                  <button className="min-w-0 flex-1 truncate text-left text-neutral-200" onClick={() => select(item.id)}>
                    {ch?.name ?? "character"}
                  </button>
                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-neutral-500 hover:text-red-300"
                    title="Remove from scene"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            {items.length === 0 && (
              <div className="text-[11px] text-neutral-600">Add characters above to build a scene.</div>
            )}
          </div>
        </div>

        {/* Marble world backdrop */}
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
            World (World Labs Marble)
          </div>
          {environmentAssetId ? (
            <div className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/60 p-2">
              <div className="flex items-center justify-between text-[11px] text-neutral-300">
                <span>World loaded · {environmentKind === "splat" ? "splat" : "mesh"}</span>
                <button onClick={() => setEnvironment(null)} className="text-neutral-500 hover:text-red-300" title="Remove world">
                  ✕
                </button>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="w-10">Scale</span>
                <input type="range" min={10} max={400} value={Math.round(env.scale * 100)} onChange={(e) => updateEnv({ scale: Number(e.target.value) / 100 })} className="flex-1" />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="w-10">Height</span>
                <input type="range" min={-300} max={300} value={Math.round(env.y * 100)} onChange={(e) => updateEnv({ y: Number(e.target.value) / 100 })} className="flex-1" />
              </label>
              <label className="flex items-center gap-2 text-[11px] text-neutral-400">
                <span className="w-10">Turn</span>
                <input type="range" min={-180} max={180} value={Math.round((env.rotY * 180) / Math.PI)} onChange={(e) => updateEnv({ rotY: (Number(e.target.value) * Math.PI) / 180 })} className="flex-1" />
              </label>
              <button
                onClick={alignGround}
                className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-200 hover:bg-neutral-700"
                title="Drop the world so its floor sits at the characters' feet (y=0)"
              >
                ⤓ Align ground
              </button>
              <div>
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">Frame</div>
                <div className="flex flex-wrap gap-1">
                  {CAMERA_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => frameView(p)}
                      className="rounded bg-neutral-800 px-2 py-1 text-[10px] text-neutral-300 hover:bg-neutral-700"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
              <div className="text-[10px] leading-relaxed text-neutral-600">
                {environmentKind === "splat"
                  ? "Splat world via drei <Splat> (.splat format). A .ply may not render — re-export as .splat from Marble. Align ground works once the splat has loaded."
                  : "Fit the world so its floor meets the characters' feet, or hit Align ground."}
              </div>
            </div>
          ) : (
            <>
              <label className="block cursor-pointer rounded border border-dashed border-neutral-700 p-2 text-center text-[11px] text-neutral-400 hover:border-azure-600 hover:text-neutral-200">
                Import a Marble world (.glb · .splat)
                <input
                  type="file"
                  accept=".glb,.splat,.ply,model/gltf-binary"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void importEnvironment(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <div className="mt-1 text-[9px] leading-relaxed text-neutral-600">
                GLB mesh or Gaussian splat. For splats export the compact .splat from Marble.
              </div>
            </>
          )}
        </div>

        {/* selected item transform */}
        {selectedItem && (
          <div className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/60 p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
              {charById.get(selectedItem.characterId)?.name ?? "Selected"}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setMode("place")}
                className={`flex-1 rounded px-2 py-1 text-[11px] ${mode === "place" ? "bg-azure-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"}`}
              >
                Place
              </button>
              <button
                onClick={() => setMode("pose")}
                className={`flex-1 rounded px-2 py-1 text-[11px] ${mode === "pose" ? "bg-azure-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"}`}
              >
                Pose
              </button>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-neutral-400">
              <span className="w-10">Turn</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round((selectedItem.rotY * 180) / Math.PI)}
                onChange={(e) => updateItem(selectedItem.id, { rotY: (Number(e.target.value) * Math.PI) / 180 })}
                className="flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-neutral-400">
              <span className="w-10">Scale</span>
              <input
                type="range"
                min={50}
                max={150}
                value={Math.round(selectedItem.scale * 100)}
                onChange={(e) => updateItem(selectedItem.id, { scale: Number(e.target.value) / 100 })}
                className="flex-1"
              />
            </label>
            <div className="text-[10px] text-neutral-600">
              {mode === "place" ? "Drag the gizmo to move on the plane." : "Click a joint to pose · scroll to zoom."}
            </div>
          </div>
        )}

        {/* generate */}
        <div className="mt-auto flex flex-col gap-2 border-t border-[var(--pf-hair)] pt-3">
          <AutoTextarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            minRows={3}
            className="rounded bg-neutral-800 px-2 py-1.5 text-[12px] text-neutral-200"
            placeholder="Scene prompt"
          />
          <button
            onClick={() => void generate()}
            disabled={busy || items.length === 0}
            className="rounded bg-azure-600 px-3 py-2 text-sm font-medium text-white hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
            title="Render the composed scene and generate from it (nano-banana). Anchored on the selected character."
          >
            {busy ? "Generating…" : "Generate scene"}
          </button>
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          {resultId && (
            <AssetImage assetId={resultId} alt="scene generation" className="w-full rounded-lg" />
          )}
          <div className="text-[10px] leading-relaxed text-neutral-600">
            Every scene character&apos;s sheet is referenced for identity; the composed render carries their poses + placement.
          </div>
        </div>
      </div>

      {/* center: 3D scene */}
      <div className="relative min-w-0 flex-1" style={{ background: "var(--pf-stage)" }}>
        <span className="pointer-events-none absolute left-4 top-3 z-10 font-mono text-[9.5px] uppercase tracking-[0.2em] text-neutral-500">
          Composition · {mode}
        </span>
        {items.length === 0 && !environmentAssetId ? (
          <div className="flex h-full items-center justify-center text-sm text-neutral-600">
            Add characters (or import a Marble world) from the left to build a scene.
          </div>
        ) : (
          <Canvas
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            dpr={[1, 2]}
            camera={{ position: [0, 1.6, 4], fov: 42 }}
            onPointerMissed={() => select(null)}
          >
            <Scene
              items={items}
              urls={urls}
              poses={poseByChar}
              envUrl={envUrl}
              registry={registry}
              envRef={envRef}
              cameraApiRef={cameraApiRef}
            />
          </Canvas>
        )}
      </div>
    </main>
  );
}
