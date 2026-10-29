import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SR, envelope, mixDown, music, peaks, place } from '../lib/real/audio.ts';
import { cuesFor, cutArgs } from '../lib/real/assemble.ts';

const tone = (sec: number, amp = .3) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => amp * Math.sin(i / SR * 2 * Math.PI * 220));

test('mouth envelope: 24 digits a second, silent before the line starts', () => {
  const env = envelope(tone(1), .5, 2);
  assert.equal(env.length, 48);
  assert.match(env, /^[0-9]+$/);
  assert.equal(env.slice(0, 12), '0'.repeat(12));
  assert.ok(+env[20] >= 7);
});

test('peaks, placing clips and ducking the music under the voice', () => {
  const p = peaks(tone(1), 50);
  assert.equal(p.length, 50);
  assert.ok(Math.max(...p) === 1 && Math.min(...p) >= 0);
  const voice = place(4, [{ at: 2, pcm: tone(1) }]);
  assert.equal(voice.length, 4 * SR);
  assert.equal(voice[SR], 0);
  const bed = music(4, 'calm'), v = place(4, [{ at: 0, pcm: tone(4, .2) }]);
  const alone = mixDown(new Float32Array(v.length), bed), withVoice = mixDown(v, bed);
  const rms = (x: Float32Array, a: number) => { let s = 0; for (let i = a; i < a + SR / 2; i++) s += x[i] * x[i]; return Math.sqrt(s / (SR / 2)); };
  const musicUnderVoice = Float32Array.from(withVoice, (x, i) => x - v[i]);
  assert.ok(rms(alone, SR * 2) > 0);
  assert.ok(rms(musicUnderVoice, SR * 2) < rms(alone, SR * 2) * .6, 'the music is ducked under the voice');
});

test('subtitle cues keep the line\'s punctuation, stay short and follow the voice', () => {
  const line = 'Привет! Я Клод. Почему небо голубое? Сейчас разберёмся!';
  const ws = line.replace(/[!?.,]/g, '').split(' ').map((w, i) => [i * .4, i * .4 + .35, w] as [number, number, string]);
  const cues = cuesFor(line, ws, 10, 24);
  assert.ok(cues.length >= 2);
  assert.equal(cues.map(c => c.text).join(' '), line);
  assert.ok(cues.every(c => c.text.length <= 26));
  assert.ok(cues.every((c, i) => c.start >= 9.9 && c.end > c.start && (i === 0 || c.start >= cues[i - 1].end)));
  const quoted = cuesFor('Напиши слово «НЕБО» — вот и всё!', [[0, .3, 'Напиши'], [.4, .6, 'слово'], [.7, 1, 'НЕБО'], [1.1, 1.3, 'вот'], [1.4, 1.5, 'и'], [1.6, 1.8, 'всё']], 0);
  assert.equal(quoted.map(c => c.text).join(' '), 'Напиши слово «НЕБО» — вот и всё!');
});

test('the cut: one cross-fade per seam at the scene starts, sound and subtitles mapped', () => {
  const args = cutArgs({ clips: ['a.mp4', 'b.mp4', 'c.mp4'], starts: [0, 5, 10.5], total: 15, audio: 'sound.wav', ass: 'subtitles.ass', out: 'cut.mp4' });
  const f = args[args.indexOf('-filter_complex') + 1];
  assert.equal((f.match(/xfade/g) || []).length, 2);
  assert.match(f, /offset=5\.000/);
  assert.match(f, /offset=10\.500/);
  assert.match(f, /ass=subtitles\.ass/);
  assert.ok(args.includes('3:a'));
  assert.equal(args[args.length - 1], 'cut.mp4');
});
