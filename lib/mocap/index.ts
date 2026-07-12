import type { PoseRotations } from "../db";
import pack from "./pack.json";

// Curated CMU motion-capture starter pack (see scripts/mocap-manifest.json for
// provenance and scripts/build-mocap-pack.mjs to regenerate). Same rotation
// semantics as every pose: world-space offsets from T-pose, degrees, XYZ.
// CMU mocap data is free for any use including commercial.

export interface MocapPose {
  id: string;
  name: string;
  section: "stance" | "action";
  tags: string[];
  rotations: PoseRotations;
}

export interface MocapClipFrame {
  time: number;
  rotations: PoseRotations;
}

export interface MocapClip {
  id: string;
  name: string;
  tags: string[];
  /** seconds, last frame time (frames start at 0) */
  duration: number;
  frames: MocapClipFrame[];
}

// JSON infers rotation triples as number[]; the build script guarantees tuples.
export const MOCAP_POSES = pack.poses as unknown as MocapPose[];
export const MOCAP_CLIPS = pack.clips as unknown as MocapClip[];
