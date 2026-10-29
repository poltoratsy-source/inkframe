// The self-review on small synthetic MP4s made by ffmpeg right here: a normal one, one with a black run, a dark
// scene with stars, silence under a line, a sound at the ceiling, no sound, a broken file. Needs ffmpeg + ffprobe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { probe, reviewVideo, type ReviewPlan } from '../lib/real/review.ts';
import { writeAss } from '../lib/real/assemble.ts';
import { rendererVersion } from '../lib/real/painter.ts';
import type { Review } from '../lib/store/types.ts';

const noFfmpeg = spawnSync('ffmpeg', ['-version']).status !== 0 || spawnSync('ffprobe', ['-version']).status !== 0;
const dir = mkdtempSync(join(tmpdir(), 'inkframe-review-'));

/** A 4 s, 320×180, 24 fps clip: a moving test picture and a 440 Hz tone, changed by `vf` / `af`. */
function clip(name: string, o: { vf?: string; af?: string; silent?: boolean } = {}) {
  const out = join(dir, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=24:d=4',
    ...(o.silent ? [] : ['-f', 'lavfi', '-i', 'sine=f=440:sample_rate=48000:d=4']),
    ...(o.vf ? ['-vf', o.vf] : []), ...(o.af ? ['-af', o.af] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...(o.silent ? [] : ['-c:a', 'aac', '-shortest']), out]);
  return out;
}
const BLACK = "drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill:enable='between(t,1,2.5)'";
const STARS = [BLACK, ...[[30, 20], [90, 50], [150, 30], [210, 70], [270, 25], [120, 100]].map(([x, y]) => `drawbox=x=${x}:y=${y}:w=6:h=6:color=white:t=fill:enable='between(t,1,2.5)'`)].join(',');

/** Two 2 s scenes, a line in each, subtitles written for both. */
function plan(file: string, more: Partial<ReviewPlan> = {}): ReviewPlan {
  const ass = join(dir, 'subs.ass');
  writeAss(ass, [{ start: .3, end: 1.9, text: 'Первая реплика' }, { start: 2.3, end: 3.9, text: 'Вторая реплика' }]);
  return {
    file, src: `/files/${file}`, width: 320, height: 180, fps: 24, duration: 4,
    scenes: [{ n: 1, start: 0, duration: 2, dark: false }, { n: 2, start: 2, duration: 2, dark: false }],
    lines: [{ n: 1, start: .3, end: 1.9, voiced: true }, { n: 2, start: 2.3, end: 3.9, voiced: true }],
    voice: true, sound: true, subtitles: { file: ass, burned: true }, ...more,
  };
}
const check = (r: Review, id: string) => r.checks.find(c => c.id === id)!;
const failed = (r: Review) => r.checks.filter(c => !c.ok && !c.warn).map(c => c.id);
const warned = (r: Review) => r.checks.filter(c => !c.ok && c.warn).map(c => c.id);

test('a normal clip passes every check', { skip: noFfmpeg }, async () => {
  const file = clip('normal'), r = await reviewVideo(plan(file));
  assert.equal(r.decision, 'PASS', JSON.stringify(r.checks));
  assert.equal(r.video, `/files/${file}`);
  assert.deepEqual(r.checks.map(c => c.id), ['probe', 'duration', 'black', 'blank', 'silence', 'clipping', 'subtitles']);
  assert.match(check(r, 'probe').detail, /320×180, 24 кадров\/с, видео и звук/);
  assert.match(check(r, 'blank').detail, /^4 кадра/);
  assert.match(check(r, 'subtitles').detail, /вшиты: 2 строки на 2 реплики/);
});

test('a black run outside a dark scene is a FAIL, with its time', { skip: noFfmpeg }, async () => {
  const r = await reviewVideo(plan(clip('black', { vf: BLACK })));
  assert.equal(r.decision, 'FAIL');
  assert.deepEqual(failed(r), ['black', 'blank'], 'the sample at 1,4 s falls into the black run too');
  assert.match(check(r, 'black').detail, /чёрный экран 1,5 с \(сцена 1\)/);
  assert.ok(Math.abs(check(r, 'black').at![0] - 1) < .1);
});

test('a dark scene on purpose: darkness with a drawing passes, a flat black does not', { skip: noFfmpeg }, async () => {
  const dark = [{ n: 1, start: 0, duration: 2, dark: true }, { n: 2, start: 2, duration: 2, dark: true }];
  const stars = clip('stars', { vf: STARS });
  const night = await reviewVideo(plan(stars, { scenes: dark }));
  assert.equal(night.decision, 'PASS', JSON.stringify(night.checks));
  assert.match(check(night, 'black').detail, /ночь задумана/);
  const notMeant = await reviewVideo(plan(stars));
  assert.deepEqual(failed(notMeant), ['black'], 'the same stars in a daytime scene are a fault');
  const flat = await reviewVideo(plan(clip('black-dark', { vf: BLACK }), { scenes: dark }));
  assert.deepEqual(failed(flat), ['black', 'blank'], 'a dark scene is no excuse for a frame with nothing on it');
});

test('a flat frame is caught by the blank check', { skip: noFfmpeg }, async () => {
  const r = await reviewVideo(plan(clip('flat', { vf: "drawbox=x=0:y=0:w=iw:h=ih:color=0xF3EBDC:t=fill:enable='between(t,1.2,1.6)'" })));
  assert.deepEqual(failed(r), ['blank']);
  assert.deepEqual(check(r, 'blank').at, [1.4]);
  assert.match(check(r, 'blank').detail, /кадр 0:01 \(сцена 1\) залит одним цветом/);
});

test('silence under a line is a FAIL when the voice is on, and skipped when it is off', { skip: noFfmpeg }, async () => {
  const file = clip('silence', { af: "volume=enable='between(t,2.2,3.6)':volume=0" });
  const r = await reviewVideo(plan(file));
  assert.deepEqual(failed(r), ['silence']);
  assert.match(check(r, 'silence').detail, /тишина 1,3 с под репликой сцены 2/);
  assert.deepEqual(check(r, 'silence').at, [2.3]);
  const off = await reviewVideo(plan(file, { voice: false }));
  assert.equal(check(off, 'silence').ok, true);
  assert.match(check(off, 'silence').detail, /голос выключен/);
  const unvoiced = await reviewVideo(plan(clip('normal2'), { lines: [{ n: 1, start: .3, end: 1.9, voiced: true }, { n: 2, start: 2.3, end: 3.5, voiced: false }] }));
  assert.match(check(unvoiced, 'silence').detail, /реплика сцены 2 не озвучена/);
});

test('a sound at the ceiling is a WARN, not a FAIL', { skip: noFfmpeg }, async () => {
  const r = await reviewVideo(plan(clip('loud', { af: 'volume=30dB' })));
  assert.equal(r.decision, 'WARN', JSON.stringify(r.checks));
  assert.deepEqual(warned(r), ['clipping']);
  assert.match(check(r, 'clipping').detail, /упирается в потолок/);
  assert.equal(check(r, 'clipping').at?.[0], 0, 'from the very first second');
});

test('no sound: a FAIL when the cartoon should have one, fine when it is silent on purpose', { skip: noFfmpeg }, async () => {
  const file = clip('mute', { silent: true });
  const r = await reviewVideo(plan(file));
  assert.equal(r.decision, 'FAIL');
  assert.match(check(r, 'probe').detail, /нет звука/);
  const meant = await reviewVideo(plan(file, { voice: false, sound: false, subtitles: undefined, lines: [{ n: 1, start: .3, end: 1.7, voiced: false }] }));
  assert.equal(meant.decision, 'PASS', JSON.stringify(meant.checks));
  assert.match(check(meant, 'probe').detail, /звука нет — так задумано/);
});

test('length, frame size, subtitles and a broken file', { skip: noFfmpeg }, async () => {
  const file = clip('normal3');
  const long = await reviewVideo(plan(file, { duration: 6 }));
  assert.deepEqual(failed(long), ['duration']);
  assert.match(check(long, 'duration').detail, /4,0 с, а по раскадровке 6,0 с — ролик обрезан/);
  assert.equal((await reviewVideo(plan(file, { duration: 4.1 }))).decision, 'PASS', 'within the tolerance');
  const wide = await reviewVideo(plan(file, { width: 1280, height: 720 }));
  assert.match(check(wide, 'probe').detail, /кадр 320×180, а должен быть 1280×720/);
  const fps = await reviewVideo(plan(file, { fps: 30 }));
  assert.deepEqual(warned(fps), ['probe']);
  assert.deepEqual(warned(await reviewVideo(plan(file, { subtitles: undefined }))), ['subtitles']);
  assert.deepEqual(warned(await reviewVideo(plan(file, { subtitles: { file: join(dir, 'subs.ass'), burned: false } }))), ['subtitles']);
  writeFileSync(join(dir, 'empty.ass'), '[Script Info]\n');
  assert.match(check(await reviewVideo(plan(file, { subtitles: { file: join(dir, 'empty.ass'), burned: true } })), 'subtitles').detail, /пустой/);
  writeFileSync(join(dir, 'broken.mp4'), 'mp4');
  const broken = await reviewVideo(plan(join(dir, 'broken.mp4')));
  assert.equal(broken.decision, 'FAIL');
  assert.deepEqual(broken.checks.map(c => c.id), ['probe']);
  assert.match(broken.checks[0].detail, /не открывается/);
});

test('without ffprobe the file is read with ffmpeg -i', { skip: noFfmpeg }, async () => {
  const file = clip('normal4'), bin = join(dir, 'bin'), path = process.env.PATH;
  mkdirSync(bin, { recursive: true });
  symlinkSync(execFileSync('sh', ['-c', 'command -v ffmpeg']).toString().trim(), join(bin, 'ffmpeg'));
  process.env.PATH = bin;
  try {
    const p = await probe(file);
    assert.deepEqual({ ...p, duration: Math.round(p!.duration) }, { duration: 4, audio: true, video: { width: 320, height: 180, fps: 24 } });
  } finally { process.env.PATH = path; }
});

test('the renderer version changes with the renderer, not with the voice script', () => {
  const r = mkdtempSync(join(tmpdir(), 'inkframe-renderer-')), mods = join(r, 'none');
  mkdirSync(join(r, 'engine'));
  writeFileSync(join(r, 'engine', 'core.js'), 'const a = 1;');
  writeFileSync(join(r, 'tts.py'), 'print(1)');
  const v1 = rendererVersion(r, mods);
  assert.match(v1, /^[0-9a-f]{10}$/);
  writeFileSync(join(r, 'tts.py'), 'print(2)');
  assert.equal(rendererVersion(r, mods), v1, 'the voice script does not repaint clips');
  writeFileSync(join(r, 'engine', 'core.js'), 'const a = 2;');
  assert.notEqual(rendererVersion(r, mods), v1);
});
