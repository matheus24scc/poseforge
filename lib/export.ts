import type { FFmpeg } from "@ffmpeg/ffmpeg";
import type { SegmentInfo } from "./db";
import { getTimeline, segmentKey } from "./timeline";
import { getAssetBlob } from "./assets";

// Client-side timeline → single stitched MP4 via ffmpeg.wasm. The core is
// ~30MB, single-threaded (no SharedArrayBuffer / COOP-COEP headers needed) and
// lazy-loaded from CDN on first export only — it is NEVER imported server-side
// (would break the Workers-compatible API routes). Blobs stay client-side.

const CORE_VERSION = "0.12.10";
const CORE_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`;

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFfmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ffmpeg = new FFmpeg();
      if (onLog) ffmpeg.on("log", ({ message }) => onLog(message));
      await ffmpeg.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ffmpeg;
    })().catch((e) => {
      ffmpegPromise = null; // allow retry after a failed load
      throw e;
    });
  }
  return ffmpegPromise;
}

export interface ExportProgress {
  phase: "loading" | "trimming" | "stitching" | "done";
  /** 0..1 within the current phase, when known */
  fraction?: number;
  /** e.g. "clip 2 / 4" */
  detail?: string;
}

interface OrderedSegment {
  key: string;
  info: SegmentInfo;
}

// ffmpeg.readFile() types its bytes as possibly SharedArrayBuffer-backed; copy
// into a plain ArrayBuffer-backed view the Blob constructor accepts.
function toMp4Blob(data: unknown): Blob {
  const src = data as Uint8Array;
  const copy = new Uint8Array(src.length);
  copy.set(src);
  return new Blob([copy], { type: "video/mp4" });
}

/** Segments that have a generated clip, in keyframe (timeline) order. */
export async function exportableSegments(characterId: string): Promise<OrderedSegment[]> {
  const t = await getTimeline(characterId);
  const out: OrderedSegment[] = [];
  for (let i = 0; i < t.keyframes.length - 1; i++) {
    const key = segmentKey(t.keyframes[i].id, t.keyframes[i + 1].id);
    const info = t.segments[key];
    if (info?.videoAssetId) out.push({ key, info });
  }
  return out;
}

export interface ClipInput {
  blob: Blob;
  trimStart?: number;
  trimEnd?: number;
}

/** Stitch the character's clip segments into one MP4 (keyframe order, trims
 * applied). */
export async function stitchTimeline(
  characterId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  const segments = await exportableSegments(characterId);
  if (segments.length === 0) throw new Error("No generated clips to export.");
  const clips: ClipInput[] = [];
  for (let i = 0; i < segments.length; i++) {
    const blob = await getAssetBlob(segments[i].info.videoAssetId!);
    if (!blob) throw new Error(`Clip ${i + 1} is missing from the local store.`);
    clips.push({ blob, trimStart: segments[i].info.trimStart, trimEnd: segments[i].info.trimEnd });
  }
  return stitchClips(clips, onProgress);
}

/** Concatenate clips into one MP4. Fast path (concat demuxer, no re-encode)
 * when nothing is trimmed — valid because every clip is uniform Veo output;
 * otherwise re-encode each clip (applying trim) so the concatenated streams
 * share codec params and the final concat can stream-copy. */
export async function stitchClips(
  clips: ClipInput[],
  onProgress?: (p: ExportProgress) => void,
): Promise<Blob> {
  if (clips.length === 0) throw new Error("No clips to stitch.");

  onProgress?.({ phase: "loading" });
  const ffmpeg = await getFfmpeg();

  // Load every source clip into the wasm FS.
  const inputs: string[] = [];
  for (let i = 0; i < clips.length; i++) {
    const name = `in${i}.mp4`;
    await ffmpeg.writeFile(name, new Uint8Array(await clips[i].blob.arrayBuffer()));
    inputs.push(name);
  }

  const anyTrim = clips.some((c) => c.trimStart != null || c.trimEnd != null);
  let concatList: string[];

  if (!anyTrim && clips.length > 1) {
    // Fast path: no re-encode, just concatenate the originals.
    concatList = inputs;
    onProgress?.({ phase: "stitching" });
  } else if (!anyTrim && clips.length === 1) {
    // Single untrimmed clip — return it as-is.
    onProgress?.({ phase: "done" });
    const data = await ffmpeg.readFile("in0.mp4");
    await cleanup(ffmpeg, inputs, []);
    return toMp4Blob(data);
  } else {
    // Re-encode each clip (applying trim) to uniform params.
    concatList = [];
    for (let i = 0; i < clips.length; i++) {
      onProgress?.({ phase: "trimming", detail: `clip ${i + 1} / ${clips.length}` });
      const { trimStart, trimEnd } = clips[i];
      const out = `seg${i}.mp4`;
      const args: string[] = [];
      if (trimStart != null) args.push("-ss", String(trimStart));
      args.push("-i", inputs[i]);
      if (trimEnd != null) args.push("-t", String((trimEnd - (trimStart ?? 0)).toFixed(3)));
      args.push(
        "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-r", "30", "-vf", "setsar=1", "-video_track_timescale", "30000",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        out,
      );
      await ffmpeg.exec(args);
      concatList.push(out);
    }
  }

  onProgress?.({ phase: "stitching" });
  const listName = "concat.txt";
  await ffmpeg.writeFile(
    listName,
    new TextEncoder().encode(concatList.map((f) => `file '${f}'`).join("\n")),
  );
  await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "out.mp4"]);
  const data = await ffmpeg.readFile("out.mp4");

  onProgress?.({ phase: "done" });
  await cleanup(ffmpeg, inputs, [...concatList, listName, "out.mp4"]);
  return toMp4Blob(data);
}

async function cleanup(ffmpeg: FFmpeg, inputs: string[], intermediates: string[]): Promise<void> {
  for (const f of [...inputs, ...intermediates]) {
    try {
      await ffmpeg.deleteFile(f);
    } catch {
      /* best-effort */
    }
  }
}
