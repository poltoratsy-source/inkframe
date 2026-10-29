import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoEngine } from '../lib/engine/demo.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { EngineEvent } from '../lib/engine/types.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
/** The gates of M1–M3: only the script stops; the storyboard and final gates are tested in gates-m4.test.ts. */
const M1 = { script: true, storyboard: false, final: false };
const until = (engine: DemoEngine, id: string, pred: (ev: EngineEvent) => boolean) =>
  new Promise<EngineEvent[]>(resolve => {
    const seen: EngineEvent[] = [];
    const off = engine.subscribe(id, ev => { seen.push(ev); if (pred(ev)) { queueMicrotask(off); resolve(seen); } });
  });
/** The user pressing «Утвердить» on every gate as it opens. */
const approving = (engine: DemoEngine, id: string) =>
  engine.subscribe(id, ev => { if (ev.type === 'gate' && ev.open) queueMicrotask(() => engine.approve(id, ev.stage, ev.version)); });
const create = (engine: DemoEngine, s = settings) => { const p = engine.create(s); approving(engine, p.id); return p; };
const gateOpen = (engine: DemoEngine, id: string, version = 1) => until(engine, id, ev => ev.type === 'gate' && ev.open && ev.version === version);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

test('subscribe replays a snapshot first, then the run ends ready', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = create(e);
  const seen = await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  assert.equal(seen[0].type, 'snapshot');
  assert.equal(e.get(p.id)!.status, 'ready');
  assert.equal(e.list()[0].id, p.id);
  assert.ok(e.list()[0].thumb, 'list shows a thumbnail');
});

test('an edit sent mid-run waits for the run and then redraws the scene', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = create(e);
  await until(e, p.id, ev => ev.type === 'stage' && ev.stage === 'paint' && ev.status === 'in_progress');
  const edited = until(e, p.id, ev => ev.type === 'scene.edited');
  e.editScene(p.id, 2, 'ночь');
  await edited;
  const s = e.get(p.id)!;
  assert.equal(s.status, 'ready');
  assert.equal(s.scenes[1].edited, true);
});

test('build is refused until every scene is done, then hands out the video', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = create(e);
  assert.throws(() => e.build(p.id), /not ready/);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  // listen before acting: the cut's events must not be able to slip past a listener added after build()
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  e.build(p.id);
  await done;
  assert.equal(e.get(p.id)!.video, '/demo/result.mp4');
});

test('a slow moment inside build() never pushes the queued script out before anyone could listen', async () => {
  // the flaky failure of M5: a GC pause or a busy CPU inside build() let the clock pass the whole (4 ms at speed 1000)
  // cut script, so «done» was emitted synchronously and a listener added after build() waited forever
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = create(e);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  const real = Date.now;
  let skew = 0;
  Date.now = () => real() + (skew += 50);   // every look at the clock is 50 ms later
  try { e.build(p.id); } finally { Date.now = real; }
  assert.equal(e.get(p.id)!.status, 'building', 'only the events at 0 ms come out inside build()');
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
});

test('unknown projects and scenes', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  assert.equal(e.get('nope'), undefined);
  assert.throws(() => e.editScene('nope', 1, 'x'), /not found/);
  const p = create(e);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  assert.throws(() => e.editScene(p.id, 9, 'x'), /scene 9/);
  assert.throws(() => e.editScene(p.id, 1, '   '), /empty/);
});

test('empty idea is refused', () => {
  assert.throws(() => new DemoEngine().create({ ...settings, idea: '  ' }), /idea/);
});

test('new words from the edit panel show at once and redraw the scene', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = create(e);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  const edited = until(e, p.id, ev => ev.type === 'scene.edited');
  e.editScene(p.id, 1, '', { line: 'Новая реплика' });
  assert.equal(e.get(p.id)!.scenes[0].line, 'Новая реплика');
  await edited;
  assert.equal(e.get(p.id)!.scenes[0].edited, true);
});

test('the demo stops at the script gate and goes on after «Утвердить»', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = e.create(settings);
  const seen = await gateOpen(e, p.id);
  await tick();
  let s = e.get(p.id)!;
  assert.equal(s.status, 'awaiting');
  assert.deepEqual(s.stages.script, { status: 'awaiting', version: 1 });
  assert.equal(s.scenes.length, 3);
  assert.ok(!seen.some(ev => ev.type === 'frame') && s.scenes.every(sc => !sc.frame), 'nothing drawn while the gate is open');
  assert.throws(() => e.editScene(p.id, 1, 'ночь'), /не утверждён/);
  assert.throws(() => e.build(p.id), /not ready/);
  assert.throws(() => e.approve(p.id, 'script', 2), (err: Error & { status?: number }) => err.status === 409);
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  e.approve(p.id, 'script', 1);
  s = e.approve(p.id, 'script', 1);   // a double click: no effect
  assert.equal(s.stages.script.status, 'completed');
  await done;
  s = e.get(p.id)!;
  assert.ok(s.scenes.every(sc => sc.status === 'done'));
  assert.equal(s.log.filter(l => l.id === 'gate-script-v1').length, 1);
  assert.equal(s.log.find(l => l.id === 'gate-script-v1')!.text, 'Сценарий v1 утверждён');
});

test('«Вернуть с замечанием» in the demo: «переделываю», then version 2 at the gate', async () => {
  const e = new DemoEngine({ speed: 1000, gates: M1 });
  const p = e.create(settings);
  await gateOpen(e, p.id);
  await tick();
  const v2 = gateOpen(e, p.id, 2);
  const s1 = e.revise(p.id, 'script', 1, 'короче вторую сцену');
  assert.equal(s1.stages.script.status, 'revised');
  assert.equal(s1.status, 'drafting');
  await v2;
  await tick();
  const s = e.get(p.id)!;
  assert.deepEqual(s.stages.script, { status: 'awaiting', version: 2 });
  assert.ok(s.log.some(l => l.id === 'script-v2' && /Демо-режим/.test(l.detail ?? '')));
  assert.throws(() => e.approve(p.id, 'script', 1), /устарела/);
  const done = until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  e.approve(p.id, 'script', 2);
  await done;
});

test('gates off: the demo runs straight through', async () => {
  const e = new DemoEngine({ speed: 1000, gates: { script: false, storyboard: false, final: false } });
  const p = e.create(settings);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  assert.equal(e.get(p.id)!.stages.script.status, 'completed');
});
