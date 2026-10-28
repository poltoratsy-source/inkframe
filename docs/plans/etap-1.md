# Inkframe, stage 1 (clickable demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A clickable demo of the Inkframe studio: start screen → studio where a cartoon "draws itself" (sketch → colour) → scene edits → "Build MP4", driven by a fake but live engine.

**Architecture:** Next.js (App Router) app. All studio logic sits behind one interface, `StudioEngine` (`lib/engine/types.ts`). Stage 1 ships `DemoEngine`, which plays a timed script of events built from pre-rendered frames of our own cartoon; the UI only consumes engine events over SSE and folds them with a pure reducer. Stage 2 adds `RealEngine` (Claude Agent SDK + painted renderer) behind the same interface, so screens stay unchanged.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind 4, Node 20 test runner + tsx, ffmpeg (asset prep), puppeteer-core (walkthrough recording).

**Spec:** coordinator brief of 28.10.2026 (stage 1 re-scoped to a demo site) + mockups `start.html`, `maket.html`.

## Global Constraints

- Dark theme, accent `#ff8a3d`, layouts follow the two mockups (1600×1000 reference).
- Engine selected by `INKFRAME_ENGINE` (`demo` default; `real` = stage-2 stub that fails with a clear message).
- Demo dev server: `npm run dev` on `127.0.0.1:3700` only.
- No secrets in git; `.env.local` ignored. Own API key field stored only in `.env.local`.
- Brand imagery from client work (e.g. soft-drink ad) is not shipped in the repo.
- File names in Latin; README in English + `README.ru.md`; licence MIT with credits to ClaudeAnimationBase and p5.brush.

## Review Focus

1. Opening a studio URL for an unknown or expired project id → friendly "project not found" with a link home, not a crash (test in Task 3: `getProject('nope')` returns `undefined`; UI test by snapshot).
2. Editing a scene while the first run is still drawing → edit is queued after that scene finishes, run keeps going (test in Task 2: `buildEditScript` on a scene in `queued` state still yields events after its run).
3. "Build MP4" pressed before all scenes are done → button disabled with hint (reducer test `canBuild(state) === false` in Task 2).
4. Empty idea on the start screen → button disabled, examples fill the idea (snapshot in Task 5).
5. SSE reconnect / page reload mid-run → client gets the full current state first (Task 3 test: `subscribe` replays a `snapshot` event).

---

### Task 1: Scaffold + demo assets

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`, `.gitignore`, `scripts/prepare-demo-assets.sh`, `public/demo/**`, `lib/engine/demo-catalog.json`.

- [ ] Step 1: `scripts/prepare-demo-assets.sh` cuts 6 scenes × 8 frames (640×360) from `multfilm-lidar.mp4`, makes a pencil "sketch" twin of every frame (`edgedetect` + `negate` + paper tint), re-encodes the film to 1280×720 as `public/demo/result.mp4`, writes 600 voice/music peaks to `demo-catalog.json`.
- [ ] Step 2: Verify: `ls public/demo/frames | wc -l` = 96; `ffprobe result.mp4` duration ≈ 67 s; look at one sketch frame.
- [ ] Step 3: `npm run dev` serves a blank page on 127.0.0.1:3700 (`curl -s -o /dev/null -w '%{http_code}'` → 200). Commit.

### Task 2: Engine types, reducer and demo script (TDD)

**Files:** Create `lib/engine/types.ts`, `lib/engine/reducer.ts`, `lib/engine/demo-script.ts`; Test `tests/reducer.test.ts`, `tests/demo-script.test.ts`.

**Interfaces — Produces:**
- `type EngineEvent` (union: `snapshot`, `log.add`, `log.update`, `storyboard`, `scene.status`, `frame`, `progress`, `track`, `scene.edited`, `video`, `status`).
- `applyEvent(state: ProjectState, ev: EngineEvent): ProjectState` — pure.
- `canBuild(state: ProjectState): boolean`.
- `sceneCountFor(durationSec: number): number` — 15→3, 30→4, 60→6, 120→6.
- `buildRunScript(project: ProjectState, catalog: DemoCatalog, speed?: number): TimedEvent[]` with `TimedEvent = { at: number /* ms */, ev: EngineEvent }`.
- `buildEditScript(state: ProjectState, n: number, request: string, catalog, speed?): TimedEvent[]`.
- `buildAssembleScript(state, catalog, speed?): TimedEvent[]`.
- `lookFor(request: string): string` — CSS filter for a quick edit ("ночь" → night look).

- [ ] Step 1: Tests: run script for 15 s → 3 scenes; every scene gets sketch frames before colour frames; last event is `status: ready`; `at` is non-decreasing; progress ends at 1; edit script ends with `scene.edited` and the scene back to `done`; `canBuild` false until all scenes `done`; reducer appends logs, updates frames, marks `edited`.
- [ ] Step 2: `npm test` → FAIL (modules missing).
- [ ] Step 3: Implement.
- [ ] Step 4: `npm test` → PASS. Commit.

### Task 3: DemoEngine + engine registry + API (TDD)

**Files:** Create `lib/engine/demo.ts`, `lib/engine/real.ts`, `lib/engine/index.ts`, `app/api/projects/route.ts`, `app/api/projects/[id]/route.ts`, `app/api/projects/[id]/events/route.ts`, `app/api/projects/[id]/edit/route.ts`, `app/api/projects/[id]/build/route.ts`, `app/api/settings/route.ts`, `lib/settings.ts`; Test `tests/demo-engine.test.ts`, `tests/settings.test.ts`.

**Interfaces — Produces:** `interface StudioEngine { mode; create(input: StartSettings): ProjectState; get(id): ProjectState | undefined; list(): ProjectSummary[]; subscribe(id, cb: (ev) => void): () => void; editScene(id, n, request): void; build(id): void }`; `getEngine(): StudioEngine` (singleton on `globalThis`); `saveApiKey(envFile, key)`, `hasApiKey(envFile)`.

- [ ] Step 1: Tests (fake timers via `speed` = 0.001): create → subscribe gets `snapshot` first, then events until `ready`; edit on unknown scene throws; `build` before ready throws; `RealEngine.create` throws `NotImplemented` with a message naming stage 2; `saveApiKey` keeps other lines of `.env.local` and replaces an old key.
- [ ] Step 2: FAIL → implement → PASS. Commit.

### Task 4: Start screen

**Files:** Create `app/page.tsx`, `components/start/*.tsx`, `lib/options.ts`.

- [ ] Idea box with examples, 7 style cards (only "Акварель" active, others "скоро"), 8 option groups (duration 15 с/30 с/60 с/2 мин, format 16:9 + "скоро", voice, hero, audience, music, language, ending), "Начать рисовать" → `POST /api/projects` → `/studio/<id>`; settings modal with own API key; recent projects.
- [ ] Verify by headless screenshot at 1600×1000, compare with mockup. Commit.

### Task 5: Studio screen

**Files:** Create `app/studio/[id]/page.tsx`, `components/studio/*.tsx`, `lib/useProject.ts`.

- [ ] Left: idea + "Клод сейчас делает" log; centre: stage with pen reveal (new frame wipes in behind an orange line), tags, subtitle, overall progress; right: scene edit panel (what's on screen, line, quick edits, text input); bottom: scene strip + voice/music waveforms; top: "Собрать MP4" → modal with player + download.
- [ ] Verify by screenshots mid-run, after an edit, after build. Commit.

### Task 6: Run on MSK1, walkthrough video, docs

**Files:** Create `scripts/record-walkthrough.mjs`, `README.md`, `README.ru.md`, `LICENSE`, `Dockerfile`, `docker-compose.yml`, `demo/*`.

- [ ] Start `npm run dev` detached on 127.0.0.1:3700; `curl` → 200.
- [ ] Record 30–60 s walkthrough (puppeteer screencast → MP4) + 4 screenshots; look at each.
- [ ] README "Demo mode" section. Final commit; `git status` clean.
