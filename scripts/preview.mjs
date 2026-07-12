// Stick-figure SVG rendering for offline curation contact sheets.
// Port of computePosePreview from lib/pose.ts (keep the CANON table and the
// premultiplied world-rotation FK in sync with it).

import * as THREE from "three";

const D = Math.PI / 180;

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

const SEGMENTS = [
  ["hips", "spine1"], ["spine1", "spine2"], ["spine2", "spine3"], ["spine3", "neck"],
  ["neck", "head"], ["spine3", "l_shoulder"], ["l_shoulder", "l_upperarm"],
  ["l_upperarm", "l_forearm"], ["l_forearm", "l_hand"], ["spine3", "r_shoulder"],
  ["r_shoulder", "r_upperarm"], ["r_upperarm", "r_forearm"], ["r_forearm", "r_hand"],
  ["hips", "l_thigh"], ["l_thigh", "l_shin"], ["l_shin", "l_foot"],
  ["hips", "r_thigh"], ["r_thigh", "r_shin"], ["r_shin", "r_foot"],
];

export function poseSvg(rotations, yawDeg = 22, size = 120) {
  const world = new Map();
  world.set("__root", { pos: new THREE.Vector3(), rot: new THREE.Quaternion() });
  for (const joint of CANON) {
    const parent = joint.parent ? world.get(joint.parent) : world.get("__root");
    const offset = new THREE.Vector3(...joint.offset).applyQuaternion(parent.rot);
    const pos = parent.pos.clone().add(offset);
    const rot = parent.rot.clone();
    const r = rotations[joint.key];
    if (r) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0] * D, r[1] * D, r[2] * D, "XYZ"));
      rot.premultiply(q);
    }
    world.set(joint.key, { pos, rot });
  }
  const yaw = yawDeg * D;
  const pts = new Map();
  for (const [key, { pos }] of world) {
    if (key === "__root") continue;
    pts.set(key, [pos.x * Math.cos(yaw) - pos.z * Math.sin(yaw), pos.y]);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts.values()) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY, 0.01) * 1.25;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const s = ([x, y]) => [50 + ((x - cx) / span) * 100, 50 - ((y - cy) / span) * 100];

  let body = "";
  for (const [a, b] of SEGMENTS) {
    const [x1, y1] = s(pts.get(a));
    const [x2, y2] = s(pts.get(b));
    body += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#9dd" stroke-width="3.5" stroke-linecap="round"/>`;
  }
  const ht = s(pts.get("head_top")), nk = s(pts.get("head"));
  const r = Math.max(4, Math.hypot(ht[0] - nk[0], ht[1] - nk[1]) / 1.6);
  body += `<circle cx="${((ht[0] + nk[0]) / 2).toFixed(1)}" cy="${((ht[1] + nk[1]) / 2).toFixed(1)}" r="${r.toFixed(1)}" fill="#9dd"/>`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
