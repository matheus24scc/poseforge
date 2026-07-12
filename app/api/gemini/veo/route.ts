import { NextResponse, type NextRequest } from "next/server";

// Starts a Veo long-running video generation. Stateless proxy — instances/
// parameters pass through verbatim so frame-field tweaks stay client-side.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "veo-3.1-generate-preview";

export async function POST(req: NextRequest) {
  let body: { apiKey?: string; model?: string; instances?: unknown; parameters?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { apiKey, model = DEFAULT_MODEL, instances, parameters } = body;
  if (!apiKey) return NextResponse.json({ error: "Missing Gemini API key" }, { status: 400 });
  if (!instances) return NextResponse.json({ error: "Missing instances" }, { status: 400 });

  const res = await fetch(`${GEMINI_BASE}${encodeURIComponent(model)}:predictLongRunning`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ instances, parameters }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json(
      { error: data?.error?.message ?? `Veo error (${res.status})` },
      { status: res.status },
    );
  }
  return NextResponse.json(data); // { name: "models/.../operations/..." }
}
