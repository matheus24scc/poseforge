import { NextResponse, type NextRequest } from "next/server";

// Stateless proxy to the Meshy API. Path-allowlisted so this can't be used as
// an open proxy; the user's key travels via the x-meshy-key header per request.

const MESHY_BASE = "https://api.meshy.ai/openapi/";
const ALLOWED_PATHS = [
  /^v1\/image-to-3d(\/[A-Za-z0-9_-]+)?$/,
  /^v1\/multi-image-to-3d(\/[A-Za-z0-9_-]+)?$/,
  /^v1\/rigging(\/[A-Za-z0-9_-]+)?$/,
];

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (!ALLOWED_PATHS.some((re) => re.test(joined))) {
    return NextResponse.json({ error: "Path not allowed" }, { status: 403 });
  }
  const apiKey = req.headers.get("x-meshy-key");
  if (!apiKey) return NextResponse.json({ error: "Missing Meshy API key" }, { status: 400 });

  const init: RequestInit = {
    method: req.method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  };
  if (req.method === "POST") init.body = await req.text();

  const res = await fetch(MESHY_BASE + joined, init);
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

export { proxy as GET, proxy as POST, proxy as DELETE };
