// Author/inspect library poses offline (same FK preview as the app). Renders a
// labelled grid to scripts/.cmu-cache/pose-lab.html. Edit SETS below, re-run,
// eyeball. Static-frame mocap poses are read from lib/mocap/pack.json by id.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { poseSvg } from "./preview.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const pack = JSON.parse(await readFile(path.join(here, "..", "lib", "mocap", "pack.json"), "utf8"));
const mocap = (id) => pack.poses.find((p) => p.id === id)?.rotations ?? {};

// Current builtins under review (mirror lib/pose.ts).
const CUR = {
  "Hands on Hips": { l_upperarm: [-15, 0, -55], r_upperarm: [-15, 0, 55], l_forearm: [0, 0, 45], r_forearm: [0, 0, -45] },
  Salute: { l_upperarm: [0, 0, -72], r_upperarm: [-30, 0, 15], r_forearm: [-10, 0, -115], spine2: [-4, 0, 0] },
  Wave: { l_upperarm: [0, 0, -72], r_upperarm: [0, 0, -50], r_forearm: [0, 0, -45], head: [0, 0, 8] },
};

// Proposed replacements — iterate here.
const NEW = {
  Shrug: {
    l_shoulder: [0, 0, 18], r_shoulder: [0, 0, -18],
    l_upperarm: [0, 0, -28], r_upperarm: [0, 0, 28],
    l_forearm: [0, 0, 62], r_forearm: [0, 0, -62],
    head: [8, 0, 0],
  },
  "Shrug B": {
    l_upperarm: [-8, 0, -42], r_upperarm: [-8, 0, 42],
    l_forearm: [0, 0, 78], r_forearm: [0, 0, -78],
    l_shoulder: [0, 0, 14], r_shoulder: [0, 0, -14],
  },
  "Wave (hi)": {
    l_upperarm: [0, 0, -72], r_upperarm: [0, 0, -120], r_forearm: [0, 0, -30], head: [0, 0, 6],
  },
};

const SETS = [
  ["Current — under review", CUR],
  ["Proposed builtins", NEW],
  ["Current mocap", {
    "Sit, Chin in Hand": mocap("cmu-sit-chin"),
    "Sit, Ankle on Knee": mocap("cmu-sit-ankle"),
    Bow: mocap("cmu-bow"),
    Kick: mocap("cmu-kick"),
  }],
];

const card = (svg, label) =>
  `<div style="display:inline-block;margin:5px;padding:8px;background:#1a1c20;border-radius:10px;text-align:center">${svg}<div style="color:#bbb;font:12px sans-serif;max-width:130px">${label}</div></div>`;

let html = `<body style="background:#0c0d10;margin:18px">`;
for (const [title, set] of SETS) {
  html += `<h3 style="color:#89a;font:14px sans-serif">${title}</h3>`;
  for (const [label, rot] of Object.entries(set)) html += card(poseSvg(rot, 22, 130), label);
}
const out = path.join(here, ".cmu-cache", "pose-lab.html");
await writeFile(out, html);
console.log(out);
