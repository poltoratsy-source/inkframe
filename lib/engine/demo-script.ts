// Timed event scripts for the demo engine: what a real run looks like, played from pre-rendered frames.
import { frameSrc, type DemoCatalog } from './demo-catalog';
import type { EngineEvent, Look, ProjectState, SceneBoard, TimedEvent } from './types';
import { MUSIC_NAMES, VOICE_NAMES } from '../options';

const SKETCH_MS = 450, COLOR_MS = 600, FPS = 12;

export function sceneCountFor(durationSec: number): number {
  return Math.max(3, Math.min(6, Math.round(durationSec / 8)));
}

/** A tiny script writer: `wait(ms)` moves the clock, `emit(ev)` schedules an event at the current time. */
function writer(speed: number) {
  const out: TimedEvent[] = [];
  let t = 0;
  return {
    out,
    wait: (ms: number) => { t += ms / speed; },
    emit: (ev: EngineEvent) => { out.push({ at: Math.round(t), ev }); },
  };
}

/** Which catalog scenes a cartoon of `count` scenes uses: spread evenly, first and last always in. */
const pick = (count: number, available: number) =>
  Array.from({ length: count }, (_, i) => Math.round(i * (available - 1) / Math.max(1, count - 1)));

export function storyboardFor(p: ProjectState, c: DemoCatalog): SceneBoard[] {
  const count = sceneCountFor(p.settings.duration), base = Math.floor(p.settings.duration / count);
  let start = 0;
  return pick(count, c.scenes.length).map((ci, i) => {
    const duration = i === count - 1 ? p.settings.duration - base * (count - 1) : base;
    const b = { n: i + 1, title: c.scenes[ci].title, visual: c.scenes[ci].visual, line: c.scenes[ci].line, start, duration, catalog: ci + 1 };
    start += duration;
    return b;
  });
}

/** Frames of one scene drawn sketch → colour, with the stage tag counting real frame numbers. */
function drawScene(w: ReturnType<typeof writer>, c: DemoCatalog, n: number, catalogScene: number, duration: number,
  opts: { sketch: number; color: number; sketchMs: number; colorMs: number; look?: Look; onFrame?: () => void }) {
  const total = Math.round(duration * FPS), steps = opts.sketch + opts.color;
  w.emit({ type: 'scene.status', n, status: 'sketch' });
  for (let k = 0; k < opts.sketch; k++) {
    w.emit({ type: 'frame', n, kind: 'sketch', src: frameSrc(c, catalogScene, k % 8, 'sketch'), index: Math.round((k + 1) / steps * total), total });
    opts.onFrame?.(); w.wait(opts.sketchMs);
  }
  w.emit({ type: 'scene.status', n, status: 'painting' });
  if (opts.look) w.emit({ type: 'scene.look', n, look: opts.look });
  for (let k = 0; k < opts.color; k++) {
    w.emit({ type: 'frame', n, kind: 'color', src: frameSrc(c, catalogScene, k % 8, 'color'), index: Math.round((opts.sketch + k + 1) / steps * total), total });
    opts.onFrame?.(); w.wait(opts.colorMs);
  }
  w.emit({ type: 'scene.status', n, status: 'done' });
}

export function buildRunScript(p: ProjectState, c: DemoCatalog, speed = 1): TimedEvent[] {
  const w = writer(speed), s = p.settings;
  const board = storyboardFor(p, c), lines = board.length + (s.ending !== 'none' ? 1 : 0);
  const step = (id: string, text: string, detail?: string) => w.emit({ type: 'log.add', step: { id, text, status: 'run', ...(detail && { detail }) } });
  const done = (id: string, text?: string) => w.emit({ type: 'log.update', id, status: 'ok', ...(text && { text }) });

  w.emit({ type: 'status', status: 'drafting' });
  step('read', 'Читаю идею и настройки'); w.wait(900); done('read', 'Прочитал идею и настройки');
  step('script', 'Пишу сценарий и раскадровку', `«${p.title}»`); w.wait(2000);
  w.emit({ type: 'storyboard', title: p.title, scenes: board.map(({ catalog: _c, ...b }) => b) });
  done('script', `Написал сценарий: ${board.length} сцены, ${lines} реплик`.replace('сцены', board.length > 4 ? 'сцен' : 'сцены'));
  for (const b of board) w.emit({ type: 'log.add', step: { id: `scene-${b.n}`, text: `Сцена ${b.n} — в очереди`, status: 'wait' } });
  if (s.music !== 'none') w.emit({ type: 'log.add', step: { id: 'music', text: 'Музыка и сведение звука', status: 'wait' } });
  w.wait(400);
  if (s.hero !== 'none') { step('hero', 'Рисую героя по листу персонажа'); w.wait(1300); done('hero', 'Нарисовал героя по листу персонажа'); }
  if (s.voice !== 'none') {
    step('voice', `Озвучиваю реплики · голос «${VOICE_NAMES[s.voice]}»`); w.wait(1500);
    w.emit({ type: 'track', kind: 'voice', peaks: c.voicePeaks });
    done('voice', `Озвучил реплики · голос «${VOICE_NAMES[s.voice]}»`);
  }

  const perScene = 16, totalFrames = board.length * perScene, msPerScene = 8 * SKETCH_MS + 8 * COLOR_MS;
  let drawn = 0;
  for (const b of board) {
    const id = `scene-${b.n}`;
    w.emit({ type: 'log.update', id, status: 'run', text: `Рисую сцену ${b.n}: набросок`, detail: `«${b.visual}»` });
    drawScene(w, c, b.n, b.catalog, b.duration, {
      sketch: 8, color: 8, sketchMs: SKETCH_MS, colorMs: COLOR_MS,
      onFrame: () => {
        drawn++;
        if (drawn === 9 + (b.n - 1) * perScene) w.emit({ type: 'log.update', id, status: 'run', text: `Рисую сцену ${b.n} начисто` });
        const left = (totalFrames - drawn) / perScene * msPerScene / 1000 / speed;
        w.emit({ type: 'progress', value: +(drawn / totalFrames * 0.96).toFixed(3), etaSec: Math.round(left + 3) });
      },
    });
    w.emit({ type: 'log.update', id, status: 'ok', text: `Сцена ${b.n} готова начисто`, detail: '' });
  }
  if (s.music !== 'none') {
    w.emit({ type: 'log.update', id: 'music', status: 'run', text: `Подбираю музыку · ${MUSIC_NAMES[s.music]}, свожу с голосом` });
    w.wait(1200);
    w.emit({ type: 'track', kind: 'music', peaks: c.musicPeaks });
    done('music', `Музыка · ${MUSIC_NAMES[s.music]}, приглушена под голос`);
  }
  w.emit({ type: 'progress', value: 1, etaSec: 0 });
  w.emit({ type: 'log.add', step: { id: 'ready', text: 'Все сцены готовы — можно собирать MP4', status: 'ok' } });
  w.emit({ type: 'status', status: 'ready' });
  return w.out;
}

/** The demo's stand-in for "Claude redraws this scene": a look per quick edit, a stable one for free text. */
const LOOKS: [RegExp, Look][] = [
  [/ноч|темн/i, { filter: 'brightness(.62) saturate(1.25) hue-rotate(-18deg)', zoom: 1 }],
  [/крупн|ближе|больше/i, { filter: 'none', zoom: 1.35 }],
  [/весел|ярч|радост/i, { filter: 'saturate(1.7) brightness(1.1) hue-rotate(8deg)', zoom: 1.05 }],
  [/медлен|спокой/i, { filter: 'saturate(.75) sepia(.25)', zoom: 1 }],
  [/зел[её]н/i, { filter: 'hue-rotate(95deg) saturate(1.3)', zoom: 1 }],
  [/голос/i, { filter: 'none', zoom: 1 }],
];
const FREE: Look[] = [
  { filter: 'hue-rotate(40deg) saturate(1.2)', zoom: 1.1 },
  { filter: 'hue-rotate(-40deg) saturate(1.3)', zoom: 1 },
  { filter: 'sepia(.35) saturate(1.4)', zoom: 1.15 },
  { filter: 'contrast(1.15) saturate(1.5)', zoom: 1.05 },
];
export function lookFor(request: string): Look {
  for (const [re, look] of LOOKS) if (re.test(request)) return look;
  let h = 0; for (const ch of request) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FREE[h % FREE.length];
}

export function buildEditScript(p: ProjectState, n: number, request: string, c: DemoCatalog, speed = 1): TimedEvent[] {
  const sc = p.scenes.find(x => x.n === n);
  if (!sc) throw new Error(`No scene ${n} in this project`);
  const board = storyboardFor(p, c).find(b => b.n === n)!;
  const w = writer(speed), id = `edit-${n}-${sc.version}`;
  w.emit({ type: 'log.add', step: { id, text: `Правлю сцену ${n}: «${request}»`, status: 'run', detail: 'Остальные сцены не трогаю' } });
  w.wait(1200);
  w.emit({ type: 'log.update', id, status: 'run', text: `Перерисовываю сцену ${n}` });
  drawScene(w, c, n, board.catalog, sc.duration, { sketch: 4, color: 6, sketchMs: 300, colorMs: 380, look: lookFor(request) });
  w.emit({ type: 'scene.edited', n, request });
  w.emit({ type: 'log.update', id, status: 'ok', text: `Сцена ${n} перерисована: «${request}»`, detail: '' });
  return w.out;
}

export function buildAssembleScript(_p: ProjectState, c: DemoCatalog, speed = 1): TimedEvent[] {
  const w = writer(speed);
  w.emit({ type: 'status', status: 'building' });
  w.emit({ type: 'log.add', step: { id: 'build', text: 'Склеиваю сцены, голос и музыку в MP4', status: 'run', detail: '0 %' } });
  for (const pct of [18, 41, 67, 88, 100]) { w.wait(600); w.emit({ type: 'log.update', id: 'build', status: 'run', detail: `${pct} %` }); }
  w.emit({ type: 'video', src: c.video });
  w.emit({ type: 'log.update', id: 'build', status: 'ok', text: 'MP4 готов — можно скачать', detail: c.videoLabel });
  w.emit({ type: 'status', status: 'done' });
  return w.out;
}
