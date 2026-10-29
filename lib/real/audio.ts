// Sound: edge-tts voices (renderer/tts.py), the mouth envelope for the painter, waveform peaks for the studio,
// a small synthesized music bed and the voice-over-music mix with ducking. Everything is mono PCM at 24 kHz.
import { execFile, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { StartSettings } from '../engine/types';

export const SR = 24000;
export type Word = [number, number, string];

const VOICES: Record<StartSettings['language'], { svetlana: string; dmitry: string }> = {
  ru: { svetlana: 'ru-RU-SvetlanaNeural', dmitry: 'ru-RU-DmitryNeural' },
  en: { svetlana: 'en-US-AvaNeural', dmitry: 'en-US-AndrewNeural' },
  kk: { svetlana: 'kk-KZ-AigulNeural', dmitry: 'kk-KZ-DauletNeural' },
};
export function voiceId(lang: StartSettings['language'], voice: StartSettings['voice'], other = false): string {
  const v = VOICES[lang] ?? VOICES.ru, k = voice === 'dmitry' ? 'dmitry' : 'svetlana';
  return v[other ? (k === 'dmitry' ? 'svetlana' : 'dmitry') : k];
}

export interface TtsJob { text: string; voice: string; rate?: string; out: string }

/** Voices every job (3 at a time); writes <out>.mp3 and <out>.json with word timings. */
export function tts(jobs: TtsJob[], jobsFile: string): Promise<void> {
  writeFileSync(jobsFile, JSON.stringify(jobs));
  return new Promise((ok, bad) => {
    execFile(process.env.INKFRAME_PYTHON ?? 'python3', [resolve('renderer/tts.py'), jobsFile], { timeout: 180000 }, (e, _o, err) =>
      e ? bad(new Error(`voice-over failed: ${(err || e.message).trim().split('\n').pop()}`)) : ok());
  });
}
export const wordsOf = (out: string): Word[] => JSON.parse(readFileSync(out + '.json', 'utf8')).words ?? [];

/** Decodes any audio file to mono float PCM at SR. */
export function decode(file: string): Promise<Float32Array> {
  return new Promise((ok, bad) => {
    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-ac', '1', '-ar', String(SR), '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = []; let err = '';
    ff.stdout.on('data', d => chunks.push(d)); ff.stderr.on('data', d => { err += d; });
    ff.on('close', code => {
      if (code) return bad(new Error(`ffmpeg could not read ${file}: ${err.trim()}`));
      const b = Buffer.concat(chunks), n = b.length >> 1, out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(i * 2) / 32768;
      ok(out);
    });
  });
}

const rmsAt = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };

/** Mouth envelope: one digit 0..9 per 1/24 s, normalised so speech peaks around 8. */
export function envelope(x: Float32Array, startSec = 0, totalSec = x.length / SR): string {
  const hop = SR / 24, n = Math.ceil(totalSec * 24), lead = Math.round(startSec * 24), r: number[] = [];
  for (let i = 0; i < n; i++) { const a = Math.round((i - lead) * hop); r.push(a < 0 || a >= x.length ? 0 : rmsAt(x, a, Math.min(x.length, a + hop))); }
  const loud = r.filter(v => v > .005).sort((a, b) => a - b), ref = loud[Math.floor(loud.length * .9)] || 1;
  return r.map(v => String(Math.max(0, Math.min(9, Math.round(v / ref * 8))))).join('');
}

/** `n` waveform bars between 0 and 1 for the studio's sound lanes. */
export function peaks(x: Float32Array, n = 480): number[] {
  const step = x.length / n, r: number[] = [];
  for (let i = 0; i < n; i++) r.push(rmsAt(x, Math.floor(i * step), Math.floor((i + 1) * step)));
  const max = Math.max(...r, 1e-6);
  return r.map(v => +Math.min(1, v / max).toFixed(3));
}

/** Places clips on a timeline of `totalSec` seconds. */
export function place(totalSec: number, clips: { at: number; pcm: Float32Array }[]): Float32Array {
  const out = new Float32Array(Math.ceil(totalSec * SR));
  for (const c of clips) { const s = Math.round(c.at * SR); for (let i = 0; i < c.pcm.length && s + i < out.length; i++) if (s + i >= 0) out[s + i] += c.pcm[i]; }
  return out;
}

/** A soft music bed: a four-chord pad and a light pluck on the beat. calm = 76 BPM, upbeat = 104 BPM. */
export function music(totalSec: number, kind: 'calm' | 'upbeat'): Float32Array {
  const n = Math.ceil(totalSec * SR), out = new Float32Array(n), bpm = kind === 'calm' ? 76 : 104, beat = 60 / bpm, bar = beat * 4;
  const chords = [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66], [164.81, 207.65, 261.63]];
  const TAU = Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const t = i / SR, b = Math.floor(t / bar), tt = t - b * bar, c = chords[b % 4];
    const env = Math.min(1, tt / .5) * Math.min(1, (bar - tt) / .5);
    let v = 0;
    for (const f of c) v += .05 * env * (Math.sin(TAU * f * tt) + .25 * Math.sin(TAU * f * 2.003 * tt));
    v += .05 * env * Math.sin(TAU * c[0] / 2 * tt);
    const k = Math.floor(t / beat), tb = t - k * beat;
    if (tb < .35) v += (kind === 'calm' ? .03 : .05) * Math.sin(TAU * [880, 1318.5, 1046.5, 1318.5][k % 4] * tb) * Math.exp(-tb * 9);
    if (kind === 'upbeat' && k % 2 === 0 && tb < .3) v += .1 * Math.sin(TAU * (45 + 60 * Math.exp(-tb * 30)) * tb) * Math.exp(-tb * 10);
    out[i] = v * Math.min(1, t / 1.5) * Math.min(1, (totalSec - t) / 2);
  }
  return out;
}

/** Voice on top, music ducked under it (by 60 % while someone speaks), normalised. */
export function mixDown(voice: Float32Array, bed?: Float32Array): Float32Array {
  const n = Math.max(voice.length, bed?.length ?? 0), out = new Float32Array(n);
  if (bed) {
    let peak = 1e-6; for (const v of bed) peak = Math.max(peak, Math.abs(v));
    const win = Math.round(SR * .1); let acc = 0;
    const absV = (i: number) => (i >= 0 && i < voice.length ? Math.abs(voice[i]) : 0);
    for (let i = 0; i < n; i++) {
      acc += absV(i + win / 2) - absV(i - win / 2 - 1);
      const env = Math.max(0, acc / win), duck = 1 - .6 * Math.min(1, env / .03);
      out[i] = (i < bed.length ? bed[i] / peak * .3 : 0) * duck;
    }
  }
  for (let i = 0; i < voice.length; i++) out[i] += voice[i];
  let max = 1e-6; for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > .98) for (let i = 0; i < n; i++) out[i] *= .98 / max;
  return out;
}

export function writeWav(file: string, x: Float32Array) {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + x.length * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  writeFileSync(file, b);
}
