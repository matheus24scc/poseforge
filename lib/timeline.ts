import { db, type Keyframe, type PoseRotations, type TimelineRow } from "./db";

// Timeline CRUD. One timeline per character (id === characterId); keyframes
// stay sorted by time; segment results are keyed by keyframe-id pair so they
// survive time nudges but invalidate naturally if a keyframe is deleted.

export function segmentKey(fromId: string, toId: string): string {
  return `${fromId}:${toId}`;
}

export async function getTimeline(characterId: string): Promise<TimelineRow> {
  const existing = await db.timelines.get(characterId);
  if (existing) return existing;
  const row: TimelineRow = {
    id: characterId,
    characterId,
    keyframes: [],
    segments: {},
    updatedAt: Date.now(),
  };
  await db.timelines.put(row);
  return row;
}

async function mutate(characterId: string, fn: (t: TimelineRow) => void): Promise<TimelineRow> {
  const t = await getTimeline(characterId);
  fn(t);
  t.keyframes.sort((a, b) => a.time - b.time);
  t.updatedAt = Date.now();
  await db.timelines.put(t);
  return t;
}

export async function addKeyframe(
  characterId: string,
  time: number,
  rotations: PoseRotations,
): Promise<Keyframe> {
  const kf: Keyframe = { id: crypto.randomUUID(), time: Math.max(0, time), rotations };
  await mutate(characterId, (t) => t.keyframes.push(kf));
  return kf;
}

/** Insert a clip (batch of keyframes) starting at `startTime`. Existing
 * keyframes at/after the insertion point shift right by the clip's length plus
 * a gap, so nothing is clobbered — classic track-insert semantics. */
export async function insertClip(
  characterId: string,
  startTime: number,
  frames: { time: number; rotations: PoseRotations }[],
): Promise<Keyframe[]> {
  const GAP = 0.5;
  const t0 = Math.max(0, Math.round(startTime * 10) / 10);
  const duration = frames.length ? frames[frames.length - 1].time : 0;
  const added = frames.map((f) => ({
    id: crypto.randomUUID(),
    time: Math.round((t0 + f.time) * 10) / 10,
    rotations: f.rotations,
  }));
  await mutate(characterId, (t) => {
    for (const kf of t.keyframes) {
      if (kf.time >= t0) kf.time = Math.round((kf.time + duration + GAP) * 10) / 10;
    }
    t.keyframes.push(...added);
  });
  return added;
}

export async function updateKeyframe(
  characterId: string,
  keyframeId: string,
  patch: Partial<Keyframe>,
): Promise<void> {
  await mutate(characterId, (t) => {
    const kf = t.keyframes.find((k) => k.id === keyframeId);
    if (kf) Object.assign(kf, patch, { id: kf.id });
  });
}

export async function deleteKeyframe(characterId: string, keyframeId: string): Promise<void> {
  await mutate(characterId, (t) => {
    t.keyframes = t.keyframes.filter((k) => k.id !== keyframeId);
    for (const key of Object.keys(t.segments)) {
      if (key.includes(keyframeId)) delete t.segments[key];
    }
  });
}

export async function setSegment(
  characterId: string,
  key: string,
  patch: { prompt?: string; videoAssetId?: string; trimStart?: number; trimEnd?: number },
): Promise<void> {
  await mutate(characterId, (t) => {
    t.segments[key] = { ...t.segments[key], ...patch, createdAt: Date.now() };
  });
}
