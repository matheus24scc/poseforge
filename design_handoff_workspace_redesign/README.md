# Handoff: PoseForge Workspace Redesign

## Overview
This package proposes a full redesign of the PoseForge workspace — the app for turning a
source image into a rigged 3D character, posing it, and generating stills/video. The redesign
introduces one clear **spatial model** (Process · Stage · References), a **direct-manipulation
pose editor**, an **iterative pipeline that keeps every version**, and a **calmer visual system**
(cool graphite + a single azure signal) that moves away from the current amber/chartreuse look.

Two design artifacts are included:
1. **`PoseforgeDirection.dc.html`** — the high-fidelity **design direction / ideation board**: cover, accent studies, problem framing, the spatial model, color & type system, the full annotated workspace shell (dark + light mode), the pose editor, iterative pipeline, and jobs.
2. **`WorkspaceWireframes.dc.html`** — **low-fidelity wireframes** exploring the workspace shell structure (turn 1: three shell approaches) and per-screen flows (turn 2: launcher, empty new character, contextual References logic, images in stage, asset library, timeline drawer, collapsed rail).

## About the Design Files
The `.dc.html` files in this bundle are **design references authored in HTML** — prototypes that
communicate intended look, layout, and behavior. They are **not** production code to copy directly.
The task is to **recreate these designs inside the existing PoseForge codebase** (the local Next.js
app), using its established patterns, components, and libraries — not to ship the HTML.

> The `.dc.html` files use a small custom runtime (`support.js`, included so the files open in a
> browser). Ignore the runtime; it is only there so a reviewer can open the files. Read them as
> visual/behavioral references.

### Target codebase (already exists)
- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript
- **3D:** `three`, `@react-three/fiber`, `@react-three/drei` (the Stage viewport)
- **State:** `zustand` (`lib/store.ts`)
- **Local persistence:** `dexie` / IndexedDB (`lib/db.ts`) — content-addressed assets
- **Styling:** Tailwind CSS v4 (`app/globals.css`)
- **Providers:** Meshy (mesh), Gemini (`lib/gemini.ts`), Veo (`lib/veo.ts`) for jobs
- **Existing components** to evolve, not rewrite from zero: `Workspace.tsx`, `Viewport.tsx`,
  `BonePanel.tsx`, `PosesPanel.tsx`, `ExpressionsPanel.tsx`, `GeneratePanel.tsx`, `JobsPanel.tsx`,
  `AssetsPanel.tsx`, `CharacterPanel.tsx`, `Timeline.tsx`, `SettingsModal.tsx`.

Reflect the new color/type tokens through the Tailwind theme in `app/globals.css`, and re-lay-out
`Workspace.tsx` into the three-zone grid rather than the current panel arrangement.

## Fidelity
**Mixed — read each file accordingly:**
- **`PoseforgeDirection.dc.html` is high-fidelity (hifi).** Final colors, type, spacing, radii, and
  the shell layout are intentional. Recreate the shell, pose editor, pipeline, and jobs UI
  pixel-accurately using the codebase's components and Tailwind tokens.
- **`WorkspaceWireframes.dc.html` is low-fidelity (lofi).** Structure and flow only — hand-drawn
  "Caveat" annotations are notes, not UI. Use it to decide *shell behavior* (which of the three
  approaches, how rails collapse, where the timeline lives, contextual References unlock rules).
  Apply the hifi visual system for actual styling.

---

## Design Tokens

### Dark mode (primary)
Neutrals (graphite ramp, dark → light):
- `#121317` — app background
- `#1A1C21` — panel / card surface
- `#26282E` — raised control / chip
- `#33363D` — track / divider fill
- `#6B6E76` — muted text / metadata
- `#9B9EA6` — secondary text
- `#C9CBD0` — near-primary text
- `#E7E8EA` — primary text
- Borders: `rgba(255,255,255,0.07)` (panel), `rgba(255,255,255,0.09–0.12)` (stronger)

Signals:
- **Azure `#4F8DFF`** — the single "signal" accent. Active pipeline step, primary tool pill,
  Generate button, active selection border, running-job dot. **Only one azure element on screen at a
  time** (the primary next action). Glow: `box-shadow: 0 0 12–18px #4F8DFF`.
  - Azure tints: `rgba(79,141,255,0.1)` bg, `rgba(79,141,255,0.35–0.4)` border, `#16243F` active-step bg.
- **Vermilion `#F2503C`** — reserved *only* for live selection/gizmo in the 3D viewport. Never a UI accent.
- Success/done: `#7FD35F` (checks, done dots).

### Light mode
- `#E5E2DA` app bg · `#EFECE5` top bar · `#EAE7DF` panels · `#E2DDD2` chips · `#D3CFC4` borders · `#F6F4EE` tiles
- Text: `#2B2A25` primary · `#4A473F` / `#6A675E` secondary · `#97948A` muted
- Stage: neutral studio gray `radial-gradient(#D6D3CA → #BFBCB2)`; mannequin stroke `#6D6A61`; gizmo `#D83A26`
- Azure signal holds; active step bg `#DFE8FB`, border `#A9C4F5`

### Type
- **Space Grotesk** (600) — display, titles, wordmark, button labels. Letter-spacing `-0.02em` to `-0.03em` on headings.
- **IBM Plex Sans** (400/500/600) — body, labels, values, copy.
- **IBM Plex Mono** (400/500) — kickers, metadata, numbers, step %, prices; uppercase kickers at `letter-spacing: 0.14–0.2em`.
- Heading scale used: 78px cover / 46px section H2 (line-height ~1.04) / 26px zone titles / 15–22px card titles / 13–18px body.

### Radii, spacing, shadow
- Radii: chips/controls `8–11px`; cards/panels `14–18px`; the mockup frame `20px`; pills `999px`.
- Panel padding `20–30px`; grid gaps `14–20px`.
- Shell top bar height ~52px; shell body grid: **`262px | 1fr | 320px`**.
- Elevation: cards flat with 1px border; mockup frame `0 40px 90px -30px rgba(0,0,0,0.8)` (dark) / `rgba(55,50,40,0.35)` (light); floating docks use `backdrop-filter: blur(8–10px)` over `rgba(18,20,24,0.7)`.

---

## Screens / Views

### 1. Workspace shell — Process · Stage · References
Source: `PoseforgeDirection.dc.html` §04 (and light mode §08). Evolve `Workspace.tsx`.
- **Layout:** top bar + three-column grid `262px | 1fr | 320px`, body height fills viewport.
- **Top bar:** azure dot + `POSEFORGE` wordmark (Space Grotesk 13px / 0.1em) · breadcrumb
  `Ronin project / Character 1` · right side: `1 job running` (mono), info button, avatar chip.
- **LEFT · Process** (`#131418`): kicker `PROCESS`; vertical list of pipeline steps. Each step =
  22px status circle (done `✓ #7FD35F` on `#26282E`; current = azure filled number; future = dashed
  border, 0.5 opacity) + label (IBM Plex Sans 13.5px) + mono sub-line (`2 versions`, `meshing… 62%`).
  Current step gets `#16243F` bg + azure border + a 4px azure progress bar. Footer hint in mono.
  Steps: Source → Extract → Character sheet → 3D mesh & rig → Pose → Generate.
- **CENTER · Stage:** `radial-gradient(130% 130% at 50% 32%, #33363D, #17191E)`; **no panels docked**.
  The 3D character sits centered (real R3F viewport). Floating chrome only: a `Reset view` chip top-right,
  and a bottom **tool dock** (`orbit / pose(azure) / pan | bones`) on blurred `rgba(18,20,24,0.72)`.
  Corner label `STAGE` (mono). Selected joint shows a **vermilion rotation gizmo**.
- **RIGHT · References** (`#131418`): tab row `Poses / Faces / Inputs` (active = `#26282E` chip);
  2-column thumbnail grid (aspect 1, radius 11px, active tile azure border); footer =
  `GENERATE FROM THIS POSE` kicker, prompt textarea, azure **Generate** button + `~$0.04` estimate.

### 2. Pose editor (direct manipulation + numeric refine)
Source: §05. Evolve `BonePanel.tsx` + `Viewport.tsx`.
- Left demo: click a joint on the model → vermilion gizmo appears → drag to rotate. Label chip
  `R.Forearm · drag to rotate`.
- Right `REFINE · R.FOREARM` panel: three rows Rotate X/Y/Z, each a slider (track `#33363D`, fill
  vermilion `#F2503C`, 16px `#E7E8EA` knob) + mono degree readout (`42°`). Footer: `Mirror ⇋`,
  `Reset joint` outline buttons. Model gizmo and numeric panel are two views of one bone state.
- Helpers: click selects / drag rotates, numeric precision, mirror across body, snap to 15°.

### 3. Iterative pipeline / version stacks
Source: §06. Backed by content-addressed assets (`lib/assets.ts`, `lib/pipeline.ts`).
- Each pipeline object holds a **stack of versions**, not one result. Horizontal filmstrip of
  version cards (aspect 3/4, radius 12px). Active card = 2px azure border + `active` badge; others
  dimmed with mono `v2 · 3 views`; trailing dashed **Re-roll** card (`↺`).
- The **active** version flows downstream; changing it marks downstream steps stale with a subtle
  "re-run to update" cue — never an auto-wipe.

### 4. Jobs (ambient)
Source: §07. Evolve `JobsPanel.tsx` → status pill + tray.
- Collapsed **status pill** in top bar: pulsing azure dot + `1 running · 2 done` (mono, pill radius 999px).
- Expands to a **tray**: rows with a status dot (azure running / green done), `Mesh · Meshy` label,
  mono `62%` / `done`. Progress also shows **in place** on the owning pipeline step.
- Behavior: survives reload (resume polling from provider task ID), never blocks the UI, shows cost
  estimate up front and totals the session.

### 5. Shell structure options (lofi — decide the bones)
Source: `WorkspaceWireframes.dc.html` turn 1. Pick one before implementing §04:
- **1a Fixed three-column** — three persistent panes, nothing moves (safe DCC baseline). *This is the
  direction the hifi shell §04 builds on.*
- **1b Stage-dominant, floating rails** — edge-to-edge stage; Process & References float as glass
  panels that collapse to icon strips (max immersion).
- **1c Bottom deck** — Process spine + stage on top; a full-width bottom deck tabs through
  References / Generate / Results / Jobs, and later grows into the animation timeline.

### 6. Per-screen flows (lofi)
Source: `WorkspaceWireframes.dc.html` turn 2 — implements 1a with individually collapsible rails and
a bottom timeline deck:
- **2a Project launcher** — "Your projects" grid, new project, import a `.poseforge` bundle; opening one opens tabs across the top.
- **2b New character (empty pipeline)** — only **Source** is live; Stage is a drop target
  (`drop an image — or describe a character`); References shows only **Inputs**; Generate locked.
- **2c Contextual References unlock rules** — Poses/Bones appear after mesh & rig; Faces appear at
  generate. The right panel is never fuller than the moment needs.
- **2d Image in stage** — a generation/character-sheet view takes center with a result filmstrip
  below and a "back to 3D" flip; Faces tab live.
- **2e Asset library** — takes the stage: content-addressed assets (sources / images / meshes / gens)
  with filters; right rail inspects the selection (`Use as source`). Evolve `AssetsPanel.tsx`.
- **2f Timeline drawer** — bottom deck opens into tracks: pose keyframes (scrub = slerp preview) and
  a video track (Generate = Veo between keyframes). Stage stays live above. Evolve `Timeline.tsx`.
- **2g Collapsed rail** — either rail folds to an icon strip independently; stage gains the room.

---

## Interactions & Behavior
- **One-signal rule:** exactly one azure element visible at a time = the primary next action.
- **Direct posing:** click joint → gizmo → drag to rotate; numeric panel mirrors the selected bone;
  snap to 15°, mirror L↔R.
- **Pipeline is re-runnable:** every step keeps versions; switching the active version marks
  downstream stale (non-destructive).
- **Jobs are async:** never modal/blocking; resume polling after reload; land results as new
  versions on the owning object; show + total cost estimates.
- **Contextual panels:** References tabs unlock as pipeline milestones are reached (2c).
- **Rails collapse** independently to icon strips (1b / 2g); light mode is a full theme swap (§08).
- **Timeline** (2f): keyframe diamonds interpolate for preview; video segments generate via Veo.

## State Management (extend `lib/store.ts`, `lib/pipeline.ts`)
- Current pipeline step + per-step status (done / active+progress / locked) and version count.
- Per-object version stacks with an `active` pointer; downstream `stale` flags derived from it.
- Selected bone + its X/Y/Z rotation (shared by gizmo and numeric panel); snap/mirror settings.
- Active viewport tool (orbit/pose/pan/bones); rail collapse state (left/right); theme (dark/light).
- Jobs list (provider, task ID, progress, cost, status) persisted so polling resumes on reload.
- References active tab, gated by unlocked milestones.

## Assets
No external image/icon assets — the mannequin, gizmos, and pose thumbnails are inline SVG stand-ins
in the prototypes and should be replaced by the **real R3F viewport render** and real generated
thumbnails from the asset store. Fonts: Space Grotesk, IBM Plex Sans, IBM Plex Mono (Google Fonts).
No PoseForge/third-party brand assets are used.

## Files in this bundle
- `PoseforgeDirection.dc.html` — hifi design direction board (open in a browser to view).
- `WorkspaceWireframes.dc.html` — lofi wireframes & flows.
- `support.js` — runtime so the two files open standalone; **not** part of the design, ignore for implementation.
