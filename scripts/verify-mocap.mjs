// Verify the BVH converter end-to-end against applyPose semantics (the Node
// three.js test pattern — headless preview tabs throttle WebGL, so pose math
// is proven here, not in the browser).
//
// Ground truth: FK world orientations straight from the BVH file.
// Test: convert frames with frameToPose, apply them to a SYNTHETIC rig whose
// bind-pose bone frames are deliberately NOT world-aligned (Mixamo-style: +Y
// runs along each bone), using the exact applyPose formula from lib/pose.ts.
// Every canonical bone's resulting world delta from bind must equal the BVH's
// (up to the heading normalization and 1° rounding).
//
//   node scripts/verify-mocap.mjs [file ...]   (default: every cached file)

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { parseBvh, worldQuats, frameToPose, headingFix, CMU_TO_CANON } from "./bvh.mjs";

const DEG = 180 / Math.PI;

// --- Synthetic humanoid rig, canonical hierarchy, Mixamo-like bind frames ---
// Bone local axes are rotated so +Y points down the bone (like real rigs);
// world offsets must still land correctly — that's what world-space pose
// semantics guarantee, and what the old local-euler code got wrong.
const HIERARCHY = [
  ["hips", null, [0, 1, 0]],
  ["spine1", "hips", [0, 0.1, 0]],
  ["spine2", "spine1", [0, 0.12, 0]],
  ["spine3", "spine2", [0, 0.12, 0]],
  ["neck", "spine3", [0, 0.1, 0]],
  ["head", "neck", [0, 0.08, 0]],
  ["l_shoulder", "spine3", [0.08, 0.05, 0]],
  ["l_upperarm", "l_shoulder", [0.1, 0, 0]],
  ["l_forearm", "l_upperarm", [0.26, 0, 0]],
  ["l_hand", "l_forearm", [0.24, 0, 0]],
  ["r_shoulder", "spine3", [-0.08, 0.05, 0]],
  ["r_upperarm", "r_shoulder", [-0.1, 0, 0]],
  ["r_forearm", "r_upperarm", [-0.26, 0, 0]],
  ["r_hand", "r_forearm", [-0.24, 0, 0]],
  ["l_thigh", "hips", [0.09, -0.05, 0]],
  ["l_shin", "l_thigh", [0, -0.4, 0]],
  ["l_foot", "l_shin", [0, -0.4, 0]],
  ["r_thigh", "hips", [-0.09, -0.05, 0]],
  ["r_shin", "r_thigh", [0, -0.4, 0]],
  ["r_foot", "r_shin", [0, -0.4, 0]],
];

function buildRig() {
  const bones = new Map();
  for (const [key, parentKey, dir] of HIERARCHY) {
    const bone = new THREE.Bone();
    bone.name = key;
    // Simulate a real rig: give each bone an arbitrary-ish bind rotation
    // (aim local +Y along the bone direction), position from dir.
    const d = new THREE.Vector3(...dir).normalize();
    bone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    if (parentKey) {
      const parent = bones.get(parentKey);
      // position in parent-local space
      bone.position.copy(new THREE.Vector3(...dir)).applyQuaternion(
        parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      );
      parent.add(bone);
    } else {
      bone.position.set(...dir);
    }
    bones.set(key, bone);
  }
  const root = bones.get("hips");
  root.updateMatrixWorld(true);
  const initial = new Map();
  for (const [, b] of bones) initial.set(b.name, b.quaternion.clone());
  return { bones, initial, root };
}

// applyPose replicated verbatim from lib/pose.ts (world-space semantics):
// local_new = qParentWorld⁻¹ ⊗ R_world ⊗ qParentWorld ⊗ local_bind, parents first.
function applyPose(rig, rotations) {
  for (const [, b] of rig.bones) b.quaternion.copy(rig.initial.get(b.name));
  rig.root.updateMatrixWorld(true);
  const keys = HIERARCHY.map(([k]) => k).filter((k) => rotations[k]); // hierarchy order = parents first
  const qParent = new THREE.Quaternion();
  for (const key of keys) {
    const bone = rig.bones.get(key);
    const e = rotations[key];
    if (bone.parent && bone.parent.isBone) bone.parent.getWorldQuaternion(qParent);
    else qParent.identity();
    const qWorld = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(e[0] / DEG, e[1] / DEG, e[2] / DEG, "XYZ"),
    );
    const qLocalBind = rig.initial.get(key).clone();
    bone.quaternion.copy(qParent).invert().multiply(qWorld).multiply(qParent).multiply(qLocalBind);
    bone.updateMatrixWorld(true);
  }
}

// --- Test one file: N spread-out frames, compare world deltas ----------------
async function verifyFile(file) {
  const bvh = parseBvh(await readFile(file, "utf8"));
  const bind = worldQuats(bvh, 0);
  const rig = buildRig();
  const frameCount = bvh.frames.length;
  const testFrames = [1, 2, 5, 10].map((n) => Math.min(Math.max(1, Math.round((frameCount * n) / 10)), frameCount - 1));

  let worst = 0;
  for (const f of testFrames) {
    const yawFix = headingFix(bvh, bind, f);
    const pose = frameToPose(bvh, bind, f, yawFix);
    applyPose(rig, pose);

    const posed = worldQuats(bvh, f);
    for (let j = 0; j < bvh.joints.length; j++) {
      const key = CMU_TO_CANON[bvh.joints[j].name];
      if (!key) continue;
      // expected world delta (heading-normalized), from the BVH
      const expected = posed[j].clone().multiply(bind[j].clone().invert()).premultiply(yawFix);
      // actual world delta on the synthetic rig
      const bone = rig.bones.get(key);
      const wNow = bone.getWorldQuaternion(new THREE.Quaternion());
      // reconstruct bind world for this bone
      const chain = [];
      for (let b = bone; b && b.isBone; b = b.parent) chain.unshift(b.name);
      const wBind = new THREE.Quaternion();
      for (const name of chain) wBind.multiply(rig.initial.get(name));
      const actual = wNow.multiply(wBind.invert());
      const err = actual.angleTo(expected) * DEG;
      worst = Math.max(worst, err);
      if (err > 2.5) {
        // > rounding tolerance (20 joints × ±0.5° accumulate down the chain)
        console.error(`  FAIL ${path.basename(file)} frame ${f} ${key}: ${err.toFixed(2)}° off`);
        return false;
      }
    }
  }
  console.log(`  ok ${path.basename(file)} (worst joint error ${worst.toFixed(2)}°)`);
  return true;
}

const here = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(here, ".cmu-cache");
const args = process.argv.slice(2);
const files = args.length
  ? args
  : (await readdir(cache)).filter((f) => f.endsWith(".bvh")).map((f) => path.join(cache, f));

let pass = true;
for (const f of files) pass = (await verifyFile(f)) && pass;
console.log(pass ? "\nALL PASS" : "\nFAILURES — see above");
process.exit(pass ? 0 : 1);
