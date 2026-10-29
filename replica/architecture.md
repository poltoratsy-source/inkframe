# Architecture: Inkframe 3 (fresh rebuild of OpenMontage's production-control and ink-animation ideas)

Source: `replica/recon.md`, `replica/features.csv`. Clean-room: OpenMontage is AGPL-3.0, nothing is copied from it;
every line below is Inkframe's own design on Inkframe's existing code. Scope (Ru_ANGEL15, 29.10): **everything that is
not `skip` in features.csv, in order.** No time estimates here — the customer schedules.

## Stack

Nothing new at the base. Inkframe already has the stack the features need.

| layer | choice | why |
| --- | --- | --- |
| web | Next.js App Router + React + TS + Tailwind (as now) | the studio, SSE and API routes already live here |
| storage | files under `projects/<id>/` (as now), JSON + JSONL | one user per install, everything inspectable, the GitHub Pages demo stays static |
| auth | none (local studio) | runs on the owner's machine; no accounts in scope |
| payments / email | none | not in scope |
| jobs | the engine's per-project queue (`RealEngine.enqueue`) | already serialises paint, voice and cut per project |
| render | p5.js + p5.brush in headless Chrome via puppeteer-core (`lib/real/painter.ts`) | deterministic, no paid model; style packs plug in here |
| voice / sound | edge-tts (`renderer/tts.py`) + ffmpeg | as now |
| checks | ffprobe + ffmpeg filters (blackdetect, silencedetect, volumedetect) | post-render self-review with tools already installed |
| hosting | the owner's server (MSK1 now) + GitHub Pages for the demo | as now |

No database: the data model below is a set of files with TypeScript types and a schema check on write
(`lib/store/*.ts`). If Inkframe ever becomes multi-user SaaS, the same types map 1:1 to Postgres tables.

## Schema (files; see `replica/schema.md` for the full types)

Files per project, `projects/<id>/`:

| file | what | written by | notes |
| --- | --- | --- | --- |
| `project.json` | ProjectState (exists) + `stages`, `styleId`, `profile` | engine | add fields, keep old projects loading (defaults) |
| `stages/<stage>.json` | Checkpoint: status, version, artifact, approval | engine | stage ∈ brief, script, storyboard, paint, voice, compose, review, final |
| `stages/history/<stage>.v<N>.json` | superseded versions | engine | never deleted |
| `events.jsonl` | one line per event: at, stage, scene?, kind, payload | engine (`emit`) | frames: one line per scene step, not per frame (size) |
| `decisions.jsonl` | what, chosen, alternatives, reason, confidence, estimate, actual | engine + storyboard | shown in WorkLog |
| `review.json` | self-review: checks[], decision PASS / WARN / FAIL | `lib/real/review.ts` | a FAIL keeps the MP4 off the screen |
| `estimate.json` | frames × s/frame × workers, Claude calls, disk MB | `lib/real/estimate.ts` | shown on gates; budget mode observe/warn/cap |

Style packs, `renderer/styles/<id>/`: `style.json` (palette, paper, brush, boil {fps, amp, inkOnly}, springs preset,
colour grammar), `STYLE.md` (rules for the storyboard prompt), `kit.js` (optional extra drawing helpers). Two to start:
`watercolor` (today's look, moved out of core.js constants) and `ink` (black ink on white, orange = flow, red =
problem, blue = good end).

Mocap clips (later milestone), `renderer/mocap/<name>.json`: per-frame 2D joint tracks; `catalog.json` with name,
category, description, source + licence (CMU, taken from its own source).

Rules that are constraints, not UI: a stage cannot become `completed` while its gate is open (checked in
`lib/store/stages.ts`, not only in the button); every approval carries the version it approves, so a stale tab
cannot approve a version that was already replaced.

## API

Existing routes stay. New ones are marked **new**.

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| POST /api/projects | start a cartoon | studio | StartSettings (+ styleId, profile) | ProjectState | F01 |
| GET /api/projects | library | studio | — | ProjectSummary[] (+ stage, awaiting) | F02 library |
| GET /api/projects/[id] | one project | studio | — | ProjectState | F01 |
| GET /api/projects/[id]/events | live events (SSE) | studio | — | snapshot + EngineEvent stream | F01, F02 |
| **POST /api/projects/[id]/gate** | approve or send back a stage | studio | {stage, version, decision: approve \| revise, note?} | ProjectState | F01 gates |
| **GET /api/projects/[id]/replay** | the run as timed events | studio | — | {startedAt, events: TimedEvent[]} from events.jsonl | F03 |
| POST /api/projects/[id]/edit | redraw one scene | studio | {n, request, patch?} | 202 | F01 |
| POST /api/projects/[id]/build | cut the MP4 | studio | — | 202 | F01 |
| **GET /api/projects/[id]/review** | self-review report | studio | — | Review | F01 final gate |
| GET /api/projects/[id]/files/[...path] | frames, clips, MP4 | studio | — | file | all |
| **GET /api/styles** | style packs | studio | — | StylePack[] (id, name, preview) | start screen |
| **POST /api/reference** (could) | analyse a reference video | studio | {url \| file} | {pacing, hook, beats, style} | F04 |
| GET/POST /api/settings | settings (exists) | studio | … | … | — |

Engine contract (`lib/engine/types.ts`) grows by: `approve(id, stage, version, note?)`, `revise(id, stage, version,
note)`; `ProjectStatus` + `'awaiting'`; events `stage` {stage, status, version}, `gate` {stage, open, summary},
`estimate`, `decision`, `review`. DemoEngine plays the same gates on a timer so the Pages demo shows them.

Webhooks: none. Jobs: none on a schedule; all work is per-project queue items.

## The parts that bite

- **determinism**: frames paint in parallel and out of order. Style packs and spring presets must stay pure
  functions of t; boil keyed by element (`boilSeed`) so a moving arm never re-boils the body. Test: paint the same
  frame twice in two pages and compare pixels.
- **layouts for 9:16 and 1:1**: templates place things at fixed 1920×1080 points (12 places in templates.js, more in
  props). Needs a layout layer (`renderer/layout.js`: safe areas, hero/prop slots per format) instead of numbers.
- **resume**: the server can restart mid-paint. On load, a stage `in_progress` resumes from its last finished scene
  (stages/<stage>.json keeps `doneScenes`); an `awaiting` gate just waits.
- **races / idempotency**: two tabs, double clicks. Gate calls carry `version`; a second approve of the same version
  is a no-op; build is already guarded (`cutQueued`).
- **events.jsonl size**: frame events are high-rate; write one line per scene step and per gate/decision, keep live
  frames SSE-only.
- **Claude unavailable**: storyboard falls back to the template (exists); revise-with-note must also work without
  Claude (rule-based edit, as scene edits do now) and say so in the log.
- **self-review false alarms**: a deliberate black iris or night scene is not a broken frame — check only the four
  sample frames against thresholds and allow intended dark scenes (scene setting = night/space).
- **IK on Clawd**: his arms are single 2.2u nubs; reaching is one-segment aim + optional two-segment arm for
  props held far away. Keep his look; IK must not stretch him.
- **mocap**: a second character type (stick figure in our brush), not Clawd; converter written fresh; clips from
  CMU's own distribution with the licence line in catalog.json.

## Build order (all non-skip rows, in order; each milestone ends with tests green and a look at frames)

1. **Vertical slice — gates end to end, ugly**: stages + `POST /gate` + GatePanel showing the script; DemoEngine and
   RealEngine both pause at "script". Screens: studio S02 + GatePanel. Files: stages/, events.jsonl.
2. **Motion polish (visible at once)**: spring presets (settle/overshoot/bouncy/soft + anticipation) in core.js,
   used by templates, props and Clawd; boil parameters per element (still props hold; ink-only boil option).
3. **Self-review after every cut**: review.ts (ffprobe, 4 sample frames, black/blank, silence, clipping, subtitle
   stream), WorkLog lines, FAIL blocks the "MP4 ready" state.
4. **All gates**: storyboard contact sheet (key frame + words + timing per scene, draft paint only), final gate with
   the review; revise-with-note for each; estimate on each gate; budget modes observe/warn/cap; decision log.
5. **Living board + replay + library**: stage rail with states, scene cards filling in, time meter, ▶ Replay from
   events.jsonl, library with live/awaiting badges.
6. **Formats 9:16 and 1:1**: layout.js, templates and props on slots, engine passes `settings.format`, assemble.ts
   sizes; contact sheets and the final MP4 in all three.
7. **Style packs**: move today's look into `styles/watercolor`, add `styles/ink` with the colour grammar; start
   screen picks a style; STYLE.md feeds the storyboard prompt.
8. **Clawd reaches + machines**: arm aim / IK to a target, new props crank, lever, gauge, hopper, slot, box and a
   `machine` template (feed → crank → machine works → output pops); metaphor rules (concept → action → object →
   Clawd does it) in the storyboard prompt; speech balloons tethered to the mouth.
9. **Could-haves**: slideshow-risk check (same template too often, weak motion) in the review; mocap stick-figure
   puppet with a starter catalogue; start from a reference video (uses the watch tooling); thin `Painter`
   interface so a second renderer can plug in.
10. **Fixes from replica-entrepreneur** (after it runs).
