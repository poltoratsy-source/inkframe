import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunScript, buildEditScript, buildAssembleScript, sceneCountFor, lookFor } from '../lib/engine/demo-script.ts';
import { applyEvent, emptyProject } from '../lib/engine/reducer.ts';
import { DEMO_CATALOG } from '../lib/engine/demo-catalog.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';
import type { ProjectState, TimedEvent } from '../lib/engine/types.ts';

const project = (duration: number, extra = {}) =>
  emptyProject('p1', { ...DEFAULT_SETTINGS, idea: 'Короткий мультфильм: Клод объясняет, почему небо голубое', duration, ...extra }, 'demo');
const play = (s: ProjectState, script: TimedEvent[]) => script.reduce((st, { ev }) => applyEvent(st, ev), s);

test('scene count follows the duration', () => {
  assert.deepEqual([15, 30, 60, 120].map(sceneCountFor), [3, 4, 6, 6]);
});

test('a 15 s run has 3 scenes and ends ready with full progress', () => {
  const script = buildRunScript(project(15), DEMO_CATALOG);
  const end = play(project(15), script);
  assert.equal(end.scenes.length, 3);
  assert.equal(end.status, 'ready');
  assert.equal(end.progress, 1);
  assert.ok(end.scenes.every(s => s.status === 'done' && s.frameKind === 'color'));
  assert.equal(end.scenes.reduce((a, s) => a + s.duration, 0), 15);
  assert.equal(script.at(-1)!.ev.type, 'status');
});

test('times never go backwards and every scene is sketched before it is painted', () => {
  const script = buildRunScript(project(60), DEMO_CATALOG);
  for (let i = 1; i < script.length; i++) assert.ok(script[i].at >= script[i - 1].at, `event ${i}`);
  for (let n = 1; n <= 6; n++) {
    const frames = script.filter(e => e.ev.type === 'frame' && e.ev.n === n).map(e => (e.ev as { kind: string }).kind);
    assert.ok(frames.length >= 8);
    assert.equal(frames.indexOf('color'), frames.lastIndexOf('sketch') + 1, `scene ${n}`);
  }
});

test('voice track only when a voice is chosen; music only when music is on', () => {
  const kinds = (p: ProjectState) => buildRunScript(p, DEMO_CATALOG).filter(e => e.ev.type === 'track').map(e => (e.ev as { kind: string }).kind);
  assert.deepEqual(kinds(project(15)).sort(), ['music', 'voice']);
  assert.deepEqual(kinds(project(15, { voice: 'none', music: 'none' })), []);
});

test('speed scales the timeline', () => {
  const slow = buildRunScript(project(15), DEMO_CATALOG, 1).at(-1)!.at;
  const fast = buildRunScript(project(15), DEMO_CATALOG, 2).at(-1)!.at;
  assert.ok(Math.abs(fast - slow / 2) < 2);
  assert.ok(slow > 20_000 && slow < 45_000, `15 s demo run lasts ${slow} ms`);
});

test('an edit redraws only that scene and marks it edited', () => {
  const ready = play(project(15), buildRunScript(project(15), DEMO_CATALOG));
  const edit = buildEditScript(ready, 2, 'ночь', DEMO_CATALOG);
  assert.ok(edit.every(e => !('n' in e.ev) || e.ev.n === 2));
  const after = play(ready, edit);
  assert.equal(after.scenes[1].edited, true);
  assert.equal(after.scenes[1].status, 'done');
  assert.equal(after.scenes[1].look.filter, lookFor('ночь').filter);
  assert.equal(after.scenes[0].edited, false);
});

test('an edit of a missing scene is refused', () => {
  const ready = play(project(15), buildRunScript(project(15), DEMO_CATALOG));
  assert.throws(() => buildEditScript(ready, 7, 'ночь', DEMO_CATALOG), /scene 7/);
});

test('quick edits have distinct looks, free text gets a stable one', () => {
  const looks = ['ночь', 'крупнее герой', 'веселее'].map(r => JSON.stringify(lookFor(r)));
  assert.equal(new Set(looks).size, 3);
  assert.deepEqual(lookFor('сделай лучи зелёными'), lookFor('сделай лучи зелёными'));
  assert.equal(lookFor('крупнее герой').zoom > 1, true);
});

test('assembling hands out the demo film', () => {
  const ready = play(project(15), buildRunScript(project(15), DEMO_CATALOG));
  const done = play(ready, buildAssembleScript(ready, DEMO_CATALOG));
  assert.equal(done.status, 'done');
  assert.equal(done.video, DEMO_CATALOG.video);
});
