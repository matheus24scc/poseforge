import * as THREE from "three";
import type { PoseRotations } from "./db";
import type { Rig } from "./store";

// Poses are stored as canonical-joint rotation offsets (degrees, XYZ euler,
// relative to the T-pose bind), NOT raw bone names — so a pose written once
// applies to any humanoid rig we can classify. Meshy auto-rigs use
// Mixamo-convention names (LeftArm, RightForeArm, Spine01, …) which map 1:1.

export type CanonKey =
  | "hips"
  | "spine1"
  | "spine2"
  | "spine3"
  | "neck"
  | "head"
  | "l_shoulder"
  | "r_shoulder"
  | "l_upperarm"
  | "r_upperarm"
  | "l_forearm"
  | "r_forearm"
  | "l_hand"
  | "r_hand"
  | "l_thigh"
  | "r_thigh"
  | "l_shin"
  | "r_shin"
  | "l_foot"
  | "r_foot";

function side(n: string): "l" | "r" | null {
  if (/left|(^|[^a-z])l([^a-z]|$)/.test(n)) return "l";
  if (/right|(^|[^a-z])r([^a-z]|$)/.test(n)) return "r";
  return null;
}

function part(n: string): string | null {
  if (/(fore|lower).?arm|elbow/.test(n)) return "forearm";
  if (/hand|wrist/.test(n)) return "hand";
  if (/shoulder|clavicle|collar/.test(n)) return "shoulder";
  if (/up.?leg|upper.?leg|thigh/.test(n)) return "thigh";
  if (/lower.?leg|shin|calf|knee/.test(n)) return "shin";
  if (/toe/.test(n)) return null; // leave toes alone
  if (/foot|ankle/.test(n)) return "foot";
  if (/arm/.test(n)) return "upperarm";
  if (/leg/.test(n)) return "shin"; // mixamo-style: "LeftLeg" is the lower leg
  if (/^hips?$|pelvis/.test(n)) return "hips";
  if (/spine|chest|torso/.test(n)) return "spine";
  if (/neck/.test(n)) return "neck";
  if (/head(?!.*(end|front|top))/.test(n)) return "head";
  return null;
}

/** Map a rig's bones onto canonical joint keys. Spine chains of any length are
 * distributed across spine1..spine3 by hierarchy depth. */
export function buildBoneMap(bones: THREE.Bone[]): Map<CanonKey, THREE.Bone> {
  const map = new Map<CanonKey, THREE.Bone>();
  const spines: { bone: THREE.Bone; depth: number }[] = [];
  for (const bone of bones) {
    const n = bone.name.toLowerCase();
    const p = part(n);
    if (!p) continue;
    if (p === "spine") {
      let depth = 0;
      for (let o: THREE.Object3D | null = bone.parent; o; o = o.parent) depth++;
      spines.push({ bone, depth });
      continue;
    }
    if (p === "hips" || p === "neck" || p === "head") {
      if (!map.has(p)) map.set(p, bone);
      continue;
    }
    const s = side(n);
    if (!s) continue;
    const key = `${s}_${p}` as CanonKey;
    if (!map.has(key)) map.set(key, bone);
  }
  spines.sort((a, b) => a.depth - b.depth);
  const slots: CanonKey[][] = [[], ["spine2"], ["spine1", "spine3"], ["spine1", "spine2", "spine3"]];
  const assign = slots[Math.min(spines.length, 3)];
  assign.forEach((key, i) => map.set(key, spines[i].bone));
  return map;
}

const D = Math.PI / 180;

function boneDepth(bone: THREE.Bone): number {
  let d = 0;
  for (let o = bone.parent; o; o = o.parent) d++;
  return d;
}

// Pose rotations are defined in WORLD space (character facing +Z, +Y up,
// +X = character's left): "lower the arm" is -Z for the left arm on ANY rig,
// regardless of the bone's bind-frame axes. At apply time each world rotation
// is converted into the bone's local frame:
//   local_new = qParentWorld⁻¹ ⊗ R_world ⊗ qParentWorld ⊗ local_bind
// Parents apply first, so children compose on the already-posed body.
export function applyPose(rig: Rig, rotations: PoseRotations): void {
  resetPose(rig);
  const entries = Object.entries(rotations)
    .map(([key, e]) => ({ e, bone: rig.byKey.get(key as CanonKey) }))
    .filter((x): x is { e: [number, number, number]; bone: THREE.Bone } => !!x.bone)
    .sort((a, b) => boneDepth(a.bone) - boneDepth(b.bone));
  const qParent = new THREE.Quaternion();
  for (const { bone, e } of entries) {
    if (bone.parent) bone.parent.getWorldQuaternion(qParent);
    else qParent.identity();
    const qWorld = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(e[0] * D, e[1] * D, e[2] * D, "XYZ"),
    );
    const qLocalBind = bone.quaternion.clone(); // resetPose restored bind
    bone.quaternion
      .copy(qParent)
      .invert()
      .multiply(qWorld)
      .multiply(qParent)
      .multiply(qLocalBind);
    bone.updateMatrixWorld(true);
  }
}

/** Apply only the given joints on top of the CURRENT pose (no full reset), so
 * a body-part-scoped pose (e.g. arms only) composes onto whatever stance the
 * character already holds. Same world-space formula as applyPose. */
export function applyPoseMerge(rig: Rig, rotations: PoseRotations): void {
  const entries = Object.entries(rotations)
    .map(([key, e]) => ({ e, bone: rig.byKey.get(key as CanonKey) }))
    .filter((x): x is { e: [number, number, number]; bone: THREE.Bone } => !!x.bone)
    .sort((a, b) => boneDepth(a.bone) - boneDepth(b.bone));
  const qParent = new THREE.Quaternion();
  for (const { bone, e } of entries) {
    if (bone.parent) bone.parent.getWorldQuaternion(qParent);
    else qParent.identity();
    const qWorld = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(e[0] * D, e[1] * D, e[2] * D, "XYZ"),
    );
    const initial = rig.initial.get(bone.uuid);
    const qBind = initial
      ? new THREE.Quaternion().setFromEuler(initial as THREE.Euler)
      : bone.quaternion.clone();
    bone.quaternion.copy(qParent).invert().multiply(qWorld).multiply(qParent).multiply(qBind);
    bone.updateMatrixWorld(true);
  }
}

export function resetPose(rig: Rig): void {
  for (const bone of rig.bones) {
    const initial = rig.initial.get(bone.uuid);
    if (initial) bone.rotation.copy(initial as THREE.Euler);
    bone.updateMatrixWorld(true);
  }
}

/** Build a Rig (bones + canonical map + bind-pose snapshot) from a loaded GLB
 * scene, or null if it has no bones. Shared by the single-character viewport
 * and the composition scene. */
export function buildRig(root: THREE.Object3D): Rig | null {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned meshes vanish when posed otherwise
  });
  if (!bones.length) return null;
  const initial = new Map(bones.map((b) => [b.uuid, b.rotation.clone()]));
  return { bones, initial, byKey: buildBoneMap(bones) };
}

/** Scale a scene to `height` units tall and sit it on the ground (feet at y=0,
 * centered in x/z), so it can be placed by a parent group's transform. */
export function normalizeToGround(scene: THREE.Object3D, height = 1.6): void {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = size.y > 0 ? height / size.y : 1;
  scene.scale.setScalar(scale);
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= box.min.y;
}

/** Read the rig's current deviation from bind as world-space offsets (the
 * inverse of applyPose), so saved poses replay on any rig. */
export function capturePose(rig: Rig): PoseRotations {
  const rotations: PoseRotations = {};
  const byDepth = [...rig.byKey.entries()].sort((a, b) => boneDepth(a[1]) - boneDepth(b[1]));
  const qParent = new THREE.Quaternion();
  for (const [key, bone] of byDepth) {
    const initial = rig.initial.get(bone.uuid);
    if (!initial) continue;
    const qBind = new THREE.Quaternion().setFromEuler(initial as THREE.Euler);
    if (bone.quaternion.angleTo(qBind) < 0.02) continue;
    if (bone.parent) bone.parent.getWorldQuaternion(qParent);
    else qParent.identity();
    // R_world = qParent ⊗ local_now ⊗ local_bind⁻¹ ⊗ qParent⁻¹
    const qDelta = qParent
      .clone()
      .multiply(bone.quaternion)
      .multiply(qBind.clone().invert())
      .multiply(qParent.clone().invert());
    const e = new THREE.Euler().setFromQuaternion(qDelta, "XYZ");
    const deg: [number, number, number] = [
      Math.round(e.x / D),
      Math.round(e.y / D),
      Math.round(e.z / D),
    ];
    if (deg[0] || deg[1] || deg[2]) rotations[key] = deg;
  }
  return rotations;
}

// --- Built-in pose library ---------------------------------------------------
// WORLD-axis semantics (character faces +Z, +Y up, +X = character's left):
//   Z rotates in the body plane   → left arm down = −Z, right arm down = +Z,
//                                    raise = the opposite sign
//   X swings limbs forward/back   → forward = −X for hanging limbs/legs,
//                                    knee-bend/back = +X; spine lean fwd = +X
//   Y swings arms forward/turns   → left arm forward = −Y, right = +Y

export interface BuiltinPose {
  id: string;
  name: string;
  tags: string[];
  rotations: PoseRotations;
}

export const BUILTIN_POSES: BuiltinPose[] = [
  { id: "b-tpose", name: "T-Pose", tags: ["neutral"], rotations: {} },
  {
    id: "b-relaxed",
    name: "Relaxed",
    tags: ["neutral", "stand"],
    rotations: { l_upperarm: [0, 0, -72], r_upperarm: [0, 0, 72], l_forearm: [0, 0, -6], r_forearm: [0, 0, 6] },
  },
  {
    id: "b-wave",
    name: "Wave",
    tags: ["gesture"],
    rotations: {
      l_upperarm: [0, 0, -72],
      r_upperarm: [0, 0, -50],
      r_forearm: [0, 0, -45],
      head: [0, 0, 8],
    },
  },
  {
    id: "b-arms-up",
    name: "Arms Up",
    tags: ["gesture", "celebrate"],
    rotations: { l_upperarm: [0, 0, 60], r_upperarm: [0, 0, -60], l_forearm: [0, 0, 12], r_forearm: [0, 0, -12] },
  },
  {
    id: "b-point",
    name: "Point Forward",
    tags: ["gesture"],
    rotations: { l_upperarm: [0, 0, -72], r_upperarm: [0, 85, 0] },
  },
  {
    id: "b-shrug",
    name: "Shrug",
    tags: ["gesture", "idle"],
    rotations: {
      l_shoulder: [0, 0, 18],
      r_shoulder: [0, 0, -18],
      l_upperarm: [0, 0, -28],
      r_upperarm: [0, 0, 28],
      l_forearm: [0, 0, 62],
      r_forearm: [0, 0, -62],
      head: [8, 0, 0],
    },
  },
  {
    id: "b-cross",
    name: "Arms Crossed",
    tags: ["stand", "confident"],
    rotations: {
      l_upperarm: [-25, 0, -65],
      r_upperarm: [-25, 0, 65],
      l_forearm: [-20, 0, -85],
      r_forearm: [-20, 0, 85],
      spine3: [5, 0, 0],
    },
  },
  {
    id: "b-walk",
    name: "Walk",
    tags: ["locomotion"],
    rotations: {
      l_upperarm: [25, 0, -72],
      r_upperarm: [-25, 0, 72],
      l_forearm: [-15, 0, 0],
      r_forearm: [-35, 0, 0],
      l_thigh: [-30, 0, 0],
      r_thigh: [20, 0, 0],
      l_shin: [15, 0, 0],
      r_shin: [35, 0, 0],
      spine2: [3, 0, 0],
    },
  },
  {
    id: "b-run",
    name: "Run",
    tags: ["locomotion", "action"],
    rotations: {
      spine2: [12, 0, 0],
      l_upperarm: [45, 0, -70],
      r_upperarm: [-45, 0, 70],
      l_forearm: [-70, 0, 0],
      r_forearm: [-80, 0, 0],
      l_thigh: [-55, 0, 0],
      r_thigh: [30, 0, 0],
      l_shin: [35, 0, 0],
      r_shin: [80, 0, 0],
    },
  },
  {
    id: "b-jump",
    name: "Jump",
    tags: ["action"],
    rotations: {
      l_upperarm: [15, 0, 50],
      r_upperarm: [15, 0, -50],
      l_thigh: [-35, 0, 0],
      r_thigh: [-35, 0, 0],
      l_shin: [70, 0, 0],
      r_shin: [70, 0, 0],
      spine2: [5, 0, 0],
    },
  },
  {
    id: "b-sit",
    name: "Sit",
    tags: ["stand", "rest"],
    rotations: {
      l_thigh: [-85, 0, 0],
      r_thigh: [-85, 0, 0],
      l_shin: [85, 0, 0],
      r_shin: [85, 0, 0],
      l_upperarm: [0, 0, -72],
      r_upperarm: [0, 0, 72],
      l_forearm: [-35, 0, 0],
      r_forearm: [-35, 0, 0],
      spine2: [5, 0, 0],
    },
  },
  {
    id: "b-crouch",
    name: "Crouch",
    tags: ["action", "stealth"],
    rotations: {
      l_thigh: [-95, 0, 0],
      r_thigh: [-95, 0, 0],
      l_shin: [120, 0, 0],
      r_shin: [120, 0, 0],
      spine1: [20, 0, 0],
      spine2: [15, 0, 0],
      l_upperarm: [-20, 0, -65],
      r_upperarm: [-20, 0, 65],
      l_forearm: [-40, 0, 0],
      r_forearm: [-40, 0, 0],
    },
  },
  {
    id: "b-fight",
    name: "Fight Stance",
    tags: ["action", "combat"],
    rotations: {
      spine2: [5, 15, 0],
      l_upperarm: [-35, 0, -60],
      r_upperarm: [-45, 0, 55],
      l_forearm: [-95, 0, 0],
      r_forearm: [-105, 0, 0],
      l_thigh: [-15, 0, 0],
      r_thigh: [10, 0, 0],
      l_shin: [15, 0, 0],
      r_shin: [15, 0, 0],
      head: [0, -10, 0],
    },
  },
  {
    id: "b-think",
    name: "Thinking",
    tags: ["gesture", "idle"],
    rotations: {
      l_upperarm: [0, 0, -72],
      r_upperarm: [-40, 0, 45],
      r_forearm: [-120, 0, 0],
      head: [10, 0, 8],
      spine3: [5, 0, 0],
    },
  },
];

// --- Direct manipulation helpers ----------------------------------------------

export function mirrorKey(key: CanonKey): CanonKey | null {
  if (key.startsWith("l_")) return `r_${key.slice(2)}` as CanonKey;
  if (key.startsWith("r_")) return `l_${key.slice(2)}` as CanonKey;
  return null;
}

/** Canonical key of a bone (reverse byKey lookup). */
export function keyForBone(rig: Rig, uuid: string): CanonKey | null {
  for (const [key, bone] of rig.byKey) if (bone.uuid === uuid) return key;
  return null;
}

function worldDelta(rig: Rig, bone: THREE.Bone): THREE.Quaternion | null {
  const initial = rig.initial.get(bone.uuid);
  if (!initial) return null;
  const qBind = new THREE.Quaternion().setFromEuler(initial as THREE.Euler);
  const qParent = new THREE.Quaternion();
  if (bone.parent) bone.parent.getWorldQuaternion(qParent);
  return qParent
    .clone()
    .multiply(bone.quaternion)
    .multiply(qBind.clone().invert())
    .multiply(qParent.clone().invert());
}

function applyWorldDelta(rig: Rig, bone: THREE.Bone, qDelta: THREE.Quaternion): void {
  const initial = rig.initial.get(bone.uuid);
  if (!initial) return;
  const qBind = new THREE.Quaternion().setFromEuler(initial as THREE.Euler);
  const qParent = new THREE.Quaternion();
  if (bone.parent) bone.parent.getWorldQuaternion(qParent);
  bone.quaternion.copy(qParent).invert().multiply(qDelta).multiply(qParent).multiply(qBind);
  bone.updateMatrixWorld(true);
}

/** Copy the selected joint's pose to its opposite-side counterpart, mirrored
 * across the body (x→−x plane: quaternion (x,y,z,w) → (x,−y,−z,w)). */
export function mirrorBonePose(rig: Rig, key: CanonKey): boolean {
  const otherKey = mirrorKey(key);
  if (!otherKey) return false;
  const src = rig.byKey.get(key);
  const dst = rig.byKey.get(otherKey);
  if (!src || !dst) return false;
  const delta = worldDelta(rig, src);
  if (!delta) return false;
  applyWorldDelta(rig, dst, new THREE.Quaternion(delta.x, -delta.y, -delta.z, delta.w));
  return true;
}

/** Reset one bone to its bind rotation. */
export function resetBone(rig: Rig, bone: THREE.Bone): void {
  const initial = rig.initial.get(bone.uuid);
  if (initial) bone.rotation.copy(initial as THREE.Euler);
  bone.updateMatrixWorld(true);
}

/** Quaternion-slerp between two poses (per canonical joint), for timeline
 * scrubbing/playback. alpha 0 → a, 1 → b. */
export function interpolatePose(a: PoseRotations, b: PoseRotations, alpha: number): PoseRotations {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: PoseRotations = {};
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const key of keys) {
    const ra = a[key] ?? [0, 0, 0];
    const rb = b[key] ?? [0, 0, 0];
    qa.setFromEuler(e.set(ra[0] * D, ra[1] * D, ra[2] * D, "XYZ"));
    qb.setFromEuler(new THREE.Euler(rb[0] * D, rb[1] * D, rb[2] * D, "XYZ"));
    qa.slerp(qb, alpha);
    e.setFromQuaternion(qa, "XYZ");
    out[key] = [e.x / D, e.y / D, e.z / D];
  }
  return out;
}

/** Rasterize a pose's stick figure to a PNG data URI — the conditioning image
 * for 2D re-posing (nano-banana gets [character image + skeleton + prompt]). */
export function poseSkeletonPng(rotations: PoseRotations): string {
  const { lines, head } = computePosePreview(rotations, 0); // front view for 2D conditioning
  const size = 512;
  const s = size / 100;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 13;
  ctx.lineCap = "round";
  for (const [x1, y1, x2, y2] of lines) {
    ctx.beginPath();
    ctx.moveTo(x1 * s, y1 * s);
    ctx.lineTo(x2 * s, y2 * s);
    ctx.stroke();
  }
  ctx.fillStyle = "#111111";
  ctx.beginPath();
  ctx.arc(head.x * s, head.y * s, head.r * s, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

// --- Skeleton preview (library thumbnails) -----------------------------------
// Tiny FK evaluation of a canonical stick figure so every pose renders as an
// orientation-showing skeleton without needing a 3D scene. Approximate by
// design: thumbnails communicate the pose, the viewport is the truth.

export interface CanonJoint {
  key: CanonKey | "head_top";
  parent: CanonKey | "root" | null;
  offset: [number, number, number];
}

export const CANON: CanonJoint[] = [
  { key: "hips", parent: null, offset: [0, 0, 0] },
  { key: "spine1", parent: "hips", offset: [0, 0.1, 0] },
  { key: "spine2", parent: "spine1", offset: [0, 0.12, 0] },
  { key: "spine3", parent: "spine2", offset: [0, 0.12, 0] },
  { key: "neck", parent: "spine3", offset: [0, 0.1, 0] },
  { key: "head", parent: "neck", offset: [0, 0.08, 0] },
  { key: "head_top", parent: "head", offset: [0, 0.16, 0] },
  { key: "l_shoulder", parent: "spine3", offset: [0.1, 0.06, 0] },
  { key: "l_upperarm", parent: "l_shoulder", offset: [0.07, 0, 0] },
  { key: "l_forearm", parent: "l_upperarm", offset: [0.26, 0, 0] },
  { key: "l_hand", parent: "l_forearm", offset: [0.24, 0, 0] },
  { key: "r_shoulder", parent: "spine3", offset: [-0.1, 0.06, 0] },
  { key: "r_upperarm", parent: "r_shoulder", offset: [-0.07, 0, 0] },
  { key: "r_forearm", parent: "r_upperarm", offset: [-0.26, 0, 0] },
  { key: "r_hand", parent: "r_forearm", offset: [-0.24, 0, 0] },
  { key: "l_thigh", parent: "hips", offset: [0.1, -0.04, 0] },
  { key: "l_shin", parent: "l_thigh", offset: [0, -0.42, 0] },
  { key: "l_foot", parent: "l_shin", offset: [0, -0.4, 0] },
  { key: "r_thigh", parent: "hips", offset: [-0.1, -0.04, 0] },
  { key: "r_shin", parent: "r_thigh", offset: [0, -0.42, 0] },
  { key: "r_foot", parent: "r_shin", offset: [0, -0.4, 0] },
];

export interface PosePreviewData {
  /** line segments [x1,y1,x2,y2] in a 0..100 viewBox, plus head circle */
  lines: [number, number, number, number][];
  head: { x: number; y: number; r: number };
}

export function computePosePreview(rotations: PoseRotations, yawDeg = 22): PosePreviewData {
  const world = new Map<string, { pos: THREE.Vector3; rot: THREE.Quaternion }>();
  world.set("__root", { pos: new THREE.Vector3(0, 0, 0), rot: new THREE.Quaternion() });

  for (const joint of CANON) {
    const parent = joint.parent ? world.get(joint.parent) : world.get("__root");
    if (!parent) continue;
    const offset = new THREE.Vector3(...joint.offset).applyQuaternion(parent.rot);
    const pos = parent.pos.clone().add(offset);
    const rot = parent.rot.clone();
    const r = rotations[joint.key];
    if (r) {
      // world-axis rotation (matches applyPose semantics): premultiply
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D, r[1] * D, r[2] * D, "XYZ"));
      rot.premultiply(q);
    }
    world.set(joint.key, { pos, rot });
  }

  // slight yaw for a ¾ view, orthographic projection to 2D
  const yaw = yawDeg * D;
  const project = (v: THREE.Vector3): [number, number] => [
    v.x * Math.cos(yaw) - v.z * Math.sin(yaw),
    v.y,
  ];

  const pts = new Map<string, [number, number]>();
  for (const [key, { pos }] of world) pts.set(key, project(pos));

  const SEGMENTS: [string, string][] = [
    ["hips", "spine1"],
    ["spine1", "spine2"],
    ["spine2", "spine3"],
    ["spine3", "neck"],
    ["neck", "head"],
    ["spine3", "l_shoulder"],
    ["l_shoulder", "l_upperarm"],
    ["l_upperarm", "l_forearm"],
    ["l_forearm", "l_hand"],
    ["spine3", "r_shoulder"],
    ["r_shoulder", "r_upperarm"],
    ["r_upperarm", "r_forearm"],
    ["r_forearm", "r_hand"],
    ["hips", "l_thigh"],
    ["l_thigh", "l_shin"],
    ["l_shin", "l_foot"],
    ["hips", "r_thigh"],
    ["r_thigh", "r_shin"],
    ["r_shin", "r_foot"],
  ];

  // fit into 0..100 viewBox (y flipped for SVG)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts.values()) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.01) * 1.25;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const toSvg = ([x, y]: [number, number]): [number, number] => [
    50 + ((x - cx) / span) * 100,
    50 - ((y - cy) / span) * 100,
  ];

  const lines: [number, number, number, number][] = [];
  for (const [a, b] of SEGMENTS) {
    const pa = pts.get(a);
    const pb = pts.get(b);
    if (!pa || !pb) continue;
    const [x1, y1] = toSvg(pa);
    const [x2, y2] = toSvg(pb);
    lines.push([x1, y1, x2, y2]);
  }
  const headPt = toSvg(pts.get("head_top")!);
  const neckPt = toSvg(pts.get("head")!);
  const r = Math.max(4, Math.hypot(headPt[0] - neckPt[0], headPt[1] - neckPt[1]) / 1.6);
  return { lines, head: { x: (headPt[0] + neckPt[0]) / 2, y: (headPt[1] + neckPt[1]) / 2, r } };
}
