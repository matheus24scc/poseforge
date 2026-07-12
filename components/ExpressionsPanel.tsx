"use client";

import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { BUILTIN_EXPRESSIONS } from "@/lib/expressions";
import { putBlob } from "@/lib/assets";
import { useAppStore } from "@/lib/store";
import AssetImage from "./AssetImage";
import AutoTextarea from "./AutoTextarea";

// Expression library (2D layer): each entry is a prompt fragment, optionally
// with a reference image. The selected expression rides along on Generate and
// powers the "Refine expression" second pass.
export default function ExpressionsPanel() {
  const expressionId = useAppStore((s) => s.expressionId);
  const setExpressionId = useAppStore((s) => s.setExpressionId);
  const userExpressions = useLiveQuery(() => db.expressions.orderBy("createdAt").toArray(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fragment, setFragment] = useState("");
  const [refAssetId, setRefAssetId] = useState<string | undefined>();
  const fileInput = useRef<HTMLInputElement>(null);

  const add = async () => {
    if (!name.trim() || !fragment.trim()) return;
    await db.expressions.add({
      id: crypto.randomUUID(),
      name: name.trim(),
      promptFragment: fragment.trim(),
      refAssetId,
      createdAt: Date.now(),
    });
    setName("");
    setFragment("");
    setRefAssetId(undefined);
    setAdding(false);
  };

  const chip = (id: string, label: string, custom = false) => (
    <div key={id} className="group relative">
      <button
        onClick={() => setExpressionId(expressionId === id ? null : id)}
        className={`w-full rounded border px-2 py-1.5 text-left text-xs transition ${
          expressionId === id
            ? "border-azure-500 bg-azure-950/40 text-azure-200"
            : "border-neutral-800 bg-neutral-900/60 text-neutral-300 hover:border-neutral-600"
        }`}
      >
        {label}
      </button>
      {custom && (
        <button
          onClick={() => {
            if (expressionId === id) setExpressionId(null);
            void db.expressions.delete(id);
          }}
          className="absolute right-1 top-1.5 hidden h-4 w-4 items-center justify-center rounded-full bg-neutral-800 text-[9px] text-neutral-400 hover:bg-red-900 group-hover:flex"
        >
          ✕
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Expressions
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-700"
        >
          {adding ? "Cancel" : "+ Custom"}
        </button>
      </div>
      <div className="text-[11px] text-neutral-500">
        The selected expression is applied to the face at generation time
        {expressionId ? "" : " — none selected"}.
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded border border-neutral-800 bg-neutral-900/60 p-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (e.g. Battle cry)"
            className="rounded bg-neutral-800 px-2 py-1 text-xs"
          />
          <AutoTextarea
            value={fragment}
            onChange={(e) => setFragment(e.target.value)}
            placeholder="Describe the expression (e.g. mouth open in a fierce battle cry, eyes narrowed)"
            minRows={2}
            className="rounded bg-neutral-800 px-2 py-1 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInput.current?.click()}
              className="rounded bg-neutral-800 px-2 py-1 text-[11px] text-neutral-400 hover:bg-neutral-700"
            >
              {refAssetId ? "Reference ✓" : "Reference image (optional)"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) {
                  const asset = await putBlob(f, "image", "expression-ref");
                  setRefAssetId(asset.id);
                }
                e.target.value = "";
              }}
            />
            <button
              onClick={() => void add()}
              disabled={!name.trim() || !fragment.trim()}
              className="ml-auto rounded bg-azure-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-azure-500 disabled:bg-neutral-700 disabled:text-neutral-400"
            >
              Add
            </button>
          </div>
          {refAssetId && (
            <AssetImage assetId={refAssetId} alt="ref" className="h-16 rounded object-contain" />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {BUILTIN_EXPRESSIONS.map((x) => chip(x.id, x.name))}
        {(userExpressions ?? []).map((x) => chip(x.id, x.name, true))}
      </div>
    </div>
  );
}
