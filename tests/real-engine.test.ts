// RealEngine end to end with fake tools: no Claude, Chrome, edge-tts or ffmpeg needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './helpers/tmp.ts';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { SR } from '../lib/real/audio.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { EngineEvent } from '../lib/engine/types.ts';
import type { Checkpoint, LoggedEvent, Review } from '../lib/store/types.ts';
import type { ReviewPlan } from '../lib/real/review.ts';
import { canBuild } from '../lib/engine/reducer.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
const BOARD = {
  title: 'Почему небо голубое',
  scenes: [
    { title: 'Вопрос', line: 'Привет! Почему небо голубое?', duration: 4, spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' } },
    { title: 'Рассеяние', line: 'Синий свет рассеивается в воздухе сильнее красного.', duration: 6, spec: { template: 'compare', left: { prop: 'wave', color: 'blue', caption: 'синий' }, right: { prop: 'wave', color: 'red', caption: 'красный' } } },
    { title: 'Финал', line: 'Пиши в комментариях НЕБО!', duration: 5, spec: { template: 'card', setting: 'sunset', title: 'НЕБО' } },
  ],
};

/** What Claude answers when the script comes back with a note: the same storyboard with a new first line. */
const REWRITTEN = { ...BOARD, scenes: [{ ...BOARD.scenes[0], line: 'Привет! Сегодня коротко: почему небо голубое?' }, ...BOARD.scenes.slice(1)] };

/** What the fake self-review answers: PASS, a WARN about loud sound, a FAIL with a black run in scene 2, or a crash. */
type Verdict = 'PASS' | 'WARN' | 'FAIL' | 'throw';
function verdict(v: Verdict, plan: ReviewPlan): Review {
  if (v === 'throw') throw new Error('ffprobe: not found');
  const checks: Review['checks'] = [{ id: 'probe', ok: true, detail: '1280×720' }];
  if (v === 'WARN') checks.push({ id: 'clipping', ok: false, warn: true, detail: 'звук упирается в потолок', at: [3] });
  if (v === 'FAIL') checks.push({ id: 'black', ok: false, detail: 'чёрный экран 1,0 с (сцена 2)', at: [plan.scenes[1].start + .5] });
  return { at: new Date().toISOString(), video: plan.src, decision: v, checks };
}

function fakes(o: { claude?: 'ok' | 'down'; review?: Verdict } = {}) {
  const painted: { scene: StageScene; times: number[] }[] = [], cuts: string[][] = [], asked: string[] = [], plans: ReviewPlan[] = [];
  const box = { review: o.review ?? 'PASS' as Verdict };
  const tools: Partial<RealTools> = {
    ask: async p => {
      asked.push(p);
      if (o.claude === 'down') throw new Error('Claude did not answer in 1 s');
      if (p.includes('NOTE FROM THE AUTHOR')) return JSON.stringify(REWRITTEN);
      if (p.includes('CURRENT SCENE')) return JSON.stringify({ ...BOARD.scenes[1], line: 'Синий рассеивается, поэтому небо голубое.', spec: { ...BOARD.scenes[1].spec, setting: 'night' } });
      return JSON.stringify(BOARD);
    },
    voice: async jobs => { for (const j of jobs) { writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w.replace(/[!?.,]/g, '')]) })); } },
    // every line "lasts" 0.35 s per word
    decode: async f => { const words = JSON.parse((await import('node:fs')).readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length; return new Float32Array(Math.round(words * .35 * SR)).fill(.2); },
    painter: { workers: 3, close: async () => {}, frames: async (scene, times, _o, onFrame) => { painted.push({ scene, times }); for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg')); } },
    ffmpeg: async (args, cwd) => { cuts.push(args); writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
    review: async plan => { plans.push(plan); return verdict(box.review, plan); },
  };
  return { tools, painted, cuts, asked, plans, box };
}
const until = (e: RealEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(resolve => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); resolve(); } });
});
/** Approves every gate as it opens (the user pressing «Утвердить»), until the run is ready. */
const ready = (e: RealEngine, id: string) => {
  const off = e.subscribe(id, ev => { if (ev.type === 'gate' && ev.open) queueMicrotask(() => e.approve(id, ev.stage, ev.version)); });
  return until(e, id, ev => ev.type === 'status' && ev.status === 'ready').finally(off);
};
const gateOpen = (e: RealEngine, id: string, version = 1) => until(e, id, ev => ev.type === 'gate' && ev.open && ev.version === version);
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const dirOf = (e: RealEngine, id: string) => e.fileOf(id, 'stages/script.json')!.replace(/\/stages\/script\.json$/, '');
const json = <T>(f: string): T => JSON.parse(readFileSync(f, 'utf8'));
const journal = (dir: string): LoggedEvent[] => readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
/** The gates of M1–M3: only the script stops; the storyboard and final gates are tested in gates-m4.test.ts. */
const M1 = { script: true, storyboard: false, final: false };
const engine = (f: ReturnType<typeof fakes>, more = {}) => new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: M1, ...more });

test('a run: Claude storyboard, voice fits the scenes, sketch then colour drafts for every scene', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  const s = e.get(p.id)!;
  assert.equal(s.engine, 'real');
  assert.equal(s.scenes.length, 3);
  assert.ok(s.scenes.every(sc => sc.status === 'done' && sc.colors.length > 0 && sc.frame?.startsWith(`/api/projects/${p.id}/files/frames/`)));
  assert.equal(s.scenes[1].visual.startsWith('Сравнение'), true);
  // scene 2 has 8 words → 2.8 s of voice → stays 6 s; all starts follow each other
  assert.deepEqual(s.scenes.map(sc => sc.start), [0, s.scenes[0].duration, s.scenes[0].duration + s.scenes[1].duration]);
  assert.ok(s.tracks.voice?.length && s.tracks.music?.length);
  assert.ok(s.log.some(l => l.id === 'script' && l.detail === 'Claude'));
  // sketches are painted as sketches, colour drafts in the fast colour mode, with the mouth envelope
  assert.ok(f.painted.some(x => x.scene.sketch) && f.painted.some(x => x.scene.fast && x.scene.voice.length > 0));
  assert.equal(s.status, 'ready');
  assert.ok(e.fileOf(p.id, s.scenes[0].frame!.split('/files/')[1]));
  assert.equal(e.fileOf(p.id, '../../etc/passwd'), undefined);
});

test('Claude down: template storyboard, and edits fall back to rules', async () => {
  const f = fakes({ claude: 'down' }), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  assert.ok(e.get(p.id)!.log.some(l => l.id === 'script' && /по шаблону/.test(l.detail ?? '')));
  assert.equal(e.get(p.id)!.scenes[2].caption, 'НЕБО');
  const asked = f.asked.length;
  e.editScene(p.id, 1, 'ночь');
  await until(e, p.id, ev => ev.type === 'scene.edited');
  assert.equal(f.asked.length, asked, 'Claude is not asked again right after it failed');
  assert.match(e.get(p.id)!.scenes[0].visual, /ночью/);
});

test('an edit redraws only its scene; the next cut re-renders only that scene', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  e.build(p.id);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  const first = e.get(p.id)!;
  assert.match(first.video!, new RegExp(`/api/projects/${p.id}/files/cut-1\\.mp4`));
  const clipsFirst = f.cuts.filter(a => a.includes('-framerate')).length;
  assert.equal(clipsFirst, 3);
  const cut = f.cuts[f.cuts.length - 1];
  assert.ok(cut.includes('sound.wav') && cut.some(a => a.includes('ass=subtitles.ass')));

  const before = f.painted.length;
  e.editScene(p.id, 2, '', { line: 'Синий свет рассеивается сильнее всех.' });
  await until(e, p.id, ev => ev.type === 'scene.edited');
  const s = e.get(p.id)!;
  assert.equal(s.video, undefined, 'the old MP4 is taken away');
  assert.equal(s.scenes[1].line, 'Синий свет рассеивается сильнее всех.');
  assert.equal(s.scenes[1].edited, true);
  assert.equal(s.scenes[0].edited, false);
  const redrawn = f.painted.slice(before);
  assert.ok(redrawn.length === 2 && redrawn.every(x => x.scene.template === 'compare'), 'only scene 2 was painted again');

  e.build(p.id);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  assert.equal(f.cuts.filter(a => a.includes('-framerate')).length - clipsFirst, 1, 'one new clip, two from the cache');
  const dir = e.fileOf(p.id, 'cut-2.mp4')!.replace(/\/cut-2\.mp4$/, '');
  assert.deepEqual(readdirSync(dir).filter(x => x.startsWith('cut-')), ['cut-2.mp4']);
  assert.equal(readdirSync(join(dir, 'clips')).length, 3);
  assert.equal(existsSync(join(dir, 'tmp')), false, 'final frames are deleted after the cut');
});

test('edits and builds are refused when they make no sense', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  assert.throws(() => e.build(p.id), /not ready/);
  await ready(e, p.id);
  assert.throws(() => e.editScene(p.id, 7, 'ночь'), /scene 7/);
  assert.throws(() => e.editScene(p.id, 1, '  '), /empty/);
  assert.throws(() => e.editScene('nope', 1, 'x'), /not found/);
  assert.throws(() => e.create({ ...settings, idea: ' ' }), /idea/);
});

test('projects survive a restart', async () => {
  const f = fakes(), dir = tmp();
  const e = new RealEngine({ dir, tools: f.tools, draftFps: 2, sketchFrames: 2, gates: M1 });
  const p = e.create(settings);
  await ready(e, p.id);
  await new Promise(r => setTimeout(r, 20));
  const again = new RealEngine({ dir, tools: f.tools, gates: M1 });
  assert.equal(again.get(p.id)?.scenes.length, 3);
  assert.equal(again.list()[0].id, p.id);
});

test('the run stops at the script gate: nothing is voiced or painted until it is approved', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  await gateOpen(e, p.id);
  await tick();
  let s = e.get(p.id)!;
  assert.equal(s.status, 'awaiting');
  assert.deepEqual(s.gate && { stage: s.gate.stage, version: s.gate.version }, { stage: 'script', version: 1 });
  assert.match(s.gate!.summary, /3 сцены/);
  assert.deepEqual(s.stages.script, { status: 'awaiting', version: 1 });
  assert.equal(s.stages.brief.status, 'completed');
  assert.equal(s.scenes.length, 3, 'the scenes are shown for reading');
  assert.equal(f.painted.length, 0, 'no frame painted before approval');
  assert.ok(s.log.some(l => l.id === 'gate-script-v1' && l.status === 'wait'));
  assert.throws(() => e.build(p.id), /not ready/);
  assert.throws(() => e.editScene(p.id, 1, 'ночь'), /не утверждён/);
  const dir = dirOf(e, p.id);
  assert.equal(json<Checkpoint>(join(dir, 'stages/script.json')).status, 'awaiting');
  assert.ok(journal(dir).some(l => l.kind === 'gate' && l.payload.open === true && l.payload.version === 1));

  assert.throws(() => e.approve(p.id, 'script', 2), (err: Error & { status?: number }) => err.status === 409);
  assert.throws(() => e.approve(p.id, 'storyboard', 1), (err: Error & { status?: number }) => err.status === 409);
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  s = e.approve(p.id, 'script', 1, 'годится');
  assert.equal(s.gate, undefined);
  assert.deepEqual(s.stages.script, { status: 'completed', version: 1 });
  const again = e.approve(p.id, 'script', 1);
  assert.equal(again.stages.script.status, 'completed', 'a second approve of the same version changes nothing');
  await done;
  s = e.get(p.id)!;
  assert.ok(f.painted.length > 0 && s.scenes.every(sc => sc.status === 'done'));
  assert.equal(s.stages.paint.status, 'completed');
  assert.equal(s.stages.voice.status, 'completed');
  const cp = json<Checkpoint>(join(dir, 'stages/script.json'));
  assert.deepEqual([cp.status, cp.approval?.decision, cp.approval?.version, cp.approval?.note], ['completed', 'approve', 1, 'годится']);
  assert.deepEqual(json<Checkpoint>(join(dir, 'stages/paint.json')).doneScenes, [1, 2, 3]);
  const lines = journal(dir);
  assert.equal(lines.filter(l => l.kind === 'scene' && l.scene === 2).length, 3, 'one line per scene step: sketch, painting, done');
  assert.ok(!lines.some(l => (l.kind as string) === 'frame'), 'frames stay out of the journal');
  assert.ok(lines.some(l => l.kind === 'gate' && l.payload.decision === 'approve'));
});

test('revise: Claude rewrites the script as v2, v1 stays in history, the gate opens again', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  await gateOpen(e, p.id);
  await tick();
  assert.throws(() => e.revise(p.id, 'script', 1, '   '), (err: Error & { status?: number }) => err.status === 400);
  const v2 = gateOpen(e, p.id, 2);
  const s1 = e.revise(p.id, 'script', 1, 'короче начало');
  assert.equal(s1.stages.script.status, 'revised');
  assert.equal(s1.gate, undefined);
  assert.throws(() => e.approve(p.id, 'script', 1), /уже возвращена/);
  await v2;
  await tick();
  const s = e.get(p.id)!;
  assert.deepEqual(s.stages.script, { status: 'awaiting', version: 2 });
  assert.equal(s.scenes[0].line, REWRITTEN.scenes[0].line);
  assert.ok(f.asked.some(q => q.includes('NOTE FROM THE AUTHOR: короче начало')));
  assert.ok(s.log.some(l => l.id === 'script-v2' && l.status === 'ok' && /Claude учёл/.test(l.detail ?? '')));
  assert.equal(f.painted.length, 0);
  const dir = dirOf(e, p.id), old = json<Checkpoint>(join(dir, 'stages/history/script.v1.json'));
  assert.deepEqual([old.version, old.status, old.approval?.decision, old.approval?.note], [1, 'revised', 'revise', 'короче начало']);
  assert.equal((old.artifact as { scenes: { line: string }[] }).scenes[0].line, BOARD.scenes[0].line);
  assert.throws(() => e.approve(p.id, 'script', 1), /устарела/);
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  e.approve(p.id, 'script', 2);
  await done;
  assert.deepEqual(e.get(p.id)!.stages.script, { status: 'completed', version: 2 });
});

test('revise without Claude: simple rules, and the log says so', async () => {
  const f = fakes({ claude: 'down' }), e = engine(f);
  const p = e.create(settings);
  await gateOpen(e, p.id);
  await tick();
  e.revise(p.id, 'script', 1, 'сцена 1: ночь');
  await gateOpen(e, p.id, 2);
  await tick();
  const s = e.get(p.id)!;
  assert.match(s.scenes[0].visual, /ночью/);
  assert.doesNotMatch(s.scenes[1].visual, /ночью/);
  assert.ok(s.log.some(l => l.id === 'script-v2' && /по простым правилам/.test(l.detail ?? '')));
  e.revise(p.id, 'script', 2, 'сделай как-нибудь иначе');
  await gateOpen(e, p.id, 3);
  await tick();
  assert.ok(e.get(p.id)!.log.some(l => l.id === 'script-v3' && /не понял/.test(l.detail ?? '')), 'an honest line when the note was not understood');
});

test('gates off: the run goes straight through, as before Inkframe 3', async () => {
  const f = fakes(), e = engine(f, { gates: { script: false, storyboard: false, final: false } });
  const p = e.create(settings);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  const s = e.get(p.id)!;
  assert.equal(s.gate, undefined);
  assert.deepEqual(s.stages.script, { status: 'completed', version: 1 });
});

test('a project saved before Inkframe 3 (no stages) opens and can be edited', async () => {
  const f = fakes(), dir = tmp();
  const e = new RealEngine({ dir, tools: f.tools, draftFps: 2, sketchFrames: 2, gates: M1 });
  const p = e.create(settings);
  await ready(e, p.id);
  await tick(20);
  const file = join(dir, p.id, 'project.json'), saved = json<{ state: Record<string, unknown> }>(file);
  delete saved.state.stages;
  writeFileSync(file, JSON.stringify(saved));
  const again = new RealEngine({ dir, tools: f.tools, draftFps: 2, sketchFrames: 2, gates: M1 });
  const s = again.get(p.id)!;
  assert.deepEqual([s.stages.brief.status, s.stages.script.status, s.stages.paint.status, s.stages.storyboard.status], ['completed', 'completed', 'completed', 'pending']);
  again.editScene(p.id, 1, 'ночь');
  await until(again, p.id, ev => ev.type === 'scene.edited');
});

const built = (e: RealEngine, id: string) => {
  const end = until(e, id, ev => ev.type === 'status' && (ev.status === 'done' || ev.status === 'ready'));
  e.build(id);
  return end;
};
const clipsMade = (f: ReturnType<typeof fakes>) => f.cuts.filter(a => a.includes('-framerate')).length;

test('after the cut comes the self-review: PASS hands out the MP4, with review.json and a journal line', async () => {
  const f = fakes(), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  await built(e, p.id);
  const s = e.get(p.id)!, dir = dirOf(e, p.id);
  assert.equal(s.status, 'done');
  assert.equal(s.video, `/api/projects/${p.id}/files/cut-1.mp4`);
  assert.deepEqual([s.stages.compose.status, s.stages.review.status], ['completed', 'completed']);
  assert.equal(s.review?.decision, 'PASS');
  assert.equal(json<Review>(join(dir, 'review.json')).decision, 'PASS');
  assert.ok(journal(dir).some(l => l.kind === 'review' && l.stage === 'review' && l.payload.decision === 'PASS'));
  assert.ok(s.log.some(l => l.id === 'review-1' && l.status === 'ok' && /всё в порядке/.test(l.text)));
  assert.ok(s.log.some(l => l.id === 'build-1' && l.text === 'MP4 готов — можно скачать'));
  // what the review was told to expect: the storyboard's length, every scene and line, the subtitles
  const plan = f.plans[0];
  assert.equal(plan.file, join(dir, 'cut-1.mp4'));
  assert.deepEqual([plan.width, plan.height, plan.fps, plan.voice, plan.sound], [1280, 720, 24, true, true]);
  assert.equal(plan.duration, s.scenes.reduce((a, sc) => a + sc.duration, 0));
  assert.deepEqual(plan.scenes.map(x => [x.n, x.start, x.dark]), s.scenes.map(sc => [sc.n, sc.start, false]));
  assert.ok(plan.lines.length === 3 && plan.lines.every((l, i) => l.voiced && l.start > s.scenes[i].start && l.end <= s.scenes[i].start + s.scenes[i].duration));
  assert.deepEqual(plan.subtitles, { file: join(dir, 'subtitles.ass'), burned: true });
});

test('a FAIL keeps the MP4 off the screen, says why, and the next cut repaints the broken scene', async () => {
  const f = fakes({ review: 'FAIL' }), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  await built(e, p.id);
  let s = e.get(p.id)!;
  const dir = dirOf(e, p.id);
  assert.equal(s.status, 'ready', 'not done: the MP4 is not handed out');
  assert.equal(s.video, undefined);
  assert.equal(s.review?.decision, 'FAIL');
  assert.equal(s.review?.video, `/api/projects/${p.id}/files/cut-1.mp4`, 'the report still points at the draft to look at');
  assert.deepEqual([s.stages.compose.status, s.stages.review.status], ['completed', 'failed']);
  const line = s.log.find(l => l.id === 'review-1')!;
  assert.equal(line.status, 'err');
  assert.match(line.text, /Проверка не пройдена — MP4 не отдаю/);
  assert.match(line.detail!, /чёрный экран 1,0 с \(сцена 2\)\. При следующей сборке перерисую сцену 2\./);
  assert.ok(s.log.some(l => l.id === 'build-1' && l.status === 'err'));
  assert.ok(canBuild(s), '«Собрать MP4» works again');
  assert.equal(json<Review>(join(dir, 'review.json')).decision, 'FAIL');
  assert.ok(journal(dir).some(l => l.kind === 'review' && l.payload.decision === 'FAIL'));
  assert.equal(readdirSync(join(dir, 'clips')).filter(c => c.startsWith('s2-')).length, 0, 'the broken scene leaves the cache');

  f.box.review = 'PASS';
  const before = clipsMade(f);
  await built(e, p.id);
  s = e.get(p.id)!;
  assert.equal(clipsMade(f) - before, 1, 'only scene 2 is painted again');
  assert.equal(s.status, 'done');
  assert.equal(s.video, `/api/projects/${p.id}/files/cut-2.mp4`);
  assert.equal(s.stages.review.status, 'completed');

  // a FAIL after a good cut takes the old MP4 off the screen as well (its file is replaced by the new cut)
  f.box.review = 'FAIL';
  await built(e, p.id);
  s = e.get(p.id)!;
  assert.deepEqual([s.status, s.video, s.review?.decision], ['ready', undefined, 'FAIL']);
  assert.equal(s.review?.video, `/api/projects/${p.id}/files/cut-3.mp4`);

  // a scene edit takes the MP4 and its report away
  e.editScene(p.id, 1, '', { line: 'Привет! Небо — голубое. Почему?' });
  await until(e, p.id, ev => ev.type === 'scene.edited');
  s = e.get(p.id)!;
  assert.deepEqual([s.video, s.review, s.stages.review.status], [undefined, undefined, 'pending']);
});

test('a WARN hands out the MP4 with the remarks; a review that cannot run is a WARN too', async () => {
  const f = fakes({ review: 'WARN' }), e = engine(f);
  const p = e.create(settings);
  await ready(e, p.id);
  await built(e, p.id);
  let s = e.get(p.id)!;
  assert.equal(s.status, 'done');
  assert.ok(s.video);
  assert.ok(s.log.some(l => l.id === 'review-1' && l.status === 'ok' && /есть замечания/.test(l.text) && /потолок/.test(l.detail ?? '')));

  f.box.review = 'throw';
  e.editScene(p.id, 1, '', { line: 'Привет! Почему же небо голубое?' });
  await until(e, p.id, ev => ev.type === 'scene.edited');
  await built(e, p.id);
  s = e.get(p.id)!;
  assert.equal(s.status, 'done');
  assert.equal(s.review?.decision, 'WARN');
  assert.match(s.review!.checks[0].detail, /проверить ролик не получилось: ffprobe: not found/);
});

test('the clip cache knows the renderer version: a new renderer paints every clip again', async () => {
  const f = fakes(), dir = tmp();
  const a = new RealEngine({ dir, tools: f.tools, draftFps: 2, sketchFrames: 2, rendererVersion: 'a', gates: M1 });
  const p = a.create(settings);
  await ready(a, p.id);
  await built(a, p.id);
  assert.equal(clipsMade(f), 3);
  await tick(20);
  const same = new RealEngine({ dir, tools: f.tools, rendererVersion: 'a', gates: M1 });
  await built(same, p.id);
  assert.equal(clipsMade(f), 3, 'the same renderer: every clip from the cache');
  const b = new RealEngine({ dir, tools: f.tools, rendererVersion: 'b', gates: M1 });
  await built(b, p.id);
  assert.equal(clipsMade(f), 6, 'a changed renderer: all three painted again');
  assert.equal(readdirSync(join(dir, p.id, 'clips')).length, 3, 'the old clips are cleaned away');
});
