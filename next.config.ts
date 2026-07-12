import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Provider payloads (base64 images in JSON bodies) can exceed the default
  // server actions limit; we use plain route handlers, so nothing needed yet.
  // Keep this file free of Node-only config — must stay Workers-compatible.
};

export default nextConfig;
