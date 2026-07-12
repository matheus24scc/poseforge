import type { InlineData } from "./assets";

// Veo (Gemini API) client: start a long-running generation, poll the
// operation, download the result. Operation names persist in job records so
// generations survive reloads exactly like Meshy tasks do.

// Latest Veo with first/last-frame interpolation (checked 2026-07-07; Veo 3.0
// is deprecated, Gemini Omni Flash lacks last-frame control).
export const VEO_MODEL = "veo-3.1-generate-preview";
export const VEO_MODEL_FAST = "veo-3.1-fast-generate-preview";

interface VeoOperation {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: {
      generatedSamples?: { video?: { uri?: string } }[];
      raiMediaFilteredCount?: number;
      raiMediaFilteredReasons?: string[];
    };
  };
}

// Docs and SDK examples disagree on the frame-image encoding, so try each
// known shape in order — a wrong shape 400s instantly and bills nothing.
const FRAME_SHAPES: ((f: InlineData) => unknown)[] = [
  (f) => ({ inlineData: { mimeType: f.mimeType, data: f.data } }),
  (f) => ({ imageBytes: f.data, mimeType: f.mimeType }),
  (f) => ({ bytesBase64Encoded: f.data, mimeType: f.mimeType }),
];

export async function startVeo(
  apiKey: string,
  input: { prompt: string; firstFrame: InlineData; lastFrame?: InlineData; model?: string },
): Promise<string /* operation name */> {
  let lastError = "Veo request failed";
  for (const shape of FRAME_SHAPES) {
    const instance: Record<string, unknown> = {
      prompt: input.prompt,
      image: shape(input.firstFrame),
    };
    if (input.lastFrame) instance.lastFrame = shape(input.lastFrame);
    const res = await fetch("/api/gemini/veo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        model: input.model ?? VEO_MODEL,
        instances: [instance],
        parameters: { aspectRatio: "16:9", resolution: "720p" },
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.name) return data.name as string;
    lastError = data?.error ?? `Veo request failed (${res.status})`;
    // Only retry with another shape on schema-style rejections.
    if (res.status !== 400) break;
  }
  throw new Error(lastError);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function pollVeo(
  apiKey: string,
  operationName: string,
  { intervalMs = 8000, timeoutMs = 15 * 60_000 } = {},
): Promise<string /* video uri */> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`/api/gemini/operation?name=${encodeURIComponent(operationName)}`, {
      headers: { "x-gemini-key": apiKey },
    });
    const op = (await res.json().catch(() => null)) as VeoOperation | null;
    if (!res.ok || !op) {
      throw new Error((op as { error?: string } | null)?.error?.toString() ?? "Operation poll failed");
    }
    if (op.done) {
      if (op.error?.message) throw new Error(op.error.message);
      const gvr = op.response?.generateVideoResponse;
      const uri = gvr?.generatedSamples?.[0]?.video?.uri;
      if (!uri) {
        const reason = gvr?.raiMediaFilteredReasons?.[0];
        throw new Error(reason ?? "Veo finished but returned no video (possibly safety-filtered)");
      }
      return uri;
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for Veo");
    await sleep(intervalMs);
  }
}

export async function downloadVeoVideo(apiKey: string, uri: string): Promise<Blob> {
  const res = await fetch(`/api/gemini/file?uri=${encodeURIComponent(uri)}`, {
    headers: { "x-gemini-key": apiKey },
  });
  if (!res.ok) throw new Error(`Video download failed (${res.status})`);
  return res.blob();
}
