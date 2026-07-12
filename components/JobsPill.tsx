"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type JobStatus } from "@/lib/db";
import { JOB_COST_USD } from "@/lib/pipeline";

// Ambient jobs (design §07): a top-bar pill that expands into a tray. Work
// never blocks the UI; progress also shows in place on the Process step.

// "This session" = since the app loaded. Jobs persist across reloads, so we
// only tally ones that succeeded during the current run.
const SESSION_START = Date.now();

const STATUS_STYLE: Record<JobStatus, string> = {
  queued: "bg-neutral-700",
  submitted: "bg-azure-600",
  running: "bg-azure-600",
  succeeded: "bg-ok-500",
  failed: "bg-red-500",
};

const KIND_LABEL: Record<string, string> = {
  sourceGen: "Source · Gemini",
  extract: "Extract · Gemini",
  sheet: "Sheet · Gemini",
  mesh: "Mesh · Meshy",
  rig: "Rig · Meshy",
  imageGen: "Generate · Gemini",
  videoGen: "Clip · Veo",
};

export default function JobsPill() {
  const [open, setOpen] = useState(false);
  const jobs = useLiveQuery(() => db.jobs.orderBy("createdAt").reverse().limit(15).toArray(), []);
  const running = (jobs ?? []).filter((j) => j.status === "running" || j.status === "submitted");
  const done = (jobs ?? []).filter((j) => j.status === "succeeded");

  // Session spend: sum estimated USD over jobs that succeeded this run; Meshy
  // mesh/rig bill in credits (no USD estimate) so they're counted separately.
  const sessionDone = useLiveQuery(
    () => db.jobs.where("status").equals("succeeded").toArray(),
    [],
  );
  let sessionUsd = 0;
  let meshyOps = 0;
  for (const j of sessionDone ?? []) {
    if (j.updatedAt < SESSION_START) continue;
    const cost = JOB_COST_USD[j.kind];
    if (cost == null) meshyOps += 1;
    else sessionUsd += cost;
  }
  const hasSpend = sessionUsd > 0 || meshyOps > 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[var(--pf-edge)] bg-neutral-900 px-3 py-1 font-mono text-[10.5px] text-neutral-400 hover:bg-neutral-800"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            running.length ? "bg-azure-600 pf-pulse" : done.length ? "bg-ok-500" : "bg-neutral-600"
          }`}
        />
        {running.length
          ? `${running.length} running · ${done.length} done`
          : `${done.length} done`}
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-72 rounded-[14px] border border-[var(--pf-edge)] bg-neutral-900 p-2 shadow-2xl">
          {(jobs ?? []).length === 0 && (
            <div className="p-2 font-mono text-[10px] text-neutral-500">no jobs yet</div>
          )}
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {(jobs ?? []).map((job) => (
              <div key={job.id} className="rounded-lg px-2 py-1.5 hover:bg-neutral-800/60">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_STYLE[job.status]} ${
                      job.status === "running" ? "pf-pulse" : ""
                    }`}
                  />
                  <span className="flex-1 truncate text-xs text-neutral-300">
                    {KIND_LABEL[job.kind] ?? job.kind}
                  </span>
                  <span className="font-mono text-[10px] text-neutral-500">
                    {job.status === "running"
                      ? `${job.progress ?? 0}%`
                      : job.status === "succeeded"
                        ? "done"
                        : job.status}
                  </span>
                </div>
                {job.error && (
                  <div className="mt-0.5 break-words pl-3.5 text-[10px] text-red-400">
                    {job.error.slice(0, 200)}
                  </div>
                )}
              </div>
            ))}
          </div>

          {hasSpend && (
            <div className="mt-1 border-t border-[var(--pf-hair)] px-2 pt-2">
              <div className="flex items-baseline justify-between font-mono text-[10px] text-neutral-400">
                <span>this session</span>
                <span>
                  ~${sessionUsd.toFixed(2)}
                  {meshyOps > 0 && (
                    <span className="text-neutral-500">
                      {" "}
                      + {meshyOps} Meshy op{meshyOps === 1 ? "" : "s"}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 font-mono text-[9px] leading-snug text-neutral-600">
                estimate only — your real charges come from your providers
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
