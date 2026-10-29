import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEvent, canBuild, emptyProject, normalizeProject } from '../lib/engine/reducer.ts';
import type { ProjectState } from '../lib/engine/types.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';

const base = () => emptyProject('p1', { ...DEFAULT_SETTINGS, idea: 'Почему небо голубое', duration: 15 }, 'demo');

const board = {
  type: 'storyboard' as const, title: 'Почему небо голубое',
  scenes: [1, 2, 3].map(n => ({ n, title: `S${n}`, visual: 'v', line: 'l', start: (n - 1) * 5, duration: 5 })),
};

test('storyboard creates queued scenes', () => {
  const s = applyEvent(base(), board);
  assert.equal(s.scenes.length, 3);
  assert.ok(s.scenes.every(sc => sc.status === 'queued' && !sc.edited && sc.version === 1));
  assert.equal(s.title, 'Почему небо голубое');
});

test('log.add appends and log.update changes status in place', () => {
  let s = applyEvent(base(), { type: 'log.add', step: { id: 'a', text: 'Пишу сценарий', status: 'run' } });
  s = applyEvent(s, { type: 'log.update', id: 'a', status: 'ok', text: 'Написал сценарий' });
  assert.deepEqual(s.log, [{ id: 'a', text: 'Написал сценарий', status: 'ok' }]);
});

test('frame updates the scene thumbnail and the stage', () => {
  let s = applyEvent(base(), board);
  s = applyEvent(s, { type: 'frame', n: 2, kind: 'sketch', src: '/demo/frames/s2-0-sketch.jpg', index: 3, total: 60 });
  assert.equal(s.scenes[1].frame, '/demo/frames/s2-0-sketch.jpg');
  assert.equal(s.scenes[1].frameKind, 'sketch');
  assert.deepEqual(s.current, { n: 2, kind: 'sketch', src: '/demo/frames/s2-0-sketch.jpg', index: 3, total: 60 });
});

test('scene.edited marks the scene, bumps its version and keeps the request', () => {
  let s = applyEvent(base(), board);
  s = applyEvent(s, { type: 'scene.edited', n: 3, request: 'ночь' });
  assert.equal(s.scenes[2].edited, true);
  assert.equal(s.scenes[2].version, 2);
  assert.deepEqual(s.scenes[2].edits, ['ночь']);
  assert.equal(s.scenes[0].edited, false);
});

test('canBuild only when every scene is done and the run is ready', () => {
  let s = applyEvent(base(), board);
  assert.equal(canBuild(s), false);
  for (const n of [1, 2, 3]) s = applyEvent(s, { type: 'scene.status', n, status: 'done' });
  assert.equal(canBuild(s), false, 'still drawing');
  s = applyEvent(s, { type: 'status', status: 'ready' });
  assert.equal(canBuild(s), true);
  s = applyEvent(s, { type: 'scene.status', n: 2, status: 'painting' });
  assert.equal(canBuild(s), false, 'a scene is being redrawn');
});

test('snapshot replaces the whole state; unknown scene numbers are ignored', () => {
  const other = { ...base(), id: 'p2' };
  assert.equal(applyEvent(base(), { type: 'snapshot', state: other }).id, 'p2');
  const s = applyEvent(applyEvent(base(), board), { type: 'scene.status', n: 9, status: 'done' });
  assert.ok(s.scenes.every(sc => sc.status === 'queued'));
});

test('a scene keeps its colour frames for playback and forgets them when redrawn', () => {
  let s = applyEvent(base(), board);
  const f = (src: string, kind: 'sketch' | 'color') => ({ type: 'frame' as const, n: 1, kind, src, index: 1, total: 60 });
  s = applyEvent(s, f('a-sketch', 'sketch'));
  s = applyEvent(s, f('a', 'color'));
  s = applyEvent(s, f('b', 'color'));
  s = applyEvent(s, f('b', 'color'));
  assert.deepEqual(s.scenes[0].colors, ['a', 'b']);
  s = applyEvent(s, { type: 'scene.status', n: 1, status: 'sketch' });
  assert.deepEqual(s.scenes[0].colors, []);
});

test('scene.board changes one scene\'s words and timing; an empty video takes the MP4 away', () => {
  let s = applyEvent(base(), board);
  s = applyEvent(s, { type: 'scene.board', n: 2, patch: { line: 'новая', caption: 'надпись', duration: 6.5 } });
  assert.equal(s.scenes[1].line, 'новая');
  assert.equal(s.scenes[1].caption, 'надпись');
  assert.equal(s.scenes[1].duration, 6.5);
  assert.equal(s.scenes[0].line, 'l');
  s = applyEvent(s, { type: 'video', src: '/x.mp4' });
  assert.equal(s.video, '/x.mp4');
  s = applyEvent(s, { type: 'video', src: '' });
  assert.equal(s.video, undefined);
});

test('stage and gate events: the gate opens, blocks the cut, and closes', () => {
  let s = applyEvent(base(), board);
  assert.deepEqual(s.stages.script, { status: 'pending', version: 1 });
  s = applyEvent(s, { type: 'stage', stage: 'script', status: 'awaiting', version: 1 });
  s = applyEvent(s, { type: 'gate', stage: 'script', version: 1, open: true, summary: '3 сцены' });
  assert.deepEqual(s.gate, { stage: 'script', version: 1, summary: '3 сцены' });
  assert.deepEqual(s.stages.script, { status: 'awaiting', version: 1 });
  for (const n of [1, 2, 3]) s = applyEvent(s, { type: 'scene.status', n, status: 'done' });
  s = applyEvent(s, { type: 'status', status: 'ready' });
  assert.equal(canBuild(s), false, 'no cut while a gate is open');
  assert.equal(applyEvent(s, { type: 'gate', stage: 'final', version: 1, open: false, summary: '' }).gate?.stage, 'script', 'closing another stage leaves it');
  s = applyEvent(s, { type: 'gate', stage: 'script', version: 1, open: false, summary: '' });
  assert.equal(s.gate, undefined);
  assert.equal(canBuild(s), true);
});

test('a project saved before stages existed gets them from what it has', () => {
  const old = applyEvent(applyEvent(base(), board), { type: 'status', status: 'ready' }) as Partial<ProjectState>;
  delete old.stages;
  const s = normalizeProject(old as ProjectState);
  assert.equal(s.stages.brief.status, 'completed');
  assert.equal(s.stages.script.status, 'completed');
  assert.equal(s.stages.paint.status, 'pending', 'scenes are not all done');
  assert.equal(applyEvent(base(), { type: 'snapshot', state: old as ProjectState }).stages.script.status, 'completed');
  const fresh = base();
  assert.equal(normalizeProject(fresh), fresh, 'a current project is left as it is');
});
