// The replay of a run (Inkframe 3, M5). Both engines keep a journal of the events they emit — events.jsonl on the
// server, memory in the demo — but never single frames, so the file stays small however long the cartoon is. The
// replay folds those very events with the reducer the studio uses live, so the stage rail, the scene cards and the
// activity feed change exactly as they did. Frames come from the scene's own files (the demo: its catalogue),
// spread over the time each scene was being drawn. Waits for a human (an open gate, a finished cartoon) are squeezed
// to a few seconds, so a run that waited an hour for «Утвердить» still replays in minutes.
import { NO_LOOK, applyEvent, emptyProject } from './reducer';
import type { EngineEvent, ProjectState, TimedEvent } from './types';
import { STAGE_NAMES, approvedWord, isStageId, type Decision, type LoggedEvent, type ReviewCheck, type StageId } from '../store/types';

/** progress goes to the journal in 5 % steps (the engines send one per frame) */
const PROGRESS_STEPS = 20;
const PCT = /^\d+ %$/;

/** What of an engine event the journal keeps: everything but frames and snapshots; progress in 5 % steps; a log line
 *  that only counts percent in 10 % steps. `before` is the state the event is applied to. */
export function forJournal(ev: EngineEvent, before: ProjectState): EngineEvent | undefined {
  switch (ev.type) {
    case 'snapshot': case 'frame': return undefined;
    case 'progress': {
      const step = (v: number) => Math.floor(v * PROGRESS_STEPS);
      return ev.value <= 0 || ev.value >= 1 || step(ev.value) !== step(before.progress) ? ev : undefined;
    }
    case 'log.update': {
      if (ev.text !== undefined || ev.detail === undefined || !PCT.test(ev.detail)) return ev;
      const was = before.log.find(l => l.id === ev.id);
      if (!was || was.status !== ev.status || !PCT.test(was.detail ?? '')) return ev;
      const tens = (d: string) => Math.floor(parseInt(d, 10) / 10);
      return tens(was.detail!) === tens(ev.detail) ? undefined : ev;
    }
    default: return ev;
  }
}

/** One events.jsonl line: a short summary people can grep (kind, stage, scene, payload) and the event for the replay. */
export function journalLine(ev: EngineEvent, before: ProjectState): Omit<LoggedEvent, 'at'> | undefined {
  const kept = forJournal(ev, before);
  return kept && { ...summary(kept), ev: kept };
}

function summary(ev: EngineEvent): Omit<LoggedEvent, 'at' | 'ev'> {
  switch (ev.type) {
    case 'stage': return { kind: 'stage', stage: ev.stage, payload: { status: ev.status, version: ev.version } };
    case 'gate': return { kind: 'gate', stage: ev.stage, payload: { open: ev.open, version: ev.version, ...(ev.open && { summary: ev.summary }) } };
    case 'scene.status': return { kind: 'scene', stage: 'paint', scene: ev.n, payload: { status: ev.status } };
    case 'scene.edited': return { kind: 'scene', stage: 'paint', scene: ev.n, payload: { edited: ev.request } };
    case 'video': return { kind: 'cut', stage: 'compose', payload: { src: ev.src } };
    case 'estimate': return { kind: 'estimate', stage: ev.estimate.stage, payload: { totalSec: ev.estimate.totalSec, frames: ev.estimate.frames, mode: ev.estimate.mode, ...(ev.estimate.actualSec !== undefined && { actualSec: ev.estimate.actualSec }) } };
    case 'decision': return { kind: 'decision', stage: ev.decision.stage, ...(ev.decision.scene && { scene: ev.decision.scene }), payload: { what: ev.decision.what, chosen: ev.decision.chosen } };
    case 'review': return { kind: 'review', stage: 'review', payload: { decision: ev.review.decision, video: ev.review.video, faults: ev.review.checks.filter(c => !c.ok).map(c => ({ id: c.id, warn: !!c.warn, detail: c.detail, ...(c.at && { at: c.at }) })) } };
    case 'log.add': return ev.step.status === 'err' ? { kind: 'error', payload: { text: ev.step.text, detail: ev.step.detail ?? '' } } : { kind: 'log', payload: { id: ev.step.id, text: ev.step.text } };
    case 'log.update': return ev.status === 'err' ? { kind: 'error', payload: { id: ev.id, text: ev.text ?? '', detail: ev.detail ?? '' } } : { kind: 'log', payload: { id: ev.id, status: ev.status } };
    case 'status': return { kind: 'status', payload: { status: ev.status } };
    case 'storyboard': return { kind: 'storyboard', stage: 'script', payload: { title: ev.title, scenes: ev.scenes.length } };
    case 'scene.key': return { kind: 'key', stage: 'storyboard', scene: ev.n, payload: { src: ev.src } };
    case 'scene.board': case 'scene.look': return { kind: 'board', scene: ev.n, payload: {} };
    case 'track': return { kind: 'track', stage: ev.kind === 'voice' ? 'voice' : 'compose', payload: { kind: ev.kind } };
    case 'progress': return { kind: 'progress', payload: { value: ev.value } };
    default: return { kind: 'log', payload: {} };
  }
}

// ---------- the replay ----------
/** Frames of one scene that exist on disk (or in the demo catalogue), in drawing order. */
export interface SceneFrames { sketch: string[]; color: string[] }
/** full = every step (M5 on); partial = a journal from M1–M4 (stages, gates, scene steps); none = no journal. */
export type JournalKind = 'full' | 'partial' | 'none';
/** A journaled event at its wall-clock time (ms since 1970). */
export interface Stamped { t: number; ev: EngineEvent }

export interface Replay {
  id: string;
  title: string;
  journal: JournalKind;
  /** the time of the first journal line; null without a journal */
  startedAt: string | null;
  /** the length of the replay, ms (waits for a human squeezed to IDLE_MS) */
  durationMs: number;
  /** wall time from the first line to the last, ms */
  realMs: number;
  /** where the replay starts: the project's settings, nothing written or drawn yet */
  initial: ProjectState;
  /** `at` = ms from the start of the replay, in order */
  events: TimedEvent[];
  /** when each stage first started, for the scrubber */
  marks: { stage: StageId; at: number }[];
  /** squeezed waits: where they start on the replay's clock and how long they really were */
  idle: { at: number; ms: number }[];
}

/** a wait for a human (or a pause of the server longer than BREAK_MS) lasts this long in the replay */
export const IDLE_MS = 3000;
const BREAK_MS = 5 * 60_000;
/** at most this many frames of each kind are shown per scene step */
const MAX_FRAMES = 8;

/** The replay of a project from its journal lines (events.jsonl). Lines without `ev` (an M1–M4 journal) are read as
 *  far as they go: stages, gates, scene steps, the cut, the review and errors, over the project's own scene list. */
export function replayFromJournal(p: ProjectState, lines: LoggedEvent[], frames: Record<number, SceneFrames> = {}): Replay {
  const full = lines.filter(l => l.ev);
  if (full.length) return buildReplay(p, full.map(l => ({ t: Date.parse(l.at), ev: l.ev! })), frames, 'full');
  const old = lines.flatMap((l, i) => { const ev = fromOldLine(l, i); return ev ? [{ t: Date.parse(l.at), ev }] : []; });
  return buildReplay(p, old, frames, old.length ? 'partial' : 'none');
}

export function buildReplay(p: ProjectState, items: Stamped[], frames: Record<number, SceneFrames> = {}, journal: JournalKind = items.length ? 'full' : 'none'): Replay {
  const sorted = items.filter(x => Number.isFinite(x.t)).map((x, i) => ({ ...x, i })).sort((a, b) => a.t - b.t || a.i - b.i);
  const initial = startOf(p, journal);
  const timed: TimedEvent[] = [], idle: Replay['idle'] = [];
  let s = initial, clock = 0, prev = sorted[0]?.t ?? 0;
  for (const x of sorted) {
    const gap = x.t - prev, waiting = !!s.gate || s.status === 'awaiting' || s.status === 'ready' || s.status === 'done';
    if (gap > IDLE_MS && (waiting || gap > BREAK_MS)) { idle.push({ at: clock, ms: gap }); clock += IDLE_MS; }
    else clock += Math.max(0, gap);
    prev = x.t;
    timed.push({ at: clock, ev: x.ev });
    s = applyEvent(s, x.ev);
  }
  const events = withFrames(timed, frames, s);
  return {
    id: p.id, title: s.title || p.title, journal,
    startedAt: sorted.length ? new Date(sorted[0].t).toISOString() : null,
    durationMs: clock, realMs: sorted.length ? sorted[sorted.length - 1].t - sorted[0].t : 0,
    initial, events, marks: marksOf(events), idle,
  };
}

/** The state of the run `ms` into the replay. */
export function stateAt(r: Replay, ms: number): ProjectState {
  let s = r.initial;
  for (const x of r.events) { if (x.at > ms) break; s = applyEvent(s, x.ev); }
  return s;
}

/** Wall-clock ms since the run's first line at `ms` into the replay (the squeezed waits put back). */
export function realOffset(r: Replay, ms: number): number {
  let extra = 0;
  for (const w of r.idle) {
    if (w.at >= ms) break;
    const part = Math.min(ms - w.at, IDLE_MS) / IDLE_MS;
    extra += part * (w.ms - IDLE_MS);
  }
  return ms + extra;
}

/** Where a replay starts: a full journal writes the scenes itself; an old one is laid over the project's scene list. */
function startOf(p: ProjectState, journal: JournalKind): ProjectState {
  const base = emptyProject(p.id, p.settings, p.engine, p.createdAt);
  if (journal !== 'partial') return base;
  return {
    ...base, title: p.title,
    scenes: p.scenes.map(sc => ({ ...sc, status: 'queued' as const, frame: undefined, frameKind: undefined, key: undefined, colors: [], look: NO_LOOK, edited: false, version: 1, edits: [] })),
  };
}

/** Frames spread over each drawing step: sketches between «набросок» and «рисую», colour frames up to «готово»,
 *  and the scene's last colour frame when it is done. */
function withFrames(timed: TimedEvent[], frames: Record<number, SceneFrames>, end: ProjectState): TimedEvent[] {
  if (!Object.keys(frames).length) return timed;
  const out = timed.map((x, i) => ({ ...x, seq: i }));
  const add = (at: number, seq: number, n: number, kind: 'sketch' | 'color', src: string, index: number) => {
    const total = Math.max(1, Math.round((end.scenes.find(sc => sc.n === n)?.duration ?? 4) * 12));
    out.push({ at, seq, ev: { type: 'frame', n, kind, src, index: Math.min(total, Math.round(index * total)), total } });
  };
  timed.forEach((x, i) => {
    if (x.ev.type !== 'scene.status') return;
    const { n, status } = x.ev, f = frames[n];
    if (!f || status === 'queued') return;
    const next = timed.findIndex((y, j) => j > i && y.ev.type === 'scene.status' && y.ev.n === n);
    const until = next >= 0 ? timed[next].at : x.at + 2000;
    if (status === 'done') {
      const last = f.color[f.color.length - 1] ?? f.sketch[f.sketch.length - 1];
      if (last) add(x.at, i + .5, n, f.color.length ? 'color' : 'sketch', last, 1);
      return;
    }
    const list = spread(status === 'sketch' ? f.sketch : f.color, MAX_FRAMES);
    list.forEach((src, k) => {
      const share = k / list.length;
      add(x.at + (until - x.at) * share, i + .5 + k / 1000, n, status === 'sketch' ? 'sketch' : 'color', src, status === 'sketch' ? share * .4 : .4 + share * .6);
    });
  });
  return out.sort((a, b) => a.at - b.at || a.seq - b.seq).map(({ at, ev }) => ({ at: Math.round(at), ev }));
}

/** Up to `max` items picked evenly, the first and the last always in. */
export function spread<T>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  return Array.from({ length: max }, (_, k) => xs[Math.round(k * (xs.length - 1) / (max - 1))]);
}

function marksOf(events: TimedEvent[]): Replay['marks'] {
  const seen = new Map<StageId, number>();
  for (const x of events) if (x.ev.type === 'stage' && x.ev.status !== 'pending' && !seen.has(x.ev.stage)) seen.set(x.ev.stage, x.at);
  return [...seen].map(([stage, at]) => ({ stage, at })).sort((a, b) => a.at - b.at);
}

/** An events.jsonl line from before M5 (no `ev`) as an engine event, where it carries enough. */
function fromOldLine(l: LoggedEvent, i: number): EngineEvent | undefined {
  const p = l.payload ?? {}, stage = isStageId(l.stage) ? l.stage : undefined, n = l.scene;
  switch (l.kind) {
    case 'stage':
      return stage && typeof p.status === 'string' ? { type: 'stage', stage, status: p.status as never, version: Number(p.version) || 1 } : undefined;
    case 'gate':
      if (!stage) return undefined;
      if (typeof p.open === 'boolean') return { type: 'gate', stage, version: Number(p.version) || 1, open: p.open, summary: String(p.summary ?? '') };
      if (p.decision === 'approve' || p.decision === 'revise') return {
        type: 'log.add', step: {
          id: `old-gate-${i}`, status: 'ok', ...(p.note ? { detail: `«${p.note}»` } : {}),
          text: p.decision === 'approve' ? `${STAGE_NAMES[stage]} v${p.version} ${approvedWord(stage)}` : `${STAGE_NAMES[stage]} v${p.version} вернули с замечанием`,
        },
      };
      return undefined;
    case 'scene':
      if (!n) return undefined;
      if (typeof p.status === 'string') return { type: 'scene.status', n, status: p.status as never };
      if (typeof p.edited === 'string') return { type: 'scene.edited', n, request: p.edited };
      return undefined;
    case 'cut': return typeof p.src === 'string' ? { type: 'video', src: p.src } : undefined;
    case 'review': {
      const faults = (Array.isArray(p.faults) ? p.faults : []) as ReviewCheck[];
      return { type: 'review', review: { at: l.at, video: String(p.video ?? ''), decision: (p.decision as 'PASS') ?? 'PASS', checks: faults.map(c => ({ ...c, ok: false })) } };
    }
    case 'decision': {
      if (typeof p.chosen !== 'string' || !stage) return undefined;
      const decision: Decision = { at: l.at, stage, what: (p.what as Decision['what']) ?? 'other', chosen: p.chosen, alternatives: [], reason: '', confidence: 'medium', ...(n && { scene: n }) };
      return { type: 'decision', decision };
    }
    case 'error': return { type: 'log.add', step: { id: `old-err-${i}`, text: String(p.text || 'Что-то пошло не так'), detail: String(p.detail ?? ''), status: 'err' } };
    default: return undefined;
  }
}
