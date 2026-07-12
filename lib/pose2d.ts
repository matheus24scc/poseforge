import type { PoseRotations } from "./db";
import { CANON, type CanonKey } from "./pose";

// 2D-sketch posing. A front-view stick figure has no depth, so sketched poses
// are planar → they map onto our Z-axis (body-plane) rotation offsets only
// (arms up/out/down, splits, leans — not forward reach). FK + solve are pure
// planar trig; verified by the round-trip in scripts/pose2d-test.mjs.

const D = Math.PI / 180;
type Joint = (typeof CANON)[number];
const byKey = new Map<string, Joint>(CANON.map((j) => [j.key as string, j]));

// The bone whose drawn direction fixes each joint's world angle (its own child
// in the canonical chain; spine3/hips branch → the spine/torso continuation).
const PRIMARY: Record<string, string> = {
  hips: "spine1", spine1: "spine2", spine2: "spine3", spine3: "neck",
  neck: "head", head: "head_top",
  l_shoulder: "l_upperarm", l_upperarm: "l_forearm", l_forearm: "l_hand",
  r_shoulder: "r_upperarm", r_upperarm: "r_forearm", r_forearm: "r_hand",
  l_thigh: "l_shin", l_shin: "l_foot",
  r_thigh: "r_shin", r_shin: "r_foot",
};

export type Vec2 = [number, number];

const rot2 = (x: number, y: number, a: number): Vec2 => [
  x * Math.cos(a) - y * Math.sin(a),
  x * Math.sin(a) + y * Math.cos(a),
];
const normDeg = (a: number): number => {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
};

/** FK a pose to 2D joint positions (model space, y-up, front view). */
export function poseToJoints2d(rotations: PoseRotations): Map<string, Vec2> {
  const world = new Map<string, number>();
  const pos = new Map<string, Vec2>();
  for (const joint of CANON) {
    if (joint.parent == null) {
      world.set(joint.key, 0);
      pos.set(joint.key, [0, 0]);
      continue;
    }
    const pAngle = world.get(joint.parent) ?? 0;
    const [ox, oy] = rot2(joint.offset[0], joint.offset[1], pAngle);
    const [px, py] = pos.get(joint.parent) ?? [0, 0];
    pos.set(joint.key, [px + ox, py + oy]);
    const own = (rotations[joint.key]?.[2] ?? 0) * D;
    world.set(joint.key, pAngle + own);
  }
  return pos;
}

const bindAngle = (key: string): number => {
  const j = byKey.get(key)!;
  return Math.atan2(j.offset[1], j.offset[0]);
};

/** World angle of a joint under the current pose (FK), radians. */
function worldAngle(rotations: PoseRotations, key: string): number {
  let a = 0;
  let k: string | null = key;
  const chain: string[] = [];
  while (k) {
    chain.unshift(k);
    k = byKey.get(k)?.parent ?? null;
  }
  for (const c of chain) a += (rotations[c]?.[2] ?? 0) * D;
  return a;
}

/** Rotate the bone that ENDS at `jointKey` so it points at `target` (model
 * space, y-up). That bone is controlled by the parent joint's rotation, so
 * this sets one Z offset; returns a new rotations object. Dragging the hand
 * bends the elbow; dragging the elbow swings the upper arm. */
export function solveBoneToward(
  rotations: PoseRotations,
  jointKey: CanonKey,
  target: Vec2,
): PoseRotations {
  const joint = byKey.get(jointKey);
  if (!joint || joint.parent == null) return rotations;
  const parentKey = joint.parent;
  const parent = byKey.get(parentKey);
  if (!parent) return rotations;
  const pos = poseToJoints2d(rotations);
  const [px, py] = pos.get(parentKey) ?? [0, 0];
  const desiredWorld = Math.atan2(target[1] - py, target[0] - px) - bindAngle(jointKey);
  const grandWorld = parent.parent != null ? worldAngle(rotations, parent.parent) : 0;
  const own = normDeg((desiredWorld - grandWorld) / D);
  const next = { ...rotations };
  if (Math.abs(own) < 0.5) delete next[parentKey];
  else next[parentKey] = [0, 0, Math.round(own)];
  return next;
}

/** Batch-solve a full set of dragged joint positions back to a pose. */
export function jointsToPose2d(pos: Map<string, Vec2>): PoseRotations {
  const world = new Map<string, number>();
  for (const joint of CANON) {
    const childKey = PRIMARY[joint.key];
    if (!childKey) continue;
    const [jx, jy] = pos.get(joint.key) ?? [0, 0];
    const [cx, cy] = pos.get(childKey) ?? [0, 0];
    world.set(joint.key, Math.atan2(cy - jy, cx - jx) - bindAngle(childKey));
  }
  const rotations: PoseRotations = {};
  for (const joint of CANON) {
    if (!world.has(joint.key)) continue;
    const parentWorld = joint.parent != null && world.has(joint.parent) ? world.get(joint.parent)! : 0;
    const own = normDeg((world.get(joint.key)! - parentWorld) / D);
    if (Math.abs(own) > 0.5) rotations[joint.key] = [0, 0, Math.round(own)];
  }
  return rotations;
}

// --- Body parts (scoping + extensibility) ------------------------------------
// Poses can be saved scoped to selected parts so fragments compose (an arm
// wave on top of a stance). Extend here as CanonKey grows (hands → fingers,
// feet → toes) once rigs expose those bones.

export type BodyPart = "head" | "torso" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

export const BODY_PARTS: { part: BodyPart; label: string; keys: CanonKey[] }[] = [
  { part: "head", label: "Head", keys: ["neck", "head"] },
  { part: "torso", label: "Torso", keys: ["hips", "spine1", "spine2", "spine3"] },
  { part: "leftArm", label: "L arm", keys: ["l_shoulder", "l_upperarm", "l_forearm", "l_hand"] },
  { part: "rightArm", label: "R arm", keys: ["r_shoulder", "r_upperarm", "r_forearm", "r_hand"] },
  { part: "leftLeg", label: "L leg", keys: ["l_thigh", "l_shin", "l_foot"] },
  { part: "rightLeg", label: "R leg", keys: ["r_thigh", "r_shin", "r_foot"] },
];

const KEY_TO_PART = new Map<string, BodyPart>();
for (const g of BODY_PARTS) for (const k of g.keys) KEY_TO_PART.set(k, g.part);

/** Draggable joint handles → the bone each one rotates (its parent joint).
 * Elbows/knees swing the limb root; hands/feet bend the joint; head + spine
 * lean the torso. */
export const DRAG_HANDLES: CanonKey[] = [
  "l_forearm", "l_hand", "r_forearm", "r_hand",
  "l_shin", "l_foot", "r_shin", "r_foot",
  "spine2", "spine3", "head",
];

/** Filter a pose to the selected body parts (for scoped saving). */
export function scopePose(rotations: PoseRotations, parts: BodyPart[]): PoseRotations {
  if (parts.length === BODY_PARTS.length) return rotations; // full body
  const set = new Set(parts);
  const out: PoseRotations = {};
  for (const [key, v] of Object.entries(rotations)) {
    const part = KEY_TO_PART.get(key);
    if (part && set.has(part)) out[key] = v;
  }
  return out;
}
