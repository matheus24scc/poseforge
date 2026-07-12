# Contributing to Poseforge

<p>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-3b82f6.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/PRs-welcome-4f8dff" alt="PRs welcome">
  <img src="https://img.shields.io/badge/checks-typecheck%20%2B%20build-10b981" alt="Checks: typecheck + build">
</p>

Thanks for your interest in Poseforge! Contributions are welcome — bug fixes, new pose/animation packs, provider adapters, performance work, and docs all help. This guide covers how to get set up and the conventions worth knowing before you dig in.

By participating, you agree to uphold our [Code of Conduct](#code-of-conduct).

## Ways to contribute

- **Report a bug** — [open a bug report](https://github.com/wolfgangjblack/poseforge/issues/new?template=bug_report.yml).
- **Request a feature** — [open a feature request](https://github.com/wolfgangjblack/poseforge/issues/new?template=feature_request.yml), describing the workflow you're trying to unlock.
- **Send a pull request** — fixes, features, or docs. For anything large, please open an issue first so we can align on the approach before you invest the time.
- **Improve the docs** — clarifications, corrected steps, and better examples are always welcome.

## Development setup

Poseforge is a Next.js (App Router) + TypeScript app with no backend — all state is client-side.

```bash
# fork the repo, then:
git clone https://github.com/<your-username>/poseforge
cd poseforge
npm install
npm run dev          # http://localhost:3000
```

You'll need **Node 18.18+** and a browser with WebGL2 + IndexedDB. To exercise the AI pipeline you'll need your own **Gemini** and **Meshy** API keys (entered via the in-app **API keys** modal — see the [README](./README.md#add-your-api-keys)). Much of the UI — the workspace shell, pose editor, timeline, sketch tool, and composition view — can be developed and tested by uploading your own rigged GLB via **3D mesh & rig → Upload rigged**, no provider keys required.

Before opening a PR:

```bash
npm run typecheck    # tsc --noEmit — keep it green
npm run build        # verify a production build (stop the dev server first!)
```

## Project layout

```
app/            Next.js App Router — pages + stateless proxy API routes
  api/gemini/*  nano-banana (image) + Veo (video) proxies
  api/meshy/*   image→3D + auto-rig proxy
components/      React UI — the workspace shell, pose editor, timeline, etc.
lib/            State + domain logic
  db.ts         Dexie (IndexedDB) schema — catalog + content-addressed blobs
  pipeline.ts   the source→…→generate pipeline + job orchestration
  pose.ts       world-space pose math + the canonical skeleton
  pose2d.ts     2D sketch → pose solving
  mocap/         the bundled CMU pose/clip pack (JSON)
scripts/        offline tools (BVH→canonical conversion, pose math tests)
docs/media/     README screenshots
DESIGN.md       architecture + decisions
ROADMAP.md      what's shipped and what's next
```

## Coding conventions

These aren't style preferences — they're load-bearing invariants that keep the app deployable and correct:

- **Keep all provider calls in the stateless, `fetch`-only API routes** (`app/api/*`). No Node-native server dependencies — the app must stay Cloudflare Workers-compatible so it can deploy unchanged later.
- **Every expensive provider call gets a durable job** (`JobRow` in `lib/db.ts`). Meshy mesh/rig and Veo tasks record a provider task id and **resume on reload** — don't fire-and-forget.
- **Pose math is world-space and rig-independent.** If you change anything in `lib/pose.ts` (or the BVH converter), verify it with the Node/three.js test scripts in `scripts/` — *not* by eye in the browser. Hidden/background preview tabs throttle rendering, so visual "it looks right" is not a reliable check.
- **Never run `npm run build` while the dev server is running** — it can corrupt `.next` and cause 500s. Recover with `rm -rf .next` and restart.
- **Assets are content-addressed** (SHA-256). Reuse `putBlob` / the asset store rather than duplicating blobs; this is what makes re-generations dedupe and `.poseforge` bundles diff cleanly.
- **State lives in Dexie/IndexedDB**, not on a server. There is no server-side state to add.
- Keep `npm run typecheck` clean and prefer small, focused commits.

## Pose & animation content

New pose or clip content must come from **freely-licensed** sources. The bundled pack is derived from the **CMU Graphics Lab Motion Capture Database** (free for any use, including commercial), converted offline by `scripts/` into the app's world-space canonical format.

**Please do not** add Mixamo or AMASS content as a redistributed library — their licenses prohibit it. (You may still *use* such tools in your own outputs; the restriction is on bundling them into this repo.)

## Commit & pull request process

1. Create a branch off `main` (`git checkout -b fix/short-description`).
2. Make your change; keep commits focused and messages descriptive.
3. Run `npm run typecheck` and `npm run build`.
4. Push and open a PR against `main`, filling in the PR template.
5. Link any related issue (`Closes #123`).

Maintainers may ask for changes — that's a normal part of review, not a rejection. Small, reviewable PRs get merged fastest.

## Code of Conduct

Be respectful, constructive, and welcoming. Assume good faith, critique ideas rather than people, and help keep discussions productive. Harassment or abusive behavior isn't tolerated. Report concerns by opening an issue or contacting the maintainer.

---

See [DESIGN.md](./DESIGN.md) for the architecture and [ROADMAP.md](./ROADMAP.md) for where the project is headed. Thanks for contributing! 🛠️
