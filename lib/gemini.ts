// Client for our Gemini proxy route. The key travels per-request and is never
// persisted server-side (the route is a stateless, Workers-compatible proxy).

export const NANO_BANANA_MODEL = "gemini-2.5-flash-image";

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiImageResult {
  images: { mimeType: string; data: string }[];
  text: string | null;
}

export async function geminiGenerate(
  apiKey: string,
  parts: GeminiPart[],
  model: string = NANO_BANANA_MODEL,
): Promise<GeminiImageResult> {
  const res = await fetch("/api/gemini/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, model, parts }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `Gemini request failed (${res.status})`);
  }
  return data as GeminiImageResult;
}

export async function geminiGenerateImage(
  apiKey: string,
  parts: GeminiPart[],
): Promise<GeminiImageResult> {
  const result = await geminiGenerate(apiKey, parts);
  if (!result.images.length) {
    throw new Error(
      result.text
        ? `Model returned no image. Model said: ${result.text.slice(0, 300)}`
        : "Model returned no image",
    );
  }
  return result;
}
