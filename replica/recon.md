# Recon map: OpenMontage (agentic video production, local web board + CLI)

Scope: the hand-drawn animation path (Ink Theater) and the production-control layer around it (Backlot living
storyboard, approval gates, replay, quality gates, budget/decision log, style packs, output profiles).
For: Inkframe (MIT) — the studio Ru_ANGEL15 sells as "hand-painted explainer cartoons, made by Claude".
Date: 2026-10-29

**Clean-room rule.** OpenMontage is AGPL-3.0. Nothing below is code from it: only what it does and how a user
moves through it, from its public README and docs. Inkframe code is written fresh; no file, snippet or asset of
OpenMontage is copied. (Its handwriting font Patrick Hand is OFL and its mocap clips are CMU, free for any use —
if we ever want them, we take them from their original sources, not from OpenMontage.)

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | README | https://github.com/calesthio/OpenMontage#readme | pitch, governance, Backlot, style system, profiles |
| 2 | Architecture doc | docs/ARCHITECTURE.md | BaseTool, registry, selector, checkpoints, budget, 3-layer knowledge |
| 3 | Ink Theater README | ink-theater/README.md | the five capabilities, determinism rules, Ink Puppet, balloons |
| 4 | Ink Theater skill | skills/creative/ink-theater.md | concept → action → object → mascot method, archetypes, colour grammar |
| 5 | Backlot README | backlot/README.md | living board, state sources, replay |
| 6 | Checkpoint protocol | skills/meta/checkpoint-protocol.md | gate policy per stage, in_progress liveness, resume |
| 7 | Reviewer skill | skills/meta/reviewer.md | review rounds, slideshow risk, delivery promise |
| 8 | Pipeline manifest | pipeline_defs/animated-explainer.yaml | stage list and which stages gate |
| 9 | Customer brief | openmontage_architecture_patterns.docx (Ru_ANGEL15) | BaseTool/Registry, RenderSelector, YAML pipelines, gates, audit+budget, style packs |
| 10 | Inkframe today | /root/inkframe README.md, lib/, renderer/, components/studio/ | what we already have |

Repo facts (29.10.2026): ~72.9k stars, AGPL-3.0, 12 pipelines, 100+ tools, 700+ skill files, last push 28.10.2026.

## Core loop

You describe a video (or paste one you like); the agent plans it in stages, stops for your yes at every creative
decision, renders, checks its own render, and you watch all of it fill in on a live board.

Inkframe's core loop is the same shape for one genre: idea → script/storyboard → painted scenes → voice → MP4,
with scene-level edits. OpenMontage is wider (many genres, many providers); Inkframe can be deeper in one.

## Screens

OpenMontage (Backlot is its only real UI; everything else is chat):

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Library | `backlot open` | every production on disk, live first | project cards, live badge | empty, filled, live |
| S02 | Live board | `backlot open <id>` | production as it happens | stage rail, script card, filmstrip, decisions, cost meter, activity, renders | idle, live, awaiting_human, done, no-checkpoint fallback |
| S03 | Script gate | board → stage awaiting | approve the script before visuals | screenplay page, "awaiting your approval" banner | awaiting, approved, revised (versions) |
| S04 | Storyboard gate | board → assets stage | approve visuals before render | contact sheet per scene: takes, prompt, cost, quality score | generating (shimmer), awaiting, approved |
| S05 | Replay | board → ▶ REPLAY RUN | scrub a finished run end to end | scrubber over checkpoint history + events | playing, paused |

Inkframe today: S01 start (idea + style + settings), S02 studio (Stage, Timeline, WorkLog, EditPanel,
BuildDialog), Settings dialog. No library, no gates, no replay.

## Flows

```
F01 Idea to approved video (OpenMontage)
    chat brief -> proposal (gate) -> script (gate, S03) -> scene plan (gate) -> assets (gate, S04)
    -> edit -> compose -> post-render self-review -> publish (gate)
    happy path: 5 approvals
    edge: reviewer says REVISE (new version, old one archived); session dies mid-assets (resume from
          in_progress checkpoint); render fails self-review (not shown to the user)

F02 Watch a production live
    S01 -> S02 ; stages light up, scene cards shimmer while generating, cost meter moves
    edge: project without checkpoints -> "what the watcher found" view

F03 Replay a finished run
    S02 -> S05 ; scrub the whole production from timestamps

F04 Start from a reference video
    paste URL -> analysis (pacing, hook, scenes, style) -> 2–3 concepts with cost + sample -> F01

Inkframe F01 today: S01 idea -> S02 storyboard + painting stream -> edit a scene in words -> MP4. 2 clicks, 0 gates.
```

## Components (to rebuild in Inkframe's own design)

| component | variants | states | used on |
| --- | --- | --- | --- |
| Stage rail | horizontal steps | pending, in_progress, awaiting_human, completed, revised | S02 |
| Gate banner | script, storyboard, final | awaiting, approved, sent back with note | S02–S04 |
| Contact sheet | scene card with key frame, words, timing, estimate | painting (shimmer), ready, approved, redraw | S04 |
| Activity feed | event line with time | live, replay | S02, S05 |
| Cost/time meter | estimate vs actual | under, near cap, over | S02 |
| Replay scrubber | — | playing, paused | S05 |
| Self-review report | pass / warnings / fail | — | after render |

## Inferred data model (for Inkframe, file-based like today)

```
Project      id, title, idea, style_pack, profile (16:9 | 9:16 | 1:1), created_at
             evidence: backlot project.json; Inkframe projects/ ; confidence: high
Checkpoint   project_id, stage (brief|script|storyboard|keyframes|paint|voice|compose|review), status
             (in_progress|awaiting_human|completed|revised), version, artifacts, approved_by, note, at
             evidence: checkpoint protocol, backlot state table ; confidence: high
Event        project_id, at, stage, scene_id?, kind (start|frame|done|error|decision|gate), payload
             evidence: events.jsonl feeds activity + replay ; confidence: high
Decision     project_id, at, what, chosen, alternatives[], reason, confidence, estimate, actual
             evidence: decision audit trail ; confidence: medium
Review       project_id, stage, round, decision (PASS|REVISE|PASS_WITH_WARNINGS), findings[]
             evidence: reviewer skill ; confidence: medium
StylePack    id, name, palette, brush params, paper, line boil {fps, amp}, colour grammar, notes (STYLE.md)
             evidence: style playbooks + customer brief ; confidence: medium (ours to design)
```

Relationships: Project 1-n Checkpoint (versioned), Project 1-n Event, Project 1-n Decision, Project n-1 StylePack.

## Feature matrix

See `features.csv`. Must 9, should 13, could 7, skip 6.

## What will lift Inkframe most (effect ÷ effort)

| # | capability | why it matters to a buyer | size | lands in Inkframe |
| --- | --- | --- | --- | --- |
| 1 | Line boil — **already in Inkframe** (core.js BOIL 12 fps, boilSeed); left to do: per-style amplitude/fps, still props hold, ink-only boil | the "alive" look tuned per style | 0.5 d | renderer/engine/core.js (+ timeline.js), templates.js |
| 2 | Spring easing — **partly in Inkframe** (backOut, elasticOut, spring); left to do: named presets + anticipation used everywhere | props pop, Clawd lands and settles instead of sliding linearly | 0.5 d | renderer/engine/timeline.js, props.js |
| 3 | Approval gates: script → storyboard contact sheet → final | client approves before the expensive paint; fewer redo cycles, sells as "you stay in control" | 1.5 d | lib/engine/real.ts, reducer.ts, types.ts, components/studio (new GatePanel) |
| 4 | Post-render self-review (ffprobe, 4 frames black/blank check, silence/clipping, subtitles present) | we never hand over a broken MP4 | 0.5 d | lib/real/assemble.ts (+ new review.ts), WorkLog |
| 5 | Output profiles 16:9 / 9:16 / 1:1 — **renderer already has 9:16 (?tall)**, the engine ignores settings.format and templates are laid out for 1920×1080 | Reels, Shorts, TikTok — what business clients actually post | 1 d | renderer/stage.html, templates.js layout, assemble.ts, options.ts |
| 6 | Living board + replay (stage rail, scene cards fill in, time meter, replay from events) | the demo that sells the studio; the client watches the production | 1.5 d | lib/engine (events.jsonl), components/studio (Rail, Replay), app/studio/[id] |
| 7 | Style packs (2 to start: "Watercolour" = today, "Ink" = black ink on white with colour grammar) | one engine, several looks; a price tier per style | 1.5 d | new renderer/styles/, scene-spec.ts, templates.js, StartScreen |
| 8 | Clawd arms by IK (FABRIK) + contraption props (crank, lever, gauge, hopper) + new "machine" template | the host physically does the idea (cranks the machine), not just points at it | 2 d | renderer/engine/clawd.js, props.js, templates.js, scene-spec.ts |

Also worth it, later: time/cost estimate before paint shown on the gate (part of #3, +0.25 d); decision log
(why this template/style/voice) in WorkLog (0.5 d); concept→action→object→mascot metaphor rules for the
storyboard prompt (0.25 d, lib/real/storyboard.ts — big quality gain for little work).

## Out of scope (cannot or should not be cloned)

- OpenMontage code, assets, prompts and skill texts — AGPL-3.0; ideas only.
- 60+ provider integrations, paid video/image generators, stock libraries — their catalogue, not a feature; Inkframe's point is "everything painted by code".
- Remotion / HyperFrames runtimes — we have our own p5.brush renderer.
- 12 pipelines (talking head, podcast repurpose, dubbing, documentary) — other products; Inkframe stays one genre done best.
- ToolRegistry + scored RenderSelector across many providers — with one renderer it is ceremony; keep a thin `Painter` interface so a second renderer can plug in later (customer brief, item 1–2) — could.
- Mocap ink-puppet from CMU clips — could (2 d): needs a fresh BVH→2D converter and a stick-figure rig distinct from Clawd.

## Size

Screens to add 3 (gate panel, live rail/board, replay), flows 3, entities 6 (files, no database).
Hard parts: boil that stays seek-safe across parallel painters; vertical 9:16 layouts for all four templates;
IK that looks natural with the existing Clawd drawing. Size: **M** — about 8–10 working days for the top 8.

Build order (thin slice first): 1 boil + 2 springs (visible on day 1) → 4 self-review → 3 gates (+ estimate)
→ 6 living board + replay → 5 profiles → 7 style packs → 8 IK + contraptions → metaphor rules → could-list.


**Correction 29.10 (stage 2):** reading the renderer showed boil, part of the springs and the 9:16 stage already exist. features.csv updated.
