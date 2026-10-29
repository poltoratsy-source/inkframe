// RealEngine end to end with fake tools: no Claude, Chrome, edge-tts or ffmpeg needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { SR } from '../lib/real/audio.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { EngineEvent } from '../lib/engine/types.ts';
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

function fakes(o: { claude?: 'ok' | 'down' } = {}) {
  const painted: { scene: StageScene; times: number[] }[] = [], cuts: string[][] = [], asked: string[] = [];
  const tools: Partial<RealTools> = {
    ask: async p => {
      asked.push(p);
      if (o.claude === 'down') throw new Error('Claude did not answer in 1 s');
      if (p.includes('CURRENT SCENE')) return JSON.stringify({ ...BOARD.scenes[1], line: 'Синий рассеивается, поэтому небо голубое.', spec: { ...BOARD.scenes[1].spec, setting: 'night' } });
      return JSON.stringify(BOARD);
    },
    voice: async jobs => { for (const j of jobs) { writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w.replace(/[!?.,]/g, '')]) })); } },
    // every line "lasts" 0.35 s per word
    decode: async f => { const words = JSON.parse((await import('node:fs')).readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length; return new Float32Array(Math.round(words * .35 * SR)).fill(.2); },
    painter: { workers: 3, close: async () => {}, frames: async (scene, times, _o, onFrame) => { painted.push({ scene, times }); for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg')); } },
    ffmpeg: async (args, cwd) => { cuts.push(args); writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
  };
  return { tools, painted, cuts, asked };
}
const until = (e: RealEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(resolve => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); resolve(); } });
});
const ready = (e: RealEngine, id: string) => until(e, id, ev => ev.type === 'status' && ev.status === 'ready');
const engine = (f: ReturnType<typeof fakes>, more = {}) => new RealEngine({ dir: mkdtempSync(join(tmpdir(), 'inkframe-')), tools: f.tools, draftFps: 2, sketchFrames: 2, ...more });

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
  const f = fakes(), dir = mkdtempSync(join(tmpdir(), 'inkframe-'));
  const e = new RealEngine({ dir, tools: f.tools, draftFps: 2, sketchFrames: 2 });
  const p = e.create(settings);
  await ready(e, p.id);
  await new Promise(r => setTimeout(r, 20));
  const again = new RealEngine({ dir, tools: f.tools });
  assert.equal(again.get(p.id)?.scenes.length, 3);
  assert.equal(again.list()[0].id, p.id);
});
