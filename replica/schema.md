# Schema: Inkframe 3 files (TypeScript types, checked on write)

Inkframe stores projects as files, not tables. These types go to `lib/store/types.ts`; every writer validates
before writing and every reader fills defaults, so projects made before Inkframe 3 still open.

```ts
export type StageId = 'brief' | 'script' | 'storyboard' | 'paint' | 'voice' | 'compose' | 'review' | 'final';
export type StageStatus = 'pending' | 'in_progress' | 'awaiting' | 'completed' | 'revised' | 'failed';

/** which stages stop for a human; a config value, not code (inkframe.config.json, per project override) */
export interface GatePolicy { script: boolean; storyboard: boolean; final: boolean }   // default all true

/** projects/<id>/stages/<stage>.json — the newest version; older ones in stages/history/<stage>.v<N>.json */
export interface Checkpoint {
  stage: StageId;
  status: StageStatus;
  version: number;                 // +1 on every revise; approvals name the version they approve
  startedAt: string; updatedAt: string;
  gate?: boolean;                  // this version waits for a human: `completed` only with an approval of this version (M1)
  artifact?: unknown;              // script: SceneBoard[]; storyboard: {n, frame, line, start, duration}[]; final: {video, review}
  doneScenes?: number[];           // resume point for paint / voice
  approval?: { decision: 'approve' | 'revise'; version: number; note?: string; at: string };
  estimate?: Estimate;
}

/** projects/<id>/events.jsonl — one JSON per line, append-only */
export interface LoggedEvent {
  at: string;                      // ISO, UTC
  stage?: StageId; scene?: number;
  kind: 'stage' | 'gate' | 'scene' | 'frame' | 'voice' | 'cut' | 'review' | 'decision' | 'error' | 'log';
  payload: Record<string, unknown>;
}

/** projects/<id>/decisions.jsonl */
export interface Decision {
  at: string; stage: StageId;
  what: 'template' | 'style' | 'voice' | 'music' | 'fallback' | 'format' | 'other';
  chosen: string; alternatives: string[]; reason: string;
  confidence: 'high' | 'medium' | 'low';
  estimate?: Estimate; actual?: Estimate;
}

/** projects/<id>/estimate.json and on each gate */
export interface Estimate {
  frames: number; secPerFrame: number; workers: number;
  paintSec: number; voiceSec: number; cutSec: number;
  claudeCalls: number; diskMb: number;
  mode: 'observe' | 'warn' | 'cap'; capSec?: number;   // cap: stop before paint above capSec without approval
}

/** projects/<id>/review.json */
export interface Review {
  at: string; video: string;
  decision: 'PASS' | 'WARN' | 'FAIL';
  checks: {
    id: 'probe' | 'duration' | 'black' | 'blank' | 'silence' | 'clipping' | 'subtitles' | 'slideshow';
    ok: boolean; detail: string; at?: number[];     // seconds where it was found
  }[];
}

/** renderer/styles/<id>/style.json */
export interface StylePack {
  id: string; name: { ru: string; en: string };
  paper: string; ink: string; palette: Record<string, string>;
  brush: { wash: boolean; hatch: boolean; bleed: number; texture: number };
  boil: { fps: number; amp: number; inkOnly: boolean };
  springs: 'settle' | 'overshoot' | 'bouncy' | 'soft';
  grammar?: { structure: string; flow: string; problem: string; good: string };   // the Ink style
  preview: string;                                                               // a still for the start screen
}

/** renderer/mocap/catalog.json (milestone 9) */
export interface MocapClip { name: string; category: 'move' | 'action' | 'pose' | 'gesture' | 'dance'; description: string; frames: number; fps: number; source: string; licence: string }
```

Additions to existing types (`lib/engine/types.ts`):

```ts
ProjectStatus  += 'awaiting'
ProjectState   += stages: Record<StageId, { status: StageStatus; version: number }>; styleId: string; gate?: { stage: StageId; version: number; summary: string }
StartSettings  += styleId?: string            // format already exists ('16:9' | '9:16' | '1:1'); the real engine starts honouring it
EngineEvent    += { type: 'stage'; stage; status; version } | { type: 'gate'; stage; version; open: boolean; summary }
                | { type: 'estimate'; estimate } | { type: 'decision'; decision } | { type: 'review'; review }
StudioEngine   += approve(id, stage, version, note?) ; revise(id, stage, version, note)
```
