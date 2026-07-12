// Build lib/mocap/pack.json from the curated manifest (run fetch-cmu.mjs
// first), plus an HTML contact sheet for eyeballing the result.
//
//   node scripts/build-mocap-pack.mjs                 build pack + contact sheet
//   node scripts/build-mocap-pack.mjs --explore 13_29 sample one file every 0.5s
//                                                     (pick pose times visually)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseBvh, samplePose, sampleClip, motionDuration } from "./bvh.mjs";
import { poseSvg } from "./preview.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(here, ".cmu-cache");

const loadBvh = async (file) => parseBvh(await readFile(path.join(cache, `${file}.bvh`), "utf8"));

const card = (svg, label) =>
  `<div style="display:inline-block;margin:4px;padding:6px;background:#1a1c20;border-radius:8px;text-align:center">${svg}<div style="color:#aaa;font:11px sans-serif;max-width:120px">${label}</div></div>`;

const sheet = (title, cards) =>
  `<body style="background:#0c0d10;margin:16px"><h2 style="color:#ddd;font:16px sans-serif">${title}</h2>${cards}</body>`;

// --- explore mode -------------------------------------------------------------
const exploreIdx = process.argv.indexOf("--explore");
if (exploreIdx > -1) {
  const file = process.argv[exploreIdx + 1];
  const step = Number(process.argv[exploreIdx + 2] ?? 0.5);
  const bvh = await loadBvh(file);
  const dur = motionDuration(bvh);
  let cards = "";
  for (let t = 0; t <= dur; t += step) {
    cards += card(poseSvg(samplePose(bvh, t)), `t=${t.toFixed(1)}s`);
  }
  const out = path.join(cache, `explore-${file}.html`);
  await writeFile(out, sheet(`${file} — ${dur.toFixed(1)}s`, cards));
  console.log(out);
  process.exit(0);
}

// --- build mode ---------------------------------------------------------------
const manifest = JSON.parse(await readFile(path.join(here, "mocap-manifest.json"), "utf8"));
const bvhs = new Map();
for (const entry of [...manifest.poses, ...manifest.clips]) {
  if (!bvhs.has(entry.file)) bvhs.set(entry.file, await loadBvh(entry.file));
}

const poses = manifest.poses.map((p) => ({
  id: p.id,
  name: p.name,
  section: p.section,
  tags: p.tags,
  rotations: samplePose(bvhs.get(p.file), p.t),
}));

const clips = manifest.clips.map((c) => {
  const frames = sampleClip(bvhs.get(c.file), c.start, c.end, c.step);
  return {
    id: c.id,
    name: c.name,
    tags: c.tags,
    duration: frames[frames.length - 1].time,
    frames,
  };
});

await mkdir(path.join(here, "..", "lib", "mocap"), { recursive: true });
const packPath = path.join(here, "..", "lib", "mocap", "pack.json");
await writeFile(packPath, JSON.stringify({ poses, clips }, null, 1));

let cards = "<h3 style='color:#889;font:13px sans-serif'>Poses</h3>";
for (const p of poses) cards += card(poseSvg(p.rotations), `${p.name} (${p.section})`);
for (const c of clips) {
  cards += `<h3 style='color:#889;font:13px sans-serif'>Clip: ${c.name} (${c.duration}s, ${c.frames.length} frames)</h3>`;
  for (const f of c.frames) cards += card(poseSvg(f.rotations), `${f.time}s`);
}
const sheetPath = path.join(cache, "pack-contact-sheet.html");
await writeFile(sheetPath, sheet("Mocap pack", cards));

const kb = (JSON.stringify({ poses, clips }).length / 1024).toFixed(0);
console.log(`${packPath} — ${poses.length} poses, ${clips.length} clips, ${kb}KB`);
console.log(sheetPath);
