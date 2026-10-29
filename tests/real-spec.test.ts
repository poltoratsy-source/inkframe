import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpec, describe, words } from '../lib/real/scene-spec.ts';
import { cleanStoryboard, codeWordOf, editByRules, extractJson, splitDurations, templateStoryboard, topicOf } from '../lib/real/storyboard.ts';
import { DEFAULT_SETTINGS } from '../lib/options.ts';

const settings = { ...DEFAULT_SETTINGS, idea: 'Короткий мультфильм: Клод объясняет, почему небо голубое', duration: 15 };

test('cleanSpec keeps known values only and repairs what a template needs', () => {
  const s = cleanSpec({ template: 'compare', setting: 'mars', mood: 'HAPPY', prop: 'dragon', caption: '  <b>Hi</b>  ', left: { prop: 'sun' } });
  assert.equal(s.setting, 'sky');                      // unknown setting → default
  assert.equal(s.mood, 'happy');                       // case-insensitive
  assert.equal(s.prop, undefined);                     // unknown prop dropped
  assert.equal(s.template, 'host');                    // compare without two sides → host
  assert.equal(s.caption, 'b Hi /b');                  // no markup reaches the stage
  assert.equal(cleanSpec({ template: 'object' }).prop, 'question');
  assert.equal(cleanSpec({ template: 'card', caption: 'НЕБО' }).title, 'НЕБО');
  assert.equal(cleanSpec({ template: 'card' }).title, '★');
  assert.equal(words('x'.repeat(50), 10)!.length, 10);
  assert.match(describe(cleanSpec({ template: 'compare', left: { prop: 'wave', caption: 'синий' }, right: { prop: 'wave' } })), /Сравнение/);
});

test('a storyboard from Claude: fences, unknown fields and lengths that add up to the asked duration', () => {
  const raw = extractJson('Here:\n```json\n' + JSON.stringify({
    title: 'Почему небо голубое',
    scenes: [
      { title: 'Вопрос', line: 'Почему небо голубое?', duration: 4, spec: { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', script: 'alert(1)' } },
      { title: 'Свет', line: 'Белый свет — это все цвета.', duration: 6, spec: { template: 'object', prop: 'prism' } },
      { title: 'Финал', line: 'Пиши НЕБО!', duration: 5, spec: { template: 'card', title: 'НЕБО' } },
      { title: 'пусто' },
    ],
  }) + '\n```');
  const b = cleanStoryboard(raw, { ...settings, hero: 'none' });
  assert.equal(b.scenes.length, 3);
  assert.equal(b.by, 'claude');
  assert.equal(Math.round(b.scenes.reduce((a, s) => a + s.duration, 0)), 15);
  assert.ok(b.scenes.every(s => s.spec.hero === false));
  assert.equal((b.scenes[0].spec as unknown as Record<string, unknown>).script, undefined);
  assert.throws(() => cleanStoryboard({ scenes: [] }, settings), /too few/);
  assert.throws(() => extractJson('no json here'), /no JSON/);
});

test('the template storyboard (no AI) for "why is the sky blue", 15 s', () => {
  assert.equal(topicOf(settings.idea), 'Почему небо голубое?');
  assert.equal(codeWordOf('Почему небо голубое?'), 'НЕБО');
  const b = templateStoryboard(settings);
  assert.equal(b.by, 'template');
  assert.deepEqual(b.scenes.map(s => s.spec.template), ['host', 'object', 'card']);
  assert.equal(b.scenes[1].spec.prop, 'sun');
  assert.equal(b.scenes[2].spec.title, 'НЕБО');
  assert.equal(b.scenes.reduce((a, s) => a + s.duration, 0), 15);
  assert.deepEqual(splitDurations(15, 4), [3.8, 3.8, 3.8, 3.6]);
  const none = templateStoryboard({ ...settings, ending: 'none', duration: 30 });
  assert.ok(none.scenes.every(s => s.spec.template !== 'card'));
});

test('edits by rules: new words, quick chips, and requests it does not understand', () => {
  const scene = templateStoryboard(settings).scenes[0];
  assert.equal(editByRules(scene, 'реплика: Привет, небо!').scene.line, 'Привет, небо!');
  assert.equal(editByRules(scene, 'подпись: «Синее небо»').scene.spec.caption, 'Синее небо');
  assert.equal(editByRules(scene, 'ночь').scene.spec.setting, 'night');
  assert.equal(editByRules(scene, 'крупнее герой').scene.spec.heroSize, 'big');
  assert.equal(editByRules(scene, 'медленнее').scene.spec.pace, 'slow');
  assert.equal(editByRules(scene, 'другой голос').voice, 'other');
  assert.equal(editByRules(scene, 'добавь радугу').scene.spec.prop, 'rainbow');
  assert.equal(editByRules(scene, 'сделай как у Миядзаки').understood, false);
  assert.equal(scene.spec.setting, 'sky', 'the original scene is not changed');
});
