// Verify the 2D-sketch pose solver (dragged front-view joints → PoseRotations).
// A front view has no depth, so poses are planar → Z-axis (body-plane) offsets
// only. Round-trip: author a pure-Z pose → FK to 2D joints → solve back →
// the Z components must match (mod 360). Mirrors lib/pose2d.ts; keep in sync.
//
//   node scripts/pose2d-test.mjs

// Canonical skeleton (mirror of CANON in lib/pose.ts), y-up, front view.
const CANON = [
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

const byKey = new Map(CANON.map((j) => [j.key, j]));
// primary child = the bone whose direction defines a joint's world angle
const PRIMARY = {
  hips: "spine1", spine1: "spine2", spine2: "spine3", spine3: "neck",
  neck: "head", head: "head_top",
  l_shoulder: "l_upperarm", l_upperarm: "l_forearm", l_forearm: "l_hand",
  r_shoulder: "r_upperarm", r_upperarm: "r_forearm", r_forearm: "r_hand",
  l_thigh: "l_shin", l_shin: "l_foot",
  r_thigh: "r_shin", r_shin: "r_foot",
};

const D = Math.PI / 180;
const rot2 = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
const norm = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };

// FK a pose (Z-degrees per key) to 2D joint positions (y-up front view).
function poseToJoints2d(rotations) {
  const world = new Map();
  const pos = new Map();
  for (const joint of CANON) {
    if (joint.parent == null) {
      world.set(joint.key, 0);
      pos.set(joint.key, [0, 0]);
      continue;
    }
    const pAngle = world.get(joint.parent);
    const [ox, oy] = rot2(joint.offset[0], joint.offset[1], pAngle);
    const [px, py] = pos.get(joint.parent);
    pos.set(joint.key, [px + ox, py + oy]);
    const own = (rotations[joint.key]?.[2] ?? 0) * D;
    world.set(joint.key, pAngle + own);
  }
  return pos;
}

// Solve dragged 2D joints back to per-key Z-degree offsets.
function jointsToPose2d(pos) {
  const world = new Map();
  const rotations = {};
  for (const joint of CANON) {
    const childKey = PRIMARY[joint.key];
    if (!childKey) continue; // leaf
    const child = byKey.get(childKey);
    const [jx, jy] = pos.get(joint.key);
    const [cx, cy] = pos.get(childKey);
    const drawn = Math.atan2(cy - jy, cx - jx);
    const bind = Math.atan2(child.offset[1], child.offset[0]);
    world.set(joint.key, drawn - bind);
  }
  for (const joint of CANON) {
    if (!world.has(joint.key)) continue;
    const parentWorld = joint.parent != null && world.has(joint.parent) ? world.get(joint.parent) : 0;
    const own = norm((world.get(joint.key) - parentWorld) / D);
    if (Math.abs(own) > 0.5) rotations[joint.key] = [0, 0, Math.round(own)];
  }
  return rotations;
}

// --- round-trip tests --------------------------------------------------------
const CASES = {
  "arms up": { l_upperarm: [0, 0, 60], r_upperarm: [0, 0, -60], l_forearm: [0, 0, 12], r_forearm: [0, 0, -12] },
  "arms down": { l_upperarm: [0, 0, -72], r_upperarm: [0, 0, 72] },
  "legs apart": { l_thigh: [0, 0, 20], r_thigh: [0, 0, -20] },
  lean: { spine1: [0, 0, 10], spine2: [0, 0, 8], head: [0, 0, -6] },
  "one arm wave": { l_upperarm: [0, 0, -72], r_upperarm: [0, 0, -120], r_forearm: [0, 0, -30] },
};

let pass = true;
for (const [name, pose] of Object.entries(CASES)) {
  const joints = poseToJoints2d(pose);
  const solved = jointsToPose2d(joints);
  let worst = 0;
  for (const key of new Set([...Object.keys(pose), ...Object.keys(solved)])) {
    const a = pose[key]?.[2] ?? 0;
    const b = solved[key]?.[2] ?? 0;
    worst = Math.max(worst, Math.abs(norm(a - b)));
  }
  const ok = worst < 1.5;
  pass = pass && ok;
  console.log(`  ${ok ? "ok" : "FAIL"} ${name} — worst Z error ${worst.toFixed(2)}°`);
}
console.log(pass ? "\nALL PASS" : "\nFAILURES");
process.exit(pass ? 0 : 1);
