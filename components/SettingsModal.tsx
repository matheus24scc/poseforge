"use client";

import { useEffect, useState } from "react";
import { db } from "@/lib/db";

export const DISCLAIMER =
  "Poseforge runs generations against your own API keys (Google Gemini, Meshy). " +
  "You are responsible for all charges those providers bill to your accounts. " +
  "Cost figures shown in the app are rough estimates only — always verify against " +
  "the providers' pricing pages. Keys are stored locally in your browser and are " +
  "only sent with requests to the providers.";

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const [geminiKey, setGeminiKey] = useState("");
  const [meshyKey, setMeshyKey] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [previouslyAccepted, setPreviouslyAccepted] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void (async () => {
      const [g, m, a] = await Promise.all([
        db.settings.get("geminiKey"),
        db.settings.get("meshyKey"),
        db.settings.get("disclaimerAccepted"),
      ]);
      setGeminiKey(g?.value ?? "");
      setMeshyKey(m?.value ?? "");
      setPreviouslyAccepted(a?.value === "true");
      setAccepted(a?.value === "true");
    })();
  }, []);

  const canSave = accepted || previouslyAccepted;

  const save = async () => {
    await db.settings.bulkPut([
      { key: "geminiKey", value: geminiKey.trim() },
      { key: "meshyKey", value: meshyKey.trim() },
      { key: "disclaimerAccepted", value: "true" },
    ]);
    setSaved(true);
    setTimeout(onClose, 400);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
    >
      <div
        className="w-[420px] rounded-lg border border-neutral-800 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-sm font-semibold">API keys</div>
        <label className="mb-2 block text-xs text-neutral-400">
          Gemini API key{" "}
          <span className="text-neutral-600">(aistudio.google.com/apikey)</span>
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs"
            placeholder="AIza…"
          />
        </label>
        <label className="mb-3 block text-xs text-neutral-400">
          Meshy API key <span className="text-neutral-600">(meshy.ai → Settings → API)</span>
          <input
            type="password"
            value={meshyKey}
            onChange={(e) => setMeshyKey(e.target.value)}
            className="mt-1 w-full rounded bg-neutral-800 px-2 py-1.5 text-xs"
            placeholder="msy_…"
          />
        </label>
        <div className="mb-3 rounded border border-azure-900/60 bg-azure-950/30 p-2 text-[11px] leading-relaxed text-azure-200/90">
          {DISCLAIMER}
        </div>
        {!previouslyAccepted && (
          <label className="mb-3 flex items-start gap-2 text-xs text-neutral-300">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5"
            />
            I understand that I pay for all provider usage with my own keys.
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={!canSave}
            className="rounded bg-azure-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-azure-500 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-400"
          >
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
