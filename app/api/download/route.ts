import { NextResponse, type NextRequest } from "next/server";

// Download proxy for provider-hosted result files (Meshy's presigned asset
// URLs don't allow browser CORS). Host-allowlisted — tighten further before
// any hosted deploy.

const ALLOWED_HOSTS = (host: string) => host === "meshy.ai" || host.endsWith(".meshy.ai");

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing url param" }, { status: 400 });
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS(parsed.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }
  const res = await fetch(parsed);
  if (!res.ok) {
    return NextResponse.json({ error: `Upstream error (${res.status})` }, { status: 502 });
  }
  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": "no-store",
    },
  });
}
