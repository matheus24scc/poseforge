"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls, useGLTF } from "@react-three/drei";
import type { TransformControls as TransformControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useViewportStore } from "@/lib/store";
import { applyPose, buildBoneMap } from "@/lib/pose";
import type { PoseRotations } from "@/lib/db";

function Model({ url, initialPose }: { url: string; initialPose?: PoseRotations | null }) {
  const { scene } = useGLTF(url);
  const showSkeleton = useViewportStore((s) => s.showSkeleton);
  // read fresh at mount without making the pose a mount-effect dependency
  const initialPoseRef = useRef(initialPose);
  initialPoseRef.current = initialPose;

  useEffect(() => {
    // Normalize to ~1.6 units tall, feet on the ground, centered.
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? 1.6 / size.y : 1;
    scene.scale.setScalar(scale);
    scene.updateMatrixWorld(true);
    box.setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    scene.position.x -= center.x;
    scene.position.z -= center.z;
    scene.position.y -= box.min.y;

    const bones: THREE.Bone[] = [];
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned meshes vanish when posed otherwise
    });
    const initial = new Map(bones.map((b) => [b.uuid, b.rotation.clone()]));
    const rig = bones.length ? { bones, initial, byKey: buildBoneMap(bones) } : null;
    const store = useViewportStore.getState();
    store.setRig(rig);
    if (process.env.NODE_ENV === "development") {
      (window as unknown as { __pfRig?: unknown }).__pfRig = rig;
    }
    // apply a pose selected while the viewport was unmounted; otherwise restore
    // the character's persisted working pose so it survives remount/step nav
    if (rig && store.pendingPose) {
      applyPose(rig, store.pendingPose);
      store.setPendingPose(null);
      store.bumpPoseVersion();
    } else if (rig && initialPoseRef.current && Object.keys(initialPoseRef.current).length) {
      applyPose(rig, initialPoseRef.current);
      store.bumpPoseVersion();
    }
    return () => useViewportStore.getState().setRig(null);
  }, [scene]);

  // SkeletonHelper only makes sense once the model actually has bones
  // (the unrigged step-4 mesh has none).
  const helper = useMemo(() => {
    let hasBones = false;
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) hasBones = true;
    });
    return hasBones ? new THREE.SkeletonHelper(scene) : null;
  }, [scene]);

  return (
    <>
      <primitive object={scene} />
      {showSkeleton && helper && <primitive object={helper} />}
    </>
  );
}

export function CaptureBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    useViewportStore.getState().setCapture(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
    return () => useViewportStore.getState().setCapture(null);
  }, [gl, scene, camera]);
  return null;
}

// Direct manipulation (design §05): clickable joint markers on the canonical
// bones, tracked to their world positions every frame; the selected joint
// gets a rotation gizmo. Vermilion is reserved for exactly this.
const VERM = new THREE.Color("#f2503c");
const VERM_DIM = new THREE.Color("#8a4038");
const IDLE = new THREE.Color("#9b9ea6");

export function JointMarkers() {
  const rig = useViewportStore((s) => s.rig);
  const selectedBoneUuid = useViewportStore((s) => s.selectedBoneUuid);
  const setSelectedBoneUuid = useViewportStore((s) => s.setSelectedBoneUuid);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const joints = useMemo(() => (rig ? [...new Set(rig.byKey.values())] : []), [rig]);
  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const tmpV = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    joints.forEach((bone, i) => {
      bone.getWorldPosition(tmpV);
      tmpM.makeTranslation(tmpV.x, tmpV.y, tmpV.z);
      mesh.setMatrixAt(i, tmpM);
      mesh.setColorAt(
        i,
        bone.uuid === selectedBoneUuid ? VERM : hovered === i ? VERM_DIM : IDLE,
      );
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  if (!joints.length) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, joints.length]}
      onClick={(e) => {
        e.stopPropagation();
        if (e.instanceId === undefined) return;
        setSelectedBoneUuid(joints[e.instanceId].uuid);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHovered(e.instanceId ?? null);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHovered(null);
        document.body.style.cursor = "auto";
      }}
    >
      <sphereGeometry args={[0.022, 12, 12]} />
      <meshBasicMaterial depthTest={false} transparent opacity={0.9} />
    </instancedMesh>
  );
}

export function BoneGizmo() {
  const rig = useViewportStore((s) => s.rig);
  const selectedBoneUuid = useViewportStore((s) => s.selectedBoneUuid);
  const snap = useViewportStore((s) => s.snap);
  const bumpPoseVersion = useViewportStore((s) => s.bumpPoseVersion);
  const controlsRef = useRef<TransformControlsImpl>(null);
  const bone = rig?.bones.find((b) => b.uuid === selectedBoneUuid);

  // One-signal rule: tint the whole rotation gizmo vermilion. three-stdlib's
  // gizmo restores each handle's base color from material.tempColor every frame
  // (drag/hover still flashes yellow), so override tempColor as well as color.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const paint = (m: THREE.Material) => {
      const cm = m as THREE.Material & { color?: THREE.Color; tempColor?: THREE.Color };
      if (!cm.color) return;
      cm.color.copy(VERM);
      cm.tempColor = VERM.clone();
    };
    controls.traverse((o) => {
      const mat = (o as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach(paint);
      else if (mat) paint(mat);
    });
  }, [selectedBoneUuid]);

  if (!bone) return null;
  return (
    <TransformControls
      ref={controlsRef}
      object={bone}
      mode="rotate"
      space="local"
      size={0.55}
      rotationSnap={snap ? Math.PI / 12 : null}
      onMouseUp={() => bumpPoseVersion()}
    />
  );
}

// OrbitControls saves its initial position/target; expose its reset() so the
// UI can offer a "recenter" escape hatch after the user gets lost in orbit.
function ResetViewBridge() {
  const controls = useThree((s) => s.controls) as { reset?: () => void } | null;
  useEffect(() => {
    if (!controls?.reset) return;
    useViewportStore.getState().setResetView(() => controls.reset!());
    return () => useViewportStore.getState().setResetView(null);
  }, [controls]);
  return null;
}

// Model parsing can fail (unsupported GLTF extensions, corrupt download…).
// Without this boundary a failure white-screens the whole app; with it, the
// rest of the pipeline stays usable and the real error is visible.
class ViewportErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="text-sm text-red-400">Couldn&apos;t display the 3D model</div>
          <div className="max-w-md break-words text-xs text-neutral-500">
            {this.state.error.message || String(this.state.error)}
          </div>
          <button
            onClick={() => this.setState({ error: null })}
            className="rounded bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function Viewport({
  modelUrl,
  poseMode = false,
  initialPose = null,
}: {
  modelUrl: string | null;
  poseMode?: boolean;
  initialPose?: PoseRotations | null;
}) {
  // Browsers can drop the WebGL context (GPU pressure, embedded webviews,
  // backgrounded tabs). Remount the Canvas on loss to get a fresh context.
  const [glEpoch, setGlEpoch] = useState(0);

  if (!modelUrl) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        The 3D mesh appears here after the Mesh step.
      </div>
    );
  }
  return (
    <ViewportErrorBoundary resetKey={`${modelUrl}:${glEpoch}`}>
      <Canvas
        key={glEpoch}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        dpr={[1, 2]}
        camera={{ position: [0, 1.2, 2.6], fov: 42 }}
        onPointerMissed={() => {
          if (poseMode) useViewportStore.getState().setSelectedBoneUuid(null);
        }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setTimeout(() => setGlEpoch((n) => n + 1), 1000);
          });
        }}
      >
        {/* Plain mid-gray backdrop: the captured render doubles as the pose
            reference image for generation, so keep it clean. */}
        <color attach="background" args={["#3f3f46"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 4]} intensity={2.2} />
        <directionalLight position={[-4, 3, -3]} intensity={0.8} />
        <gridHelper args={[10, 20, "#52525b", "#3f3f46"]} />
        <Suspense fallback={null}>
          <Model url={modelUrl} initialPose={initialPose} />
        </Suspense>
        {poseMode && <JointMarkers />}
        {poseMode && <BoneGizmo />}
        <CaptureBridge />
        <OrbitControls target={[0, 0.85, 0]} makeDefault />
        <ResetViewBridge />
      </Canvas>
    </ViewportErrorBoundary>
  );
}
