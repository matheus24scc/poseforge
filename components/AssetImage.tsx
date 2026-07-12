"use client";

import { useEffect, useState } from "react";
import { getAssetUrl } from "@/lib/assets";

export default function AssetImage({
  assetId,
  alt,
  className,
}: {
  assetId: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    // reset — the same component instance often swaps to a new version's asset
    setUrl(null);
    setMissing(false);
    getAssetUrl(assetId).then((u) => {
      if (cancelled) return;
      if (u) setUrl(u);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  if (missing) {
    return (
      <div
        className={`flex items-center justify-center text-[10px] text-neutral-600 ${className ?? ""}`}
      >
        image no longer in local storage — re-run this step
      </div>
    );
  }
  if (!url) return <div className={`animate-pulse bg-neutral-800 ${className ?? ""}`} />;
  // eslint-disable-next-line @next/next/no-img-element -- object URLs, no optimizer
  return <img src={url} alt={alt} className={className} />;
}
