// M6: the 9:16 and 1:1 formats. The layout layer (renderer/layout.js) checked slot by slot against each format's safe
// area; the engine carrying settings.format to the painter, the cut, the subtitles and the self-review (fake tools);
// clip and key frame caches keyed by format; the review's frame size and its subtitle-free crop; the demo saying that
// its ready-made film is horizontal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { RealEngine, type RealTools } from '../lib/engine/real.ts';
import { DemoEngine } from '../lib/engine/demo.ts';
import { SR } from '../lib/real/audio.ts';
import { writeAss } from '../lib/real/assemble.ts';
import { LIMITS, pictureShare, type ReviewPlan } from '../lib/real/review.ts';
import { FORMATS, FORMAT_IDS, formatOf, sizeOf, type Format } from '../lib/formats.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { Decision, Estimate } from '../lib/store/types.ts';
import type { EngineEvent, StudioEngine } from '../lib/engine/types.ts';
import type { FrameOptions } from '../lib/real/painter.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';
import { tmp } from './helpers/tmp.ts';

// ---------- the layout layer ----------
interface Box { x0: number; y0: number; x1: number; y1: number }
interface Pt { x: number; y: number; s: number }
interface Layout {
  id: Format; W: number; H: number; ground: number; safe: Box; subs: Box;
  caption: { x: number; y: number; w: number; max: number; lines: number };
  cam: Record<'host' | 'object' | 'compare', [number, number]>;
  host: { prop: Pt; solo: Pt; hero: { x: number; x0: number; u: number } };
  object: { prop: Pt; hero: { x: number; u: number }; labelW: number; labels: { x: number; y: number; a: [number, number]; tip: [number, number] }[] };
  compare: { vertical: boolean; L: Pt & { cx: number; cy: number }; R: Pt & { cx: number; cy: number }; hero: { x: number; u: number }; capW: number };
  card: { box: [number, number, number, number]; pivot: [number, number]; title: { x: number; y: number; ySub: number; w: number; max: number };
    sub: { x: number; y: number; w: number; max: number; lines: number }; hero: { x: number; u: number } };
  bg: { window: [number, number, number, number]; sun: [number, number]; moon: [number, number]; board: [number, number, number, number]; flowers: { n: number; x0: number; dx: number } };
}
const layoutFor = (() => {
  const ctx = vm.createContext({});
  const fn = vm.runInContext(readFileSync(resolve('renderer/layout.js'), 'utf8') + '\n;layoutFor', ctx) as (q: string) => Layout;
  return (q: string): Layout => JSON.parse(JSON.stringify(fn(q)));   // plain objects of this realm, for deepEqual
})();
const inside = (b: Box, x0: number, y0: number, x1: number, y1: number) => x0 >= b.x0 && y0 >= b.y0 && x1 <= b.x1 && y1 <= b.y1;
const apart = (b: Box, y0: number, y1: number) => y1 <= b.y0 || y0 >= b.y1;
/** a prop is about 200·s px across (props.js); Clawd is 10u wide and 8u tall, plus ~1.5u of hop and emote above */
const prop = (p: Pt): [number, number, number, number] => [p.x - 100 * p.s, p.y - 100 * p.s, p.x + 100 * p.s, p.y + 100 * p.s];
/** a line of words `size` px high, at most `w` wide, centred on (x, y) */
const words = (x: number, y: number, w: number, size: number): [number, number, number, number] => [x - w / 2, y - size / 2, x + w / 2, y + size / 2];

test('layout: every format has its size, a safe area and a subtitle band where the .ass file puts the subtitles', () => {
  for (const f of FORMAT_IDS) {
    const L = layoutFor(FORMATS[f].query), { w, h } = FORMATS[f].world;
    assert.deepEqual([L.id, L.W, L.H], [f, w, h]);
    assert.ok(inside({ x0: 0, y0: 0, x1: w, y1: h }, L.safe.x0, L.safe.y0, L.safe.x1, L.safe.y1), `${f}: safe area inside the frame`);
    // the .ass bottom margin, in world px, is the bottom of the band (±1 % of the height)
    const v = sizeOf(f, 720), k = h / v.h, bottom = h - FORMATS[f].subs.marginV * k;
    assert.ok(Math.abs(L.subs.y1 - bottom) <= h * .01, `${f}: subtitle band bottom ${L.subs.y1} vs .ass ${bottom}`);
    assert.ok(L.subs.y1 <= L.safe.y1 + 1 && L.subs.y0 >= L.ground, `${f}: subtitles inside the safe area, on the floor under Clawd`);
  }
  // 9:16: clear of the top 12 % and the bottom 20 % the apps cover
  const V = layoutFor('9x16');
  assert.ok(V.safe.y0 >= .12 * V.H && V.safe.y1 <= .8 * V.H);
  assert.equal(layoutFor('nonsense').id, '16:9', 'an unknown ?fmt= is 16:9');
});

test('layout: the slots of the four templates sit inside the safe area, words never in the subtitle band', () => {
  for (const f of FORMAT_IDS) {
    const L = layoutFor(FORMATS[f].query), S = L.safe, msg = (what: string) => `${f}: ${what}`;
    const hero = (x: number, u: number, big = 1) => [x - 5 * u * big, L.ground - 9.5 * u * big, x + 5 * u * big, L.ground] as const;
    // caption: up to `lines` lines, the second below the first
    const C = L.caption, capBottom = C.y + (C.lines - 1) * C.max * .92 + C.max / 2;
    assert.ok(C.y - C.max / 2 >= S.y0 && C.x - C.w / 2 >= S.x0 && C.x + C.w / 2 <= S.x1 && capBottom <= S.y1, msg('caption'));
    // host: the prop (with or without Clawd), Clawd on the ground (also «big»)
    assert.ok(inside(S, ...prop(L.host.prop)) && inside(S, ...prop(L.host.solo)), msg('host props'));
    assert.ok(inside(S, ...hero(L.host.hero.x, L.host.hero.u)) && inside(S, ...hero(L.host.hero.x0, L.host.hero.u, 1.35)), msg('host hero'));
    assert.ok(prop(L.host.prop)[3] <= L.ground - 8 * L.host.hero.u || prop(L.host.prop)[0] >= L.host.hero.x + 5 * L.host.hero.u, msg('host: the prop is clear of Clawd'));
    // object: the prop, small Clawd, labels and arrow tips
    assert.ok(inside(S, ...hero(L.object.hero.x, L.object.hero.u)), msg('object hero'));
    for (const sp of L.object.labels) {
      const b = words(sp.x, sp.y, L.object.labelW, 84);
      assert.ok(inside(S, ...b) && apart(L.subs, b[1], b[3]), msg(`label at ${sp.x},${sp.y}`));
      assert.ok(inside(S, sp.tip[0], sp.tip[1], sp.tip[0], sp.tip[1]) && inside(S, sp.a[0], sp.a[1], sp.a[0], sp.a[1]), msg('arrow ends'));
    }
    const P = L.object.prop;
    assert.ok(P.x - 100 * P.s >= 0 && P.x + 100 * P.s <= L.W && P.y - 100 * P.s >= S.y0, msg('object prop in the frame'));
    // compare: both sides and their captions; 9:16 stacks them top / bottom, the others side by side
    const { L: A, R: B } = L.compare;
    for (const side of [A, B]) {
      assert.ok(inside(S, ...prop(side)), msg('compare prop'));
      const b = words(side.cx, side.cy, L.compare.capW, 88);
      assert.ok(inside(S, ...b) && apart(L.subs, b[1], b[3]), msg('compare caption'));
    }
    if (L.compare.vertical) assert.ok(A.x === B.x && B.y - A.y >= 200 * A.s && A.cy < B.y - 100 * B.s, msg('top / bottom, the top caption above the bottom prop'));
    else assert.ok(A.y === B.y && B.x - A.x >= 200 * A.s + 100, msg('left / right'));
    const ch = hero(L.compare.hero.x, L.compare.hero.u);
    assert.ok(inside(S, ...ch), msg('compare hero'));
    assert.ok(ch[1] >= B.cy + 44 || ch[0] >= B.cx + L.compare.capW / 2 - 40 || ch[2] <= B.cx - L.compare.capW / 2, msg('compare: Clawd clear of the captions'));
    // card: big in the middle of the safe area, the words inside the card, Clawd cheering under it
    const [bx, by, bw, bh] = L.card.box, T = L.card.title, U = L.card.sub;
    assert.ok(inside(S, bx, by, bx + bw, by + bh), msg('card box'));
    assert.ok(bw >= .65 * (S.x1 - S.x0), msg('the card is big'));
    for (const [x, y, w, m] of [[T.x, T.y, T.w, T.max], [T.x, T.ySub, T.w, T.max], [U.x, U.y, U.w, U.max]])
      assert.ok(inside({ x0: bx, y0: by, x1: bx + bw, y1: by + bh }, ...words(x, y, w, m)), msg(`card words at ${y}`));
    assert.ok(by + bh <= L.ground - 9.5 * L.card.hero.u, msg('Clawd hops below the card'));
    // backgrounds: the fixed points are in the frame
    for (const [x, y] of [L.bg.sun.map((v, i) => (i ? L.ground + v : v)), L.bg.moon]) assert.ok(x > 0 && x < L.W && y > 0 && y < L.H, msg('sun / moon'));
    assert.ok(L.bg.window[0] + L.bg.window[2] <= L.W && L.bg.board[0] + L.bg.board[2] <= L.W, msg('window and board'));
    assert.ok(L.bg.flowers.x0 + (L.bg.flowers.n - 1) * L.bg.flowers.dx + 60 <= L.W, msg('flowers'));
  }
});

test('layout: 16:9 keeps the numbers the templates had before the layout layer', () => {
  const L = layoutFor('16x9');
  assert.deepEqual([L.W, L.H, L.ground, L.caption.x, L.caption.y, L.caption.w, L.caption.max, L.caption.lines], [1920, 1080, 860, 960, 112, 1700, 104, 1]);
  assert.deepEqual([L.host.prop, L.host.solo, L.host.hero], [{ x: 1330, y: 470, s: 1.25 }, { x: 960, y: 470, s: 1.7 }, { x: 640, x0: 960, u: 26 }]);
  assert.deepEqual(L.object.labels.map(l => [l.x, l.y, ...l.a, ...l.tip]), [[400, 300, 460, 350, 770, 450], [1580, 300, 1520, 350, 1240, 430]]);
  assert.deepEqual([L.compare.L.x, L.compare.R.x, L.compare.L.y, L.compare.L.cy, L.compare.hero], [520, 1400, 470, 680, { x: 960, u: 15 }]);
  assert.deepEqual([L.card.box, L.card.pivot, L.card.title.y, L.card.title.ySub, L.card.sub.y], [[330, 150, 1260, 470], [960, 380], 385, 340, 500]);
  assert.deepEqual([L.bg.window, L.bg.sun, L.bg.moon, L.bg.board], [[1460, 150, 300, 260], [1500, -120], [1600, 190], [260, 110, 1400, 560]]);
});

test('formats: sizes, unknown values, subtitles in the .ass file', () => {
  assert.deepEqual(FORMAT_IDS.map(f => sizeOf(f, 720)), [{ w: 1280, h: 720 }, { w: 720, h: 1280 }, { w: 720, h: 720 }]);
  assert.deepEqual(FORMAT_IDS.map(f => sizeOf(f, 360)), [{ w: 640, h: 360 }, { w: 360, h: 640 }, { w: 360, h: 360 }]);
  assert.deepEqual([formatOf('9:16'), formatOf('4:3'), formatOf(undefined)], ['9:16', '16:9', '16:9']);
  const dir = tmp(), cue = [{ start: .2, end: 1, text: 'Привет' }];
  const ass = (f?: Format) => { const file = join(dir, `${f ?? 'default'}.ass`); writeAss(file, cue, f); return readFileSync(file, 'utf8'); };
  // 16:9 is the file it always was
  assert.match(ass(), /PlayResX: 1280\nPlayResY: 720\n[\s\S]*Style: Sub,Inter,40,.*,2,90,90,30,204/);
  assert.equal(ass('16:9'), ass());
  assert.match(ass('9:16'), /PlayResX: 720\nPlayResY: 1280\n[\s\S]*Style: Sub,Inter,42,.*,2,50,50,272,204/);
  assert.match(ass('1:1'), /PlayResX: 720\nPlayResY: 720\n/);
});

// ---------- the engine ----------
const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
const BOARD = {
  title: 'Почему небо голубое',
  scenes: [
    { title: 'Вопрос', line: 'Привет! Почему небо голубое?', duration: 4, spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' } },
    { title: 'Рассеяние', line: 'Синий свет рассеивается сильнее красного.', duration: 6, spec: { template: 'compare', left: { prop: 'wave', color: 'blue', caption: 'синий' }, right: { prop: 'wave', color: 'red', caption: 'красный' } } },
    { title: 'Финал', line: 'Пиши в комментариях НЕБО!', duration: 5, spec: { template: 'card', setting: 'sunset', title: 'НЕБО' } },
  ],
};
function fakes() {
  const painted: { scene: StageScene; times: number[]; o: FrameOptions }[] = [], cuts: string[][] = [], plans: ReviewPlan[] = [];
  const tools: Partial<RealTools> = {
    ask: async () => JSON.stringify(BOARD),
    voice: async jobs => { for (const j of jobs) { writeFileSync(j.out + '.mp3', ''); writeFileSync(j.out + '.json', JSON.stringify({ words: j.text.split(' ').map((w, i) => [i * .4, i * .4 + .3, w]) })); } },
    decode: async f => new Float32Array(Math.round(JSON.parse(readFileSync(f.replace(/\.mp3$/, '.json'), 'utf8')).words.length * .35 * SR)).fill(.2),
    painter: { workers: 3, close: async () => {}, frames: async (scene, times, o, onFrame) => { painted.push({ scene, times, o }); for (let i = 0; i < times.length; i++) await onFrame(i, Buffer.from('jpeg')); } },
    ffmpeg: async (args, cwd) => { cuts.push(args); writeFileSync(join(cwd ?? '', args[args.length - 1]), 'mp4'); },
    review: async plan => { plans.push(plan); return { at: new Date().toISOString(), video: plan.src, decision: 'PASS', checks: [{ id: 'probe', ok: true, detail: `${plan.width}×${plan.height}` }] }; },
  };
  return { tools, painted, cuts, plans };
}
const until = (e: StudioEngine, id: string, pred: (ev: EngineEvent) => boolean) => new Promise<void>(resolve => {
  let off = () => {};
  off = e.subscribe(id, ev => { if (pred(ev)) { queueMicrotask(() => off()); resolve(); } });
});
const OFF = { script: false, storyboard: false, final: false };
const dirOf = (e: RealEngine, id: string) => e.fileOf(id, 'stages/script.json')!.replace(/\/stages\/script\.json$/, '');
const lines = <T>(f: string): T[] => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
/** a whole run without gates, the MP4 built by hand */
async function film(e: RealEngine, format: Format) {
  const p = e.create({ ...settings, format });
  const ready = until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  await ready;
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  e.build(p.id);
  await done;
  return p.id;
}

test('engine: settings.format reaches every painter call, the draft and final sizes, the subtitles, the review and the decision log', async () => {
  for (const [format, draft, video] of [['9:16', 360, [720, 1280]], ['1:1', 360, [720, 720]], ['16:9', 640, [1280, 720]]] as const) {
    const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: OFF, budget: { mode: 'observe' }, subtitles: true });
    const id = await film(e, format), dir = dirOf(e, id), s = e.get(id)!;
    assert.equal(s.format, format, 'the project says which format its frames are');
    assert.ok(f.painted.length > 0 && f.painted.every(x => x.scene.format === format), `${format}: every frame asks the stage for ${format}`);
    const finals = f.painted.filter(x => x.o.rs === .5), drafts = f.painted.filter(x => x.o.rs === .25);
    assert.ok(drafts.length && drafts.every(x => x.o.width === draft), `${format}: drafts ${draft} px wide`);
    assert.ok(finals.length === 3 && finals.every(x => x.o.width === video[0]), `${format}: final frames ${video[0]} px wide`);
    assert.match(readFileSync(join(dir, 'subtitles.ass'), 'utf8'), new RegExp(`PlayResX: ${video[0]}\\nPlayResY: ${video[1]}\\n`));
    assert.deepEqual([f.plans[0].width, f.plans[0].height], video, 'the self-review expects this size');
    const d = lines<Decision>(join(dir, 'decisions.jsonl')).find(x => x.what === 'format')!;
    assert.deepEqual([d.chosen, d.confidence], [`${format} · ${video[0]}×${video[1]}`, 'high']);
    assert.ok(s.log.some(l => l.detail?.includes(`${video[0]}×${video[1]}`)), 'the cut line names the size');
    assert.equal(e.list()[0].format, format, 'the library knows the cover format');
  }
});

test('engine: the clip and key frame caches tell the formats apart', async () => {
  const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: OFF, budget: { mode: 'observe' }, rendererVersion: 'same' });
  const clips = async (format: Format) => readdirSync(join(dirOf(e, await film(e, format)), 'clips')).sort();
  const [a, b, c] = [await clips('16:9'), await clips('9:16'), await clips('1:1')];
  assert.equal(a.length, 3);
  for (let i = 0; i < 3; i++) assert.ok(new Set([a[i], b[i], c[i]]).size === 3, `scene ${i + 1}: three formats, three clips`);
  // the same scene in another format is a different key frame too (the storyboard gate's cache)
  const g = fakes(), e2 = new RealEngine({ dir: tmp(), tools: g.tools, draftFps: 2, sketchFrames: 2, gates: { script: false, storyboard: true, final: false }, budget: { mode: 'observe' } });
  const keys = async (format: Format) => {
    const p = e2.create({ ...settings, format });
    await until(e2, p.id, ev => ev.type === 'gate' && ev.open && ev.stage === 'storyboard');
    return e2.get(p.id)!.scenes.map(sc => sc.key!.split('/').pop());
  };
  const [k1, k2] = [await keys('16:9'), await keys('9:16')];
  assert.ok(k1.every((k, i) => k !== k2[i]));
  assert.ok(g.painted.filter(x => x.times.length === 1).every(x => x.o.width === (x.scene.format === '9:16' ? 360 : 640)), 'key frames at the draft size');
});

test('engine: the estimate counts a square frame as the smaller job it is', async () => {
  const est = async (format: Format) => {
    const f = fakes(), e = new RealEngine({ dir: tmp(), tools: f.tools, draftFps: 2, sketchFrames: 2, gates: { script: true, storyboard: false, final: false }, budget: { mode: 'observe' } });
    const p = e.create({ ...settings, format });
    await until(e, p.id, ev => ev.type === 'gate' && ev.open);
    return e.get(p.id)!.estimate as Estimate;
  };
  const [w, v, q] = [await est('16:9'), await est('9:16'), await est('1:1')];
  assert.equal(w.frames, q.frames);
  assert.equal(w.paintSec, v.paintSec, '9:16 paints as much area as 16:9');
  assert.ok(q.paintSec < w.paintSec * .8 && q.paintSec > w.paintSec * .5, `1:1 ${q.paintSec} s ≈ 0.7 × 16:9 ${w.paintSec} s`);
});

test('review: it expects the format\'s size and looks above the vertical subtitles', () => {
  assert.equal(pictureShare(1280, 720), LIMITS.picture);
  assert.equal(pictureShare(720, 720), LIMITS.picture);
  assert.equal(pictureShare(720, 1280), .7);
  // the vertical subtitles start below the part black / blank look at (.ass margin and font, two lines at most)
  const v = sizeOf('9:16', 720), top = v.h - FORMATS['9:16'].subs.marginV - 2 * 1.25 * FORMATS['9:16'].subs.size;
  assert.ok(top >= v.h * pictureShare(v.w, v.h), `subtitles from ${top} px, the check stops at ${v.h * .7}`);
});

test('demo: its film is horizontal whatever the settings ask, and it says so', async () => {
  const e = new DemoEngine({ speed: 1000, gates: { script: true, storyboard: false, final: false } });
  const p = e.create({ ...settings, format: '9:16' });
  await until(e, p.id, ev => ev.type === 'gate' && ev.open);
  const s = e.get(p.id)!;
  assert.deepEqual([s.format, s.settings.format], ['16:9', '9:16']);
  const d = s.log.find(l => l.decision?.what === 'format')?.decision;
  assert.ok(d && d.confidence === 'low' && /горизонтально/.test(d.reason), 'a «решение» line about the format');
  const q = e.create(settings);
  await until(e, q.id, ev => ev.type === 'gate' && ev.open);
  assert.ok(!e.get(q.id)!.log.some(l => l.decision?.what === 'format'), 'nothing to say for 16:9');
});
