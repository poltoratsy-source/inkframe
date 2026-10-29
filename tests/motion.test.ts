// The motion helpers of the painted engine (renderer/engine/core.js) are pure functions of time: springs, anticipation,
// hops and the boil seeds. core.js is a browser script, so it runs here in a bare VM context with p5's globals stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const seeds: number[] = [];
const ctx = vm.createContext({
  location: { search: '?render' }, URLSearchParams, window: {}, document: {},
  PROJECT: { duration: 10, bpm: 96, offset: 0 },
  randomSeed: (h: number) => { seeds.push(h); }, random: () => .5,
});
vm.runInContext(readFileSync(new URL('../renderer/engine/core.js', import.meta.url), 'utf8'), ctx);
const run = <T>(src: string): T => vm.runInContext(src, ctx) as T;
const springK = run<(k: number, p?: unknown) => number>('springK');
const springTo = run<(t: number, t0: number, d: number, p?: unknown) => number>('springTo');
const anticipate = run<(t: number, t0: number, d: number, p?: string, amt?: number, pre?: number) => number>('anticipate');
const hop = run<(t: number, t0: number, t1: number, h?: number, o?: object) => { dy: number; sq: number }>('hop');
const range = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
const PRESETS = ['settle', 'overshoot', 'bouncy', 'soft'];

test('every spring preset starts at 0 at rest, ends exactly on 1, and never jumps', () => {
  for (const p of PRESETS) {
    assert.equal(springK(-1, p), 0); assert.equal(springK(0, p), 0);
    assert.equal(springK(1, p), 1); assert.equal(springK(3, p), 1);
    assert.ok(springK(.01, p) < .02, `${p} starts at rest`);
    const ks = range(0, 1, 2000).map(k => springK(k, p));
    const step = Math.max(...ks.slice(1).map((v, i) => Math.abs(v - ks[i])));
    assert.ok(step < .02, `${p}: largest step ${step}`);
    assert.ok(Math.abs(springK(.999, p) - 1) < .01, `${p} lands on 1`);
  }
});

test('the presets have their character', () => {
  const peak = (p: string) => Math.max(...range(0, 1, 2000).map(k => springK(k, p)));
  assert.ok(peak('overshoot') > 1.12 && peak('overshoot') < 1.2, `overshoot peak ${peak('overshoot')}`);
  assert.ok(peak('settle') > 1 && peak('settle') < 1.05, `settle peak ${peak('settle')}`);
  assert.ok(peak('soft') <= 1 + 1e-12, 'soft never overshoots');
  assert.ok(peak('bouncy') <= 1 + 1e-12, 'bouncy never goes past the floor');
  const ks = range(0, 1, 4000).map(k => springK(k, 'bouncy'));
  const contacts = ks.filter((v, i) => i > 0 && v > 1 - 1e-3 && ks[i - 1] <= 1 - 1e-3).length;
  assert.ok(contacts >= 2, `bouncy touches down ${contacts} times`);
  const soft = range(0, 1, 500).map(k => springK(k, 'soft'));
  assert.ok(soft.every((v, i) => i === 0 || v >= soft[i - 1] - 1e-12), 'soft is monotonic');
  assert.equal(springK(.3, { z: .5, w: 12 }), springK(.3, 'overshoot'), 'a preset may be an object');
});

test('springTo and anticipate are pure functions of t (any order gives the same values)', () => {
  const ts = range(-.5, 2, 300);
  const a = ts.map(t => [springTo(t, .2, .8, 'overshoot'), anticipate(t, .5, .6, 'overshoot', .2)]);
  const shuffled = ts.map((t, i) => [t, i] as const).sort((x, y) => Math.sin(x[1] * 12.9898) - Math.sin(y[1] * 12.9898));
  for (const [t, i] of shuffled) assert.deepEqual([springTo(t, .2, .8, 'overshoot'), anticipate(t, .5, .6, 'overshoot', .2)], a[i]);
  assert.equal(anticipate(0, .5, .6) + 0, 0);
  assert.ok(anticipate(.4, .5, .6, 'settle', .2) < 0, 'winds up the other way first');
  assert.ok(Math.abs(anticipate(.5, .5, .6, 'settle', .2) + .2) < 1e-12, 'holds the wind-up at t0');
  assert.equal(anticipate(1.2, .5, .6, 'settle', .2), 1);
});

test('a hop crouches, flies, lands and settles, and Clawd keeps his shape', () => {
  const ts = range(0, 2.5, 1000), h = ts.map(t => hop(t, 1, 1.4, 2));
  assert.deepEqual({ ...hop(.5, 1, 1.4, 2) }, { dy: 0, sq: 0 });
  assert.ok(hop(.97, 1, 1.4, 2).sq > .1, 'crouch before takeoff');
  assert.ok(Math.abs(hop(1.2, 1, 1.4, 2).dy + 2) < 1e-9, 'top of the arc is h');
  assert.ok(hop(1.42, 1, 1.4, 2).sq > .1, 'squash on landing');
  assert.ok(h.every(p => Math.abs(p.sq) <= .2 + 1e-12 && p.dy <= 0), 'squash within ±0.2, never below the floor');
  assert.ok(Math.abs(hop(2.4, 1, 1.4, 2).sq) < 1e-3 && hop(2.4, 1, 1.4, 2).dy === 0, 'settled');
  assert.ok(Math.min(...ts.filter(t => t > 1.48 && t < 1.7).map(t => hop(t, 1, 1.4, 2).dy)) < -.1, 'a small rebound');
  assert.ok(ts.filter(t => t > 1.48).every(t => hop(t, 1, 1.4, 2, { land: 'settle' }).dy === 0), 'settle: no rebound');
});

test('boil seeds: the default stream is unchanged, and fps / hold / inkOnly change only what they say', () => {
  const seedAt = (t: number, key: string, o?: object, project?: object) => {
    seeds.length = 0;
    run(`T = ${t}; PROJECT.boil = ${JSON.stringify(project || {})}; BOILP = boilParams(); BOILO = null; BOILN = Math.floor(T * BOILP.fps);`);
    (run('boilSeed') as (k: string, o?: object) => void)(key, o);
    return seeds[0];
  };
  // FNV-1a of "key|N", exactly as before M2
  const fnv = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
  assert.equal(seedAt(1.01, 'prop-sun'), fnv('prop-sun|12'));
  assert.equal(seedAt(1.01, 'prop-sun'), seedAt(1.05, 'prop-sun'), 'same boil drawing within 1/12 s');
  assert.notEqual(seedAt(1.01, 'prop-sun'), seedAt(1.1, 'prop-sun'), 'the next drawing');
  assert.equal(seedAt(1.01, 'a', { hold: true }), seedAt(3.7, 'a', { hold: true }), 'hold never re-draws');
  assert.equal(seedAt(1.01, 'a', { fps: 6 }), fnv('a|6'), 'its own fps');
  assert.equal(seedAt(1.01, 'a', undefined, { fps: 8 }), fnv('a|8'), 'the film-wide fps');
  assert.equal(seedAt(1.01, 'a', { inkOnly: true }), seedAt(2.3, 'a', { inkOnly: true }), 'inkOnly: shapes and fills hold');
});
