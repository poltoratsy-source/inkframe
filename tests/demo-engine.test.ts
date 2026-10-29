import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoEngine } from '../lib/engine/demo.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { EngineEvent } from '../lib/engine/types.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 };
const until = (engine: DemoEngine, id: string, pred: (ev: EngineEvent) => boolean) =>
  new Promise<EngineEvent[]>(resolve => {
    const seen: EngineEvent[] = [];
    const off = engine.subscribe(id, ev => { seen.push(ev); if (pred(ev)) { queueMicrotask(off); resolve(seen); } });
  });

test('subscribe replays a snapshot first, then the run ends ready', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const p = e.create(settings);
  const seen = await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  assert.equal(seen[0].type, 'snapshot');
  assert.equal(e.get(p.id)!.status, 'ready');
  assert.equal(e.list()[0].id, p.id);
  assert.ok(e.list()[0].thumb, 'list shows a thumbnail');
});

test('an edit sent mid-run waits for the run and then redraws the scene', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const p = e.create(settings);
  await until(e, p.id, ev => ev.type === 'storyboard');
  e.editScene(p.id, 2, 'ночь');
  await until(e, p.id, ev => ev.type === 'scene.edited');
  const s = e.get(p.id)!;
  assert.equal(s.status, 'ready');
  assert.equal(s.scenes[1].edited, true);
});

test('build is refused until every scene is done, then hands out the video', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const p = e.create(settings);
  assert.throws(() => e.build(p.id), /not ready/);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  e.build(p.id);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'done');
  assert.equal(e.get(p.id)!.video, '/demo/result.mp4');
});

test('unknown projects and scenes', () => {
  const e = new DemoEngine({ speed: 1000 });
  assert.equal(e.get('nope'), undefined);
  assert.throws(() => e.editScene('nope', 1, 'x'), /not found/);
  const p = e.create(settings);
  assert.throws(() => e.editScene(p.id, 9, 'x'), /scene 9/);
  assert.throws(() => e.editScene(p.id, 1, '   '), /empty/);
});

test('empty idea is refused', () => {
  assert.throws(() => new DemoEngine().create({ ...settings, idea: '  ' }), /idea/);
});

test('new words from the edit panel show at once and redraw the scene', async () => {
  const e = new DemoEngine({ speed: 1000 });
  const p = e.create(settings);
  await until(e, p.id, ev => ev.type === 'status' && ev.status === 'ready');
  e.editScene(p.id, 1, '', { line: 'Новая реплика' });
  assert.equal(e.get(p.id)!.scenes[0].line, 'Новая реплика');
  await until(e, p.id, ev => ev.type === 'scene.edited');
  assert.equal(e.get(p.id)!.scenes[0].edited, true);
});
