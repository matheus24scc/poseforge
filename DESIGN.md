# Poseforge — Design Doc

Gen-AI character posing studio: turn an image (or prompt) into a rigged 3D character, pose/animate it with a library or by hand, and use the posed renders to drive image/video generation. Users can export both the 2D/video results **and** the 3D assets (rigged mesh, poses, animation clips).

Decisions locked 2026-07-06: web app, local-first (eventual Cloudflare deploy); 3D assets are a first-class export; local-first storage with optional sync later; first slice is a thin end-to-end thread.

Round 2 (same day): name confirmed **Poseforge**; characters are Meshy meshes only (World Labs = backdrops); Meshy auto-rig to start, possibly our own rigging much later; v1 posing = simple FK joint rotation + library poses; expressions = 2D library via chained nano-banana img2img passes (mesh-level face control later); hosted target is `demi.build/tools/poseforge`; projects open as tabs in one window; per-generation cost estimates + BYO-key liability disclaimer in-app; async work runs through a persistent job queue (§5).

Round 3 (same day): GLB-only 3D export for v1 (FBX later if demanded); hosted auth will be OAuth (Google/GitHub) when it happens; **hosting is deferred indefinitely** — until funding covers traffic/databases, `demi.build/tools/poseforge` is a landing page (GitHub link, demo videos, discussion) and the product ships as a clone-and-run local app. The hosted engine (§5) and secrets design stay on paper until then.

> **Status (2026-07-10).** The full local pipeline ships and works on real
> keys: source → extract → 3-view sheet → Meshy multi-image mesh → auto-rig →
> direct-manipulation posing → nano-banana generation, plus the animation
> timeline (Veo interpolation, non-destructive trim, ffmpeg.wasm stitched
> export) and CMU mocap import. Two things below are now historical and noted
> inline where they matter: **(a)** blob storage moved from OPFS to IndexedDB
> (OPFS proved ephemeral in embedded browsers — see §1/§4), and **(b)** the
> M0/M1 three-column layout was superseded by the **workspace redesign**
> (`design_handoff_workspace_redesign/`, authoritative for UI): a fixed
> Process · Stage · References shell with collapsible rails and a bottom
> timeline deck, graphite+azure one-signal theme, vermilion gizmo, Space
> Grotesk / IBM Plex. Milestone status is tracked per-milestone in §6.

---

## 1. Product shape

- **Platform:** Next.js web app, runs locally first (`next dev` / local server), later deployed under **`demi.build/tools/<slug>`** on Cloudflare. API routes must stay Workers-compatible (no Node-only deps): provider calls via `fetch`, no native binaries server-side. Anything heavy (video trim, segmentation) runs **client-side** (wasm) so deploy target doesn't matter.
- **Project = portable bundle.** Like passing around a CAD file: a project is a directory/zip (`.poseforge` bundle) containing a manifest + assets. Download to share, import to open. Multiple projects open at once as tabs within the app.
- **Local-first storage:** ~~OPFS (Origin Private File System) as the working store~~ → **superseded: blobs live in IndexedDB (Dexie `blobs` table)**. OPFS proved ephemeral in the embedded/preview browsers used during development (files vanished across restarts while IndexedDB persisted), so content-addressed blobs moved into Dexie; OPFS remains only as a legacy read/migrate fallback. IndexedDB also holds the catalog/index (projects, characters, jobs, generations, library metadata). The `.poseforge` bundle (zip via `fflate`) is the export/share format. Optional cloud sync is a later phase — architecture just needs stable IDs + a manifest that diffs cleanly (content-addressed assets help here).
- **BYO keys:** v1 (local) stores keys client-side only (IndexedDB, optionally encrypted with a user passphrase); keys are attached per-request to our thin proxy routes and never persisted server-side. Hosted phase adds accounts + server-held secrets (encrypted at rest — Cloudflare D1 + per-user envelope encryption, or Workers Secrets Store) so users don't re-enter keys per device. The proxy-route interface stays identical; only where the key comes from changes.
- **Cost & responsibility UX:** show an estimated cost before each generation (Veo especially); a persistent info icon opens a disclaimer popover — *"Generations run against your own API keys; you are responsible for all provider charges."* Shown once as a modal on first key entry, then always reachable from the icon.

### Providers (v1)

| Capability | Provider | Notes |
|---|---|---|
| Image gen / edit / character sheet | **Gemini API — nano-banana** (`gemini-2.5-flash-image` family) | Simple API key. Vertex AI needs OAuth/service accounts — bad BYO-key UX; offer Vertex as a later "enterprise auth" option. |
| Video gen / keyframe interpolation | **Gemini API — Veo** (latest) | Supports image-to-video and first-frame→last-frame interpolation — this is the "generate between keyframes" mechanism. |
| Image → 3D mesh + auto-rig + animation | **Meshy** | Image-to-3D, then their rigging + animation endpoints. Output GLB with standard skeleton. |
| Environments / scenes | **World Labs** | Splats/scenes as *backdrops only*. Splats have no topology — characters are never splats. |

Provider layer is a small adapter interface per capability (imageGen, videoGen, mesh, scene) so adding fal/Tripo/etc. later is additive.

---

## 2. Pipeline

```
[image upload | prompt→nano-banana]
        │
        ▼
 character extraction  ──── client-side matting (onnxruntime-web, e.g. RMBG/MODNet)
        │                    fallback: nano-banana background-removal edit
        ▼
 character sheet ─────────── nano-banana multi-view prompting (front/side/back, T-pose,
        │                    neutral expression) — stored as a Character asset
        ▼
 Meshy image-to-3D ───────── mesh (GLB) → Meshy auto-rig → rigged GLB (+ optional
        │                    Meshy animation presets)
        ▼
 pose editor (three.js) ──── library poses, manual joint manipulation (FK first, IK later),
        │                    2D skeleton sketch → 3D pose (stretch goal)
        ▼
 posed render(s) ─────────── viewport capture: beauty render + skeleton/depth overlay
        │
        ▼
 generation ──────────────── image: nano-banana (character sheet + posed render as refs + prompt)
                             video: Veo (keyframe renders as first/last frames + prompt)
```

Key insight: nano-banana/Veo take **reference images**, not ControlNet skeleton conditioning. The posed 3D render *is* the conditioning signal. The 3D layer is simultaneously a control surface for 2D generation and an exportable asset in its own right.

### Expressions

Two layers, phased (decided):
1. **v1 (generation layer):** 2D expression library = reference images + prompt fragments ("gritted teeth", "surprised") applied via **chained nano-banana img2img passes** — pass 1 generates the posed character, pass 2 (and beyond) edits the face using the expression reference. Keeps expression decoupled from pose and lets users iterate on the face without re-rolling the body. Each pass is a recorded Generation, so the chain is inspectable/replayable.
2. **later (mesh layer):** increase mesh density and do face parts — blendshape/morph-target editing in the viewport, contingent on Meshy rigs exposing facial bones/blendshapes (currently limited — verify per-mesh). Face manipulation UI mirrors the body pose editor.

### Pose library sourcing (decided)

- **Static poses (v1) — shipped:** hand-authored in our own JSON format — named joint rotations against a canonical skeleton, stored as **world-space** XYZ-euler offsets from the T-pose so one pose retargets to any humanoid rig we can classify (see `lib/pose.ts`; ~15 built-ins). User-saved poses use the same format.
- **Animation clips + mocap poses — shipped:** **CMU Motion Capture Database** (free for any use including commercial). An offline converter (`scripts/bvh.mjs`) turns the community cgspeed BVH conversion into the same world-space canonical format; the curated pack in `lib/mocap/` ships ~25 poses and 12 clips. Conversion is rig-independent (per-joint world delta folded to the nearest mapped ancestor — no target bind frames in the formula) and verified numerically against a synthetic Mixamo-style rig. Clips apply to the timeline as batches of keyframes.
- **Ruled out:** Mixamo (usable in outputs, but redistribution as a bundled library is prohibited), AMASS (research-only), and the OpenPose *software* (non-commercial license). The OpenPose/COCO keypoint **format** is just a convention, though — we adopt it freely as the interchange format for the later 2D skeleton-sketch input.

### Timeline & animation

Initially modeled on [fal video-starter-kit](https://github.com/fal-ai-community/video-starter-kit); **shipped as a lighter, bespoke timeline** — one per character, a canvas ruler with keyframe diamonds and segment bars, no Remotion dependency (client-side slerp drives the live viewport directly).
- **Pose keyframes — shipped:** a sequence of saved poses on the timeline; scrubbing interpolates joint rotations client-side (slerp) for *preview*; each keyframe can generate a nano-banana **still**, and each segment calls **Veo** (first/last-frame interpolation between the two stills) to produce the in-between clip. Segments are keyed by keyframe-id pair; jobs resume by Veo operation name.
- **Trim — shipped:** non-destructive in/out points (`trimStart`/`trimEnd` seconds on the segment), set with drag handles over a live-seeking scrub strip; the preview player clamps to them.
- **Stitched export — shipped:** `ffmpeg.wasm` (single-threaded core, lazy-loaded, client-side only) concatenates the trimmed segment clips in keyframe order into one MP4 — concat-demuxer copy when nothing is trimmed, re-encode when it is.
- Exports: MP4 (stitched video), PNG (stills), rigged GLB (3D), full `.poseforge` bundle. _Animation-clip export (GLB tracks) still later._

---

## 3. Data model (sketch)

```
Project        { id, name, createdAt, tabsState, settings }
Character      { id, projectRefs[], sourceImage, sheetImages[], meshAsset, rigMeta }
Asset          { id, kind: image|mesh|video|audio, blobHash, mime, meta }   // content-addressed
Pose           { id, name, skeletonType, jointRotations{}, thumbnail, tags[] }
ExpressionRef  { id, name, refImage?, promptFragment, tags[] }
TimelineDoc    { id, projectId, tracks[], keyframes[], durations }
Generation     { id, provider, model, inputs{refs[], prompt, params}, outputAssetId, cost?, createdAt }
LibraryEntry   { scope: shared|project, itemRef }   // shared = cross-project, still local
```

- **Shared libraries** (poses, expressions, assets, characters) live outside any project in the same local store; projects reference them by ID. Bundle export inlines referenced shared items so bundles are self-contained.
- Every generation is recorded with its full inputs → sessions are reopenable and results reproducible/comparable.

## 4. Stack

- **Next.js (App Router) + TypeScript**, Tailwind v4 (CSS-variable theme). _(No shadcn/ui — components are bespoke.)_
- **three.js / react-three-fiber + drei** — viewport, skeleton gizmos (`TransformControls`), GLB load/export; FBX export later if needed
- **Zustand** app state; **Dexie** (IndexedDB) for both catalog **and blobs** (OPFS dropped — see §1); **fflate** for `.poseforge` zip bundles
- Timeline is bespoke (no Remotion); **ffmpeg.wasm** for client-side stitched export — both shipped
- **onnxruntime-web** for client-side matting _(planned; extraction currently uses nano-banana edits)_
- API routes: stateless proxies for Gemini/Meshy (Workers-compatible `fetch` only)

## 5. Async jobs & caching (the Redis/Celery question)

Every expensive call (Meshy mesh/rig, Veo video, chained nano-banana passes) is a long-running task, so the app is built around a **persistent job queue** from day one. Redis + Celery is the right *shape* but the wrong *engines* for this stack: local-first users would need Docker + a Python worker to run a web app, and Cloudflare Workers can't host Celery (no long-lived processes). Note Meshy and Veo are already async task APIs (submit → task ID → poll) — the providers run the heavy compute; what we own is durable orchestration: ordering, retries, resumability, and progress to the UI.

One job schema, two engines:

```
Job {
  id, kind: charSheet | mesh | rig | imageGen | videoGen,
  status: queued | submitted | running | succeeded | failed | cancelled,
  providerTaskId?, inputs { prompt, refAssetIds[], params }, inputsHash,
  outputAssetId?, error?, attempts, costEstimate?, costActual?,
  projectId, createdAt, updatedAt
}
```

- **v1 (local engine):** queue lives in the client. Job records persist in Dexie; a scheduler (Web Worker) enforces per-provider ordering + concurrency limits, submits to our proxy routes, polls provider task IDs, and retries with backoff. Jobs **survive reload/close** — on reopen, any job with a `providerTaskId` resumes polling (the provider kept working while we were gone). UI subscribes to the job store: progress chips, timeline placeholders that resolve into clips.
- **Hosted engine (demi.build):** identical schema server-side on Cloudflare primitives — **Queues** (ordering, retries, DLQ), **Durable Objects** (per-user job coordinator + WebSocket/SSE push to the frontend), **D1** (job records, users, encrypted secrets), **KV/R2** (result cache). If we ever outgrow Workers and run a real server, the TS-native Celery equivalent is **BullMQ + Redis** — Celery only enters if we add a Python service.
- **Cache (the "Redis as cache" role):** in Celery-land Redis is broker + result backend first, cache second. Here the cache is the **content-addressed asset store**: `inputsHash` = hash(prompt + ref asset hashes + params + model). A job whose `inputsHash` matches a succeeded job returns the stored output instead of re-billing the user's key. Locally that's the Dexie `blobs` table + the asset index; hosted it's R2 + KV.

M0–M2 build against the local engine only; the hosted engine slots in behind the same job store interface at deploy time.

## 6. Milestones

**M0 — Thin thread — ✅ done.** upload image → extract → character sheet → Meshy mesh + auto-rig → three.js → pose → capture → nano-banana generation. Proved every risky integration. (Findings: Meshy auto-rigs use Mixamo-convention bone names; nano-banana needs a billing-enabled Google project; OPFS ephemeral → blobs moved to Dexie.)

**M1 — Pose editor + libraries — ✅ done.** Manual FK joint rotation **and** direct-manipulation gizmo (click joint → rotate, mirror, 15° snap); pose save/load; pose library (built-ins + CMU mocap, §2); 2D expression + 2D pose library via chained img2img (works pre-rig); cost estimates + disclaimer UX; multi-character + fork; `.poseforge` bundle import/export. *Layout superseded by the workspace redesign (see status note at top).*

**M2 — Timeline — ✅ done.** Pose keyframes, client-side slerp preview, Veo keyframe-to-keyframe generation (resumable via operation name), CMU mocap clips → timeline, non-destructive trim, ffmpeg.wasm stitched MP4 export. *Remaining validation on the user's keys: first Veo clip, 2D apply on a real image (cost-gated).*

**M3 — Polish + depth — partial.** Multi-project tabs ✅. Still open: light mode, IK, 2D skeleton-sketch input (OpenPose/COCO format), World Labs backdrops, mesh-level face editing (blocked on Meshy rig blendshape support). Distribution: GitHub repo (clone-and-run) + landing page at demi.build/tools/poseforge.

**M4 — Hosted deploy (funding-gated) — not started.** Cloudflare deploy behind demi.build/tools/poseforge, OAuth accounts (Google/GitHub), server-held encrypted secrets, hosted job engine (§5). Optional sync/share rides on this.

## 7. Open questions

Everything decidable up front is decided. What remains is **empirical — resolved by M0 testing**, no input needed:

1. **Segmentation** — client-side ONNX model vs. nano-banana edits. Try both on real images in M0, keep the winner.
2. **Meshy rig quality variance** — auto-rigs on stylized characters can be rough; evaluate on 3–4 test characters in M0 before committing the pose editor to their skeleton convention.
