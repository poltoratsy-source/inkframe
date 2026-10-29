// M5: the journal (events.jsonl) without frames, the replay folded from it with the studio's own reducer, the
// recorded demo run, the library cards and GET /api/projects/[id]/replay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { DemoEngine, demoReplay } from '../lib/engine/demo.ts';
import { SR } from '../lib/real/audio.ts';
import { applyEvent, emptyProject } from '../lib/engine/reducer.ts';
import { buildReplay, forJournal, realOffset, replayFromJournal, stateAt, IDLE_MS, type Replay } from '../lib/engine/replay.ts';
import { badgeOf, sortLibrary, stageOf, summarize } from '../lib/engine/library.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import { DEFAULT_GATES, STAGE_IDS, type LoggedEvent } from '../lib/store/types.ts';
import type { EngineEvent, ProjectState, StudioEngine } from '../lib/engine/types.ts';
import { tmp } from './helpers/tmp.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
const BOARD = {
  title: 'Почему небо голубое',
  scenes: [
    { title: 'Вопрос', line: 'Привет! Почему небо голубое?', duration: 4, spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' } },
    { title: 'Рассеяние', line: 'Синий свет рассеивается в воздухе сильнее красного.', duration: 6, spec: { template: 'compare', left: { prop: 'wave', color: 'blue', caption: 'синий' }, right: { prop: 'wave', color: 'red', caption: 'красный' } } },
    { title: 'Финал', line: 'Пиши в комментариях НЕБО!', duration: 5, spec: { template: 'card', setting: 'sunset', title: 'НЕБО' } },
  ],
};

function tools(): Partial<RealTools> {
  return {
    ask: async () => JSON.stringify(BOARD),
    voice: async jobs => { for (const j of jobs) { writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w]) })); } },
    decode: async f => new Float32Array(Math.round(JSON.parse(readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length * .35 * SR)).fill(.2),
    painter: { workers: 3, close: async () => {}, frames: async (_s, times, _o, onFrame) => { for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg')); } },
    ffmpeg: async (args, cwd) => { writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
    review: async plan => ({ at: new Date().toISOString(), video: plan.src, decision: 'PASS', checks: [{ id: 'probe', ok: true, detail: '1280×720' }] }),
  };
}

const until = (e: StudioEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(resolve => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); resolve(); } });
});
/** The user pressing «Утвердить» on every gate, until the cartoon is done. */
async function runToDone(e: StudioEngine, s = settings) {
  const p = e.create(s);
  const off = e.subscribe(p.id, ev => { if (ev.type === 'gate' && ev.open) setTimeout(() => e.approve(p.id, ev.stage, ev.version), 5); });
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  off();
  return p.id;
}
const end = (r: Replay) => stateAt(r, r.durationMs);
/** What the board shows, without the frames themselves (those come from files in the replay, not from the journal). */
const board = (s: ProjectState) => ({
  ...s, current: undefined,
  scenes: s.scenes.map(({ frame: _f, frameKind: _k, colors: _c, ...sc }) => sc),
});
const lines = (f: string): LoggedEvent[] => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const realEngine = (dir = tmp(), more = {}) => new RealEngine({ dir, tools: tools(), draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' }, ...more });
const dirOf = (e: RealEngine, id: string) => e.fileOf(id, 'stages/script.json')!.replace(/\/stages\/script\.json$/, '');

test('journal rule: no frames or snapshots, progress in 5 % steps, percent-only log lines in 10 % steps', () => {
  const p = emptyProject('x', settings, 'real');
  assert.equal(forJournal({ type: 'frame', n: 1, kind: 'color', src: 'a.jpg', index: 1, total: 10 }, p), undefined);
  assert.equal(forJournal({ type: 'snapshot', state: p }, p), undefined);
  const at = (v: number) => ({ ...p, progress: v });
  assert.equal(forJournal({ type: 'progress', value: .12, etaSec: 5 }, at(.11)), undefined);
  assert.ok(forJournal({ type: 'progress', value: .151, etaSec: 5 }, at(.149)));
  assert.ok(forJournal({ type: 'progress', value: 1, etaSec: 0 }, at(1)), 'the end always goes in');
  const withLine = { ...p, log: [{ id: 'build-1', text: 'Рисую', status: 'run' as const, detail: '41 %' }] };
  assert.equal(forJournal({ type: 'log.update', id: 'build-1', status: 'run', detail: '47 %' }, withLine), undefined);
  assert.ok(forJournal({ type: 'log.update', id: 'build-1', status: 'run', detail: '52 %' }, withLine));
  assert.ok(forJournal({ type: 'log.update', id: 'build-1', status: 'run', text: 'Свожу', detail: '43 %' }, withLine), 'a new text always goes in');
  assert.ok(forJournal({ type: 'log.update', id: 'build-1', status: 'ok', detail: '44 %' }, withLine), 'a new status always goes in');
});

test('replay from events.jsonl: in order, times relative to the first line, waits at a gate squeezed', () => {
  const p = emptyProject('abc', settings, 'real', '2026-10-29T10:00:00.000Z');
  const ln = (sec: number, ev: EngineEvent): LoggedEvent => ({ at: new Date(Date.parse('2026-10-29T10:00:00.000Z') + sec * 1000).toISOString(), kind: 'log', payload: {}, ev });
  const r = replayFromJournal(p, [
    ln(1, { type: 'status', status: 'drafting' }),
    ln(1, { type: 'stage', stage: 'brief', status: 'completed', version: 1 }),
    ln(2.5, { type: 'stage', stage: 'script', status: 'in_progress', version: 1 }),
    ln(3, { type: 'gate', stage: 'script', version: 1, open: true, summary: '3 сцены' }),
    ln(3, { type: 'status', status: 'awaiting' }),
    ln(3 + 3600, { type: 'stage', stage: 'script', status: 'completed', version: 1 }),   // an hour later: «Утвердить»
    ln(3 + 3600, { type: 'gate', stage: 'script', version: 1, open: false, summary: '' }),
    ln(3 + 3602, { type: 'status', status: 'drawing' }),
  ]);
  assert.equal(r.journal, 'full');
  assert.equal(r.startedAt, '2026-10-29T10:00:01.000Z');
  assert.deepEqual(r.events.map(x => x.at), [0, 0, 1500, 2000, 2000, 2000 + IDLE_MS, 2000 + IDLE_MS, 4000 + IDLE_MS]);
  assert.equal(r.realMs, 3605_000 - 1000);
  assert.deepEqual(r.idle, [{ at: 2000, ms: 3600_000 }]);
  assert.equal(Math.round(realOffset(r, 2000 + IDLE_MS)), 3602_000, 'the squeezed wait is put back for the clock');
  assert.deepEqual(r.marks.map(m => m.stage), ['brief', 'script']);
  assert.equal(stateAt(r, 2500).gate?.stage, 'script', 'mid-replay: the gate is open');
  assert.equal(stateAt(r, r.durationMs).status, 'drawing');
  assert.equal(stateAt(r, -1).status, 'drafting', 'before the first event: the start state');
});

test('a project without a journal, and one with an M1–M4 journal', () => {
  const p0 = emptyProject('old', settings, 'real');
  const none = replayFromJournal(p0, []);
  assert.deepEqual([none.journal, none.events.length, none.startedAt, none.durationMs], ['none', 0, null, 0]);
  // M4 lines have no `ev`: stages, gates and scene steps are read over the project's own scene list
  let p = applyEvent(p0, { type: 'storyboard', title: 'Небо', scenes: BOARD.scenes.map((b, i) => ({ n: i + 1, title: b.title, visual: '', line: b.line, start: i * 5, duration: 5 })) });
  p = applyEvent(p, { type: 'scene.status', n: 1, status: 'done' });
  const at = (s: number) => new Date(Date.parse('2026-10-29T10:00:00Z') + s * 1000).toISOString();
  const old = replayFromJournal(p, [
    { at: at(0), kind: 'stage', stage: 'script', payload: { status: 'awaiting', version: 1 } },
    { at: at(0), kind: 'gate', stage: 'script', payload: { open: true, version: 1, summary: '3 сцены' } },
    { at: at(5), kind: 'gate', stage: 'script', payload: { decision: 'approve', version: 1, note: 'годится' } },
    { at: at(5), kind: 'gate', stage: 'script', payload: { open: false, version: 1 } },
    { at: at(6), kind: 'scene', stage: 'paint', scene: 1, payload: { status: 'sketch' } },
    { at: at(8), kind: 'scene', stage: 'paint', scene: 1, payload: { status: 'done' } },
    { at: at(9), kind: 'error', payload: { text: 'MP4 не собрался', detail: 'ffmpeg' } },
  ]);
  assert.equal(old.journal, 'partial');
  assert.equal(old.initial.scenes.length, 3, 'the scene list comes from the project');
  assert.ok(old.initial.scenes.every(sc => sc.status === 'queued' && !sc.frame));
  const s = end(old);
  assert.equal(s.scenes[0].status, 'done');
  assert.equal(s.stages.script.status, 'awaiting');
  assert.ok(s.log.some(l => /Сценарий v1 утверждён/.test(l.text) && l.detail === '«годится»'));
  assert.ok(s.log.some(l => l.status === 'err'));
});

test('frames come from the scene files, spread over its drawing steps — not from the journal', () => {
  const p = emptyProject('f', settings, 'real');
  const t0 = Date.parse('2026-10-29T10:00:00Z');
  const r = buildReplay(p, [
    { t: t0, ev: { type: 'storyboard', title: 'Небо', scenes: [{ n: 1, title: 'A', visual: '', line: '', start: 0, duration: 4 }] } },
    { t: t0 + 1000, ev: { type: 'scene.status', n: 1, status: 'sketch' } },
    { t: t0 + 2000, ev: { type: 'scene.status', n: 1, status: 'painting' } },
    { t: t0 + 6000, ev: { type: 'scene.status', n: 1, status: 'done' } },
  ], { 1: { sketch: ['s0.jpg', 's1.jpg'], color: ['c0.jpg', 'c1.jpg', 'c2.jpg', 'c3.jpg'] } });
  const frames = r.events.filter(x => x.ev.type === 'frame');
  assert.equal(frames.length, 2 + 4 + 1);
  assert.ok(r.events.every((x, i) => i === 0 || x.at >= r.events[i - 1].at), 'still in order');
  assert.equal(stateAt(r, 1200).scenes[0].frame, 's0.jpg');
  assert.equal(stateAt(r, 1600).scenes[0].frame, 's1.jpg');
  assert.equal(stateAt(r, 4500).scenes[0].frameKind, 'color');
  const s = end(r);
  assert.equal(s.scenes[0].frame, 'c3.jpg', 'a done scene shows its last colour frame');
  assert.deepEqual(s.scenes[0].colors, ['c0.jpg', 'c1.jpg', 'c2.jpg', 'c3.jpg']);
});

test('demo: the replay of a finished run folds to the same board as the live run', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const id = await runToDone(e);
  const live = e.get(id)!, r = e.replay(id)!;
  assert.equal(r.journal, 'full');
  assert.deepEqual(board(end(r)), board(live));
  assert.ok(end(r).scenes.every(sc => sc.frame && sc.colors.length > 0), 'every card has its frames in the replay');
  assert.ok(!r.events.some((x, i) => i > 0 && x.at < r.events[i - 1].at));
  assert.deepEqual(r.marks.map(m => m.stage).sort(), [...STAGE_IDS].sort(), 'a mark for every stage');
  assert.equal(e.replay('nope'), undefined);
});

test('demo: the run recorded in advance plays every stage, the three gates and ends done', () => {
  const r = demoReplay();
  const s = end(r);
  assert.equal(s.status, 'done');
  assert.ok(STAGE_IDS.every(id => s.stages[id].status === 'completed'));
  assert.equal(r.idle.length, 3, 'three waits for «Утвердить», squeezed');
  assert.ok(s.video && s.review?.decision === 'PASS');
  assert.ok(s.estimate?.actualSec !== undefined && s.estimate.startedAt, 'plan and fact on the board');
  assert.ok(s.scenes.every(sc => sc.key && sc.frame));
  assert.ok(r.durationMs > 20_000 && r.durationMs < 120_000, `${r.durationMs} ms`);
  // on the way: a gate open, scenes in every state
  const seen = new Set<string>();
  for (let t = 0; t <= r.durationMs; t += 250) for (const sc of stateAt(r, t).scenes) seen.add(sc.status);
  assert.deepEqual([...seen].sort(), ['done', 'painting', 'queued', 'sketch']);
});

test('real engine: events.jsonl has no frames and does not grow with them; the replay folds to the live board, also after a restart', async () => {
  const dir = tmp();
  const few = realEngine(dir, { draftFps: 1, sketchFrames: 2 }), many = realEngine(tmp(), { draftFps: 8, sketchFrames: 8 });
  const a = await runToDone(few), b = await runToDone(many);
  const la = lines(join(dirOf(few, a), 'events.jsonl')), lb = lines(join(dirOf(many, b), 'events.jsonl'));
  assert.ok(!la.some(l => l.kind === 'frame' || l.ev?.type === 'frame'));
  const framesA = few.get(a)!.scenes.reduce((n, sc) => n + sc.colors.length, 0), framesB = many.get(b)!.scenes.reduce((n, sc) => n + sc.colors.length, 0);
  assert.ok(framesB >= framesA * 5, `${framesA} → ${framesB} colour frames`);
  assert.ok(lb.length - la.length <= 25, `journal lines: ${la.length} → ${lb.length} (only progress steps may add)`);
  console.log(`     events.jsonl: ${la.length} lines, ${statSync(join(dirOf(few, a), 'events.jsonl')).size} bytes`);
  // the replay
  const live = few.get(a)!, r = few.replay(a)!;
  assert.equal(r.journal, 'full');
  assert.deepEqual(board(end(r)), board(live));
  assert.ok(end(r).scenes.every(sc => sc.frame?.startsWith(`/api/projects/${a}/files/frames/s${sc.n}-v`)), 'frames from the scene folders');
  assert.ok(r.events.filter(x => x.ev.type === 'frame').every(x => few.fileOf(a, (x.ev as { src: string }).src.split('/files/')[1])), 'every frame exists on disk');
  // after a restart the journal is read from disk
  const again = realEngine(dir);
  assert.deepEqual(board(end(again.replay(a)!)), board(live));
  assert.equal(again.replay('nope'), undefined);
});

test('real engine: an old project (no events.jsonl) replays as «no journal»', () => {
  const dir = tmp(), id = 'old12345';
  mkdirSync(join(dir, id), { recursive: true });
  const state = { ...emptyProject(id, settings, 'real'), status: 'done' };
  writeFileSync(join(dir, id, 'project.json'), JSON.stringify({ state, scenes: [], cut: 1 }));
  const r = realEngine(dir).replay(id)!;
  assert.equal(r.journal, 'none');
  assert.equal(r.events.length, 0);
});

test('library: badges by state, «ждёт вас» and «рисую» first', () => {
  const base = emptyProject('a', settings, 'demo', '2026-10-29T10:00:00Z');
  const awaiting = { ...base, id: 'w', status: 'awaiting' as const, gate: { stage: 'storyboard' as const, version: 2, summary: '' }, stages: { ...base.stages, storyboard: { status: 'awaiting' as const, version: 2 } } };
  const drawing = { ...base, id: 'd', status: 'drawing' as const, stages: { ...base.stages, paint: { status: 'in_progress' as const, version: 1 } } };
  const done = { ...base, id: 'ok', status: 'done' as const, video: 'x.mp4', createdAt: '2026-10-29T12:00:00Z', stages: Object.fromEntries(STAGE_IDS.map(i => [i, { status: 'completed', version: 1 }])) as ProjectState['stages'] };
  const failed = { ...base, id: 'e', status: 'ready' as const, stages: { ...base.stages, compose: { status: 'completed' as const, version: 1 }, review: { status: 'failed' as const, version: 1 } } };
  const crashed = { ...base, id: 'c', status: 'drafting' as const, log: [{ id: 'err-1', text: 'Что-то пошло не так', status: 'err' as const }] };
  const draft = { ...base, id: 'r', status: 'ready' as const, stages: { ...base.stages, paint: { status: 'completed' as const, version: 1 } } };
  assert.deepEqual([awaiting, drawing, done, failed, crashed, draft].map(badgeOf), ['awaiting', 'drawing', 'done', 'error', 'error', 'draft']);
  assert.deepEqual([stageOf(awaiting), stageOf(drawing), stageOf(done), stageOf(failed), stageOf(draft)], ['storyboard', 'paint', 'final', 'review', 'paint']);
  const s = summarize(awaiting);
  assert.deepEqual([s.badge, s.stage, s.stageStatus, s.awaiting], ['awaiting', 'storyboard', 'awaiting', 'storyboard']);
  const order = sortLibrary([done, failed, drawing, draft, awaiting].map(summarize)).map(x => x.id);
  assert.deepEqual(order.slice(0, 2), ['w', 'd']);
  assert.equal(order[2], 'ok', 'then the newest');
});

test('GET /api/projects/[id]/replay: 404 for an unknown project, 200 with the run', async () => {
  const e = new DemoEngine({ speed: 1000 });
  (globalThis as unknown as { __inkframeEngine?: StudioEngine }).__inkframeEngine = e;
  try {
    // by a computed path: the static demo build typechecks tests without app/api (scripts/build-demo.mjs)
    const route = (p: string) => import(new URL(`../app/api/${p}`, import.meta.url).href);
    const { GET } = await route('projects/[id]/replay/route.ts') as { GET: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response> };
    const call = (id: string) => GET(new Request(`http://x/api/projects/${id}/replay`), { params: Promise.resolve({ id }) });
    const miss = await call('nope');
    assert.equal(miss.status, 404);
    assert.match((await miss.json()).error, /не найден/);
    const id = await runToDone(e);
    const ok = await call(id);
    assert.equal(ok.status, 200);
    const r = await ok.json() as Replay;
    assert.equal(r.journal, 'full');
    assert.ok(r.startedAt && r.events.length > 10 && r.events[0].at === 0);
    assert.equal(stateAt(r, r.durationMs).status, 'done');
    // the library route carries the badge and the stage
    const lib = await (await (await route('projects/route.ts') as { GET: () => Response }).GET()).json();
    assert.deepEqual([lib.projects[0].badge, lib.projects[0].stage], ['done', 'final']);
  } finally {
    delete (globalThis as unknown as { __inkframeEngine?: StudioEngine }).__inkframeEngine;
  }
});
