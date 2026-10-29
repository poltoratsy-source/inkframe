// ffmpeg work: one silent clip per scene from its frames, then the cut: cross-fades at every seam, the mixed sound,
// subtitles burned in from the voice's word timings.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { Word } from './audio';

export const FINAL_FPS = 12;     // painted on twos, like the hand-drawn engine it comes from
export const OVERLAP = .4;       // seconds of cross-fade between scenes

export function ffmpeg(args: string[], cwd?: string): Promise<void> {
  return new Promise((ok, bad) => {
    const p = spawn('ffmpeg', ['-y', '-v', 'error', ...args], { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; });
    p.on('close', c => (c ? bad(new Error(`ffmpeg: ${err.trim().split('\n').slice(-2).join(' ')}`)) : ok()));
  });
}

/** frames/f00000.jpg … → a silent H.264 clip. */
export const encodeClip = (framesPattern: string, out: string) =>
  ffmpeg(['-framerate', String(FINAL_FPS), '-i', framesPattern, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', out]);

// ---------- subtitles ----------
export interface Cue { start: number; end: number; text: string }

/** Words with the line's own punctuation, grouped into cues of at most `max` characters. `at` = when the clip starts. */
export function cuesFor(line: string, words: Word[], at: number, max = 40): Cue[] {
  if (!words.length) return [];
  const tokens: { t0: number; t1: number; s: string }[] = [];
  let cur = 0;
  const pos = words.map(([, , w]) => { const k = line.indexOf(w, cur); if (k >= 0) cur = k + w.length; return k; });
  words.forEach(([t0, t1, w], i) => {
    const k = pos[i], next = pos.slice(i + 1).find(p => p >= 0) ?? line.length;
    tokens.push({ t0, t1, s: k >= 0 ? line.slice(k, next).trim() : w });
  });
  const cues: Cue[] = []; let group: typeof tokens = [];
  const flush = () => { if (group.length) cues.push({ start: at + group[0].t0 - .05, end: at + group[group.length - 1].t1 + .35, text: group.map(g => g.s).join(' ') }); group = []; };
  for (const tk of tokens) {
    const len = group.map(g => g.s).join(' ').length;
    if (group.length && len + 1 + tk.s.length > max) flush();
    group.push(tk);
    if (/[.!?…]$/.test(tk.s) && group.map(g => g.s).join(' ').length > max * .45) flush();
  }
  flush();
  for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start - .02);
  return cues;
}

const assTime = (s: number) => { s = Math.max(0, s); return `${Math.floor(s / 3600)}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

export function writeAss(file: string, cues: Cue[]) {
  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Inter,40,&H00FFFFFF,&H00FFFFFF,&H60140F0E,&H60140F0E,1,0,0,0,100,100,0,0,4,10,0,2,90,90,30,204

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  writeFileSync(file, head + cues.map(c => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Sub,,0,0,0,,${c.text.replace(/[{}\\]/g, '')}\n`).join(''));
}

/** The ffmpeg arguments for the cut. Clips are scene i's video, OVERLAP s longer than the scene except the last. */
export function cutArgs(o: { clips: string[]; starts: number[]; total: number; audio?: string; ass?: string; out: string }): string[] {
  const n = o.clips.length, f: string[] = [];
  o.clips.forEach((_, i) => f.push(`[${i}:v]fps=24,format=yuv420p,setpts=PTS-STARTPTS[v${i}]`));
  let last = 'v0';
  for (let i = 1; i < n; i++) {
    const tr = i === n - 1 ? 'circleopen' : 'fade';
    f.push(`[${last}][v${i}]xfade=transition=${tr}:duration=${OVERLAP}:offset=${o.starts[i].toFixed(3)}[x${i}]`);
    last = `x${i}`;
  }
  f.push(`[${last}]${o.ass ? `ass=${o.ass}` : 'null'}[v]`);
  return [
    ...o.clips.flatMap(c => ['-i', c]),
    ...(o.audio ? ['-i', o.audio] : []),
    '-filter_complex', f.join(';'), '-map', '[v]', ...(o.audio ? ['-map', `${n}:a`, '-c:a', 'aac', '-b:a', '160k'] : []),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-t', o.total.toFixed(3), '-movflags', '+faststart', o.out,
  ];
}
