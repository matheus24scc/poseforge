import { NextResponse, type NextRequest } from "next/server";

// Downloads a generated video file from the Gemini files API (the returned
// URIs require the API key header, so the browser can't fetch them directly).

export async function GET(req: NextRequest) {
  const uri = req.nextUrl.searchParams.get("uri");
  const apiKey = req.headers.get("x-gemini-key");
  if (!uri) return NextResponse.json({ error: "Missing uri" }, { status: 400 });
  if (!apiKey) return NextResponse.json({ error: "Missing Gemini API key" }, { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return NextResponse.json({ error: "Invalid uri" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "generativelanguage.googleapis.com") {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }
  const res = await fetch(parsed, { headers: { "x-goog-api-key": apiKey } });
  if (!res.ok) {
    return NextResponse.json({ error: `Upstream error (${res.status})` }, { status: 502 });
  }
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "video/mp4",
      "Cache-Control": "no-store",
    },
  });
}
