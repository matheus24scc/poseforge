"use client";

import { useEffect, useRef, useState } from "react";
import { useDialogStore } from "@/lib/dialog";

export default function AppDialog() {
  const request = useDialogStore((s) => s.request);
  const setRequest = useDialogStore((s) => s.setRequest);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (request) {
      setValue(request.defaultValue ?? "");
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [request]);

  if (!request) return null;

  const answer = (v: string | null | boolean) => {
    request.resolve(v);
    setRequest(null);
  };
  const cancel = () => answer(request.mode === "prompt" ? null : false);
  const ok = () => answer(request.mode === "prompt" ? value : true);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={cancel}>
      <div
        className="w-96 rounded-[14px] border border-[var(--pf-edge)] bg-neutral-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm text-neutral-200">{request.title}</div>
        {request.mode === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") ok();
              if (e.key === "Escape") cancel();
            }}
            className="mb-3 w-full rounded-lg bg-neutral-800 px-2.5 py-1.5 text-sm text-neutral-200"
          />
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={cancel}
            className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={ok}
            disabled={request.mode === "prompt" && !value.trim()}
            className="rounded-lg bg-azure-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-azure-500 disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
