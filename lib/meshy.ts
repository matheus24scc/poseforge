// Client for our Meshy proxy routes. Meshy tasks are async (submit → task id →
// poll); the provider keeps working across reloads, which is what makes jobs
// resumable via the persisted providerTaskId.

export type MeshyTaskKind = "image-to-3d" | "multi-image-to-3d" | "rigging";

export type MeshyStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface MeshyTask {
  id: string;
  status: MeshyStatus;
  progress?: number;
  model_urls?: Record<string, string | undefined>;
  result?: {
    rigged_character_glb_url?: string;
    rigged_character_fbx_url?: string;
    basic_animations?: Record<string, unknown>;
  };
  task_error?: { message?: string } | null;
}

async function meshyFetch(apiKey: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/meshy/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-meshy-key": apiKey,
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (data as { message?: string; error?: string } | null)?.message ??
      (data as { error?: string } | null)?.error ??
      `Meshy request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}

export async function createImageTo3d(apiKey: string, imageDataUri: string): Promise<string> {
  const data = (await meshyFetch(apiKey, "v1/image-to-3d", {
    method: "POST",
    body: JSON.stringify({
      image_url: imageDataUri,
      should_texture: true,
      should_remesh: true,
      target_polycount: 30000,
      target_formats: ["glb"],
    }),
  })) as { result: string };
  return data.result;
}

export async function createMultiImageTo3d(
  apiKey: string,
  imageDataUris: string[],
): Promise<string> {
  const data = (await meshyFetch(apiKey, "v1/multi-image-to-3d", {
    method: "POST",
    body: JSON.stringify({
      image_urls: imageDataUris.slice(0, 4),
      should_texture: true,
      should_remesh: true,
      target_polycount: 30000,
      target_formats: ["glb"],
    }),
  })) as { result: string };
  return data.result;
}

export async function createRigging(
  apiKey: string,
  input: { inputTaskId?: string; modelUrl?: string },
  heightMeters = 1.7,
): Promise<string> {
  const body: Record<string, unknown> = { height_meters: heightMeters };
  if (input.inputTaskId) body.input_task_id = input.inputTaskId;
  else if (input.modelUrl) body.model_url = input.modelUrl;
  else throw new Error("createRigging needs a task id or model url");
  const data = (await meshyFetch(apiKey, "v1/rigging", {
    method: "POST",
    body: JSON.stringify(body),
  })) as { result: string };
  return data.result;
}

export async function getTask(
  apiKey: string,
  kind: MeshyTaskKind,
  taskId: string,
): Promise<MeshyTask> {
  return (await meshyFetch(apiKey, `v1/${kind}/${taskId}`)) as MeshyTask;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollTask(
  apiKey: string,
  kind: MeshyTaskKind,
  taskId: string,
  onProgress?: (progress: number) => void,
  { intervalMs = 5000, timeoutMs = 30 * 60_000 } = {},
): Promise<MeshyTask> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = await getTask(apiKey, kind, taskId);
    if (typeof task.progress === "number") onProgress?.(task.progress);
    if (task.status === "SUCCEEDED") return task;
    if (task.status === "FAILED" || task.status === "CANCELED") {
      throw new Error(task.task_error?.message ?? `Meshy task ${task.status.toLowerCase()}`);
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for Meshy task");
    await sleep(intervalMs);
  }
}

// Meshy asset URLs (assets.meshy.ai, presigned) don't allow browser CORS, so
// downloads go through our proxy route.
export async function downloadModel(url: string): Promise<Blob> {
  const res = await fetch(`/api/download?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  return res.blob();
}
