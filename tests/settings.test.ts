import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmp as tmpDir } from './helpers/tmp.ts';
import { hasApiKey, saveApiKey } from '../lib/settings.ts';

const tmp = () => join(tmpDir(), '.env.local');
const KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';

test('saves a key into a new file', () => {
  const f = tmp();
  assert.equal(hasApiKey(f), false);
  saveApiKey(f, KEY);
  assert.equal(readFileSync(f, 'utf8'), `ANTHROPIC_API_KEY=${KEY}\n`);
  assert.equal(hasApiKey(f), true);
});

test('replaces an old key and keeps other lines', () => {
  const f = tmp();
  writeFileSync(f, 'INKFRAME_ENGINE=demo\nANTHROPIC_API_KEY=sk-ant-old\nPORT=3700\n');
  saveApiKey(f, KEY);
  assert.equal(readFileSync(f, 'utf8'), `INKFRAME_ENGINE=demo\nANTHROPIC_API_KEY=${KEY}\nPORT=3700\n`);
});

test('an empty key removes the line', () => {
  const f = tmp();
  writeFileSync(f, `INKFRAME_ENGINE=demo\nANTHROPIC_API_KEY=${KEY}\n`);
  saveApiKey(f, '');
  assert.equal(readFileSync(f, 'utf8'), 'INKFRAME_ENGINE=demo\n');
  assert.equal(hasApiKey(f), false);
});

test('rejects anything that is not one Anthropic key', () => {
  const f = tmp();
  for (const bad of ['hello', 'sk-ant-x\nEVIL=1', 'sk-ant- spaced key', 'sk-ant-' + 'a'.repeat(300)]) assert.throws(() => saveApiKey(f, bad), /key/);
});
