// BVH → poseforge canonical poses (offline tooling; not shipped to the client).
//
// Works on the cgspeed "MotionBuilder-friendly" conversion of the CMU mocap
// database: every file's FIRST frame is a T-pose facing +Z, which matches the
// canonical world frame poses are authored in (character faces +Z, +Y up,
// +X = character's left). See lib/pose.ts for the applyPose semantics.
//
// The trick that makes conversion rig-independent: applyPose applies, per
// canonical joint, a world-frame rotation ON TOP of the already-posed parent
// chain. For a target rig posed so every canonical joint's total world delta
// from bind equals the BVH's, the required offset is
//     R_joint = W_joint ⊗ W_nearestMappedAncestor⁻¹
// where W = worldQuat(frame) ⊗ worldQuat(tpose)⁻¹. No target bind frames
// appear in the formula, so one conversion serves Meshy/Mixamo/anything.
// Unmapped intermediate CMU joints (LHipJoint, LowerBack, Neck, …) fold into
// their nearest mapped descendant via world composition.

import * as THREE from "three";

// Explicit CMU(MotionBuilder-names) → CanonKey map. Kept in the converter, not
// runtime (per ROADMAP): different BVH conversions rename joints; extend here.
export const CMU_TO_CANON = {
  Hips: "hips",
  LowerBack: "spine1",
  Spine: "spine2",
  Spine1: "spine3",
  Neck1: "neck",
  Head: "head",
  LeftShoulder: "l_shoulder",
  LeftArm: "l_upperarm",
  LeftForeArm: "l_forearm",
  LeftHand: "l_hand",
  RightShoulder: "r_shoulder",
  RightArm: "r_upperarm",
  RightForeArm: "r_forearm",
  RightHand: "r_hand",
  LeftUpLeg: "l_thigh",
  LeftLeg: "l_shin",
  LeftFoot: "l_foot",
  RightUpLeg: "r_thigh",
  RightLeg: "r_shin",
  RightFoot: "r_foot",
};

const DEG = 180 / Math.PI;

/** Parse a BVH file into { joints, frames, frameTime }. Each joint:
 * { name, parent(index|-1), channels: string[], channelOffset }. Frames are
 * flat float arrays in channel order. */
export function parseBvh(text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  let i = 0;
  const next = () => tokens[i++];
  const expect = (t) => {
    const got = next();
    if (got !== t) throw new Error(`BVH parse: expected ${t}, got ${got}`);
  };

  const joints = [];
  let channelCount = 0;

  const parseJoint = (parent) => {
    const kind = next(); // ROOT | JOINT | End
    if (kind === "End") {
      expect("Site");
      expect("{");
      expect("OFFSET");
      next(); next(); next();
      expect("}");
      return;
    }
    const name = next();
    const index = joints.length;
    const joint = { name, parent, channels: [], channelOffset: channelCount };
    joints.push(joint);
    expect("{");
    expect("OFFSET");
    joint.offset = [Number(next()), Number(next()), Number(next())];
    expect("CHANNELS");
    const n = Number(next());
    for (let c = 0; c < n; c++) joint.channels.push(next());
    channelCount += n;
    while (tokens[i] === "JOINT" || tokens[i] === "End") parseJoint(index);
    expect("}");
  };

  expect("HIERARCHY");
  parseJoint(-1);
  expect("MOTION");
  expect("Frames:");
  const frameCount = Number(next());
  expect("Frame");
  expect("Time:");
  const frameTime = Number(next());
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const frame = new Float64Array(channelCount);
    for (let c = 0; c < channelCount; c++) frame[c] = Number(next());
    frames.push(frame);
  }
  return { joints, frames, frameTime };
}

const AXES = {
  Xrotation: new THREE.Vector3(1, 0, 0),
  Yrotation: new THREE.Vector3(0, 1, 0),
  Zrotation: new THREE.Vector3(0, 0, 1),
};

/** Local quaternion of one joint in one frame: channel rotations compose in
 * listed order (first channel outermost), the standard BVH convention. */
function localQuat(joint, frame) {
  const q = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  for (let c = 0; c < joint.channels.length; c++) {
    const ch = joint.channels[c];
    const axis = AXES[ch];
    if (!axis) continue; // position channel
    step.setFromAxisAngle(axis, frame[joint.channelOffset + c] / DEG);
    q.multiply(step);
  }
  return q;
}

/** World quaternions for all joints in one frame. */
export function worldQuats(bvh, frameIndex) {
  const frame = bvh.frames[frameIndex];
  const world = [];
  for (let j = 0; j < bvh.joints.length; j++) {
    const joint = bvh.joints[j];
    const q = localQuat(joint, frame);
    world[j] = joint.parent >= 0 ? world[joint.parent].clone().multiply(q) : q;
  }
  return world;
}

/** Per-joint world deltas from the T-pose frame, optionally heading-normalized
 * so the character faces +Z at `frameIndex` (or at yawFrom, for clips that
 * should keep in-clip turning). */
function worldDeltas(bvh, bindWorld, frameIndex, yawFix) {
  const posed = worldQuats(bvh, frameIndex);
  return bvh.joints.map((_, j) => {
    const w = posed[j].clone().multiply(bindWorld[j].clone().invert());
    if (yawFix) w.premultiply(yawFix);
    return w;
  });
}

/** Y-rotation that turns the hips' posed heading back to +Z. */
export function headingFix(bvh, bindWorld, frameIndex) {
  const hips = bvh.joints.findIndex((j) => CMU_TO_CANON[j.name] === "hips");
  const w = worldQuats(bvh, frameIndex)[hips]
    .clone()
    .multiply(bindWorld[hips].clone().invert());
  let dir = new THREE.Vector3(0, 0, 1).applyQuaternion(w);
  if (Math.hypot(dir.x, dir.z) < 0.3) {
    // lying/bent flat: use the body up-axis as heading instead
    dir = new THREE.Vector3(0, 1, 0).applyQuaternion(w);
    if (Math.hypot(dir.x, dir.z) < 0.3) return new THREE.Quaternion();
  }
  const yaw = Math.atan2(dir.x, dir.z);
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
}

/** Extract one frame as canonical PoseRotations (world-space offsets, degrees,
 * XYZ euler — exactly what lib/pose.ts applyPose consumes). */
export function frameToPose(bvh, bindWorld, frameIndex, yawFix) {
  const deltas = worldDeltas(bvh, bindWorld, frameIndex, yawFix);
  // nearest mapped ancestor per joint, on the BVH hierarchy
  const rotations = {};
  const e = new THREE.Euler();
  for (let j = 0; j < bvh.joints.length; j++) {
    const key = CMU_TO_CANON[bvh.joints[j].name];
    if (!key) continue;
    let a = bvh.joints[j].parent;
    while (a >= 0 && !CMU_TO_CANON[bvh.joints[a].name]) a = bvh.joints[a].parent;
    const r = a >= 0 ? deltas[j].clone().multiply(deltas[a].clone().invert()) : deltas[j].clone();
    e.setFromQuaternion(r, "XYZ");
    const deg = [Math.round(e.x * DEG), Math.round(e.y * DEG), Math.round(e.z * DEG)];
    if (deg[0] || deg[1] || deg[2]) rotations[key] = deg;
  }
  return rotations;
}

/** Frame index for a time in seconds of motion (frame 0 is the injected
 * T-pose; motion starts at frame 1). */
export function frameAt(bvh, seconds) {
  const f = 1 + Math.round(seconds / bvh.frameTime);
  return Math.min(Math.max(f, 1), bvh.frames.length - 1);
}

/** Sample a static pose at `seconds` into the motion, heading-normalized. */
export function samplePose(bvh, seconds) {
  const bind = worldQuats(bvh, 0);
  const f = frameAt(bvh, seconds);
  return frameToPose(bvh, bind, f, headingFix(bvh, bind, f));
}

/** Sample a clip [start, end] at `step` intervals into {time, rotations}[],
 * times rebased to 0. Heading normalized once, at the start frame, so turns
 * within the clip survive. */
export function sampleClip(bvh, start, end, step = 0.5) {
  const bind = worldQuats(bvh, 0);
  const yawFix = headingFix(bvh, bind, frameAt(bvh, start));
  const frames = [];
  for (let t = start; t <= end + 1e-9; t += step) {
    frames.push({
      time: Math.round((t - start) * 10) / 10,
      rotations: frameToPose(bvh, bind, frameAt(bvh, t), yawFix),
    });
  }
  return frames;
}

/** Motion duration in seconds (excluding the injected T-pose frame). */
export function motionDuration(bvh) {
  return (bvh.frames.length - 2) * bvh.frameTime;
}
