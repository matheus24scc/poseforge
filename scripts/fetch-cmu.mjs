// Download the CMU BVH files the mocap manifest needs (and nothing else) into
// scripts/.cmu-cache/ (gitignored). Source: the una-dinosauria GitHub mirror of
// the cgspeed MotionBuilder-friendly conversion — free for any use, including
// commercial (CMU's release terms).
//
//   node scripts/fetch-cmu.mjs

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(await readFile(path.join(here, "mocap-manifest.json"), "utf8"));
const cacheDir = path.join(here, ".cmu-cache");
await mkdir(cacheDir, { recursive: true });

const files = [...new Set([...manifest.poses, ...manifest.clips].map((e) => e.file))];

for (const file of files) {
  const dest = path.join(cacheDir, `${file}.bvh`);
  try {
    await access(dest);
    console.log(`cached  ${file}`);
    continue;
  } catch {}
  const subject = file.split("_")[0].padStart(3, "0");
  const url = `${manifest.mirror}/${subject}/${file}.bvh`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`fetched ${file} (${(res.headers.get("content-length") / 1e6).toFixed(1)}MB)`);
}
console.log(`done — ${files.length} files in scripts/.cmu-cache/`);
