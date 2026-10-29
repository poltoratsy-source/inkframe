// Inkframe 3 production control: the stages a cartoon goes through, their checkpoints and the event journal.
// Plain types and pure helpers only, so the browser demo and the server share them (see replica/schema.md).

export type StageId = 'brief' | 'script' | 'storyboard' | 'paint' | 'voice' | 'compose' | 'review' | 'final';
export type StageStatus = 'pending' | 'in_progress' | 'awaiting' | 'completed' | 'revised' | 'failed';

export const STAGE_IDS: StageId[] = ['brief', 'script', 'storyboard', 'paint', 'voice', 'compose', 'review', 'final'];
export const STAGE_STATUSES: StageStatus[] = ['pending', 'in_progress', 'awaiting', 'completed', 'revised', 'failed'];
/** Stages the engines run today; storyboard and final join with their milestones (architecture.md, build order). */
export const LIVE_STAGES: StageId[] = ['brief', 'script', 'paint', 'voice', 'compose', 'review'];

export const STAGE_NAMES: Record<StageId, string> = {
  brief: 'Бриф', script: 'Сценарий', storyboard: 'Раскадровка', paint: 'Отрисовка',
  voice: 'Голос', compose: 'Сборка', review: 'Проверка', final: 'Финал',
};

export const isStageId = (v: unknown): v is StageId => typeof v === 'string' && (STAGE_IDS as string[]).includes(v);

/** Which stages stop for a human. Only `script` has a gate in this build; the others are read but not used yet. */
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

export interface Approval { decision: 'approve' | 'revise'; version: number; note?: string; at: string }

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
}

/** projects/<id>/events.jsonl — one JSON per line, append-only */
export interface LoggedEvent {
  at: string;
  stage?: StageId;
  scene?: number;
  kind: 'stage' | 'gate' | 'scene' | 'frame' | 'voice' | 'cut' | 'review' | 'decision' | 'error' | 'log';
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
