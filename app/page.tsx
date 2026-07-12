"use client";

import dynamic from "next/dynamic";

// The whole workspace is client-only: Dexie/OPFS/three.js all need the browser.
const Workspace = dynamic(() => import("@/components/Workspace"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
      Loading Poseforge…
    </div>
  ),
});

export default function Home() {
  return <Workspace />;
}
