// Self-review of a finished MP4 (Inkframe 3, M3). It looks at the file the user is about to get, not at what the
// engine meant to make, with ffprobe and ffmpeg's own filters (no paid model, nothing new to install):
//   probe      the file opens; video (and sound, when the cartoon has any) are there; frame size and rate as planned
//   duration   the length matches the storyboard (± LIMITS.durationSec or ± LIMITS.durationShare, whichever is larger)
//   black      blackdetect: a black run of LIMITS.blackSec or longer is a fault — except inside a scene painted dark
//              on purpose (night, space, board), and only while the frame there still has a drawing on it
//   blank      LIMITS.samples frames across the cartoon: a frame of one flat colour (luma spread < LIMITS.flatStd) is a fault
//   silence    silencedetect against the timings of the lines: silence of LIMITS.silenceSec or longer under a line,
//              or a line that was never voiced, is a fault; skipped when the voice is off
//   clipping   volumedetect: the loudest sample at LIMITS.clipDb or above means the sound hits the ceiling — a remark
//   subtitles  the .ass file has a cue under every voiced line and was burned into the picture — a remark if not
// Black and blank look only at the top 80 % of the frame: the bottom holds the subtitle box, which would make a broken
// black scene look "not black" (blackdetect wants 98 % of the pixels black) and "not flat".
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { decide, type Review, type ReviewCheck } from '../store/types';

export interface ReviewPlan {
  /** the MP4 on disk, and how the studio opens it */
  file: string;
  src: string;
  width: number;
  height: number;
  fps: number;
  /** seconds, from the storyboard */
  duration: number;
  scenes: { n: number; start: number; duration: number; dark: boolean }[];
  /** where each scene's line should sound; `voiced` = the engine got a voice for it */
  lines: { n: number; start: number; end: number; voiced: boolean }[];
  /** the project asked for a voice */
  voice: boolean;
  /** the cut has a sound track (voice and/or music) */
  sound: boolean;
  /** the subtitle file and whether the cut burned it into the picture */
  subtitles?: { file: string; burned: boolean };
}

export const LIMITS = {
  durationSec: .5, durationShare: .03,
  blackSec: .5, blackPixel: .10, blackPicture: .98,
  flatStd: 6, samples: [.1, .35, .6, .85],
  silenceDb: -40, silenceSec: 1,
  clipDb: -.1,
  /** the part of the frame black and blank look at: the top 80 %, above the subtitle box */
  picture: .8,
};

// ---------- running ffmpeg / ffprobe ----------
interface Ran { code: number; out: Buffer; err: string }
function run(cmd: string, args: string[]): Promise<Ran> {
  return new Promise((ok, bad) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = []; let err = '';
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => { err += d; });
    p.on('error', bad);
    p.on('close', code => ok({ code: code ?? 1, out: Buffer.concat(out), err }));
  });
}

export interface Probe { duration: number; video?: { width: number; height: number; fps: number; duration?: number }; audio: boolean }
const rate = (r?: string) => { const [a, b] = String(r ?? '').split('/').map(Number); return b ? a / b : a || NaN; };

/** What is in the file; undefined when it does not open. ffprobe, or `ffmpeg -i` when there is no ffprobe. */
export async function probe(file: string): Promise<Probe | undefined> {
  if (!existsSync(file)) return undefined;
  let r: Ran;
  try {
    r = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration:format=duration', '-of', 'json', file]);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return probeByFfmpeg(file);
    throw err;
  }
  if (r.code) return undefined;
  try {
    const j = JSON.parse(r.out.toString()) as { streams?: Record<string, string | number>[]; format?: { duration?: string } };
    const v = j.streams?.find(s => s.codec_type === 'video'), a = j.streams?.some(s => s.codec_type === 'audio');
    const duration = Number(j.format?.duration);
    if (!Number.isFinite(duration)) return undefined;
    const fps = rate(String(v?.avg_frame_rate ?? '')) || rate(String(v?.r_frame_rate ?? ''));
    return { duration, audio: !!a, ...(v && { video: { width: Number(v.width), height: Number(v.height), fps, duration: Number(v.duration) || undefined } }) };
  } catch { return undefined; }
}

async function probeByFfmpeg(file: string): Promise<Probe | undefined> {
  const { err } = await run('ffmpeg', ['-hide_banner', '-i', file]);   // exits 1 ("no output"), but prints what it found
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  if (!d) return undefined;
  const v = err.match(/Stream #\S+.*Video: .*?(\d{2,5})x(\d{2,5})[^\n]*/), fps = v?.[0].match(/([\d.]+) fps/);
  return {
    duration: +d[1] * 3600 + +d[2] * 60 + +d[3], audio: /Stream #\S+.*Audio:/.test(err),
    ...(v && { video: { width: +v[1], height: +v[2], fps: fps ? +fps[1] : NaN } }),
  };
}

// ---------- one pass over the whole file: black runs, silences, loudness ----------
export interface Scan { black: [number, number][]; silence: [number, number][]; maxDb?: number }
export async function scan(file: string, duration: number, audio: boolean): Promise<Scan> {
  const crop = `crop=iw:trunc(ih*${LIMITS.picture}/2)*2:0:0`;
  const args = ['-hide_banner', '-nostats', '-i', file,
    '-map', '0:v:0', '-vf', `${crop},blackdetect=d=${LIMITS.blackSec}:pic_th=${LIMITS.blackPicture}:pix_th=${LIMITS.blackPixel}`,
    ...(audio ? ['-map', '0:a:0', '-af', `silencedetect=noise=${LIMITS.silenceDb}dB:d=${LIMITS.silenceSec},volumedetect`] : []),
    '-f', 'null', '-'];
  const { code, err } = await run('ffmpeg', args);
  if (code) throw new Error(`ffmpeg could not read the video: ${err.trim().split('\n').slice(-1)[0]}`);
  const black: [number, number][] = [], silence: [number, number][] = [];
  for (const m of err.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) black.push([+m[1], +m[2]]);
  let open: number | undefined;
  for (const m of err.matchAll(/silence_(start|end):\s*(-?[\d.]+)/g)) {
    if (m[1] === 'start') open = Math.max(0, +m[2]);
    else if (open !== undefined) { silence.push([open, +m[2]]); open = undefined; }
  }
  if (open !== undefined) silence.push([open, duration]);   // silent to the very end
  const max = err.match(/max_volume:\s*(-?[\d.]+|-inf) dB/);
  return { black, silence, ...(max && { maxDb: max[1] === '-inf' ? -Infinity : +max[1] }) };
}

/** The spread of brightness (standard deviation of luma, 0–255) of the frame at `t`, top part only. */
export async function frameSpread(file: string, t: number): Promise<number | undefined> {
  const { code, out } = await run('ffmpeg', ['-v', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1',
    '-vf', `crop=iw:trunc(ih*${LIMITS.picture}/2)*2:0:0,scale=160:72,format=gray`, '-f', 'rawvideo', '-']);
  if (code || !out.length) return undefined;
  let sum = 0, sq = 0;
  for (const v of out) { sum += v; sq += v * v; }
  const mean = sum / out.length;
  return Math.sqrt(Math.max(0, sq / out.length - mean * mean));
}

/** Seconds where the sound sits at the ceiling (first `limit` of them, one per second). */
async function loudAt(file: string, limit = 5): Promise<number[]> {
  const { code, out } = await run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-f', 's16le', '-acodec', 'pcm_s16le', '-']);
  if (code) return [];
  const ceil = 32768 * 10 ** (LIMITS.clipDb / 20), sr = await sampleRate(file), at: number[] = [];
  for (let i = 0; i + 1 < out.length && at.length < limit; i += 2) {
    if (Math.abs(out.readInt16LE(i)) >= ceil) {
      const t = Math.floor(i / 2 / sr);
      at.push(t);
      i = (t + 1) * sr * 2 - 2;   // on to the next second
    }
  }
  return at;
}
async function sampleRate(file: string) {
  try {
    const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate', '-of', 'csv=p=0', file]);
    return Number(r.out.toString().trim()) || 48000;
  } catch { return 48000; }
}

// ---------- subtitles ----------
const assTime = (s: string) => { const [h, m, sec] = s.split(':'); return +h * 3600 + +m * 60 + +sec; };
export function assCues(file: string): { start: number; end: number; text: string }[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').flatMap(l => {
    const m = l.match(/^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/);
    return m && m[3].trim() ? [{ start: assTime(m[1].trim()), end: assTime(m[2].trim()), text: m[3].trim() }] : [];
  });
}

// ---------- the review ----------
const r1 = (x: number) => Math.round(x * 10) / 10;
const sec = (x: number) => `${r1(x).toFixed(1).replace('.', ',')} с`;
const mmss = (x: number) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
const db = (x: number) => (x === -Infinity ? '−∞ дБ' : `${x.toFixed(1).replace('.', ',').replace('-', '−')} дБ`);
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
const overlap = (a: [number, number], b0: number, b1: number) => Math.max(0, Math.min(a[1], b1) - Math.max(a[0], b0));

/** Every check on one MP4. Never throws: a file that does not open is a FAIL of `probe`. */
export async function reviewVideo(plan: ReviewPlan): Promise<Review> {
  const checks: ReviewCheck[] = [], done = (): Review => ({ at: new Date().toISOString(), video: plan.src, decision: decide(checks), checks });
  const sceneAt = (t: number) => plan.scenes.find(s => t >= s.start && t < s.start + s.duration)?.n ?? plan.scenes[plan.scenes.length - 1]?.n;

  // probe
  let p: Probe | undefined;
  try { p = await probe(plan.file); } catch { p = undefined; }
  if (!p || !p.video) {
    checks.push({ id: 'probe', ok: false, detail: p ? 'в файле нет видео' : 'файл не открывается — ролик битый' });
    return done();
  }
  {
    const v = p.video, size = `${v.width}×${v.height}`, want = `${plan.width}×${plan.height}`, fpsOk = Math.abs(v.fps - plan.fps) <= .5;
    const fps = Number.isFinite(v.fps) ? `${Math.round(v.fps * 100) / 100} кадров/с` : 'частота кадров не видна';
    if (size !== want) checks.push({ id: 'probe', ok: false, detail: `кадр ${size}, а должен быть ${want}` });
    else if (plan.sound && !p.audio) checks.push({ id: 'probe', ok: false, detail: 'в ролике нет звука, хотя должны быть голос или музыка' });
    else if (!fpsOk) checks.push({ id: 'probe', ok: false, warn: true, detail: `${size}, ${fps} вместо ${plan.fps}` });
    else checks.push({ id: 'probe', ok: true, detail: `${size}, ${fps}, ${p.audio ? 'видео и звук на месте' : 'звука нет — так задумано'}` });
  }

  // duration
  {
    // the file's length and the picture's length: the one further from the plan counts
    const got = [p.duration, p.video.duration ?? p.duration].sort((a, b) => Math.abs(b - plan.duration) - Math.abs(a - plan.duration))[0];
    const tol = Math.max(LIMITS.durationSec, plan.duration * LIMITS.durationShare), off = got - plan.duration;
    checks.push(Math.abs(off) <= tol
      ? { id: 'duration', ok: true, detail: `${sec(got)} — как в раскадровке` }
      : { id: 'duration', ok: false, detail: `${sec(got)}, а по раскадровке ${sec(plan.duration)} — ролик ${off < 0 ? 'обрезан' : 'длиннее, чем надо'}`, ...(off < 0 && { at: [r1(got)] }) });
  }

  let s: Scan;
  try { s = await scan(plan.file, p.duration, p.audio); }
  catch (err) {
    checks.push({ id: 'black', ok: false, detail: `ролик не читается до конца: ${(err as Error).message.slice(0, 120)}` });
    return done();
  }

  // black
  {
    const faults: [number, number][] = [], meant: number[] = [];
    for (const run of s.black) {
      const inDark = plan.scenes.filter(sc => sc.dark).reduce((a, sc) => a + overlap(run, sc.start, sc.start + sc.duration), 0);
      if (inDark >= (run[1] - run[0]) * .8) {
        // a dark scene on purpose: fine while there is still a drawing in it (stars, the hero, chalk); a flat black is not
        const spread = await frameSpread(plan.file, (run[0] + run[1]) / 2);
        if (spread !== undefined && spread >= LIMITS.flatStd) { meant.push(sceneAt(run[0])); continue; }
      }
      faults.push(run);
    }
    const dark = [...new Set(meant)].join(', ');
    checks.push(faults.length
      ? { id: 'black', ok: false, detail: faults.map(f => `чёрный экран ${sec(f[1] - f[0])} (сцена ${sceneAt(f[0])})`).join('; '), at: faults.map(f => r1(f[0])) }
      : { id: 'black', ok: true, detail: dark ? `тёмные места только в сцен${meant.length > 1 ? 'ах' : 'е'} ${dark} — там ночь задумана, рисунок виден` : 'чёрных кусков нет' });
  }

  // blank
  {
    const times = LIMITS.samples.map(k => r1(Math.min(p!.duration - .1, k * p!.duration))), flat: number[] = [];
    let seen = 0;
    for (const t of times) {
      const spread = await frameSpread(plan.file, t);
      if (spread === undefined) continue;
      seen++;
      if (spread < LIMITS.flatStd) flat.push(t);
    }
    checks.push(flat.length
      ? { id: 'blank', ok: false, detail: flat.map(t => `кадр ${mmss(t)} (сцена ${sceneAt(t)}) залит одним цветом — рисунка нет`).join('; '), at: flat }
      : seen ? { id: 'blank', ok: true, detail: `${seen} ${plural(seen, 'кадр', 'кадра', 'кадров')} (${times.map(mmss).join(', ')}) — на всех есть рисунок` }
        : { id: 'blank', ok: false, detail: 'не удалось достать ни одного кадра' });
  }

  // silence
  if (!plan.voice) checks.push({ id: 'silence', ok: true, detail: 'голос выключен — не проверял' });
  else if (!p.audio) checks.push({ id: 'silence', ok: false, detail: 'звука нет совсем, а реплики должны звучать', at: plan.lines.map(l => r1(l.start)) });
  else {
    const mute = plan.lines.filter(l => !l.voiced), holes: { n: number; at: number; len: number }[] = [];
    for (const l of plan.lines) {
      if (!l.voiced) continue;
      for (const q of s.silence) {
        const o = overlap(q, l.start, l.end);
        if (o >= LIMITS.silenceSec) holes.push({ n: l.n, at: r1(Math.max(q[0], l.start)), len: o });
      }
    }
    const say = [...mute.map(l => `реплика сцены ${l.n} не озвучена`), ...holes.map(h => `тишина ${sec(h.len)} под репликой сцены ${h.n}`)];
    checks.push(say.length
      ? { id: 'silence', ok: false, detail: say.join('; '), at: [...mute.map(l => r1(l.start)), ...holes.map(h => h.at)] }
      : { id: 'silence', ok: true, detail: `под всеми репликами (${plan.lines.length}) звучит голос` });
  }

  // clipping
  if (!p.audio || s.maxDb === undefined) checks.push({ id: 'clipping', ok: true, detail: 'звука нет — нечему хрипеть' });
  else if (s.maxDb >= LIMITS.clipDb) {
    const at = await loudAt(plan.file);
    checks.push({ id: 'clipping', ok: false, warn: true, detail: `звук упирается в потолок (${db(s.maxDb)}) — в этих местах может хрипеть`, ...(at.length && { at }) });
  } else checks.push({ id: 'clipping', ok: true, detail: `звук не упирается в потолок: самое громкое место ${db(s.maxDb)}` });

  // subtitles
  {
    const voiced = plan.lines.filter(l => l.voiced);
    if (!voiced.length) checks.push({ id: 'subtitles', ok: true, detail: 'озвученных реплик нет — субтитры не нужны' });
    else if (!plan.subtitles) checks.push({ id: 'subtitles', ok: false, warn: true, detail: 'субтитров нет, хотя реплики озвучены' });
    else {
      const cues = assCues(plan.subtitles.file);
      const bare = voiced.filter(l => !cues.some(c => c.start < l.end && c.end > l.start - .3));
      if (!cues.length) checks.push({ id: 'subtitles', ok: false, warn: true, detail: 'файл субтитров пустой' });
      else if (!plan.subtitles.burned) checks.push({ id: 'subtitles', ok: false, warn: true, detail: `субтитры написаны (${cues.length} ${plural(cues.length, 'строка', 'строки', 'строк')}), но в ролик не вшиты` });
      else if (bare.length) checks.push({ id: 'subtitles', ok: false, warn: true, detail: `без субтитров: ${bare.map(l => `реплика сцены ${l.n}`).join(', ')}`, at: bare.map(l => r1(l.start)) });
      else checks.push({ id: 'subtitles', ok: true, detail: `вшиты: ${cues.length} ${plural(cues.length, 'строка', 'строки', 'строк')} на ${voiced.length} ${plural(voiced.length, 'реплику', 'реплики', 'реплик')}` });
    }
  }
  return done();
}

/** When the review itself could not run (no ffmpeg, a crash): the MP4 is handed out with that remark. */
export const reviewCrashed = (src: string, err: unknown): Review => ({
  at: new Date().toISOString(), video: src, decision: 'WARN',
  checks: [{ id: 'probe', ok: false, warn: true, detail: `проверить ролик не получилось: ${String((err as Error)?.message ?? err).slice(0, 160)}` }],
});
