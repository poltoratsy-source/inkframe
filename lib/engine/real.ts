// RealEngine: writes and paints the cartoon for real.
//   1. Claude (Claude Code CLI on this machine) writes the storyboard: scenes, lines, lengths and a SceneSpec per scene
//      (a template + setting + props + words, never free drawing code). If Claude can't be reached, a template
//      storyboard is used and the log says so.
//   2. edge-tts voices every line; scene lengths stretch to fit the voice.
//   3. Every scene is drafted on screen: a pencil sketch, then a low-res colour pass, streamed frame by frame.
//   4. editScene() changes one scene (by Claude, by simple rules, or by new words typed in) and redraws only it.
//   5. build() paints every scene at 1280×720 / 12 fps (scenes that didn't change come from the cache), then ffmpeg
//      cuts them together with cross-fades, the voice over a ducked music bed and burned-in subtitles.
//   6. Every cut is checked before it is handed out (lib/real/review.ts → review.json): a FAIL keeps the MP4 off the
//      screen (status back to `ready`, the log says what is wrong, scenes with broken pictures are repainted next time).
// It emits the same events as DemoEngine, so the screens stay as they are. Projects live in INKFRAME_PROJECTS_DIR.
// Inkframe 3: the run goes through stages kept in projects/<id>/stages (lib/store/stages.ts). After the script is
// written the run stops at the script gate (status `awaiting`): approve() goes on to voice and paint, revise() has
// Claude (or simple rules) rewrite the script as the next version and opens the gate again. INKFRAME_GATES=off skips it.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyEvent, canBuild, emptyProject, normalizeProject } from './reducer';
import type { EngineEvent, LogStep, ProjectState, ProjectSummary, ScenePatch, StageId, StageStatus, StartSettings, StepStatus, StudioEngine } from './types';
import { StageStore, readGatePolicy } from '../store/stages';
import { GateError } from '../store/gate';
import { STAGE_NAMES, type Checkpoint, type GatePolicy, type LoggedEvent, type Review } from '../store/types';
import { MUSIC_NAMES, VOICE_NAMES } from '../options';
import { askClaude } from '../real/claude';
import { Painter, rendererVersion, type FrameOptions } from '../real/painter';
import { SR, decode, envelope, mixDown, music, peaks, place, tts, voiceId, wordsOf, writeWav, type TtsJob, type Word } from '../real/audio';
import { FINAL_FPS, OVERLAP, cuesFor, cutArgs, ffmpeg, writeAss } from '../real/assemble';
import { cleanScene, cleanStoryboard, editByRules, editPrompt, extractJson, reviseByRules, revisePrompt, storyboardPrompt, templateStoryboard, type BoardScene, type Storyboard } from '../real/storyboard';
import { DARK_SETTINGS, cleanSpec, describe, words, type StageScene } from '../real/scene-spec';
import { reviewCrashed, reviewVideo, type ReviewPlan } from '../real/review';

/** What the engine needs from the outside world; tests swap these for fakes. */
export interface RealTools {
  ask(prompt: string): Promise<string>;
  voice(jobs: TtsJob[], jobsFile: string): Promise<void>;
  decode(file: string): Promise<Float32Array>;
  painter: Pick<Painter, 'frames' | 'close' | 'workers'>;
  ffmpeg(args: string[], cwd?: string): Promise<void>;
  /** the self-review of a finished MP4 */
  review(plan: ReviewPlan): Promise<Review>;
}
export interface RealOptions {
  dir?: string;
  tools?: Partial<RealTools>;
  /** false = never ask Claude (template storyboard, rule-based edits) */
  useClaude?: boolean;
  draftFps?: number;
  sketchFrames?: number;
  finalWidth?: number;
  /** which stages stop for a human (default: inkframe.config.json + INKFRAME_GATES, see readGatePolicy) */
  gates?: GatePolicy;
  /** part of every final clip's cache key (default: a hash of renderer/**, see rendererVersion) */
  rendererVersion?: string;
}

const LEAD = .35, TAIL = .55;   // silence before and after each line inside its scene
const DRAFT: FrameOptions = { rs: .25, width: 640, quality: .82 };
const round1 = (x: number) => Math.round(x * 10) / 10;

interface RScene { board: BoardScene; planned: number; version: number; voiceOther?: boolean; audio?: { base: string; dur: number; words: Word[] }; env: string }
interface Entry {
  state: ProjectState; listeners: Set<(ev: EngineEvent) => void>; queue: (() => Promise<void>)[]; running: boolean;
  scenes: RScene[]; dir: string; cut: number; cutQueued?: boolean; storyBy?: Storyboard['by'];
  store: StageStore;
}

export class RealEngine implements StudioEngine {
  readonly mode = 'real' as const;
  private projects = new Map<string, Entry>();
  private root: string;
  private tools: RealTools;
  private useClaude: boolean;
  private draftFps: number;
  private sketchFrames: number;
  private finalWidth: number;
  private gates: GatePolicy;
  private rendererVersion?: string;
  /** after Claude fails to answer, skip it for a while instead of making every step wait for the timeout */
  private claudeDownUntil = 0;

  constructor(o: RealOptions = {}) {
    this.root = resolve(o.dir ?? process.env.INKFRAME_PROJECTS_DIR ?? 'projects');
    this.useClaude = o.useClaude ?? process.env.INKFRAME_STORYBOARD !== 'template';
    this.draftFps = o.draftFps ?? 6;
    this.sketchFrames = o.sketchFrames ?? 5;
    this.finalWidth = o.finalWidth ?? 1280;
    this.gates = o.gates ?? readGatePolicy();
    this.rendererVersion = o.rendererVersion;
    this.tools = {
      ask: p => askClaude(p), voice: tts, decode, ffmpeg, review: reviewVideo,
      painter: o.tools?.painter ?? new Painter({ workers: Number(process.env.INKFRAME_RENDER_WORKERS) || 3, log: s => console.warn(s) }),
      ...o.tools,
    } as RealTools;
    mkdirSync(this.root, { recursive: true });
    this.load();
  }

  // ---------- StudioEngine ----------
  create(settings: StartSettings): ProjectState {
    if (!settings.idea?.trim()) throw new Error('The idea is empty');
    const id = randomUUID().slice(0, 8), dir = join(this.root, id);
    mkdirSync(dir, { recursive: true });
    const e: Entry = { state: emptyProject(id, settings, 'real'), listeners: new Set(), queue: [], running: false, scenes: [], dir, cut: 0, store: new StageStore(dir) };
    this.projects.set(id, e);
    this.enqueue(e, () => this.run(e));
    return e.state;
  }

  get(id: string) { return this.projects.get(id)?.state; }

  list(): ProjectSummary[] {
    return [...this.projects.values()].map(({ state: s }) => ({
      id: s.id, title: s.title, status: s.status, duration: s.settings.duration, style: s.settings.style, createdAt: s.createdAt,
      thumb: s.scenes.find(sc => sc.frameKind === 'color')?.frame ?? s.scenes[0]?.frame,
    })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  subscribe(id: string, listener: (ev: EngineEvent) => void) {
    const e = this.entry(id);
    listener({ type: 'snapshot', state: e.state });
    e.listeners.add(listener);
    return () => { e.listeners.delete(listener); };
  }

  editScene(id: string, n: number, request: string, patch?: ScenePatch) {
    const e = this.entry(id);
    if (e.state.stages.script.status !== 'completed') throw new GateError('Сценарий ещё не утверждён: правьте его замечанием на панели утверждения', 409);
    const req = request.trim().slice(0, 300), hasPatch = !!(patch && (patch.line?.trim() || patch.caption !== undefined));
    if (!req && !hasPatch) throw new Error('The edit request is empty');
    if (e.state.scenes.length ? !e.state.scenes.some(sc => sc.n === n) : n < 1 || n > 12) throw new Error(`No scene ${n} in this project`);
    this.enqueue(e, () => this.edit(e, n, req, hasPatch ? patch : undefined));
  }

  build(id: string) {
    const e = this.entry(id);
    if (!canBuild(e.state)) throw new Error('The cartoon is not ready to build yet');
    if (e.cutQueued) return;   // a second click while the cut is on its way
    e.cutQueued = true;
    this.enqueue(e, () => this.cut(e).finally(() => { e.cutQueued = false; }));
  }

  approve(id: string, stage: StageId, version: number, note?: string): ProjectState {
    const e = this.entry(id);
    const { cp, changed } = e.store.approve(stage, version, note);
    if (!changed) return e.state;
    e.store.log({ kind: 'gate', stage, payload: { decision: 'approve', version, ...(cp.approval?.note && { note: cp.approval.note }) } });
    this.emit(e, { type: 'stage', stage, status: 'completed', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.update(e, `gate-${stage}-v${version}`, 'ok', `${STAGE_NAMES[stage]} v${version} утверждён`, cp.approval?.note ? `«${cp.approval.note}»` : '');
    this.save(e);
    this.enqueue(e, () => this.produce(e));
    return e.state;
  }

  revise(id: string, stage: StageId, version: number, note: string): ProjectState {
    const e = this.entry(id);
    const cp = e.store.revise(stage, version, note), text = cp.approval!.note!;
    e.store.log({ kind: 'gate', stage, payload: { decision: 'revise', version, note: text } });
    this.emit(e, { type: 'stage', stage, status: 'revised', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.update(e, `gate-${stage}-v${version}`, 'ok', `${STAGE_NAMES[stage]} v${version} вернули с замечанием`, `«${text}»`);
    this.emit(e, { type: 'status', status: 'drafting' });
    this.save(e);
    this.enqueue(e, () => this.rewrite(e, text));
    return e.state;
  }

  // ---------- the run ----------
  private async run(e: Entry) {
    const s = e.state.settings;
    this.emit(e, { type: 'status', status: 'drafting' });
    this.step(e, 'read', 'Прочитал идею и настройки', 'ok');
    this.setStage(e, 'brief', 'completed');
    this.setStage(e, 'script', 'in_progress');
    this.step(e, 'script', 'Пишу сценарий и раскадровку', 'run', `«${e.state.title}»`);
    const board = await this.storyboard(s);
    this.useBoard(e, board);
    this.update(e, 'script', 'ok', `Написал сценарий: ${e.scenes.length} ${plural(e.scenes.length, 'сцена', 'сцены', 'сцен')}`,
      board.by === 'claude' ? 'Claude' : 'Claude недоступен — раскадровка по шаблону');
    await this.scriptWritten(e);
  }

  private useBoard(e: Entry, board: Storyboard) {
    e.storyBy = board.by;
    e.scenes = board.scenes.map(b => ({ board: b, planned: b.duration, version: 1, env: '' }));
    this.layout(e);
    this.emit(e, { type: 'storyboard', title: board.title, scenes: e.scenes.map((_, i) => this.boardOf(e, i)) });
  }

  /** The script is on the screen: stop at its gate, or go straight on when the script gate is off. */
  private async scriptWritten(e: Entry) {
    const gated = this.gates.script;
    const cp = e.store.open('script', { title: e.state.title, by: e.storyBy, scenes: e.scenes.map(r => r.board) }, gated);
    if (!gated) { this.emit(e, { type: 'stage', stage: 'script', status: 'completed', version: cp.version }); return this.produce(e); }
    const n = e.scenes.length;
    const summary = `${n} ${plural(n, 'сцена', 'сцены', 'сцен')}, ${fmtSec(this.total(e))}. ${e.storyBy === 'claude' ? 'Сценарий написал Claude.' : 'Claude недоступен — сценарий собран по шаблону.'} `
      + 'Прочитайте реплики: после «Утвердить» Клод озвучит их и нарисует сцены. Если что-то не так — верните с замечанием, сценарий перепишется.';
    this.emit(e, { type: 'stage', stage: 'script', status: 'awaiting', version: cp.version });
    this.emit(e, { type: 'gate', stage: 'script', version: cp.version, open: true, summary });
    this.step(e, `gate-script-v${cp.version}`, `Сценарий v${cp.version} ждёт вашего решения`, 'wait', 'Рисовать не начинаю, пока не утвердите или не вернёте с замечанием');
    this.emit(e, { type: 'status', status: 'awaiting' });
  }

  /** The script came back with a note: Claude rewrites it; without Claude, simple rules, and the log says so. */
  private async rewrite(e: Entry, note: string) {
    const s = e.state.settings, v = (e.store.get('script')?.version ?? 1) + 1, id = `script-v${v}`;
    this.step(e, id, 'Переписываю сценарий по замечанию', 'run', `«${note}»`);
    const current: Storyboard = { title: e.state.title, by: e.storyBy ?? 'template', scenes: e.scenes.map(r => ({ ...r.board, duration: r.planned })) };
    let next: Storyboard | undefined, how = 'Claude учёл замечание';
    const reply = await this.claude(revisePrompt(s, current, note));
    if (reply) {
      try { next = cleanStoryboard(extractJson(reply), s); }
      catch (err) { console.warn(`[inkframe] Claude's rewrite was unusable: ${(err as Error).message}`); }
    }
    if (!next) {
      const r = reviseByRules(current, note);
      next = { ...r.board, by: 'template' };
      how = r.understood ? 'Claude недоступен — замечание учтено по простым правилам' : 'Claude недоступен, а без него замечание не понял — сценарий прежний';
    }
    this.useBoard(e, next);
    this.update(e, id, 'ok', `Переписал сценарий: версия ${v}`, how);
    await this.scriptWritten(e);
  }

  /** Everything after the approved script: voice, the sketch and colour drafts of every scene, music. */
  private async produce(e: Entry) {
    const s = e.state.settings;
    this.emit(e, { type: 'status', status: 'drawing' });
    if (s.voice !== 'none') {
      this.setStage(e, 'voice', 'in_progress');
      this.setStage(e, 'voice', (await this.voiceAll(e)) ? 'completed' : 'failed');
    } else this.setStage(e, 'voice', 'completed');
    for (const [i] of e.scenes.entries()) this.step(e, `scene-${i + 1}`, `Сцена ${i + 1} — в очереди`, 'wait');
    if (s.music !== 'none') this.step(e, 'music', 'Музыка и сведение звука', 'wait');

    const units = e.scenes.reduce((a, r) => a + this.draftTimes(r.board.duration).length + this.sketchFrames, 0);
    const t0 = Date.now(), doneScenes: number[] = []; let done = 0;
    this.setStage(e, 'paint', 'in_progress', { doneScenes });
    for (const [i] of e.scenes.entries()) {
      await this.draw(e, i, () => {
        done++;
        const left = (Date.now() - t0) / done * (units - done) / 1000;
        this.emit(e, { type: 'progress', value: +(done / units * .96).toFixed(3), etaSec: Math.round(left + 2) });
      });
      doneScenes.push(i + 1);
      e.store.set('paint', 'in_progress', { doneScenes: [...doneScenes] });
      this.update(e, `scene-${i + 1}`, 'ok', `Сцена ${i + 1} готова начерно`, '');
    }
    this.setStage(e, 'paint', 'completed');
    if (s.music !== 'none') {
      this.update(e, 'music', 'run', `Подбираю музыку · ${MUSIC_NAMES[s.music]}, свожу с голосом`);
      this.emit(e, { type: 'track', kind: 'music', peaks: peaks(music(this.total(e), s.music === 'calm' ? 'calm' : 'upbeat')) });
      this.update(e, 'music', 'ok', `Музыка · ${MUSIC_NAMES[s.music]}, приглушена под голос`);
    }
    this.emit(e, { type: 'progress', value: 1, etaSec: 0 });
    this.step(e, 'ready', 'Все сцены готовы начерно — можно собирать MP4', 'ok', `Ролик: ${fmtSec(this.total(e))}`);
    this.emit(e, { type: 'status', status: 'ready' });
  }

  private async storyboard(s: StartSettings): Promise<Storyboard> {
    const reply = await this.claude(storyboardPrompt(s));
    if (reply) {
      try { return cleanStoryboard(extractJson(reply), s); }
      catch (err) { console.warn(`[inkframe] Claude's storyboard was unusable: ${(err as Error).message}`); }
    }
    return templateStoryboard(s);
  }

  /** Claude's reply, or undefined when Claude is switched off or can't be reached (then it rests for 10 minutes). */
  private async claude(prompt: string): Promise<string | undefined> {
    if (!this.useClaude || Date.now() < this.claudeDownUntil) return undefined;
    try { return await this.tools.ask(prompt); }
    catch (err) {
      console.warn(`[inkframe] Claude unavailable, using templates: ${(err as Error).message}`);
      this.claudeDownUntil = Date.now() + 10 * 60 * 1000;
      return undefined;
    }
  }

  // ---------- voice ----------
  /** true when every line got its voice */
  private async voiceAll(e: Entry, only?: number[]): Promise<boolean> {
    const s = e.state.settings, idx = only ?? e.scenes.map((_, i) => i);
    const id = only ? `voice-${Date.now()}` : 'voice';
    this.step(e, id, `Озвучиваю ${only ? 'реплику' : 'реплики'} · голос «${VOICE_NAMES[s.voice]}»`, 'run');
    mkdirSync(join(e.dir, 'voice'), { recursive: true });
    const jobs: TtsJob[] = idx.map(i => {
      const r = e.scenes[i], base = join(e.dir, 'voice', `s${i + 1}-${hash(r.board.line + r.voiceOther).slice(0, 8)}`);
      return { text: r.board.line, voice: voiceId(s.language, s.voice, r.voiceOther), rate: r.board.spec.pace === 'slow' ? '-5%' : '+5%', out: base };
    });
    try {
      await this.tools.voice(jobs.filter(j => !existsSync(j.out + '.mp3')), join(e.dir, 'voice', 'jobs.json'));
      for (const [k, i] of idx.entries()) {
        const pcm = await this.tools.decode(jobs[k].out + '.mp3'), ws = wordsOf(jobs[k].out);
        // edge-tts pads the end with silence: the line lasts until its last word
        const spoken = ws.length ? Math.min(pcm.length / SR, ws[ws.length - 1][1] + .15) : pcm.length / SR;
        e.scenes[i].audio = { base: jobs[k].out, dur: spoken, words: ws };
      }
      this.layout(e);
      await this.refreshVoice(e);
      this.update(e, id, 'ok', `Озвучил${only ? ' заново' : ''} · голос «${VOICE_NAMES[s.voice]}»`, `Ролик: ${fmtSec(this.total(e))}`);
      return true;
    } catch (err) {
      this.update(e, id, 'err', 'Озвучка не удалась — продолжаю без голоса', (err as Error).message.slice(0, 160));
      return false;
    }
  }

  /** Scene lengths: the storyboard's, stretched to fit each voiced line. */
  private layout(e: Entry) {
    for (const r of e.scenes) r.board.duration = r.audio ? Math.max(r.planned, round1(r.audio.dur + LEAD + TAIL)) : r.planned;
  }
  private starts(e: Entry) { let t = 0; return e.scenes.map(r => { const a = t; t = round1(t + r.board.duration); return a; }); }
  private total(e: Entry) { return round1(e.scenes.reduce((a, r) => a + r.board.duration, 0)); }

  /** Rebuilds the voice track (peaks for the studio) and every scene's mouth envelope; tells the studio new timings. */
  private async refreshVoice(e: Entry) {
    const starts = this.starts(e), clips: { at: number; pcm: Float32Array }[] = [];
    for (const [i, r] of e.scenes.entries()) {
      if (!r.audio) { r.env = ''; continue; }
      const pcm = await this.tools.decode(r.audio.base + '.mp3');
      r.env = envelope(pcm, LEAD, r.board.duration + OVERLAP);
      clips.push({ at: starts[i] + LEAD, pcm });
    }
    for (const [i, r] of e.scenes.entries()) {
      const sc = e.state.scenes[i];
      if (sc && (sc.start !== starts[i] || sc.duration !== r.board.duration)) this.emit(e, { type: 'scene.board', n: i + 1, patch: { start: starts[i], duration: r.board.duration } });
    }
    if (clips.length) this.emit(e, { type: 'track', kind: 'voice', peaks: peaks(place(this.total(e), clips)) });
  }

  // ---------- drawing ----------
  private draftTimes(dur: number) { const n = Math.max(2, Math.round(dur * this.draftFps)); return Array.from({ length: n }, (_, k) => round3(k / this.draftFps)); }
  private stage(r: RScene, extra: Partial<StageScene> = {}): StageScene { return { ...r.board.spec, duration: r.board.duration, voice: r.env, ...extra }; }

  /** Sketch, then the colour draft, streamed to the studio. */
  private async draw(e: Entry, i: number, tick: () => void) {
    const r = e.scenes[i], n = i + 1, dur = r.board.duration, total = Math.round(dur * FINAL_FPS);
    const rel = `frames/s${n}-v${r.version}`, dir = join(e.dir, rel);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const url = (f: string) => `/api/projects/${e.state.id}/files/${rel}/${f}`;
    this.update(e, `scene-${n}`, 'run', `Рисую сцену ${n}: набросок`, `«${r.board.title}»`);
    this.emit(e, { type: 'scene.status', n, status: 'sketch' });
    const sk = Array.from({ length: this.sketchFrames }, (_, k) => round3((k + .5) / this.sketchFrames * dur));
    await this.tools.painter.frames(this.stage(r, { sketch: true }), sk, DRAFT, (k, jpg) => {
      const f = `sketch-${k}.jpg`; writeFileSync(join(dir, f), jpg); tick();
      this.emit(e, { type: 'frame', n, kind: 'sketch', src: url(f), index: Math.round(sk[k] * FINAL_FPS), total });
    });
    this.update(e, `scene-${n}`, 'run', `Рисую сцену ${n} в цвете`);
    this.emit(e, { type: 'scene.status', n, status: 'painting' });
    const ct = this.draftTimes(dur);
    await this.tools.painter.frames(this.stage(r, { fast: true }), ct, DRAFT, (k, jpg) => {
      const f = `color-${String(k).padStart(3, '0')}.jpg`; writeFileSync(join(dir, f), jpg); tick();
      this.emit(e, { type: 'frame', n, kind: 'color', src: url(f), index: Math.round(ct[k] * FINAL_FPS), total });
    });
    this.emit(e, { type: 'scene.status', n, status: 'done' });
    // older drafts of this scene are no longer shown anywhere
    for (const d of readdirSync(join(e.dir, 'frames'))) if (d.startsWith(`s${n}-v`) && d !== `s${n}-v${r.version}`) rmSync(join(e.dir, 'frames', d), { recursive: true, force: true });
  }

  // ---------- edits ----------
  private async edit(e: Entry, n: number, request: string, patch?: ScenePatch) {
    const i = n - 1, r = e.scenes[i], s = e.state.settings;
    if (!r) throw new Error(`No scene ${n} in this project`);
    const what = request || [patch?.line && 'новая реплика', patch?.caption !== undefined && 'новая подпись'].filter(Boolean).join(', ');
    const id = `edit-${n}-${Date.now()}`;
    this.step(e, id, `Правлю сцену ${n}: «${what}»`, 'run', 'Остальные сцены не трогаю');
    let next: BoardScene = { ...r.board, spec: { ...r.board.spec } }, voiceOther = r.voiceOther, how = '';
    if (patch) {
      if (patch.line?.trim()) next.line = words(patch.line, 220)!;
      if (patch.caption !== undefined) {
        const c = words(patch.caption, next.spec.template === 'card' ? 24 : 42);
        if (next.spec.template === 'card') next.spec.title = c ?? next.spec.title; else next.spec.caption = c;
      }
      how = 'новые слова';
    }
    if (request) {
      let byClaude = false;
      const reply = await this.claude(editPrompt(s, next, request));
      if (reply) {
        try {
          const got = cleanScene(extractJson(reply), next.duration, s);
          if (got) { next = { ...got, duration: next.duration }; byClaude = true; how = 'Claude'; }
        } catch (err) { console.warn(`[inkframe] Claude's edit was unusable: ${(err as Error).message}`); }
      }
      if (/голос|voice/i.test(request)) voiceOther = !voiceOther;
      if (!byClaude) {
        const ruled = editByRules(next, request);
        if (!ruled.understood && !patch) {
          this.update(e, id, 'err', `Не понял правку сцены ${n} без Claude`, 'Напишите «реплика: …» или «подпись: …», или «ночь», «крупнее герой», «медленнее», «веселее», «другой голос»');
          return;
        }
        next = ruled.scene; how = how || 'по правилам';
      }
    }
    next.spec = cleanSpec(next.spec);
    if (s.hero === 'none') next.spec.hero = false;
    const revoice = next.line !== r.board.line || voiceOther !== r.voiceOther || next.spec.pace !== r.board.spec.pace;
    r.board = next;
    r.voiceOther = voiceOther;
    this.emit(e, { type: 'scene.board', n, patch: this.boardPatch(e, i) });
    if (revoice && s.voice !== 'none') await this.voiceAll(e, [i]);   // the scene keeps its storyboard length or stretches to the new voice
    if (e.state.video || e.state.review) {
      this.emit(e, { type: 'video', src: '' }); this.emit(e, { type: 'status', status: 'ready' });
      this.setStage(e, 'compose', 'pending'); this.setStage(e, 'review', 'pending');
    }
    this.update(e, id, 'run', `Перерисовываю сцену ${n}`);
    r.version++;
    this.setStage(e, 'paint', 'in_progress');
    await this.draw(e, i, () => {});
    this.update(e, `scene-${n}`, 'ok', `Сцена ${n} готова начерно`, '');   // draw() left the scene's own line «running»
    this.setStage(e, 'paint', 'completed');
    this.emit(e, { type: 'scene.edited', n, request: what });
    this.update(e, id, 'ok', `Сцена ${n} перерисована: «${what}»`, how === 'Claude' ? 'Правку понял Claude' : how === 'по правилам' ? 'Claude недоступен — правка по правилам' : '');
  }

  private boardOf(e: Entry, i: number) { return { n: i + 1, ...this.boardPatch(e, i) }; }
  private boardPatch(e: Entry, i: number) {
    const b = e.scenes[i].board, starts = this.starts(e);
    return { title: b.title, line: b.line, visual: describe(b.spec, e.state.settings.language), caption: b.spec.template === 'card' ? b.spec.title : b.spec.caption ?? '', start: starts[i], duration: b.duration };
  }

  // ---------- the cut ----------
  private async cut(e: Entry) {
    const s = e.state.settings, id = `build-${++e.cut}`, starts = this.starts(e), total = this.total(e);
    this.emit(e, { type: 'status', status: 'building' });
    this.setStage(e, 'compose', 'in_progress');
    this.step(e, id, 'Рисую сцены начисто и склеиваю MP4', 'run', '0 %');
    try {
      mkdirSync(join(e.dir, 'clips'), { recursive: true });
      const w = this.finalWidth, opts: FrameOptions = { rs: Number(process.env.INKFRAME_FINAL_RS) || .5, width: w, quality: .9 };
      const jobs = e.scenes.map((r, i) => {
        const len = r.board.duration + (i < e.scenes.length - 1 ? OVERLAP : 0), stage = this.stage(r, { fast: process.env.INKFRAME_WATERCOLOR !== '1' });
        // the renderer's version is in the key: after a change to renderer/** every clip is painted again
        const key = hash(JSON.stringify([stage, len, w, this.rendererVersion ??= rendererVersion()])).slice(0, 12);
        return { i, len, stage, clip: `clips/s${i + 1}-${key}.mp4`, frames: Math.round(len * FINAL_FPS) };
      });
      const todo = jobs.filter(j => !existsSync(join(e.dir, j.clip))), all = todo.reduce((a, j) => a + j.frames, 0) || 1;
      let done = 0;
      for (const j of todo) {
        const tmp = join(e.dir, 'tmp', `s${j.i + 1}`);
        rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
        this.update(e, id, 'run', `Рисую начисто сцену ${j.i + 1} из ${jobs.length}`);
        const times = Array.from({ length: j.frames }, (_, k) => round3(k / FINAL_FPS));
        await this.tools.painter.frames(j.stage, times, opts, (k, jpg) => {
          writeFileSync(join(tmp, `f${String(k).padStart(5, '0')}.jpg`), jpg);
          if (++done % 6 === 0) this.update(e, id, 'run', undefined, `${Math.round(done / all * 85)} %`);
        });
        await this.tools.ffmpeg(['-framerate', String(FINAL_FPS), '-i', join(tmp, 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', join(e.dir, j.clip)]);
        rmSync(tmp, { recursive: true, force: true });
      }
      this.update(e, id, 'run', 'Свожу голос, музыку и субтитры', '88 %');
      // sound: the voice on its timeline, the music bed ducked under it
      const clips: { at: number; pcm: Float32Array }[] = [];
      for (const [i, r] of e.scenes.entries()) if (r.audio) clips.push({ at: starts[i] + LEAD, pcm: await this.tools.decode(r.audio.base + '.mp3') });
      const voice = place(total, clips), bed = s.music !== 'none' ? music(total, s.music === 'calm' ? 'calm' : 'upbeat') : undefined;
      const hasSound = clips.length > 0 || !!bed;
      if (hasSound) writeWav(join(e.dir, 'sound.wav'), mixDown(voice, bed));
      const cues = e.scenes.flatMap((r, i) => (r.audio ? cuesFor(r.board.line, r.audio.words, starts[i] + LEAD) : []));
      if (cues.length) writeAss(join(e.dir, 'subtitles.ass'), cues);
      const out = `cut-${e.cut}.mp4`, src = `/api/projects/${e.state.id}/files/${out}`;
      await this.tools.ffmpeg(cutArgs({ clips: jobs.map(j => j.clip), starts, total, audio: hasSound ? 'sound.wav' : undefined, ass: cues.length ? 'subtitles.ass' : undefined, out }), e.dir);
      for (const f of readdirSync(e.dir)) if (/^cut-\d+\.mp4$/.test(f) && f !== out) rmSync(join(e.dir, f), { force: true });
      const used = new Set(jobs.map(j => j.clip.slice(6)));
      for (const f of readdirSync(join(e.dir, 'clips'))) if (!used.has(f)) rmSync(join(e.dir, 'clips', f), { force: true });
      rmSync(join(e.dir, 'tmp'), { recursive: true, force: true });
      const what = `${fmtSec(total)} · ${w}×${Math.round(w * 9 / 16)} · ${[clips.length && 'голос', bed && 'музыка', cues.length && 'субтитры'].filter(Boolean).join(', ') || 'без звука'}${todo.length < jobs.length ? ` · перерисовано сцен: ${todo.length} из ${jobs.length}` : ''}`;
      this.update(e, id, 'ok', 'MP4 склеен — проверяю, прежде чем отдать', what);
      this.setStage(e, 'compose', 'completed');

      // the self-review: the MP4 is handed out only when nothing in it is broken
      const rid = `review-${e.cut}`;
      this.setStage(e, 'review', 'in_progress');
      this.step(e, rid, 'Проверяю готовый ролик', 'run', 'длина, чёрные и пустые кадры, голос под репликами, громкость, субтитры');
      const plan: ReviewPlan = {
        file: join(e.dir, out), src, width: w, height: Math.round(w * 9 / 16), fps: 24, duration: total,
        scenes: e.scenes.map((r, i) => ({ n: i + 1, start: starts[i], duration: r.board.duration, dark: DARK_SETTINGS.includes(r.board.spec.setting) })),
        lines: e.scenes.flatMap((r, i) => (r.board.line.trim()
          ? [{ n: i + 1, start: round3(starts[i] + LEAD), end: round3(starts[i] + (r.audio ? LEAD + r.audio.dur : r.board.duration - TAIL)), voiced: !!r.audio }] : [])),
        voice: s.voice !== 'none', sound: hasSound,
        ...(cues.length && { subtitles: { file: join(e.dir, 'subtitles.ass'), burned: true } }),
      };
      let review: Review;
      try { review = await this.tools.review(plan); } catch (err) { review = reviewCrashed(src, err); }
      writeFileSync(join(e.dir, 'review.json'), JSON.stringify(review, null, 1));
      if (review.decision === 'FAIL' && e.state.video) this.emit(e, { type: 'video', src: '' });   // the previous MP4 is gone from disk too
      this.emit(e, { type: 'review', review });
      const said = (ok: boolean) => review.checks.filter(c => !c.ok && (ok ? c.warn : !c.warn)).map(c => c.detail).join('; ');
      if (review.decision === 'FAIL') {
        // scenes whose picture is broken are painted again on the next cut, not taken from the cache
        const bad = new Set(review.checks.filter(c => !c.ok && !c.warn && (c.id === 'black' || c.id === 'blank'))
          .flatMap(c => c.at ?? []).map(t => starts.filter(a => a <= t + .001).length - 1).filter(i => i >= 0));
        for (const i of bad) rmSync(join(e.dir, jobs[i].clip), { force: true });
        const again = bad.size ? ` При следующей сборке перерисую ${bad.size > 1 ? 'сцены' : 'сцену'} ${[...bad].map(i => i + 1).join(', ')}.` : '';
        this.update(e, rid, 'err', 'Проверка не пройдена — MP4 не отдаю', said(false) + '.' + again);
        this.update(e, id, 'err', 'MP4 склеен, но с ошибками — не отдаю', what);
        this.setStage(e, 'review', 'failed');
        e.cutQueued = false;   // «Собрать MP4» may be pressed again the moment the studio hears `ready`
        this.emit(e, { type: 'status', status: 'ready' });
        return;
      }
      this.update(e, rid, 'ok', review.decision === 'PASS' ? 'Проверил ролик: всё в порядке' : 'Проверил ролик: есть замечания', review.decision === 'PASS' ? '' : said(true));
      this.setStage(e, 'review', 'completed');
      this.emit(e, { type: 'video', src });
      this.update(e, id, 'ok', 'MP4 готов — можно скачать', what);
      e.cutQueued = false;
      this.emit(e, { type: 'status', status: 'done' });
    } catch (err) {
      rmSync(join(e.dir, 'tmp'), { recursive: true, force: true });
      this.update(e, id, 'err', 'MP4 не собрался', (err as Error).message.slice(0, 200));
      if (e.state.stages.review.status === 'in_progress') this.setStage(e, 'review', 'failed');
      else this.setStage(e, 'compose', 'failed');
      this.emit(e, { type: 'status', status: 'ready' });
    }
  }

  // ---------- plumbing ----------
  private entry(id: string) {
    const e = this.projects.get(id);
    if (!e) throw new Error(`Project ${id} not found`);
    return e;
  }

  private enqueue(e: Entry, task: () => Promise<void>) {
    e.queue.push(task);
    if (!e.running) void this.next(e);
  }

  private async next(e: Entry) {
    const task = e.queue.shift();
    if (!task) { e.running = false; return; }
    e.running = true;
    try { await task(); }
    catch (err) {
      console.error('[inkframe]', err);
      this.step(e, `err-${Date.now()}`, 'Что-то пошло не так', 'err', (err as Error).message.slice(0, 200));
      if (canBuild({ ...e.state, status: 'ready' })) this.emit(e, { type: 'status', status: 'ready' });
    }
    this.save(e);
    void this.next(e);
  }

  private step(e: Entry, id: string, text: string, status: StepStatus, detail?: string) {
    const step: LogStep = { id, text, status, ...(detail !== undefined && { detail }) };
    this.emit(e, { type: 'log.add', step });
  }
  private update(e: Entry, id: string, status: StepStatus, text?: string, detail?: string) {
    this.emit(e, { type: 'log.update', id, status, ...(text !== undefined && { text }), ...(detail !== undefined && { detail }) });
  }

  private emit(e: Entry, ev: EngineEvent) {
    e.state = applyEvent(e.state, ev);
    const line = journalLine(ev);
    if (line) { try { e.store.log(line); } catch (err) { console.warn('[inkframe] events.jsonl:', (err as Error).message); } }
    for (const l of e.listeners) { try { l(ev); } catch { /* a closed stream */ } }
  }

  /** Writes a stage's status through the store (which refuses `completed` on an unapproved gate), then tells the studio. */
  private setStage(e: Entry, stage: StageId, status: StageStatus, extra?: Partial<Pick<Checkpoint, 'doneScenes'>>) {
    const cp = e.store.set(stage, status, extra);
    this.emit(e, { type: 'stage', stage, status, version: cp.version });
  }

  /** The project folder for the file route. */
  fileOf(id: string, rel: string): string | undefined {
    const e = this.projects.get(id);
    if (!e || !/^[\w./-]+$/.test(rel) || rel.includes('..')) return undefined;
    const f = resolve(e.dir, rel);
    return f.startsWith(e.dir + '/') && existsSync(f) ? f : undefined;
  }

  private save(e: Entry) {
    try { writeFileSync(join(e.dir, 'project.json'), JSON.stringify({ state: e.state, scenes: e.scenes, cut: e.cut, storyBy: e.storyBy })); }
    catch (err) { console.warn('[inkframe] could not save', e.state.id, (err as Error).message); }
  }

  private load() {
    for (const id of readdirSync(this.root)) {
      const f = join(this.root, id, 'project.json');
      if (!existsSync(f)) continue;
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'));
        const dir = join(this.root, id);
        const e: Entry = { ...j, listeners: new Set(), queue: [], running: false, cutQueued: false, dir, store: new StageStore(dir) };
        e.state = normalizeProject(e.state);   // projects made before Inkframe 3 have no stages
        if (['drafting', 'drawing', 'building'].includes(e.state.status)) {
          e.state = applyEvent(e.state, { type: 'log.add', step: { id: 'restart', text: 'Работа прервалась: сервер перезапускали', status: 'err' } });
          e.state = applyEvent(e.state, { type: 'status', status: canBuild({ ...e.state, status: 'ready' }) ? 'ready' : e.state.status === 'building' ? 'ready' : e.state.status });
        }
        this.projects.set(id, e);
      } catch { /* not a project */ }
    }
  }
}

/** What goes to events.jsonl: stages, gates, one line per scene step, cuts and errors — never single frames. */
function journalLine(ev: EngineEvent): Omit<LoggedEvent, 'at'> | undefined {
  switch (ev.type) {
    case 'stage': return { kind: 'stage', stage: ev.stage, payload: { status: ev.status, version: ev.version } };
    case 'gate': return { kind: 'gate', stage: ev.stage, payload: { open: ev.open, version: ev.version, ...(ev.open && { summary: ev.summary }) } };
    case 'scene.status': return { kind: 'scene', stage: 'paint', scene: ev.n, payload: { status: ev.status } };
    case 'scene.edited': return { kind: 'scene', stage: 'paint', scene: ev.n, payload: { edited: ev.request } };
    case 'video': return { kind: 'cut', stage: 'compose', payload: { src: ev.src } };
    case 'review': return { kind: 'review', stage: 'review', payload: { decision: ev.review.decision, video: ev.review.video, faults: ev.review.checks.filter(c => !c.ok).map(c => ({ id: c.id, warn: !!c.warn, detail: c.detail, ...(c.at && { at: c.at }) })) } };
    case 'log.add': return ev.step.status === 'err' ? { kind: 'error', payload: { text: ev.step.text, detail: ev.step.detail ?? '' } } : undefined;
    case 'log.update': return ev.status === 'err' ? { kind: 'error', payload: { id: ev.id, text: ev.text ?? '', detail: ev.detail ?? '' } } : undefined;
    default: return undefined;
  }
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const fmtSec = (s: number) => (s < 60 ? `${s.toFixed(1).replace('.', ',')} с` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
