// Timed event scripts for the demo engine: what a real run looks like, played from pre-rendered frames.
import { frameSrc, type DemoCatalog } from './demo-catalog';
import type { EngineEvent, Estimate, Look, ProjectState, SceneBoard, StageId, TimedEvent } from './types';
import { MUSIC_NAMES, VOICE_NAMES } from '../options';
import { FALLBACK_SPEED, estimate } from '../store/estimate';
import { DEFAULT_BUDGET, STAGE_NAMES, approvedWord, type BudgetPolicy, type SceneNote } from '../store/types';

const SKETCH_MS = 450, COLOR_MS = 600, FPS = 12;
/** The template each catalog scene of «Как работает лидар» was painted with (for the contact sheet and decisions). */
const DEMO_TEMPLATES = ['host', 'object', 'object', 'compare', 'object', 'host'];

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

export function storyboardFor(p: ProjectState, c: DemoCatalog): (SceneBoard & { catalog: number })[] {
  const count = sceneCountFor(p.settings.duration), base = Math.floor(p.settings.duration / count);
  let start = 0;
  return pick(count, c.scenes.length).map((ci, i) => {
    const duration = i === count - 1 ? p.settings.duration - base * (count - 1) : base;
    const b = { n: i + 1, title: c.scenes[ci].title, visual: c.scenes[ci].visual, line: c.scenes[ci].line, start, duration, catalog: ci + 1, template: DEMO_TEMPLATES[ci] ?? 'host' };
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

/** The estimate the demo shows on a gate: the real engine's formula with its fallback speed (the demo paints nothing). */
export function demoEstimate(p: ProjectState, c: DemoCatalog, stage: StageId, budget: BudgetPolicy = DEFAULT_BUDGET, keys = true): Estimate {
  return estimate({
    stage, draftFps: 6, sketchFrames: 5, finalFps: FPS, overlap: .4, workers: 3, speed: FALLBACK_SPEED, claudeMade: 0, budget,
    scenes: storyboardFor(p, c).map(b => ({ duration: b.duration, key: stage === 'script' && keys, draft: true, final: true, voice: p.settings.voice !== 'none' })),
  });
}

/** Writing the script (version 1, or the next version after a note). Gated: ends with the gate open and the run
 *  stopped in `awaiting`; the rest comes from buildProduceScript once the script is approved. */
export function buildWriteScript(p: ProjectState, c: DemoCatalog, speed = 1, o: { version?: number; gated?: boolean; note?: string; estimate?: Estimate; storyboardNext?: boolean } = {}): TimedEvent[] {
  const w = writer(speed), s = p.settings, version = o.version ?? 1, gated = o.gated ?? false;
  const board = storyboardFor(p, c), lines = board.length + (s.ending !== 'none' ? 1 : 0);
  const step = (id: string, text: string, detail?: string) => w.emit({ type: 'log.add', step: { id, text, status: 'run', ...(detail && { detail }) } });
  const done = (id: string, text?: string, detail?: string) => w.emit({ type: 'log.update', id, status: 'ok', ...(text && { text }), ...(detail !== undefined && { detail }) });
  const scenesWord = board.length > 4 ? 'сцен' : 'сцены';

  w.emit({ type: 'status', status: 'drafting' });
  if (version === 1) {
    step('read', 'Читаю идею и настройки'); w.wait(900); done('read', 'Прочитал идею и настройки');
    w.emit({ type: 'stage', stage: 'brief', status: 'completed', version: 1 });
  }
  // a sent-back script stays `revised` until its next version is shown (as in the real engine)
  if (version === 1) w.emit({ type: 'stage', stage: 'script', status: 'in_progress', version });
  const id = version === 1 ? 'script' : `script-v${version}`;
  if (version === 1) step(id, 'Пишу сценарий и раскадровку', `«${p.title}»`);
  else step(id, `Переделываю сценарий по замечанию`, `«${o.note ?? ''}»`);
  w.wait(version === 1 ? 2000 : 2400);
  w.emit({ type: 'storyboard', title: p.title, scenes: board.map(({ catalog: _c, ...b }) => b) });
  if (version === 1) done(id, `Написал сценарий: ${board.length} ${scenesWord}, ${lines} реплик`);
  else done(id, `Сценарий v${version} готов`, 'Демо-режим: показываю тот же сценарий как новую версию — по-настоящему его перепишет Claude');
  // the choices behind the script, shown beside the script gate (the ungated run is the plain pre-Inkframe-3 recording)
  if (version === 1 && gated) {
    const d = (what: 'style' | 'voice' | 'music', chosen: string, reason: string) =>
      w.emit({ type: 'decision', decision: { at: new Date().toISOString(), stage: 'brief', what, chosen, alternatives: [], reason, confidence: 'high' } });
    d('style', 'Акварель', 'задан на стартовом экране');
    d('voice', VOICE_NAMES[s.voice], 'из настроек');
    d('music', MUSIC_NAMES[s.music], 'из настроек');
    for (const b of board) w.emit({ type: 'decision', decision: {
      at: new Date().toISOString(), stage: 'script', what: 'template', scene: b.n, chosen: b.template ?? 'host', confidence: 'medium',
      alternatives: ['host', 'object', 'compare', 'card'].filter(t => t !== b.template), reason: 'демо: кадры взяты из готового мультфильма «Как работает лидар»',
    } });
  }
  if (gated) {
    const summary = `${board.length} ${scenesWord}, ${s.duration} с. ` + (o.storyboardNext
      ? 'Прочитайте реплики: после «Утвердить» Клод нарисует по одному ключевому кадру на сцену — раскадровку. Если что-то не так — верните с замечанием, сценарий перепишется.'
      : 'Прочитайте реплики: после «Утвердить» Клод озвучит их и нарисует сцены. Если что-то не так — верните с замечанием, сценарий перепишется.');
    if (o.estimate) w.emit({ type: 'estimate', estimate: o.estimate });
    w.emit({ type: 'stage', stage: 'script', status: 'awaiting', version });
    w.emit({ type: 'gate', stage: 'script', version, open: true, summary });
    w.emit({ type: 'log.add', step: { id: `gate-script-v${version}`, text: `Сценарий v${version} ждёт вашего решения`, status: 'wait', detail: 'Утвердите или верните с замечанием' } });
    w.emit({ type: 'status', status: 'awaiting' });
  } else {
    w.emit({ type: 'stage', stage: 'script', status: 'completed', version });
  }
  return w.out;
}

/** The storyboard gate: one key frame per scene (version 1), or the next version after a note — only the scenes
 *  marked (or, for a general note, all of them) get a new frame. Ends with the gate open. */
export function buildKeysScript(p: ProjectState, c: DemoCatalog, speed = 1, o: { version?: number; note?: string; marks?: SceneNote[]; estimate?: Estimate } = {}): TimedEvent[] {
  const w = writer(speed), version = o.version ?? 1, board = storyboardFor(p, c);
  const redo = version === 1 ? board.map(b => b.n) : o.marks?.length ? o.marks.map(m => m.n).filter(n => n <= board.length) : board.map(b => b.n);
  const id = `keys-v${version}`;
  w.emit({ type: 'status', status: 'drafting' });
  if (version === 1) w.emit({ type: 'stage', stage: 'storyboard', status: 'in_progress', version });
  w.emit({ type: 'log.add', step: { id, text: version === 1 ? 'Рисую раскадровку: по одному ключевому кадру на сцену' : 'Правлю раскадровку по замечанию', status: 'run', detail: version === 1 ? 'начерно, без голоса' : `«${o.note ?? ''}»` } });
  for (const n of redo) w.emit({ type: 'scene.key', n, src: '' });
  for (const b of board.filter(x => redo.includes(x.n))) {
    w.wait(500);
    w.emit({ type: 'scene.key', n: b.n, src: frameSrc(c, b.catalog, version === 1 ? 4 : (3 + version) % 8, 'color') });
  }
  w.emit({ type: 'log.update', id, status: 'ok', text: version === 1 ? `Нарисовал раскадровку: ${board.length} кадра` : `Раскадровка v${version}: перерисовал сцены ${redo.join(', ')}`,
    detail: version === 1 ? '' : 'Демо-режим: показываю другой кадр той же сцены — по-настоящему сцену поправит Claude по замечанию' });
  if (o.estimate) w.emit({ type: 'estimate', estimate: o.estimate });
  w.emit({ type: 'stage', stage: 'storyboard', status: 'awaiting', version });
  w.emit({ type: 'gate', stage: 'storyboard', version, open: true, summary: `Раскадровка: ${board.length} кадра — по одному на сцену, начерно и без голоса. После «Утвердить» Клод озвучит реплики, нарисует сцены целиком, соберёт MP4 и проверит его. Не так — напишите замечание или отметьте сцены «перерисовать».` });
  w.emit({ type: 'log.add', step: { id: `gate-storyboard-v${version}`, text: `Раскадровка v${version} ждёт вашего решения`, status: 'wait', detail: 'Полностью рисовать не начинаю, пока не утвердите' } });
  w.emit({ type: 'status', status: 'awaiting' });
  return w.out;
}

/** Everything after the approved script (or storyboard): hero, voice, every scene sketch → colour, music. Ends
 *  `ready`; with `cut` it ends without it, the assemble script comes right after. */
export function buildProduceScript(p: ProjectState, c: DemoCatalog, speed = 1, o: { cut?: boolean } = {}): TimedEvent[] {
  const w = writer(speed), s = p.settings;
  const board = storyboardFor(p, c);
  const step = (id: string, text: string, detail?: string) => w.emit({ type: 'log.add', step: { id, text, status: 'run', ...(detail && { detail }) } });
  const done = (id: string, text?: string) => w.emit({ type: 'log.update', id, status: 'ok', ...(text && { text }) });

  w.emit({ type: 'status', status: 'drawing' });
  w.wait(400);
  if (s.hero !== 'none') { step('hero', 'Рисую героя по листу персонажа'); w.wait(1300); done('hero', 'Нарисовал героя по листу персонажа'); }
  if (s.voice !== 'none') {
    w.emit({ type: 'stage', stage: 'voice', status: 'in_progress', version: 1 });
    step('voice', `Озвучиваю реплики · голос «${VOICE_NAMES[s.voice]}»`); w.wait(1500);
    w.emit({ type: 'track', kind: 'voice', peaks: c.voicePeaks });
    done('voice', `Озвучил реплики · голос «${VOICE_NAMES[s.voice]}»`);
  }
  w.emit({ type: 'stage', stage: 'voice', status: 'completed', version: 1 });

  // what is still ahead, in the order it will happen
  for (const b of board) w.emit({ type: 'log.add', step: { id: `scene-${b.n}`, text: `Сцена ${b.n} — в очереди`, status: 'wait' } });
  if (s.music !== 'none') w.emit({ type: 'log.add', step: { id: 'music', text: 'Музыка и сведение звука', status: 'wait' } });

  w.emit({ type: 'stage', stage: 'paint', status: 'in_progress', version: 1 });
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
  w.emit({ type: 'stage', stage: 'paint', status: 'completed', version: 1 });
  if (s.music !== 'none') {
    w.emit({ type: 'log.update', id: 'music', status: 'run', text: `Подбираю музыку · ${MUSIC_NAMES[s.music]}, свожу с голосом` });
    w.wait(1200);
    w.emit({ type: 'track', kind: 'music', peaks: c.musicPeaks });
    done('music', `Музыка · ${MUSIC_NAMES[s.music]}, приглушена под голос`);
  }
  w.emit({ type: 'progress', value: 1, etaSec: 0 });
  w.emit({ type: 'log.add', step: { id: 'ready', text: o.cut ? 'Все сцены готовы — собираю MP4' : 'Все сцены готовы — можно собирать MP4', status: 'ok' } });
  if (!o.cut) w.emit({ type: 'status', status: 'ready' });
  return w.out;
}

/** The whole run in one script. With `gated` it stops at the script gate (the produce part is left out). */
export function buildRunScript(p: ProjectState, c: DemoCatalog, speed = 1, gated = false): TimedEvent[] {
  const head = buildWriteScript(p, c, speed, { gated });
  if (gated) return head;
  const t = head.at(-1)?.at ?? 0;
  return [...head, ...buildProduceScript(p, c, speed).map(x => ({ ...x, at: x.at + t }))];
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
  w.emit({ type: 'stage', stage: 'paint', status: 'in_progress', version: 1 });
  w.wait(1200);
  w.emit({ type: 'log.update', id, status: 'run', text: `Перерисовываю сцену ${n}` });
  drawScene(w, c, n, board.catalog, sc.duration, { sketch: 4, color: 6, sketchMs: 300, colorMs: 380, look: lookFor(request) });
  w.emit({ type: 'scene.edited', n, request });
  w.emit({ type: 'stage', stage: 'paint', status: 'completed', version: 1 });
  w.emit({ type: 'log.update', id, status: 'ok', text: `Сцена ${n} перерисована: «${request}»`, detail: '' });
  return w.out;
}

/** The cut and its self-review. `final`: the final gate opens with the MP4 (version given) instead of `done`.
 *  `n`: the number of the cut (log lines of a second cut get their own ids). */
export function buildAssembleScript(_p: ProjectState, c: DemoCatalog, speed = 1, o: { final?: { version: number }; n?: number } = {}): TimedEvent[] {
  const w = writer(speed), k = o.n ?? 1, build = k === 1 ? 'build' : `build-${k}`, review = k === 1 ? 'review' : `review-${k}`;
  w.emit({ type: 'status', status: 'building' });
  w.emit({ type: 'stage', stage: 'compose', status: 'in_progress', version: 1 });
  w.emit({ type: 'log.add', step: { id: build, text: 'Склеиваю сцены, голос и музыку в MP4', status: 'run', detail: '0 %' } });
  for (const pct of [18, 41, 67, 88, 100]) { w.wait(600); w.emit({ type: 'log.update', id: build, status: 'run', detail: `${pct} %` }); }
  w.emit({ type: 'log.update', id: build, status: 'ok', text: 'MP4 склеен — проверяю, прежде чем отдать', detail: c.videoLabel });
  w.emit({ type: 'stage', stage: 'compose', status: 'completed', version: 1 });
  // the self-review, as the real engine does it after every cut; the demo MP4's report is known in advance
  w.emit({ type: 'stage', stage: 'review', status: 'in_progress', version: 1 });
  w.emit({ type: 'log.add', step: { id: review, text: 'Проверяю готовый ролик', status: 'run', detail: 'длина, чёрные и пустые кадры, голос под репликами, громкость, субтитры' } });
  w.wait(900);
  w.emit({ type: 'review', review: { at: new Date().toISOString(), video: c.video, decision: 'PASS', checks: c.review } });
  w.emit({ type: 'log.update', id: review, status: 'ok', text: 'Проверил ролик: всё в порядке', detail: '' });
  w.emit({ type: 'stage', stage: 'review', status: 'completed', version: 1 });
  w.emit({ type: 'video', src: c.video });
  if (o.final) {
    const v = o.final.version;
    w.emit({ type: 'log.update', id: build, status: 'ok', text: 'MP4 склеен и проверен — ждёт вашего решения', detail: c.videoLabel });
    w.emit({ type: 'stage', stage: 'final', status: 'awaiting', version: v });
    w.emit({ type: 'gate', stage: 'final', version: v, open: true, summary: 'MP4 собран и проверен: ошибок нет. Посмотрите ролик: «Утвердить» — ролик готов, его можно скачать. Не так — выберите сцену и напишите, что переделать: Клод перерисует её и соберёт MP4 заново.' });
    w.emit({ type: 'log.add', step: { id: `gate-final-v${v}`, text: `Финал v${v} ждёт вашего решения`, status: 'wait', detail: 'Ролик отдам, когда утвердите' } });
    w.emit({ type: 'status', status: 'awaiting' });
    return w.out;
  }
  w.emit({ type: 'stage', stage: 'final', status: 'completed', version: 1 });
  w.emit({ type: 'log.update', id: build, status: 'ok', text: 'MP4 готов — можно скачать', detail: c.videoLabel });
  w.emit({ type: 'status', status: 'done' });
  return w.out;
}

/** What «Утвердить» does on the screen: the stage is done, its gate closes, its log line says so (final: the cartoon is done). */
export function approvalEvents(stage: StageId, version: number, note?: string): EngineEvent[] {
  return [
    { type: 'stage', stage, status: 'completed', version },
    { type: 'gate', stage, version, open: false, summary: '' },
    { type: 'log.update', id: `gate-${stage}-v${version}`, status: 'ok', text: stage === 'final' ? `Финал v${version} утверждён — ролик отдан` : `${STAGE_NAMES[stage]} v${version} ${approvedWord(stage)}`, detail: note ? `«${note}»` : '' },
    ...(stage === 'final' ? [{ type: 'status', status: 'done' } as EngineEvent] : []),
  ];
}
