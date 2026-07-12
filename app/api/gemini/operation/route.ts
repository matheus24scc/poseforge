import { NextResponse, type NextRequest } from "next/server";

// Polls a Gemini long-running operation (Veo). Key travels via header.

export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name");
  const apiKey = req.headers.get("x-gemini-key");
  if (!name) return NextResponse.json({ error: "Missing operation name" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "Missing Gemini API key" }, { status: 400 });
  if (!/^[\w./-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid operation name" }, { status: 400 });
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}`, {
    headers: { "x-goog-api-key": apiKey },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return NextResponse.json(
      { error: data?.error?.message ?? `Operation poll failed (${res.status})` },
      { status: res.status },
    );
  }
  return NextResponse.json(data);
}
