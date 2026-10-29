// M7: style packs (renderer/styles/<id>: style.json, STYLE.md, kit.js). The packs are read and checked; Watercolour
// keeps the numbers core.js had before the packs; the Ink colour grammar (a role → its colour, no role → the ink,
// Clawd as he is) on core.js's own paint wrapper in a VM; roles in the SceneSpec; the style in the storyboard prompt
// and the template storyboard; the style reaching the painter, both caches, the decision log and the estimate; the
// demo saying its film is watercolour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { BRAND, STYLE_IDS, STYLE_PACKS, checkPack, styleOf, type StylePack } from '../lib/styles.ts';
import { checkPacks, loadPack, styleNotes } from '../lib/real/styles.ts';
import { cleanSpec } from '../lib/real/scene-spec.ts';
import { storyboardPrompt, templateStoryboard } from '../lib/real/storyboard.ts';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { DemoEngine } from '../lib/engine/demo.ts';
import { SR } from '../lib/real/audio.ts';
import { DEFAULT_SETTINGS, STYLES } from '../lib/options.ts';
import type { Decision, Estimate } from '../lib/store/types.ts';
import type { EngineEvent, StartSettings, StudioEngine } from '../lib/engine/types.ts';
import type { FrameOptions } from '../lib/real/painter.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';
import { tmp } from './helpers/tmp.ts';

// ---------- the packs ----------
test('packs: both exist on disk, pass the check, and the bundled copies are the files', () => {
  assert.deepEqual([...STYLE_IDS], ['watercolor', 'ink']);
  assert.deepEqual(checkPacks(), { watercolor: [], ink: [] });
  for (const id of STYLE_IDS) {
    const disk = loadPack(id);
    assert.deepEqual(disk, STYLE_PACKS[id], `${id}: lib/styles.ts bundles the same file`);
    for (const [k, c] of Object.entries(BRAND)) assert.equal(disk.palette[k], c, `${id}: Clawd keeps ${k}`);
    assert.ok(styleNotes(id).length > 200, `${id}: STYLE.md for the storyboard`);
  }
  assert.ok(readdirSync(resolve('renderer/styles/ink')).includes('kit.js'));
  assert.equal(styleOf('kinetic'), 'watercolor', 'an old or unknown style id paints as watercolour');
  assert.equal(styleOf('ink'), 'ink');
  // the start screen offers exactly the packs, each with a real frame of its own
  assert.deepEqual(STYLES.map(s => s.id), ['watercolor', 'ink']);
  assert.ok(STYLES.every(s => !s.soon && /demo\/styles\/(watercolor|ink)\.jpg$/.test(s.thumb)));
});

test('packs: the check catches missing fields, bad colours, a changed Clawd and a broken file on disk', () => {
  const ink = structuredClone(STYLE_PACKS.ink) as unknown as Record<string, any>;
  assert.deepEqual(checkPack(ink, 'ink'), []);
  const broken = (f: (p: Record<string, any>) => void) => { const p = structuredClone(ink); f(p); return checkPack(p, 'ink'); };
  assert.ok(broken(p => { delete p.paper; }).some(x => x.startsWith('paper')));
  assert.ok(broken(p => { p.ink = 'black'; }).some(x => x.startsWith('ink')));
  assert.ok(broken(p => { p.palette.clay = '#000000'; }).some(x => x.includes('Clawd')));
  assert.ok(broken(p => { p.boil.fps = 60; }).some(x => x.startsWith('boil')));
  assert.ok(broken(p => { p.springs.pop = 'wobbly'; }).some(x => x.startsWith('springs')));
  assert.ok(broken(p => { p.grammar.flow = 'orange'; }).some(x => x.startsWith('grammar')));
  assert.ok(broken(p => { p.grammar.defaults.arrow = 'blue'; }).some(x => x.startsWith('grammar.defaults')));
  assert.ok(broken(p => { delete p.speed; }).some(x => x.startsWith('speed')));
  assert.ok(checkPack(ink, 'watercolor').some(x => x.startsWith('id')), 'the folder name and the id agree');
  // a pack on disk with a missing kit and a bad field is refused with both problems
  const dir = tmp();
  cpSync(resolve('renderer/styles'), dir, { recursive: true });
  writeFileSync(join(dir, 'ink', 'style.json'), JSON.stringify({ ...ink, kit: 'gone.js', paper: '#fff' }));
  assert.throws(() => loadPack('ink', dir), /paper[\s\S]*gone\.js is missing/);
  assert.deepEqual(checkPacks(dir).watercolor, []);
});

// ---------- core.js with a pack, in a VM ----------
type Call = [string, ...unknown[]];
function stage(pack: StylePack) {
  const calls: Call[] = [], rec = (n: string) => (...a: unknown[]) => { calls.push([n, ...a]); };
  const brush = Object.fromEntries(['wash', 'noWash', 'fill', 'fillBleed', 'fillTexture', 'noFill', 'hatch', 'hatchStyle', 'noHatch', 'noStroke',
    'beginShape', 'vertex', 'endShape', 'polygon', 'set', 'spline'].map(n => [n, n === 'vertex' ? () => {} : rec(n)]));
  const ctx = vm.createContext({
    location: { search: '?render' }, URLSearchParams, window: { STYLE: structuredClone(pack) }, document: {},
    PROJECT: { duration: 10, bpm: 96, offset: 0, boil: pack.boil }, randomSeed: () => {}, random: () => .5,
    push: () => {}, pop: () => {}, translate: () => {}, brush,
  });
  vm.runInContext(readFileSync(resolve('renderer/engine/core.js'), 'utf8'), ctx);
  const run = <T>(src: string): T => vm.runInContext(src, ctx) as T;
  /** paint or draw something and return what the brush was asked for: outline colours and wash colours */
  const look = (src: string) => {
    calls.length = 0; run(src);
    return { lines: calls.filter(c => c[0] === 'set').map(c => c[2]), washes: calls.filter(c => c[0] === 'wash').map(c => c[1]), fills: calls.filter(c => c[0] === 'fill').length };
  };
  return { run, look };
}
const SQ = '[[0,0],[100,0],[100,100],[0,100]]';

test('watercolour: the pack holds exactly the numbers core.js had, and paints every shape as drawn', () => {
  const { run, look } = stage(STYLE_PACKS.watercolor);
  assert.deepEqual(JSON.parse(run('JSON.stringify(PAL)')), {
    paper: '#F3EBDC', ink: '#2B2233', clay: '#D97757', clayDk: '#A84D33', clayLt: '#F2A283',
    night: '#1F2550', indigo: '#2F3C7A', rose: '#E27A92', ochre: '#E8AA38', sap: '#6E9F58',
    teal: '#3A9C98', violet: '#7B5CA8', cream: '#FFF5E2', sky: '#8EC3E6',
  });
  assert.deepEqual(JSON.parse(run('JSON.stringify(SPR)')), { pop: 'overshoot', arrive: 'settle', land: 'bouncy', letters: 'overshoot' });
  assert.deepEqual(JSON.parse(run('JSON.stringify(LET)')), { fill: '#FFF5E2', stroke: '#2B2233', shadow: true, title: '#D97757', sub: '#2B2233' });
  assert.equal(run('STYLED'), false, 'no shape is restyled');
  assert.equal(run('GRAM'), null, 'no colour grammar');
  assert.deepEqual(JSON.parse(run('JSON.stringify(boilParams())')), { fps: 12, amp: 1, inkOnly: false, hold: false, holdStill: false });
  const b = STYLE_PACKS.watercolor.brushes.ink;
  assert.deepEqual([b.weight, b.scatter, b.opacity, b.pressure], [5, .25, 235, [1.15, .75]], 'the ink brush as it was');
  const t = STYLE_PACKS.watercolor.texture;
  assert.deepEqual([t.blotches.n, t.blotches.r0, t.blotches.dr, t.fibres.n, t.grain.depth, t.vignette.alpha], [70, 120, 380, 1400, 34, .35], 'the paper as it was');
  // a role means nothing here: the shape keeps its colours
  const plain = look(`paint(${SQ}, { wash: '#5B8FD6', fill: '#3A9C98', ink: '#2B2233' })`);
  const marked = look(`withRole('problem', () => paint(${SQ}, { wash: '#5B8FD6', fill: '#3A9C98', ink: '#2B2233' }))`);
  assert.deepEqual(marked, plain);
  assert.deepEqual([plain.washes, plain.lines, plain.fills], [['#5B8FD6'], ['#2B2233'], 1]);
});

test('ink: the colour grammar — a role gets its colour, no role is the ink, Clawd stays himself', () => {
  const ink = STYLE_PACKS.ink, g = ink.grammar!, { run, look } = stage(ink);
  assert.equal(run('STYLED'), true);
  assert.deepEqual(JSON.parse(run('JSON.stringify(boilParams())')), { fps: 10, amp: 1.5, inkOnly: true, hold: false, holdStill: false }, 'boils 10 times a second, ink lines only');
  assert.deepEqual(JSON.parse(run('JSON.stringify(SPR)')), { pop: 'settle', arrive: 'settle', land: 'bouncy', letters: 'settle' });
  // no role: the outline is the ink, the fill goes, the wash fades to a hint of its colour on the paper
  const plain = look(`paint(${SQ}, { wash: '#5B8FD6', fill: '#3A9C98', ink: '#2B2233' })`);
  assert.deepEqual(plain.lines, [ink.ink]);
  assert.equal(plain.fills, 0, 'no watercolour fill on the structure');
  assert.equal(plain.washes.length, 1);
  assert.ok(run(`lumOf('${plain.washes[0]}')`) as number > .9, `the wash is almost paper: ${plain.washes[0]}`);
  // each role: its own colour for the line and a tint of it for the wash
  for (const role of ['flow', 'problem', 'good'] as const) {
    const r = look(`withRole('${role}', () => paint(${SQ}, { wash: '#5B8FD6', ink: '#2B2233' }))`);
    assert.deepEqual(r.lines, [g[role]], `${role}: the line is ${g[role]}`);
    assert.equal(r.washes[0], run(`mixCol(PAL.paper, '${g[role]}', ${g.tint})`), `${role}: the wash is a tint of it`);
    assert.deepEqual(look(`withRole('${role}', () => inkLine([[0,0],[5,5],[10,0]], 1, '#4E7F3E'))`).lines, [g[role]], `${role}: ink lines too`);
  }
  assert.deepEqual(look(`withRole('nonsense', () => inkLine([[0,0],[5,5],[10,0]], 1, '#4E7F3E'))`).lines, [ink.ink], 'an unknown role is no role');
  assert.deepEqual(look(`inkLine([[0,0],[5,5],[10,0]], 1, '#4E7F3E')`).lines, [ink.ink], 'a coloured line without a role is ink');
  // the role ends with its element
  assert.deepEqual(look(`withRole('good', () => {}); paint(${SQ}, { wash: '#5B8FD6' })`).lines, [ink.ink]);
  // a dark spot stays solid ink (pupils); a shape drawn without an outline gets a thin one
  assert.deepEqual(look(`paint(${SQ}, { wash: '#2B2233', ink: null })`).washes, [ink.ink]);
  assert.deepEqual(look(`paint(${SQ}, { wash: '#E8AA38', ink: null })`).lines, [ink.ink], 'a flame or a rainbow band keeps a line');
  // inside clawd() (KEEP) the shapes are as drawn: his clay and his fills
  const clawd = look(`KEEP++; try { paint(${SQ}, { wash: PAL.clay, fill: PAL.clayDk, ink: PAL.ink }) } finally { KEEP-- }`);
  assert.deepEqual([clawd.washes, clawd.fills, clawd.lines], [[ink.palette.clay], 1, [ink.ink]], 'Clawd: brand colours, the pack\'s ink outline');
});

// ---------- the storyboard ----------
const settings: StartSettings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };

test('scene spec: roles are kept where the template draws them and dropped otherwise', () => {
  const s = cleanSpec({ template: 'object', prop: 'prism', propRole: 'good', captionRole: 'problem', labels: ['свет', 'радуга'], labelRoles: ['flow', 'red'], titleRole: 'good' });
  assert.deepEqual([s.propRole, s.captionRole, s.labelRoles, s.titleRole], ['good', 'problem', ['flow', null], undefined]);
  const c = cleanSpec({ template: 'compare', left: { prop: 'wave', role: 'problem' }, right: { prop: 'wave', role: 'GOOD ' }, propRole: 'flow' });
  assert.deepEqual([c.left?.role, c.right?.role, c.propRole], ['problem', 'good', undefined]);
  const h = cleanSpec({ template: 'host', left: { prop: 'sun', role: 'good' }, propRole: 'blue', labelRoles: ['flow'] });
  assert.deepEqual([h.left?.role, h.propRole, h.labelRoles], [undefined, undefined, undefined]);
  assert.equal(cleanSpec({ template: 'card', title: 'НЕБО', titleRole: 'good' }).titleRole, 'good');
});

test('storyboard: STYLE.md goes into the prompt; without Claude the template storyboard follows the style', () => {
  const ink = storyboardPrompt({ ...settings, style: 'ink' }, styleNotes('ink'));
  assert.match(ink, /ink-line cartoons/);
  assert.match(ink, /Colour grammar/);
  assert.match(ink, /"propRole", "captionRole", "titleRole", "left\.role", "right\.role"/);
  const wc = storyboardPrompt(settings, styleNotes('watercolor'));
  assert.match(wc, /watercolour cartoons/);
  assert.match(wc, /STYLE: Watercolour/);
  assert.doesNotMatch(wc, /propRole/);
  const tw = templateStoryboard(settings), ti = templateStoryboard({ ...settings, style: 'ink' });
  assert.ok(tw.scenes.every(s => !s.spec.propRole && !s.spec.captionRole), 'watercolour: no roles');
  assert.equal(ti.scenes[0].spec.captionRole, 'problem', 'ink: the question is the problem');
  const middle = ti.scenes.filter(s => s.spec.template !== 'card').slice(1);
  assert.equal(middle[middle.length - 1].spec.propRole, 'good', 'ink: the answer is the good end');
  assert.ok(middle.slice(0, -1).every(s => s.spec.propRole === 'flow'), 'ink: the steps flow');
});

// ---------- the engine ----------
const BOARD = {
  title: 'Почему небо голубое',
  scenes: [
    { title: 'Вопрос', line: 'Привет! Почему небо голубое?', duration: 4, spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' } },
    { title: 'Рассеяние', line: 'Синий свет рассеивается сильнее красного.', duration: 6, spec: { template: 'compare', left: { prop: 'wave', caption: 'синий', role: 'good' }, right: { prop: 'wave', caption: 'красный' } } },
    { title: 'Финал', line: 'Пиши в комментариях НЕБО!', duration: 5, spec: { template: 'card', setting: 'sunset', title: 'НЕБО' } },
  ],
};
function fakes() {
  const painted: { scene: StageScene; times: number[]; o: FrameOptions }[] = [], prompts: string[] = [];
  const tools: Partial<RealTools> = {
    ask: async p => { prompts.push(p); return JSON.stringify(BOARD); },
    voice: async jobs => { for (const j of jobs) { writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w]) })); } },
    decode: async f => new Float32Array(Math.round(JSON.parse(readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length * .35 * SR)).fill(.2),
    painter: { workers: 3, close: async () => {}, frames: async (scene, times, o, onFrame) => { painted.push({ scene, times, o }); for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg')); } },
    ffmpeg: async (args, cwd) => { writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
    review: async plan => ({ at: new Date().toISOString(), video: plan.src, decision: 'PASS', checks: [{ id: 'probe', ok: true, detail: 'ok' }] }),
  };
  return { tools, painted, prompts };
}
const until = (e: StudioEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(res => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); res(); } });
});
const OFF = { script: false, storyboard: false, final: false };
const dirOf = (e: RealEngine, id: string) => e.fileOf(id, 'stages/script.json')!.replace(/\/stages\/script\.json$/, '');
const lines = <T>(f: string): T[] => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
async function film(e: RealEngine, style: StartSettings['style']) {
  const p = e.create({ ...settings, style });
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  e.build(p.id);
  await done;
  return p.id;
}

test('engine: the style reaches Claude, every painter call, the roles and the decision log', async () => {
  for (const style of ['ink', 'watercolor'] as const) {
    const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: OFF, budget: { mode: 'observe' } });
    const id = await film(e, style), dir = dirOf(e, id);
    assert.ok(f.painted.length > 0 && f.painted.every(x => x.scene.style === style), `${style}: every frame asks the stage for ${style}`);
    assert.equal(f.painted.find(x => x.scene.template === 'compare')!.scene.left!.role, 'good', 'the role reaches the stage');
    assert.equal(/Colour grammar/.test(f.prompts[0]), style === 'ink', 'STYLE.md in the prompt');
    const d = lines<Decision>(join(dir, 'decisions.jsonl')).find(x => x.what === 'style')!;
    assert.equal(d.chosen, STYLE_PACKS[style].name.ru);
    assert.equal(d.confidence, 'high');
    if (style === 'ink') assert.match(d.reason, /оранжевый — поток, красный — проблема, синий — хороший итог/);
  }
});

test('engine: an unknown style paints as watercolour and says so', async () => {
  const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: OFF, budget: { mode: 'observe' } });
  const id = await film(e, 'kinetic' as StartSettings['style']);
  assert.ok(f.painted.every(x => x.scene.style === 'watercolor'));
  const d = lines<Decision>(join(dirOf(e, id), 'decisions.jsonl')).find(x => x.what === 'style')!;
  assert.deepEqual([d.chosen, d.confidence], ['Акварель', 'low']);
  assert.match(d.reason, /kinetic.*акварелью/);
});

test('engine: clips and key frames are cached per style', async () => {
  const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: OFF, budget: { mode: 'observe' }, rendererVersion: 'same' });
  const clips = async (style: StartSettings['style']) => readdirSync(join(dirOf(e, await film(e, style)), 'clips')).sort();
  const [a, b] = [await clips('watercolor'), await clips('ink')];
  assert.equal(a.length, 3);
  for (let i = 0; i < 3; i++) assert.notEqual(a[i], b[i], `scene ${i + 1}: two styles, two clips`);
  const g = fakes(), e2 = new RealEngine({ dir: tmp(), tools: g.tools, draftFps: 2, sketchFrames: 2, gates: { script: false, storyboard: true, final: false }, budget: { mode: 'observe' } });
  const keys = async (style: StartSettings['style']) => {
    const p = e2.create({ ...settings, style });
    await until(e2, p.id, ev => ev.type === 'gate' && ev.open && ev.stage === 'storyboard');
    return e2.get(p.id)!.scenes.map(sc => sc.key!.split('/').pop());
  };
  const [k1, k2] = [await keys('watercolor'), await keys('ink')];
  assert.ok(k1.every((k, i) => k !== k2[i]), 'key frames differ by style');
});

test('engine: the estimate counts an Ink frame at its pack\'s cost', async () => {
  const est = async (style: StartSettings['style'], format: StartSettings['format'] = '16:9') => {
    const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: { script: true, storyboard: false, final: false }, budget: { mode: 'observe' } });
    const p = e.create({ ...settings, style, format });
    await until(e, p.id, ev => ev.type === 'gate' && ev.open);
    return e.get(p.id)!.estimate as Estimate;
  };
  const cost = STYLE_PACKS.ink.speed.cost, [w, i, q] = [await est('watercolor'), await est('ink'), await est('ink', '1:1')];
  assert.equal(w.frames, i.frames);
  assert.notEqual(cost, 1);
  // paintSec = frames × s/frame / workers + calls × lead: only the frames part scales
  const lead = (x: Estimate) => x.paintSec - (x.keyFrames! + x.draftFrames!) * x.draftSecPerFrame! / x.workers - x.finalFrames! * x.secPerFrame / x.workers;
  assert.ok(Math.abs(i.secPerFrame - w.secPerFrame * cost) < .02, `s/frame ${i.secPerFrame} = ${cost} × ${w.secPerFrame}`);
  assert.ok(Math.abs(lead(i) - lead(w)) < 1, 'the wait before a call does not depend on the style');
  assert.ok(Math.abs(q.secPerFrame - w.secPerFrame * cost * .7) < .02, 'a square Ink frame: both costs');
});

test('demo: its film is watercolour whatever the style, and it says so', async () => {
  const e = new DemoEngine({ speed: 1000, gates: { script: true, storyboard: false, final: false } });
  const p = e.create({ ...settings, style: 'ink' });
  await until(e, p.id, ev => ev.type === 'gate' && ev.open);
  const d = e.get(p.id)!.log.find(l => l.decision?.what === 'style')?.decision;
  assert.ok(d && d.chosen === 'Акварель (демо)' && d.confidence === 'low' && /акварелью/.test(d.reason));
  const q = e.create(settings);
  await until(e, q.id, ev => ev.type === 'gate' && ev.open);
  assert.equal(e.get(q.id)!.log.find(l => l.decision?.what === 'style')?.decision?.chosen, 'Акварель');
});
