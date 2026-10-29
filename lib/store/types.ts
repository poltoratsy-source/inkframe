// Inkframe 3 production control: the stages a cartoon goes through, their checkpoints and the event journal.
// Plain types and pure helpers only, so the browser demo and the server share them (see replica/schema.md).

export type StageId = 'brief' | 'script' | 'storyboard' | 'paint' | 'voice' | 'compose' | 'review' | 'final';
export type StageStatus = 'pending' | 'in_progress' | 'awaiting' | 'completed' | 'revised' | 'failed';

export const STAGE_IDS: StageId[] = ['brief', 'script', 'storyboard', 'paint', 'voice', 'compose', 'review', 'final'];
export const STAGE_STATUSES: StageStatus[] = ['pending', 'in_progress', 'awaiting', 'completed', 'revised', 'failed'];
/** Stages the engines run (M4: every one of them; the rail shows them all). */
export const LIVE_STAGES: StageId[] = [...STAGE_IDS];

export const STAGE_NAMES: Record<StageId, string> = {
  brief: 'Бриф', script: 'Сценарий', storyboard: 'Раскадровка', paint: 'Отрисовка',
  voice: 'Голос', compose: 'Сборка', review: 'Проверка', final: 'Финал',
};

/** «утверждён» / «утверждена» — the stage names are of both genders */
export const approvedWord = (id: StageId) => (['storyboard', 'paint', 'compose', 'review'].includes(id) ? 'утверждена' : 'утверждён');

export const isStageId = (v: unknown): v is StageId => typeof v === 'string' && (STAGE_IDS as string[]).includes(v);

/** Which stages stop for a human: the script, the storyboard (contact sheet of key frames) and the final MP4. */
export interface GatePolicy { script: boolean; storyboard: boolean; final: boolean }
export const DEFAULT_GATES: GatePolicy = { script: true, storyboard: true, final: true };

/** `INKFRAME_GATES=off` switches every gate off; `script,final` keeps only those; empty = the defaults. */
export function gatesFrom(value: string | undefined, base: GatePolicy = DEFAULT_GATES): GatePolicy {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return { ...base };
  if (['off', 'none', '0', 'false', 'no'].includes(v)) return { script: false, storyboard: false, final: false };
  if (['on', 'all', '1', 'true', 'yes'].includes(v)) return { script: true, storyboard: true, final: true };
  const on = new Set(v.split(/[\s,]+/));
  return { script: on.has('script'), storyboard: on.has('storyboard'), final: on.has('final') };
}

/** One scene marked «перерисовать» on the storyboard gate, with what to change in it. */
export interface SceneNote { n: number; note: string }
export interface Approval {
  decision: 'approve' | 'revise'; version: number; note?: string; at: string;
  /** revise: scenes marked one by one (storyboard: redraw these; final: redo this scene) */
  scenes?: SceneNote[];
  /** approve: the estimate was over the cap and the human allowed it */
  overCap?: boolean;
}

/** projects/<id>/stages/<stage>.json — the newest version; older ones in stages/history/<stage>.v<N>.json */
export interface Checkpoint {
  stage: StageId;
  status: StageStatus;
  /** +1 every time a stage shows a new result (after a revise); approvals name the version they approve */
  version: number;
  startedAt: string;
  updatedAt: string;
  /** true when this version waits for a human: it cannot become `completed` without an approval of this version */
  gate?: boolean;
  artifact?: unknown;
  /** resume point for paint / voice */
  doneScenes?: number[];
  approval?: Approval;
  /** what the work after this gate will cost (lib/real/estimate.ts); in `cap` mode approve needs allowOverCap */
  estimate?: Estimate;
}

// ---------- budget ----------
/** observe = only show; warn = show a warning above capSec; cap = approve needs an explicit permission above capSec */
export type BudgetMode = 'observe' | 'warn' | 'cap';
export interface BudgetPolicy { mode: BudgetMode; capSec?: number }
export const DEFAULT_BUDGET: BudgetPolicy = { mode: 'observe' };
/** warn / cap without a number: 15 minutes of work */
export const DEFAULT_CAP_SEC = 900;

/** projects/<id>/estimate.json and on each gate: the time and resources of the rest of the run.
 *  paintSec = (draft + key frames × draft s/frame + final frames × final s/frame) / workers. */
export interface Estimate {
  /** the gate this estimate was shown on */
  stage: StageId;
  at: string;
  frames: number;
  /** key frames for the contact sheet, draft frames (sketch + colour), final frames of the MP4 */
  keyFrames: number; draftFrames: number; finalFrames: number;
  /** seconds of one worker per final frame, and per draft frame */
  secPerFrame: number; draftSecPerFrame: number;
  /** true = s/frame from this server's last frames; false = the built-in fallback */
  measured: boolean;
  workers: number;
  paintSec: number; voiceSec: number; cutSec: number; totalSec: number;
  /** Claude requests: made for this cartoon so far + the ones the rest of the run needs */
  claudeCalls: number;
  diskMb: number;
  mode: BudgetMode; capSec?: number;
  /** wall time the work really took, filled in when it is over */
  actualSec?: number;
  actual?: { paintSec: number; voiceSec: number; cutSec: number };
}

/** Over the cap: approving needs `allowOverCap` (checked in the store, not only in the button). */
export const overCap = (e: Estimate | undefined): boolean =>
  !!e && e.mode === 'cap' && e.capSec !== undefined && e.actualSec === undefined && e.totalSec > e.capSec;

// ---------- decisions ----------
/** projects/<id>/decisions.jsonl — what the engine chose, out of what, and why (shown in WorkLog as «решение: …») */
export interface Decision {
  at: string;
  stage: StageId;
  what: 'template' | 'style' | 'voice' | 'music' | 'fallback' | 'format' | 'estimate' | 'other';
  /** the scene it is about, for per-scene choices */
  scene?: number;
  chosen: string;
  alternatives: string[];
  reason: string;
  confidence: 'high' | 'medium' | 'low';
  estimate?: Estimate;
}

/** projects/<id>/events.jsonl — one JSON per line, append-only */
export interface LoggedEvent {
  at: string;
  stage?: StageId;
  scene?: number;
  kind: 'stage' | 'gate' | 'scene' | 'frame' | 'voice' | 'cut' | 'review' | 'decision' | 'estimate' | 'error' | 'log';
  payload: Record<string, unknown>;
}

/** What ProjectState carries for the screens: one line per stage. */
export type StageMap = Record<StageId, { status: StageStatus; version: number }>;
export const defaultStages = (): StageMap =>
  Object.fromEntries(STAGE_IDS.map(id => [id, { status: 'pending', version: 1 }])) as StageMap;

/** The open gate as the screens see it. */
export interface OpenGate { stage: StageId; version: number; summary: string }

/** What the self-review looks at in a finished MP4 (lib/real/review.ts). */
export type CheckId = 'probe' | 'duration' | 'black' | 'blank' | 'silence' | 'clipping' | 'subtitles' | 'slideshow';
/** One check: ok, or not ok with `warn` (a remark: the MP4 is still handed out) or without it (a fault: it is not). */
export interface ReviewCheck { id: CheckId; ok: boolean; warn?: boolean; detail: string; at?: number[] }

/** projects/<id>/review.json — the self-review of the newest cut. FAIL keeps the MP4 off the screen. */
export interface Review {
  at: string;
  /** the checked MP4 as the studio opens it (/api/projects/<id>/files/cut-N.mp4) */
  video: string;
  decision: 'PASS' | 'WARN' | 'FAIL';
  checks: ReviewCheck[];
}

/** FAIL if any check failed, WARN if any only warned, else PASS. */
export const decide = (checks: ReviewCheck[]): Review['decision'] =>
  checks.some(c => !c.ok && !c.warn) ? 'FAIL' : checks.some(c => !c.ok) ? 'WARN' : 'PASS';
