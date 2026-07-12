# Poseforge — Remaining Work (handoff plan, 2026-07-07)

State: full pipeline works end-to-end on real keys (source → extract → 3-view sheet →
Meshy multi-image mesh → auto-rig → direct-manipulation posing → nano-banana generation).
All four redesign phases shipped (data model / shell / pose gizmo / launcher+bundles).
Repo: github.com/wolfgangjblack/poseforge (private). DESIGN.md = original architecture;
design_handoff_workspace_redesign/README.md = visual system (authoritative for UI).

**Read `~/.claude/.../memory/poseforge-project-overview.md` first** — it carries every
hard-won gotcha (world-space pose math, Next dev bans window.prompt, hidden-tab WebGL
throttling, dexie liveQuery vs raw IDB writes, npm build corrupts .next while dev server
runs, OPFS is unreliable → blobs live in Dexie, etc).

## 1 · CMU mocap import  ← do this first
Goal: real poses at scale + drop-in animation clips for the timeline.
- Source: CMU Motion Capture Database (free incl. commercial). Use the community BVH
  conversions (cgspeed). Do NOT bundle Mixamo/AMASS (licensing).
- Build a small **offline converter script** (Node, in `scripts/`): BVH → our canonical
  joints (`CanonKey` in lib/pose.ts) as **world-space rotation offsets in degrees**
  (same semantics as applyPose — see the formula in lib/pose.ts; verify with the
  Node-test pattern in memory: three from node_modules, synthetic Mixamo bind frames).
- Ship a curated starter pack as JSON in `lib/mocap/` (~30 static poses sampled from
  clips + ~10 short clips as keyframe sequences {time, rotations}[]).
- UI: Poses tab gets sections (Stances / Actions / Clips / Yours). A Clip applies to the
  timeline as a batch of keyframes (reuse addKeyframe; respect existing keyframes by
  inserting after playhead).
- BVH joint names in CMU differ (e.g. LeftUpArm/LHumerus per conversion) — extend the
  name classifier or map explicitly in the converter, not at runtime.

## 2 · Timeline finish: trim + stitched export
- Non-destructive trim: in/out points per segment clip, stored in SegmentInfo
  ({trimStart, trimEnd} seconds); Timeline UI = small in/out handles when a segment with
  video is selected; preview player respects them via currentTime clamping.
- Stitched export: ffmpeg.wasm (`@ffmpeg/ffmpeg` — lazy-load client-side only, it's
  ~30MB; never import server-side). Concat trimmed segment clips in keyframe order →
  one MP4 download. If codecs match (all Veo output) use concat demuxer without
  re-encode first; fall back to re-encode.
- Add "Export video" button to Timeline transport when ≥1 segment has video.

## 3 · README + DESIGN.md sync (before repo goes public)
- README: rewrite as the landing page — what it is, screenshots (user can supply),
  quickstart (clone, npm i, npm run dev, keys: aistudio.google.com/apikey + meshy.ai),
  BYO-keys cost disclaimer, feature list, architecture one-pager, bundle sharing story.
- DESIGN.md: mark shipped milestones; fix stale OPFS references (blobs live in Dexie
  now); note the workspace redesign supersedes the M0/M1 layout sections.

## 4 · Light mode — ✅ SHIPPED (2026-07-12, cb545bc)
- `.light` override in globals.css swaps the neutral ramp + azure tints (Tailwind v4
  var(--color-*) means one class rethemes every utility); hardcoded chrome lifted to
  semantic vars (--pf-panel/-glass/-stage/-hair/-edge). Toggle (☀/☾) in the top bar,
  persisted in db.settings, restored on boot as html.light. Dark stays default; the R3F
  canvas backdrop + grid stay neutral (that render is the generation reference).

## 5 · Polish backlog (cheap, taste-driven)
- ✅ SHIPPED (2026-07-12, 7ad60b0): vermilion gizmo tint (override material.tempColor
  too — three-stdlib restores it each frame); jobs-tray session cost total (JOB_COST_USD
  in lib/pipeline; sums jobs succeeded since load, Meshy = credit ops); persistent capture
  thumb lifted to viewportStore.lastRender (survives step nav + rail collapse, cleared on
  character switch).
- Still open: tune BUILTIN_POSES values live with the user (a taste session — skipped);
  consider draggable Refine panel if user asks again (declined once).

## 6 · Validation still owed (user's keys, cheap)
- First **Veo clip**: two keyframe stills → segment bar → Generate clip (fast mode ≈
  <$1). lib/veo.ts tries three frame-encoding shapes on 400s — if all fail, the error
  lands in the jobs tray verbatim; fix is client-side field naming only.
- 2D pose apply + 2D face apply on a real image (one nano-banana call each).

## 7 · Requested directions (user, 2026-07-10) — scoping
These came out of a review pass; sequencing TBD with the user.

### 7a · User-authored poses ("sketch your own")
- Save **partial/named poses scoped to body parts**: pick which parts a pose
  covers (arms / legs / torso / head → later hands / feet / fingers), name it,
  save. A partial pose only sets its joints on apply (leaves the rest), so
  fragments compose (upper-body wave + lower-body stance).
- Foundation: group `CanonKey` into body-part sets; capture/apply gain a
  key-filter; `PoseRow` gains `parts?: BodyPart[]` (backward-compatible —
  absent = full body). Extensible to finer joints by growing `CanonKey` +
  the classifier + the rig's skinned bone map (fingers/toes need Meshy rigs
  that expose them — verify per rig).
- Open: whether to also add a dedicated **2D stick-figure sketch canvas**
  (drag joints in 2D → solve to 3D) — bigger, overlaps the parked OpenPose
  interchange item. Decide before building.

### 7b · Multi-character composition on a plane — v1 SHIPPED
- **v1 (session-lived):** `components/CompositionView.tsx` + `lib/compositionStore.ts`.
  Top-bar **Compose** toggle → arrange the project's rigged characters on a
  ground plane (each cloned via SkeletonUtils.clone → independent skeleton),
  select one to Place (translate gizmo + turn/scale sliders) or Pose (reuses
  the existing JointMarkers/BoneGizmo on the selected rig), capture the group →
  `runGenerate` anchored on the selected character. Foundation for 7c.
- **v2 — ✅ SHIPPED (2026-07-12, 822cd63).** Keystone: per-character pose persistence —
  `CharacterRow.poseRotations`, captured on every Pose-step edit (StagePane effect on
  poseVersion) and restored on rig mount (Viewport initialPose). Round-trip verified
  numerically (capturePose→JSON→applyPose on an independent rig clone = 0.000°).
  Saved compositions: `compositions` Dexie table (db v6) + lib/compositions; each
  placement loads its character at the persisted pose; posing in-scene writes back to the
  character. Multi-identity gen: `runGenerateComposition` refs every scene character's
  sheet (deduped) + the composed render, recorded on the anchor.

### 7c · Marble world drop-in — v1 SHIPPED
- **v1:** the composition scene takes an imported **World Labs Marble** GLB
  mesh (exports as GLB w/ embedded textures) as a fixed backdrop
  (`EnvironmentModel` in CompositionView; import via the left rail, fit with
  scale/height/turn sliders since Marble has no unit convention). Characters
  stand in it; the group capture → generation composites them into the world.
  User exports from Marble, imports the file (no BYO-key API). Supersedes the
  parked "World Labs backdrops" item.
- **v2 — ✅ SHIPPED (2026-07-12, 0fd95f1).** Gaussian **splat** worlds via drei's
  `<Splat>` (EnvironmentSplat), picked by file extension (.splat/.ply → splat, .glb →
  mesh; kind persisted on the composition). drei reads the compact .splat format only —
  .ply is accepted but flagged. Per-world camera framing presets (Front/¾/Side/Top via a
  CameraBridge). Ground auto-align (Box3 over the env group → shift env.y so its floor
  meets the feet; mesh immediate, splat once loaded).

### 7d · NVIDIA MotionBricks motion source
- Real-time text→motion model (350k skills), releasing ~now via NVlabs/GR00T —
  research code (GPU/Python), **no BYO-key API yet**. Near-term path: it emits
  BVH/FBX → our existing `scripts/bvh.mjs` converter already turns BVH into
  canonical clips, so we consume its output **offline** with little new code.
  A hosted "type a motion → timeline clip" flow waits on a callable API.

## Later / parked
- M4 hosted deploy (funding-gated): Cloudflare Queues/DO/D1/KV per DESIGN.md §5;
  OAuth Google/GitHub; demi.build/tools/poseforge is a landing page until then.
- Mesh-level facial expressions (blendshapes) — blocked on Meshy rig capabilities.
- IK posing; 2D skeleton-sketch input (OpenPose/COCO format as interchange) — see 7a.
- World Labs backdrops → superseded by 7c (Marble).

## Working agreements (do not relearn these)
- Verify pose math changes with the Node three.js test pattern, not the preview
  (hidden preview tabs throttle rAF/timers — models don't mount headlessly; UI checks
  via DOM/dexie, math via Node, visuals via the user's eyes).
- Never run `npm run build` while the dev server is up (corrupts .next → 500s;
  rm -rf .next + restart to recover).
- All provider calls stay in stateless fetch-only API routes (Workers-compatible).
- Every expensive call gets a JobRow; Meshy/Veo ops resume by provider task id.
- Commit per feature with Co-Authored-By trailer; push to origin main.
