import { NextResponse, type NextRequest } from "next/server";

// Stateless proxy to the Gemini API. The user's key travels with each request
// and is never persisted here — keep this Workers-compatible (fetch only).

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "gemini-2.5-flash-image";

interface GeminiResponsePart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export async function POST(req: NextRequest) {
  let body: { apiKey?: string; model?: string; parts?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { apiKey, model = DEFAULT_MODEL, parts } = body;
  if (!apiKey) return NextResponse.json({ error: "Missing Gemini API key" }, { status: 400 });
  if (!Array.isArray(parts) || parts.length === 0) {
    return NextResponse.json({ error: "Missing parts" }, { status: 400 });
  }

  const res = await fetch(`${GEMINI_BASE}${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message ?? `Gemini error (${res.status})`;
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const outParts: GeminiResponsePart[] = data?.candidates?.[0]?.content?.parts ?? [];
  const images = outParts
    .filter((p) => p.inlineData)
    .map((p) => ({ mimeType: p.inlineData!.mimeType, data: p.inlineData!.data }));
  const text =
    outParts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join("\n") || null;

  return NextResponse.json({ images, text });
}
