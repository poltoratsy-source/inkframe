// M4: the storyboard and final gates, the estimate and budget modes, the decision log and resume after a restart.
// RealEngine with fake tools (no Claude, Chrome, edge-tts or ffmpeg), DemoEngine at high speed, the pure parts alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { DemoEngine } from '../lib/engine/demo.ts';
import { SR } from '../lib/real/audio.ts';
import { SpeedLog, estimate, FALLBACK_SPEED } from '../lib/real/estimate.ts';
import { approveVersion, openVersion } from '../lib/store/gate.ts';
import { readBudget } from '../lib/store/stages.ts';
import { DEFAULT_GATES, overCap, type Checkpoint, type Decision, type Estimate, type LoggedEvent } from '../lib/store/types.ts';
import { applyEvent, emptyProject } from '../lib/engine/reducer.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { EngineEvent, StudioEngine } from '../lib/engine/types.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';
import { tmp } from './helpers/tmp.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
const BOARD = {
  title: 'Почему небо голубое',
  scenes: [
    { title: 'Вопрос', line: 'Привет! Почему небо голубое?', duration: 4, why: 'вопрос задаёт ведущий — зритель смотрит на него', spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' } },
    { title: 'Рассеяние', line: 'Синий свет рассеивается в воздухе сильнее красного.', duration: 6, why: 'синий и красный рядом — разницу видно сразу', spec: { template: 'compare', left: { prop: 'wave', color: 'blue', caption: 'синий' }, right: { prop: 'wave', color: 'red', caption: 'красный' } } },
    { title: 'Финал', line: 'Пиши в комментариях НЕБО!', duration: 5, spec: { template: 'card', setting: 'sunset', title: 'НЕБО' } },
  ],
};
const NIGHT_SCENE_2 = { ...BOARD.scenes[1], spec: { ...BOARD.scenes[1].spec, setting: 'night' } };

/** Fake tools. `hang`: a painter call that never ends (the server "dies" there); `hangAsk`: the same for Claude. */
function fakes(o: { claude?: 'ok' | 'down'; hang?: (scene: StageScene, times: number[]) => boolean; hangAsk?: (p: string) => boolean } = {}) {
  const painted: { scene: StageScene; times: number[] }[] = [], cuts: string[][] = [], asked: string[] = [], voiced: string[] = [];
  let hung: () => void = () => {};
  const reached = new Promise<void>(r => { hung = r; });
  const tools: Partial<RealTools> = {
    ask: async p => {
      asked.push(p);
      if (o.hangAsk?.(p)) { hung(); return new Promise<string>(() => {}); }
      if (o.claude === 'down') throw new Error('Claude did not answer in 1 s');
      if (p.includes('CURRENT SCENE')) return JSON.stringify(NIGHT_SCENE_2);
      if (p.includes('NOTE FROM THE AUTHOR')) return JSON.stringify({ ...BOARD, scenes: [BOARD.scenes[0], NIGHT_SCENE_2, BOARD.scenes[2]] });
      return JSON.stringify(BOARD);
    },
    voice: async jobs => { for (const j of jobs) { voiced.push(j.text); writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w]) })); } },
    decode: async f => new Float32Array(Math.round(JSON.parse(readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length * .35 * SR)).fill(.2),
    painter: {
      workers: 3, close: async () => {},
      frames: async (scene, times, _o, onFrame) => {
        if (o.hang?.(scene, times)) { hung(); return new Promise<void>(() => {}); }
        painted.push({ scene, times });
        for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg'));
      },
    },
    ffmpeg: async (args, cwd) => { cuts.push(args); writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
    review: async plan => ({ at: new Date().toISOString(), video: plan.src, decision: 'PASS', checks: [{ id: 'probe', ok: true, detail: '1280×720' }] }),
  };
  return { tools, painted, cuts, asked, voiced, reached };
}
type Fakes = ReturnType<typeof fakes>;

const until = (e: StudioEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(resolve => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); resolve(); } });
});
const gateOpen = (e: StudioEngine, id: string, stage: string, version = 1) => until(e, id, ev => ev.type === 'gate' && ev.open && ev.stage === stage && ev.version === version);
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const json = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8'));
const lines = <T>(f: string): T[] => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const real = (f: Fakes, more = {}) => new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' }, ...more });
const dirOf = (e: RealEngine, id: string) => e.fileOf(id, 'stages/script.json')!.replace(/\/stages\/script\.json$/, '');
const keyCalls = (f: Fakes) => f.painted.filter(x => x.times.length === 1 && !x.scene.sketch);
const clipsMade = (f: Fakes) => f.cuts.filter(a => a.includes('-framerate')).length;

/** To the storyboard gate: script written and approved, key frames painted. */
async function toStoryboard(e: RealEngine) {
  const p = e.create(settings);
  await gateOpen(e, p.id, 'script');
  await tick();
  const sb = gateOpen(e, p.id, 'storyboard');
  e.approve(p.id, 'script', 1);
  await sb;
  await tick();
  return p.id;
}

test('storyboard gate: one draft key frame per scene, nothing voiced; approve → paint, cut, review, final gate; approve → done', async () => {
  const f = fakes(), e = real(f);
  const id = await toStoryboard(e);
  let s = e.get(id)!;
  const dir = dirOf(e, id);
  assert.equal(s.status, 'awaiting');
  assert.deepEqual(s.gate && [s.gate.stage, s.gate.version], ['storyboard', 1]);
  assert.deepEqual(s.stages.storyboard, { status: 'awaiting', version: 1 });
  assert.equal(f.painted.length, 3, 'only the key frames');
  assert.ok(keyCalls(f).length === 3 && keyCalls(f).every(x => x.scene.fast), 'one fast colour frame per scene');
  assert.equal(f.voiced.length, 0, 'nothing is voiced before the storyboard is approved');
  assert.ok(s.scenes.every(sc => sc.key?.startsWith(`/api/projects/${id}/files/frames/key/`) && sc.status === 'queued'));
  assert.deepEqual(s.scenes.map(sc => sc.template), ['host', 'compare', 'card']);
  const cp = json<Checkpoint>(join(dir, 'stages/storyboard.json'));
  assert.equal((cp.artifact as { scenes: { frame?: string }[] }).scenes.every(x => x.frame), true);
  assert.equal(cp.estimate?.stage, 'storyboard');
  assert.equal(s.estimate?.stage, 'storyboard');
  assert.throws(() => e.editScene(id, 1, 'ночь'), /утверждение «Раскадровка»/);
  assert.throws(() => e.build(id), /not ready/);

  const fin = gateOpen(e, id, 'final');
  e.approve(id, 'storyboard', 1);
  await fin;
  await tick();
  s = e.get(id)!;
  assert.equal(s.status, 'awaiting');
  assert.deepEqual([s.stages.paint.status, s.stages.voice.status, s.stages.compose.status, s.stages.review.status, s.stages.final.status], ['completed', 'completed', 'completed', 'completed', 'awaiting']);
  assert.equal(s.video, `/api/projects/${id}/files/cut-1.mp4`, 'the MP4 is there to watch');
  assert.equal(s.review?.decision, 'PASS');
  assert.equal(f.voiced.length, 3);
  assert.equal(clipsMade(f), 3);
  assert.throws(() => e.build(id), /not ready/, 'no second cut while the final gate is open');
  const est = json<Estimate>(join(dir, 'estimate.json'));
  assert.equal(est.stage, 'storyboard');
  assert.ok(est.actualSec !== undefined && est.actualSec >= 0 && est.actual, 'the fact sits next to the estimate');
  assert.equal(s.estimate?.actualSec, est.actualSec);

  e.approve(id, 'final', 1);
  s = e.get(id)!;
  assert.equal(s.status, 'done');
  assert.equal(s.stages.final.status, 'completed');
  assert.ok(s.log.some(l => l.id === 'gate-final-v1' && /ролик отдан/.test(l.text)));
  assert.equal(json<Checkpoint>(join(dir, 'stages/final.json')).approval?.decision, 'approve');
});

test('storyboard revise: a scene marked «перерисовать» changes by its note and only its key frame is painted again', async () => {
  const f = fakes(), e = real(f);
  const id = await toStoryboard(e);
  const keys = e.get(id)!.scenes.map(sc => sc.key);
  assert.throws(() => e.revise(id, 'storyboard', 1, '  ', { scenes: [{ n: 2, note: ' ' }] }), (err: Error & { status?: number }) => err.status === 400);
  const v2 = gateOpen(e, id, 'storyboard', 2);
  const s1 = e.revise(id, 'storyboard', 1, '', { scenes: [{ n: 2, note: 'ночь' }] });
  assert.equal(s1.stages.storyboard.status, 'revised');
  await v2;
  await tick();
  const s = e.get(id)!, dir = dirOf(e, id);
  assert.deepEqual(s.stages.storyboard, { status: 'awaiting', version: 2 });
  assert.equal(keyCalls(f).length, 4, 'one more key frame: scene 2 only');
  assert.equal(keyCalls(f)[3].scene.template, 'compare');
  assert.match(s.scenes[1].visual, /Сравнение/);
  assert.equal(s.scenes[0].key, keys[0]);
  assert.equal(s.scenes[2].key, keys[2]);
  assert.notEqual(s.scenes[1].key, keys[1]);
  assert.ok(f.asked.some(q => q.includes('CURRENT SCENE') && q.includes('REQUEST: ночь')));
  const old = json<Checkpoint>(join(dir, 'stages/history/storyboard.v1.json'));
  assert.deepEqual([old.version, old.status, old.approval?.note, old.approval?.scenes], [1, 'revised', 'Сцена 2: ночь', [{ n: 2, note: 'ночь' }]]);
  assert.ok(s.log.some(l => l.id === 'storyboard-v2' && /изменил сцену 2/.test(l.text)));
});

test('storyboard revise without Claude: simple rules, an honest line, and only the changed scene is repainted', async () => {
  const f = fakes({ claude: 'down' }), e = real(f);
  const id = await toStoryboard(e);
  const v2 = gateOpen(e, id, 'storyboard', 2);
  e.revise(id, 'storyboard', 1, 'сцена 3: ночь');
  await v2;
  await tick();
  const s = e.get(id)!;
  assert.equal(keyCalls(f).length, 4);
  assert.match(s.scenes[2].visual, /Финальная карточка/);
  assert.ok(s.log.some(l => l.id === 'storyboard-v2' && /по простым правилам/.test(l.detail ?? '')));
  assert.ok(s.log.some(l => l.decision?.what === 'fallback'), 'the fallback is in the decision log');
});

test('final revise: the picked scene is redone, the MP4 cut and checked again as final v2', async () => {
  const f = fakes(), e = real(f);
  const id = await toStoryboard(e);
  const fin = gateOpen(e, id, 'final');
  e.approve(id, 'storyboard', 1);
  await fin;
  await tick();
  assert.throws(() => e.revise(id, 'final', 1, 'сделай лучше'), (err: Error & { status?: number }) => err.status === 400, 'which scene? — refused before anything is written');
  assert.equal(e.get(id)!.stages.final.status, 'awaiting');
  const clips = clipsMade(f);
  const v2 = gateOpen(e, id, 'final', 2);
  e.revise(id, 'final', 1, 'ночь', { scenes: [{ n: 2, note: 'ночь' }] });
  await v2;
  await tick();
  const s = e.get(id)!, dir = dirOf(e, id);
  assert.equal(clipsMade(f) - clips, 1, 'only scene 2 is painted again for the cut');
  assert.equal(s.video, `/api/projects/${id}/files/cut-2.mp4`);
  assert.deepEqual(s.stages.final, { status: 'awaiting', version: 2 });
  assert.equal(s.scenes[1].edited, true);
  assert.equal(json<Checkpoint>(join(dir, 'stages/history/final.v1.json')).approval?.decision, 'revise');
  // «сцена 3: …» in the note names the scene too
  const v3 = gateOpen(e, id, 'final', 3);
  e.revise(id, 'final', 2, 'сцена 3: медленнее');
  await v3;
});

test('budget cap: approve over the cap is refused without the permission, goes on with it; observe and warn never refuse', async () => {
  const f = fakes(), e = real(f, { budget: { mode: 'cap', capSec: 1 } });
  const p = e.create(settings);
  await gateOpen(e, p.id, 'script');
  await tick();
  const est = e.get(p.id)!.estimate!;
  assert.equal(est.mode, 'cap');
  assert.ok(est.totalSec > 1 && overCap(est));
  assert.throws(() => e.approve(p.id, 'script', 1), (err: Error & { status?: number }) => err.status === 409 && /Разрешаю превысить лимит/.test(err.message));
  assert.equal(e.get(p.id)!.stages.script.status, 'awaiting', 'nothing changed');
  const sb = gateOpen(e, p.id, 'storyboard');
  e.approve(p.id, 'script', 1, undefined, { allowOverCap: true });
  const cp = json<Checkpoint>(join(dirOf(e, p.id), 'stages/script.json'));
  assert.equal(cp.approval?.overCap, true);
  await sb;
  await tick();
  assert.throws(() => e.approve(p.id, 'storyboard', 1), /лимита/, 'every gate over the cap asks again');

  // the rule lives in the store (gate.ts), not only in the button
  const capped = { ...est, mode: 'cap' as const, capSec: 1 };
  const open = openVersion(undefined, 'script', {}, true, undefined, capped);
  assert.throws(() => approveVersion(open, 'script', 1), /лимита/);
  assert.equal(approveVersion(open, 'script', 1, undefined, undefined, true).cp.status, 'completed');
  assert.equal(approveVersion(openVersion(undefined, 'script', {}, true, undefined, { ...capped, mode: 'warn' }), 'script', 1).changed, true);
  assert.equal(overCap({ ...capped, actualSec: 3 }), false, 'a finished estimate is never over the cap');
});

test('budget policy: inkframe.config.json and INKFRAME_BUDGET', () => {
  const cwd = tmp('inkframe-cfg-');
  assert.deepEqual(readBudget(cwd, {}), { mode: 'observe' });
  assert.deepEqual(readBudget(cwd, { INKFRAME_BUDGET: 'warn' }), { mode: 'warn', capSec: 900 });
  assert.deepEqual(readBudget(cwd, { INKFRAME_BUDGET: 'cap:600' }), { mode: 'cap', capSec: 600 });
  writeFileSync(join(cwd, 'inkframe.config.json'), JSON.stringify({ gates: { final: false }, budget: { mode: 'cap', capSec: 300 } }));
  assert.deepEqual(readBudget(cwd, {}), { mode: 'cap', capSec: 300 });
  assert.deepEqual(readBudget(cwd, { INKFRAME_BUDGET: 'observe' }), { mode: 'observe', capSec: 300 });
});

test('estimate: frames, seconds per frame, workers, voice, cut, disk', () => {
  const sp = { draft: .5, final: 1.2, voicePerLine: 2.5, encodePerFrame: .03, leadPerCall: 2, measured: true };
  const e = estimate({
    stage: 'script', draftFps: 2, sketchFrames: 2, finalFps: 12, overlap: .4, workers: 3, speed: sp, claudeMade: 2, budget: { mode: 'warn', capSec: 60 },
    scenes: [4, 6, 5].map(duration => ({ duration, key: true, draft: true, final: true, voice: true })),
  });
  // key 3; draft (2 + 8) + (2 + 12) + (2 + 10) = 36; final round(4.4·12) + round(6.4·12) + round(5·12) = 53 + 77 + 60 = 190
  assert.deepEqual([e.keyFrames, e.draftFrames, e.finalFrames, e.frames], [3, 36, 190, 229]);
  // painter calls: the key frames once + a sketch and a colour draft per scene + a final clip per scene = 10, × 2 s
  assert.equal(e.paintSec, Math.round((((3 + 36) * .5 + 190 * 1.2) / 3 + 10 * 2) * 10) / 10);   // 82.5 + 20
  assert.equal(e.voiceSec, 7.5);
  assert.ok(Math.abs(e.cutSec - (190 * .03 + .35 * 15 + 2)) < .06);
  assert.ok(Math.abs(e.totalSec - (e.paintSec + e.voiceSec + e.cutSec)) < .11);
  assert.deepEqual([e.claudeCalls, e.mode, e.capSec, e.measured, e.workers], [2, 'warn', 60, true, 3]);
  assert.ok(e.diskMb >= 1);
  // a manual cut of one changed scene: no drafts, no voice, one clip
  const cut = estimate({ stage: 'compose', draftFps: 2, sketchFrames: 2, finalFps: 12, overlap: .4, workers: 3, speed: sp, claudeMade: 0, budget: { mode: 'observe' },
    scenes: [{ duration: 4 }, { duration: 6, final: true }, { duration: 5 }] });
  assert.deepEqual([cut.draftFrames, cut.finalFrames, cut.voiceSec], [0, 77, 0]);
});

test('speed log: this server\'s median seconds per frame, the fallback until there are samples', () => {
  const file = join(tmp(), '.speed.json'), log = new SpeedLog(file);
  assert.deepEqual(log.speed(), FALLBACK_SPEED);
  log.record('draft', 3, 6, 3);     // 6 frames in 3 s on 3 workers: 1.5 s per frame for one worker
  log.record('draft', 1, 1, 3);     // one frame alone: 1 s
  log.record('draft', 2, 1, 3);
  const s = log.speed();
  assert.equal(s.draft, 1.5);
  assert.equal(s.final, 1.5 * FALLBACK_SPEED.final / FALLBACK_SPEED.draft, 'no final frames yet: scaled from the drafts');
  assert.equal(s.measured, false);
  log.record('final', 10, 4, 3);
  assert.equal(new SpeedLog(file).speed().final, 7.5, 'kept in the file');
  assert.equal(new SpeedLog(file).speed().measured, true);
});

test('decisions.jsonl: style, voice, music, format, a template per scene with the storyboard\'s reason, the estimate with its fact', async () => {
  const f = fakes(), e = real(f);
  const id = await toStoryboard(e);
  const fin = gateOpen(e, id, 'final');
  e.approve(id, 'storyboard', 1);
  await fin;
  await tick();
  const dir = dirOf(e, id), ds = lines<Decision>(join(dir, 'decisions.jsonl'));
  assert.deepEqual(ds.filter(d => d.stage === 'brief').map(d => d.what), ['style', 'voice', 'music', 'format']);
  const t = ds.filter(d => d.what === 'template');
  assert.deepEqual(t.map(d => [d.scene, d.chosen]), [[1, 'host'], [2, 'compare'], [3, 'card']]);
  assert.equal(t[1].reason, BOARD.scenes[1].why);
  assert.ok(t[1].alternatives.includes('host') && !t[1].alternatives.includes('compare'));
  assert.equal(t[2].reason, 'Claude выбрал, не объяснив почему');
  const est = ds.find(d => d.what === 'estimate')!;
  assert.match(est.chosen, /оценка ≈ .*, вышло/);
  assert.ok(est.estimate?.actualSec !== undefined);
  const s = e.get(id)!;
  assert.ok(s.log.some(l => l.decision && l.text === 'решение: сцена 2 — шаблон «сравнение»'));
  assert.ok(lines<LoggedEvent>(join(dir, 'events.jsonl')).some(l => l.kind === 'decision' && l.scene === 2));
});

test('Claude down: the template storyboard is a fallback in the decision log', async () => {
  const f = fakes({ claude: 'down' }), e = real(f);
  const p = e.create(settings);
  await gateOpen(e, p.id, 'script');
  await tick();
  const ds = lines<Decision>(join(dirOf(e, p.id), 'decisions.jsonl'));
  assert.ok(ds.some(d => d.what === 'fallback' && /шаблону/.test(d.chosen) && d.confidence === 'low'));
});

test('resume: the server dies in the middle of the paint; a new engine draws only the missing scenes and goes on', async () => {
  const dir = tmp();
  // engine 1: the colour draft of scene 2 never finishes (the process "dies" there)
  const f1 = fakes({ hang: (scene, times) => scene.template === 'compare' && !scene.sketch && times.length > 1 });
  const e1 = new RealEngine({ dir, tools: f1.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' } });
  const id = await toStoryboard(e1);
  e1.approve(id, 'storyboard', 1);
  await f1.reached;
  await tick();
  const cp = json<Checkpoint>(join(dir, id, 'stages/paint.json'));
  assert.deepEqual([cp.status, cp.doneScenes], ['in_progress', [1]]);
  assert.equal(json<{ state: { status: string } }>(join(dir, id, 'project.json')).state.status, 'drawing');

  // engine 2 on the same folder: resumes on load
  const f2 = fakes();
  const e2 = new RealEngine({ dir, tools: f2.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' } });
  await gateOpen(e2, id, 'final');
  await tick();
  const drafts = f2.painted.filter(x => x.scene.sketch || (x.scene.fast && x.times.length > 1 && x.times.every(t => t < 7)));
  assert.deepEqual([...new Set(f2.painted.filter(x => x.scene.sketch).map(x => x.scene.template))], ['compare', 'card'], 'scene 1 is not drawn again');
  assert.ok(drafts.length > 0);
  assert.equal(f2.voiced.length, 0, 'the voice was finished before the crash: not redone');
  const s = e2.get(id)!;
  assert.equal(s.status, 'awaiting');
  assert.ok(s.scenes.every(sc => sc.status === 'done'));
  assert.ok(s.log.some(l => /продолжаю с места остановки/.test(l.text) && /готово 1 из 3/.test(l.detail ?? '')));
  assert.deepEqual(json<Checkpoint>(join(dir, id, 'stages/paint.json')).doneScenes, [1, 2, 3]);
});

test('resume: a script rewrite cut by a restart is done again; an open gate just waits', async () => {
  const dir = tmp();
  const f1 = fakes({ hangAsk: p => p.includes('NOTE FROM THE AUTHOR') });
  const e1 = new RealEngine({ dir, tools: f1.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' } });
  const p = e1.create(settings);
  await gateOpen(e1, p.id, 'script');
  await tick();
  e1.revise(p.id, 'script', 1, 'короче начало');
  await f1.reached;
  const f2 = fakes();
  const e2 = new RealEngine({ dir, tools: f2.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' } });
  await gateOpen(e2, p.id, 'script', 2);
  assert.ok(f2.asked.some(q => q.includes('NOTE FROM THE AUTHOR: короче начало')));
  await tick();
  // a third start while the gate is open: nothing runs, the gate waits
  const f3 = fakes();
  const e3 = new RealEngine({ dir, tools: f3.tools, draftFps: 2, sketchFrames: 2, gates: DEFAULT_GATES, budget: { mode: 'observe' } });
  await tick();
  assert.deepEqual([e3.get(p.id)!.status, e3.get(p.id)!.stages.script.status, f3.asked.length], ['awaiting', 'awaiting', 0]);
  assert.ok(existsSync(join(dir, p.id, 'stages/history/script.v1.json')));
});

test('gates off: no storyboard key frames, no final gate; the storyboard and final stages are completed', async () => {
  const f = fakes(), e = real(f, { gates: { script: false, storyboard: false, final: false } });
  const p = e.create(settings);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  assert.equal(keyCalls(f).length, 0);
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  e.build(p.id);
  await done;
  const s = e.get(p.id)!;
  assert.deepEqual([s.stages.storyboard.status, s.stages.final.status, s.gate], ['completed', 'completed', undefined]);
});

// ---------- the demo engine (the static site) ----------
const demoGate = (e: DemoEngine, id: string, stage: string, version = 1) => gateOpen(e, id, stage, version);

test('demo: all three gates; storyboard revise shows «переделываю» and v2; final revise redoes a scene and opens v2', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const p = e.create(settings);
  await demoGate(e, p.id, 'script');
  await tick();
  assert.equal(e.get(p.id)!.estimate?.stage, 'script');
  assert.ok(e.get(p.id)!.log.some(l => l.decision?.what === 'template'));
  const sb = demoGate(e, p.id, 'storyboard');
  e.approve(p.id, 'script', 1);
  await sb;
  await tick();
  let s = e.get(p.id)!;
  assert.ok(s.scenes.every(sc => sc.key), 'a key frame on every card');
  assert.equal(s.estimate?.stage, 'storyboard');
  const v2 = demoGate(e, p.id, 'storyboard', 2);
  e.revise(p.id, 'storyboard', 1, '', { scenes: [{ n: 2, note: 'ночь' }] });
  assert.equal(e.get(p.id)!.stages.storyboard.status, 'revised');
  await v2;
  await tick();
  s = e.get(p.id)!;
  assert.ok(s.log.some(l => l.id === 'keys-v2' && /перерисовал сцены 2/.test(l.text)));
  const fin = demoGate(e, p.id, 'final');
  e.approve(p.id, 'storyboard', 2);
  await fin;
  await tick();
  s = e.get(p.id)!;
  assert.deepEqual([s.status, s.video, s.review?.decision], ['awaiting', '/demo/result.mp4', 'PASS']);
  assert.ok(s.estimate?.actualSec !== undefined, 'the final gate shows plan and fact');
  assert.throws(() => e.revise(p.id, 'final', 1, 'лучше'), (err: Error & { status?: number }) => err.status === 400);
  const f2 = demoGate(e, p.id, 'final', 2);
  e.revise(p.id, 'final', 1, 'медленнее', { scenes: [{ n: 1, note: 'медленнее' }] });
  await f2;
  await tick();
  assert.equal(e.get(p.id)!.scenes[0].edited, true);
  e.approve(p.id, 'final', 2);
  assert.equal(e.get(p.id)!.status, 'done');
});

test('demo: the cap refuses approve without the permission too', async () => {
  const e = new DemoEngine({ speed: 1000, budget: { mode: 'cap', capSec: 5 } });
  const p = e.create(settings);
  await demoGate(e, p.id, 'script');
  await tick();
  assert.throws(() => e.approve(p.id, 'script', 1), /лимита/);
  assert.equal(e.approve(p.id, 'script', 1, undefined, { allowOverCap: true }).stages.script.status, 'completed');
});

test('reducer: key frames, estimates and decisions', () => {
  let s = emptyProject('p1', settings, 'demo');
  s = applyEvent(s, { type: 'storyboard', title: 't', scenes: [{ n: 1, title: 'a', visual: 'v', line: 'l', start: 0, duration: 4, template: 'host' }] });
  s = applyEvent(s, { type: 'scene.key', n: 1, src: '/k.jpg' });
  assert.deepEqual([s.scenes[0].key, s.scenes[0].frame, s.scenes[0].status, s.scenes[0].template], ['/k.jpg', '/k.jpg', 'queued', 'host']);
  s = applyEvent(s, { type: 'scene.key', n: 1, src: '' });
  assert.equal(s.scenes[0].key, undefined);
  const est = estimate({ stage: 'script', draftFps: 6, sketchFrames: 5, finalFps: 12, overlap: .4, workers: 3, speed: FALLBACK_SPEED, claudeMade: 0, budget: { mode: 'observe' }, scenes: [{ duration: 4, final: true }] });
  s = applyEvent(s, { type: 'estimate', estimate: est });
  assert.equal(s.estimate, est);
  s = applyEvent(s, { type: 'decision', decision: { at: '', stage: 'script', what: 'template', scene: 1, chosen: 'compare', alternatives: ['host'], reason: 'видно разницу', confidence: 'high' } });
  const l = s.log.at(-1)!;
  assert.deepEqual([l.text, l.detail, l.decision?.chosen], ['решение: сцена 1 — шаблон «сравнение»', 'видно разницу', 'compare']);
});
