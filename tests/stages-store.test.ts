// The stage store on files: versions, history that is never overwritten, the gate rules and the journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp } from './helpers/tmp.ts';
import { StageStore, readGatePolicy } from '../lib/store/stages.ts';
import { DEFAULT_GATES, gatesFrom } from '../lib/store/types.ts';

const store = () => new StageStore(tmp('inkframe-stages-'));
const status = (err: unknown) => (err as { status?: number }).status;
const SCRIPT_V1 = { scenes: [{ title: 'Вопрос', line: 'Почему небо голубое?' }] };
const SCRIPT_V2 = { scenes: [{ title: 'Вопрос', line: 'Коротко: почему небо голубое?' }] };

test('a gated stage opens as v1 awaiting and cannot be written completed without an approval', () => {
  const s = store();
  s.set('script', 'in_progress');
  const cp = s.open('script', SCRIPT_V1, true);
  assert.deepEqual([cp.version, cp.status, cp.gate], [1, 'awaiting', true], 'writing the first result keeps v1');
  assert.throws(() => s.set('script', 'completed'), err => status(err) === 409);
  assert.throws(() => s.put({ ...cp, status: 'completed', approval: { decision: 'approve', version: 2, at: '' } }), err => status(err) === 409, 'an approval of another version does not count');
  assert.equal(new StageStore(s.dir).get('script')!.status, 'awaiting', 'the refused write left the file as it was');
});

test('approve: the version is checked, the same approve twice is a no-op', () => {
  const s = store();
  s.open('script', SCRIPT_V1, true);
  assert.throws(() => s.approve('script', 2), err => status(err) === 409);
  const first = s.approve('script', 1, 'годится');
  assert.equal(first.changed, true);
  assert.deepEqual([first.cp.status, first.cp.approval?.version, first.cp.approval?.note], ['completed', 1, 'годится']);
  const second = s.approve('script', 1);
  assert.equal(second.changed, false);
  assert.equal(second.cp.approval?.note, 'годится', 'the first approval stays');
  const onDisk = JSON.parse(readFileSync(join(s.dir, 'stages/script.json'), 'utf8'));
  assert.equal(onDisk.status, 'completed');
  assert.throws(() => s.approve('storyboard', 1), err => status(err) === 409, 'a stage without a gate');
});

test('revise → next version; old versions go to history and are never overwritten', () => {
  const s = store();
  s.open('script', SCRIPT_V1, true);
  assert.throws(() => s.revise('script', 1, '  '), err => status(err) === 400);
  const back = s.revise('script', 1, 'короче');
  assert.deepEqual([back.status, back.approval?.decision, back.approval?.note], ['revised', 'revise', 'короче']);
  assert.throws(() => s.approve('script', 1), err => status(err) === 409, 'a version sent back cannot be approved');
  assert.throws(() => s.revise('script', 1, 'ещё'), err => status(err) === 409);
  const v2 = s.open('script', SCRIPT_V2, true);
  assert.deepEqual([v2.version, v2.status, v2.approval], [2, 'awaiting', undefined]);
  const h1 = join(s.dir, 'stages/history/script.v1.json'), before = readFileSync(h1, 'utf8');
  assert.deepEqual(JSON.parse(before).artifact, SCRIPT_V1);
  assert.throws(() => s.approve('script', 1), err => status(err) === 409, 'approving the old version after v2 opened');
  s.revise('script', 2, 'длиннее');
  s.open('script', SCRIPT_V1, true);
  assert.deepEqual(s.history('script').map(c => [c.version, c.status]), [[1, 'revised'], [2, 'revised']]);
  assert.equal(readFileSync(h1, 'utf8'), before, 'history v1 untouched');
  assert.equal(s.approve('script', 3).cp.status, 'completed');
});

test('a stage without a gate completes at once; set keeps the version and resume data', () => {
  const s = store();
  assert.equal(s.open('script', SCRIPT_V1, false).status, 'completed');
  s.set('paint', 'in_progress', { doneScenes: [1, 2] });
  const cp = s.set('paint', 'completed');
  assert.deepEqual([cp.version, cp.status, cp.doneScenes], [1, 'completed', [1, 2]]);
  assert.equal(existsSync(join(s.dir, 'stages/history')), false, 'nothing replaced, nothing in history');
});

test('events.jsonl is appended line by line', () => {
  const s = store();
  s.log({ kind: 'stage', stage: 'script', payload: { status: 'awaiting', version: 1 } });
  s.log({ kind: 'gate', stage: 'script', payload: { open: true, version: 1 } });
  const lines = readFileSync(join(s.dir, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(s.events().map(e => e.kind), ['stage', 'gate']);
  assert.ok(s.events().every(e => !Number.isNaN(Date.parse(e.at))));
});

test('gate policy: defaults on, INKFRAME_GATES=off, a list, inkframe.config.json', () => {
  assert.deepEqual(gatesFrom(undefined), DEFAULT_GATES);
  assert.deepEqual(gatesFrom('off'), { script: false, storyboard: false, final: false });
  assert.deepEqual(gatesFrom('script'), { script: true, storyboard: false, final: false });
  const cwd = tmp('inkframe-cfg-');
  assert.deepEqual(readGatePolicy(cwd, {}), DEFAULT_GATES);
  writeFileSync(join(cwd, 'inkframe.config.json'), JSON.stringify({ gates: { script: false } }));
  assert.equal(readGatePolicy(cwd, {}).script, false);
  assert.equal(readGatePolicy(cwd, { INKFRAME_GATES: 'on' }).script, true, 'the environment wins');
});
