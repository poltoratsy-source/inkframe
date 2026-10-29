// RealEngine: writes and paints the cartoon for real.
//   1. Claude (Claude Code CLI on this machine) writes the storyboard: scenes, lines, lengths and a SceneSpec per scene
//      (a template + setting + props + words, never free drawing code). If Claude can't be reached, a template
//      storyboard is used and the log says so.
//   2. edge-tts voices every line; scene lengths stretch to fit the voice.
//   3. Every scene is drafted on screen: a pencil sketch, then a low-res colour pass, streamed frame by frame.
//   4. editScene() changes one scene (by Claude, by simple rules, or by new words typed in) and redraws only it.
//   5. build() paints every scene at 12 fps in the project's format — 1280×720, 720×1280 or 720×720 (settings.format,
//      lib/formats.ts; scenes that didn't change come from the cache), then ffmpeg cuts them together with
//      cross-fades, the voice over a ducked music bed and burned-in subtitles placed for that format.
//   6. Every cut is checked before it is handed out (lib/real/review.ts → review.json): a FAIL keeps the MP4 off the
//      screen (status back to `ready`, the log says what is wrong, scenes with broken pictures are repainted next time).
// It emits the same events as DemoEngine, so the screens stay as they are. Projects live in INKFRAME_PROJECTS_DIR.
// Inkframe 3: the run goes through stages kept in projects/<id>/stages (lib/store/stages.ts) and stops at three gates
// (status `awaiting`), each answered with approve() or revise() (a note → the next version, the old one in history):
//   script      after the script is written; revise → Claude (or simple rules) rewrites it
//   storyboard  a contact sheet: one draft key frame per scene; approve → voice, every scene, the cut and its review;
//               revise → the scene specs change by the note (or per scene marked «перерисовать») and only the key
//               frames of the scenes that changed are painted again
//   final       the MP4 with its self-review (a FAIL never gets here); approve → done; revise → one scene is redone
//               by the note and the MP4 is cut and checked again
// Every gate shows an estimate of the rest of the run (lib/real/estimate.ts, estimate.json); budget mode `cap` refuses
// approve above the cap without allowOverCap. Choices go to decisions.jsonl («решение» lines in WorkLog).
// A restart resumes an unfinished stage: the script / storyboard is written again, paint and voice go on from the
// first unfinished scene, a cut repaints only the clips that are not in the cache; an open gate just waits.
// INKFRAME_GATES=off skips every gate.
// Everything the studio sees, except single frames, is journaled in events.jsonl (lib/engine/replay.ts): replay()
// folds it again with the same reducer, with the frames taken from each scene's own folder.
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyEvent, canBuild, emptyProject, normalizeProject } from './reducer';
import { libraryOf } from './library';
import { journalLine, replayFromJournal, spread, type Replay, type SceneFrames } from './replay';
import type { ApproveOptions, EngineEvent, LogStep, ProjectState, ProjectSummary, ReviseOptions, ScenePatch, StageId, StageStatus, StartSettings, StepStatus, StudioEngine } from './types';
import { StageStore, readBudget, readGatePolicy } from '../store/stages';
import { GateError } from '../store/gate';
import { STAGE_NAMES, approvedWord, type Approval, type BudgetPolicy, type Checkpoint, type Decision, type Estimate, type GatePolicy, type Review, type SceneNote } from '../store/types';
import { MUSIC_NAMES, OPTIONS, STYLES, VOICE_NAMES } from '../options';
import { askClaude } from '../real/claude';
import { Painter, rendererVersion, type FrameOptions } from '../real/painter';
import { SR, decode, envelope, mixDown, music, peaks, place, tts, voiceId, wordsOf, writeWav, type TtsJob, type Word } from '../real/audio';
import { FINAL_FPS, OVERLAP, cuesFor, cutArgs, ffmpeg, writeAss } from '../real/assemble';
import { cleanScene, cleanStoryboard, editByRules, editPrompt, extractJson, reviseByRules, revisePrompt, storyboardPrompt, templateStoryboard, type BoardScene, type Storyboard } from '../real/storyboard';
import { DARK_SETTINGS, TEMPLATES, cleanSpec, describe, words, type StageScene } from '../real/scene-spec';
import { reviewCrashed, reviewVideo, type ReviewPlan } from '../real/review';
import { SpeedLog, estimate, type EstimateScene } from '../real/estimate';
import { FORMATS, formatOf, sizeOf, type Format } from '../formats';

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
  /** observe / warn / cap and the cap in seconds (default: inkframe.config.json + INKFRAME_BUDGET, see readBudget) */
  budget?: BudgetPolicy;
}

const LEAD = .35, TAIL = .55;   // silence before and after each line inside its scene
const DRAFT: FrameOptions = { rs: .25, width: 640, quality: .82 };   // 16:9; other formats keep the 360 short side
const DRAFT_SHORT = 360;
const round1 = (x: number) => Math.round(x * 10) / 10;

interface RScene { board: BoardScene; planned: number; version: number; voiceOther?: boolean; audio?: { base: string; dur: number; words: Word[] }; env: string }
interface Entry {
  state: ProjectState; listeners: Set<(ev: EngineEvent) => void>; queue: (() => Promise<void>)[]; running: boolean;
  scenes: RScene[]; dir: string; cut: number; cutQueued?: boolean; storyBy?: Storyboard['by'];
  store: StageStore;
  /** Claude requests made for this cartoon (the estimate shows them) */
  claudeCalls: number;
  /** the estimate of the work under way and when it started; the fact is filled in when it is over */
  plan?: Estimate; workStart?: number; parts?: { voice: number; paint: number; cut: number };
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
  private budget: BudgetPolicy;
  private speed: SpeedLog;
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
    this.budget = o.budget ?? readBudget();
    this.rendererVersion = o.rendererVersion;
    this.tools = {
      ask: p => askClaude(p), voice: tts, decode, ffmpeg, review: reviewVideo,
      painter: o.tools?.painter ?? new Painter({ workers: Number(process.env.INKFRAME_RENDER_WORKERS) || 3, log: s => console.warn(s) }),
      ...o.tools,
    } as RealTools;
    mkdirSync(this.root, { recursive: true });
    this.speed = new SpeedLog(join(this.root, '.speed.json'));
    this.load();
  }

  // ---------- StudioEngine ----------
  create(settings: StartSettings): ProjectState {
    if (!settings.idea?.trim()) throw new Error('The idea is empty');
    const id = randomUUID().slice(0, 8), dir = join(this.root, id);
    mkdirSync(dir, { recursive: true });
    const e: Entry = { state: emptyProject(id, settings, 'real'), listeners: new Set(), queue: [], running: false, scenes: [], dir, cut: 0, store: new StageStore(dir), claudeCalls: 0 };
    this.projects.set(id, e);
    this.enqueue(e, () => this.run(e));
    return e.state;
  }

  get(id: string) { return this.projects.get(id)?.state; }

  list(): ProjectSummary[] {
    return libraryOf([...this.projects.values()].map(e => e.state));
  }

  /** The run from events.jsonl; frames from each scene's newest folder (frames/s<n>-v<version>/), never from the journal. */
  replay(id: string): Replay | undefined {
    const e = this.projects.get(id);
    if (!e) return undefined;
    const frames: Record<number, SceneFrames> = {}, root = join(e.dir, 'frames');
    const dirs = existsSync(root) ? readdirSync(root) : [];
    for (const sc of e.state.scenes) {
      const v = dirs.map(d => d.match(new RegExp(`^s${sc.n}-v(\\d+)$`))?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
      if (!v) continue;
      const rel = `frames/s${sc.n}-v${v}`, files = readdirSync(join(e.dir, rel)).sort(), url = (f: string) => `/api/projects/${id}/files/${rel}/${f}`;
      frames[sc.n] = { sketch: spread(files.filter(f => f.startsWith('sketch-')), 8).map(url), color: spread(files.filter(f => f.startsWith('color-')), 8).map(url) };
    }
    return replayFromJournal(e.state, e.store.events(), frames);
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
    if (e.state.gate) throw new GateError(`Сейчас открыто утверждение «${STAGE_NAMES[e.state.gate.stage]}» — замечания пишите на его панели`, 409);
    const req = request.trim().slice(0, 300), hasPatch = !!(patch && (patch.line?.trim() || patch.caption !== undefined));
    if (!req && !hasPatch) throw new Error('The edit request is empty');
    if (e.state.scenes.length ? !e.state.scenes.some(sc => sc.n === n) : n < 1 || n > 12) throw new Error(`No scene ${n} in this project`);
    this.enqueue(e, async () => { await this.edit(e, n, req, hasPatch ? patch : undefined); });
  }

  build(id: string) {
    const e = this.entry(id);
    if (!canBuild(e.state)) throw new Error('The cartoon is not ready to build yet');
    if (e.cutQueued) return;   // a second click while the cut is on its way
    e.cutQueued = true;
    this.enqueue(e, () => this.cut(e).finally(() => { e.cutQueued = false; }));
  }

  approve(id: string, stage: StageId, version: number, note?: string, o: ApproveOptions = {}): ProjectState {
    const e = this.entry(id);
    // the store refuses an estimate over the cap without the human's permission (409), whoever calls
    const { cp, changed } = e.store.approve(stage, version, note, o.allowOverCap === true);
    if (!changed) return e.state;
    e.store.log({ kind: 'gate', stage, payload: { decision: 'approve', version, ...(cp.approval?.note && { note: cp.approval.note }), ...(cp.approval?.overCap && { overCap: true }) } });
    this.emit(e, { type: 'stage', stage, status: 'completed', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    const said = [cp.approval?.note && `«${cp.approval.note}»`, cp.approval?.overCap && 'выше лимита — с вашего разрешения'].filter(Boolean).join(' · ');
    this.update(e, `gate-${stage}-v${version}`, 'ok', stage === 'final' ? `Финал v${version} утверждён — ролик отдан` : `${STAGE_NAMES[stage]} v${version} ${approvedWord(stage)}`, said);
    if (stage === 'final') {
      this.emit(e, { type: 'status', status: 'done' });
    } else if (stage === 'script') {
      if (!this.gates.storyboard) this.startWork(e, cp.estimate);
      this.enqueue(e, () => this.afterScript(e));
    } else if (stage === 'storyboard') {
      this.startWork(e, cp.estimate);
      this.enqueue(e, () => this.produce(e, { cut: true }));
    }
    this.save(e);
    return e.state;
  }

  revise(id: string, stage: StageId, version: number, note: string, o: ReviseOptions = {}): ProjectState {
    const e = this.entry(id);
    // the final gate redoes one scene: which one is known before anything is written
    const redo = stage === 'final' ? this.sceneOf(e, note, o.scenes) : undefined;
    if (stage === 'final' && !redo) throw new GateError('Выберите сцену, которую переделать (или начните замечание со слов «сцена 2: …»)', 400);
    const cp = e.store.revise(stage, version, note, o.scenes), text = cp.approval!.note!;
    e.store.log({ kind: 'gate', stage, payload: { decision: 'revise', version, note: text, ...(cp.approval?.scenes && { scenes: cp.approval.scenes }) } });
    this.emit(e, { type: 'stage', stage, status: 'revised', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.update(e, `gate-${stage}-v${version}`, 'ok', `${STAGE_NAMES[stage]} v${version} вернули с замечанием`, `«${text}»`);
    this.emit(e, { type: 'status', status: stage === 'final' ? 'drawing' : 'drafting' });
    this.save(e);
    if (stage === 'script') this.enqueue(e, () => this.rewrite(e, text));
    else if (stage === 'storyboard') this.enqueue(e, () => this.reviseBoard(e, cp.approval!));
    else if (stage === 'final') this.enqueue(e, () => this.redoFinal(e, redo!.n, redo!.note));
    return e.state;
  }

  /** The scene a final-gate note is about: picked in the panel, or «сцена 2: …» at the start of the note. */
  private sceneOf(e: Entry, note: string, scenes?: SceneNote[]): SceneNote | undefined {
    const picked = scenes?.find(x => Number.isInteger(x.n));
    const m = note.trim().match(/^(?:сцен[аеуы]?|scene)\s*(\d+)\s*[:—,.-]?\s*(.*)$/is);
    const n = picked?.n ?? (m ? Number(m[1]) : NaN), text = (picked?.note?.trim() || (m && !picked ? m[2] : note)).trim();
    return n >= 1 && n <= e.scenes.length && text ? { n, note: text.slice(0, 300) } : undefined;
  }

  // ---------- the run ----------
  private async run(e: Entry) {
    const s = e.state.settings;
    this.emit(e, { type: 'status', status: 'drafting' });
    this.step(e, 'read', 'Прочитал идею и настройки', 'ok');
    this.setStage(e, 'brief', 'completed');
    this.setStage(e, 'script', 'in_progress');
    this.step(e, 'script', 'Пишу сценарий и раскадровку', 'run', `«${e.state.title}»`);
    const board = await this.storyboard(e);
    this.useBoard(e, board);
    this.update(e, 'script', 'ok', `Написал сценарий: ${e.scenes.length} ${plural(e.scenes.length, 'сцена', 'сцены', 'сцен')}`,
      board.by === 'claude' ? 'Claude' : 'Claude недоступен — раскадровка по шаблону');
    this.settingsDecisions(e);
    if (board.by !== 'claude') this.decide(e, { stage: 'script', what: 'fallback', chosen: 'сценарий по шаблону вместо Claude', alternatives: ['Claude'], reason: this.useClaude ? 'Claude не ответил — раскадровка собрана по шаблону' : 'Claude выключен (INKFRAME_STORYBOARD=template)', confidence: 'low' });
    this.templateDecisions(e, 'script');
    this.save(e);
    await this.scriptWritten(e);
  }

  /** New scenes on the screen. `keep`: key frames of scenes that did not change (storyboard revise). */
  private useBoard(e: Entry, board: Storyboard, keep: Map<number, string> = new Map()) {
    e.storyBy = board.by;
    e.scenes = board.scenes.map(b => ({ board: b, planned: b.duration, version: 1, env: '' }));
    this.layout(e);
    this.emit(e, { type: 'storyboard', title: board.title, scenes: e.scenes.map((_, i) => this.boardOf(e, i)) });
    for (const [n, src] of keep) if (n <= e.scenes.length) this.emit(e, { type: 'scene.key', n, src });
  }

  /** The script is on the screen: stop at its gate, or go straight on when the script gate is off. */
  private async scriptWritten(e: Entry) {
    const gated = this.gates.script;
    const est = gated ? this.showEstimate(e, 'script') : undefined;
    const cp = e.store.open('script', { title: e.state.title, by: e.storyBy, scenes: e.scenes.map(r => r.board) }, gated, est);
    if (!gated) {
      this.emit(e, { type: 'stage', stage: 'script', status: 'completed', version: cp.version });
      if (!this.gates.storyboard) this.startWork(e, this.showEstimate(e, 'script'));
      return this.afterScript(e);
    }
    const n = e.scenes.length;
    const summary = `${n} ${plural(n, 'сцена', 'сцены', 'сцен')}, ${fmtSec(this.total(e))}. ${e.storyBy === 'claude' ? 'Сценарий написал Claude.' : 'Claude недоступен — сценарий собран по шаблону.'} `
      + (this.gates.storyboard
        ? 'Прочитайте реплики: после «Утвердить» Клод нарисует по одному ключевому кадру на сцену — раскадровку. Если что-то не так — верните с замечанием, сценарий перепишется.'
        : 'Прочитайте реплики: после «Утвердить» Клод озвучит их и нарисует сцены. Если что-то не так — верните с замечанием, сценарий перепишется.');
    this.emit(e, { type: 'stage', stage: 'script', status: 'awaiting', version: cp.version });
    this.emit(e, { type: 'gate', stage: 'script', version: cp.version, open: true, summary });
    this.step(e, `gate-script-v${cp.version}`, `Сценарий v${cp.version} ждёт вашего решения`, 'wait', 'Рисовать не начинаю, пока не утвердите или не вернёте с замечанием');
    this.emit(e, { type: 'status', status: 'awaiting' });
  }

  /** The script came back with a note: Claude rewrites it; without Claude, simple rules, and the log says so. */
  private async rewrite(e: Entry, note: string) {
    const v = (e.store.get('script')?.version ?? 1) + 1, id = `script-v${v}`;
    this.line(e, id, 'Переписываю сценарий по замечанию', 'run', `«${note}»`);
    const before = e.scenes.map(r => r.board.spec.template);
    const { board: next, how, byClaude } = await this.reviseWhole(e, note);
    this.useBoard(e, next);
    this.update(e, id, 'ok', `Переписал сценарий: версия ${v}`, how);
    if (!byClaude) this.decide(e, { stage: 'script', what: 'fallback', chosen: 'замечание по простым правилам вместо Claude', alternatives: ['Claude'], reason: how, confidence: 'low' });
    this.templateDecisions(e, 'script', e.scenes.map((_, i) => i).filter(i => before[i] !== e.scenes[i].board.spec.template));
    this.save(e);
    await this.scriptWritten(e);
  }

  /** The whole board rewritten by a note: Claude, or simple rules when it can't be reached. */
  private async reviseWhole(e: Entry, note: string): Promise<{ board: Storyboard; how: string; byClaude: boolean }> {
    const s = e.state.settings;
    const current: Storyboard = { title: e.state.title, by: e.storyBy ?? 'template', scenes: e.scenes.map(r => ({ ...r.board, duration: r.planned })) };
    const reply = await this.claude(revisePrompt(s, current, note), e);
    if (reply) {
      try { return { board: cleanStoryboard(extractJson(reply), s), how: 'Claude учёл замечание', byClaude: true }; }
      catch (err) { console.warn(`[inkframe] Claude's rewrite was unusable: ${(err as Error).message}`); }
    }
    const r = reviseByRules(current, note);
    return {
      board: { ...r.board, by: 'template' }, byClaude: false,
      how: r.understood ? 'Claude недоступен — замечание учтено по простым правилам' : 'Claude недоступен, а без него замечание не понял — сценарий прежний',
    };
  }

  /** After the approved script: the contact sheet (storyboard gate), or straight to voice and paint without it. */
  private async afterScript(e: Entry) {
    if (!this.gates.storyboard) {
      const cp = e.store.open('storyboard', { by: e.storyBy, scenes: this.sheet(e) }, false);
      this.emit(e, { type: 'stage', stage: 'storyboard', status: 'completed', version: cp.version });
      return this.produce(e);
    }
    this.emit(e, { type: 'status', status: 'drafting' });
    await this.keyframes(e);
    await this.storyboardReady(e);
  }

  // ---------- the storyboard gate ----------
  /** The moment of a scene its key frame shows: late enough that the host and the props have arrived. */
  private keyTime(r: RScene) { return round3(r.board.duration * (r.board.spec.template === 'card' ? .75 : .6)); }

  /** One draft frame per scene (all in parallel), cached by what it shows: an unchanged scene is never painted twice.
   *  doneScenes in stages/storyboard.json is the resume point. */
  private async keyframes(e: Entry, only?: number[]) {
    const prev = e.store.get('storyboard'), revising = prev?.status === 'revised';
    const todo = only ?? e.scenes.map((_, i) => i), done: number[] = [];
    if (!todo.length) return;
    const id = `keys-${Date.now()}`;
    if (!revising) this.setStage(e, 'storyboard', 'in_progress', { doneScenes: [] });
    this.step(e, id, only ? `Перерисовываю ключевые кадры: ${scenesWord(todo.map(i => i + 1))}` : 'Рисую раскадровку: по одному ключевому кадру на сцену', 'run', 'начерно, без голоса — чтобы проверить картинку до полной отрисовки');
    mkdirSync(join(e.dir, 'frames', 'key'), { recursive: true });
    for (const i of todo) this.emit(e, { type: 'scene.key', n: i + 1, src: '' });
    let painted = 0;
    // no speed sample here: single frames on fresh pages measure the browser's start, not the painting
    await Promise.all(todo.map(async i => {
      const r = e.scenes[i], n = i + 1, st = this.stage(e, r, { fast: true }), t = this.keyTime(r);
      const rel = `frames/key/s${n}-${hash(JSON.stringify([st, t])).slice(0, 10)}.jpg`;
      if (!existsSync(join(e.dir, rel))) {
        painted++;
        await this.tools.painter.frames(st, [t], this.draft(e), (_k, jpg) => { writeFileSync(join(e.dir, rel), jpg); });
      }
      this.emit(e, { type: 'scene.key', n, src: `/api/projects/${e.state.id}/files/${rel}` });
      done.push(n);
      const cur = e.store.get('storyboard');
      if (cur && !revising) e.store.set('storyboard', cur.status, { doneScenes: [...done].sort((a, b) => a - b) });
    }));
    this.update(e, id, 'ok', only ? `Перерисовал ключевые кадры: ${scenesWord(todo.map(i => i + 1))}` : `Нарисовал раскадровку: ${todo.length} ${plural(todo.length, 'кадр', 'кадра', 'кадров')}`,
      painted < todo.length ? `${todo.length - painted} — из прошлой версии: эти сцены не менялись` : '');
    this.save(e);
  }

  /** What the contact sheet shows, scene by scene (the storyboard checkpoint's artifact). */
  private sheet(e: Entry) {
    const starts = this.starts(e);
    return e.scenes.map((r, i) => ({ n: i + 1, title: r.board.title, line: r.board.line, start: starts[i], duration: r.board.duration, template: r.board.spec.template, frame: e.state.scenes[i]?.key }));
  }

  private async storyboardReady(e: Entry) {
    const est = this.showEstimate(e, 'storyboard');
    const cp = e.store.open('storyboard', { by: e.storyBy, scenes: this.sheet(e) }, true, est);
    const n = e.scenes.length;
    const summary = `Раскадровка: ${n} ${plural(n, 'кадр', 'кадра', 'кадров')} — по одному на сцену, начерно и без голоса. Проверьте, что нарисовано и в каком порядке. `
      + 'После «Утвердить» Клод озвучит реплики, нарисует сцены целиком, соберёт MP4 и проверит его. Не так — напишите замечание или отметьте сцены «перерисовать»: перерисуются только они.';
    this.emit(e, { type: 'stage', stage: 'storyboard', status: 'awaiting', version: cp.version });
    this.emit(e, { type: 'gate', stage: 'storyboard', version: cp.version, open: true, summary });
    this.step(e, `gate-storyboard-v${cp.version}`, `Раскадровка v${cp.version} ждёт вашего решения`, 'wait', 'Полностью рисовать не начинаю, пока не утвердите или не вернёте с замечанием');
    this.emit(e, { type: 'status', status: 'awaiting' });
    this.save(e);
  }

  /** The storyboard came back: scenes marked one by one are changed by their own notes, a general note by Claude
   *  (or simple rules) over the whole board; then only the key frames of scenes that changed are painted again. */
  private async reviseBoard(e: Entry, a: Approval) {
    const v = (e.store.get('storyboard')?.version ?? 1) + 1, id = `storyboard-v${v}`;
    const marks = a.scenes ?? [], general = marks.length && a.note === marksText(marks) ? '' : (a.note ?? '');
    this.line(e, id, 'Правлю раскадровку по замечанию', 'run', `«${a.note ?? ''}»`);
    const sig = (b: BoardScene) => JSON.stringify([b.title, b.line, b.duration, b.spec]);
    const before = e.scenes.map(r => sig({ ...r.board, duration: r.planned })), templates = e.scenes.map(r => r.board.spec.template);
    const oldKeys = e.state.scenes.map(sc => sc.key);
    const how: string[] = [];
    let ruled = false;
    for (const m of marks) {
      const r = e.scenes[m.n - 1];
      if (!r) continue;
      const got = await this.editBoard(e, { ...r.board, duration: r.planned }, m.note);
      if (got.by === 'none') { how.push(`сцена ${m.n}: без Claude не понял «${m.note}»`); ruled = true; continue; }
      r.board = got.scene; r.planned = got.scene.duration;
      if (got.voice) r.voiceOther = !r.voiceOther;
      how.push(got.by === 'claude' ? `сцена ${m.n}: Claude` : `сцена ${m.n}: по простым правилам`);
      if (got.by === 'rules') ruled = true;
    }
    let board: Storyboard = { title: e.state.title, by: e.storyBy ?? 'template', scenes: e.scenes.map(r => ({ ...r.board, duration: r.planned })) };
    if (general) {
      const w = await this.reviseWhole(e, general);
      board = w.byClaude ? w.board : { ...w.board, by: e.storyBy ?? 'template' };
      how.push(w.how);
      if (!w.byClaude) ruled = true;
    }
    const same = board.scenes.length === before.length;
    const changed = board.scenes.map((_, i) => i).filter(i => !same || sig(board.scenes[i]) !== before[i]);
    const keep = new Map<number, string>();
    if (same) for (const [i, k] of oldKeys.entries()) if (k && !changed.includes(i)) keep.set(i + 1, k);
    const voices = e.scenes.map(r => r.voiceOther);
    this.useBoard(e, board, keep);
    if (same) for (const [i, r] of e.scenes.entries()) r.voiceOther = voices[i];
    if (ruled) this.decide(e, { stage: 'storyboard', what: 'fallback', chosen: 'замечание по простым правилам вместо Claude', alternatives: ['Claude'], reason: how.join('; '), confidence: 'low' });
    this.templateDecisions(e, 'storyboard', changed.filter(i => !same || templates[i] !== e.scenes[i].board.spec.template));
    await this.keyframes(e, changed);
    this.update(e, id, 'ok', `Раскадровка v${v}: ${changed.length ? `изменил ${changed.length > 1 ? 'сцены' : 'сцену'} ${changed.map(i => i + 1).join(', ')}` : 'сцены не изменились'}`, how.join('; '));
    await this.storyboardReady(e);
  }

  /** One scene changed by a note: Claude, or the edit rules. `by: 'none'` = not understood, nothing changed. */
  private async editBoard(e: Entry, scene: BoardScene, request: string): Promise<{ scene: BoardScene; by: 'claude' | 'rules' | 'none'; voice?: boolean }> {
    const s = e.state.settings;
    const reply = await this.claude(editPrompt(s, scene, request), e);
    if (reply) {
      try {
        const got = cleanScene(extractJson(reply), scene.duration, s);
        if (got) return { scene: { ...got, duration: scene.duration }, by: 'claude' };
      } catch (err) { console.warn(`[inkframe] Claude's edit was unusable: ${(err as Error).message}`); }
    }
    const ruled = editByRules(scene, request);
    return ruled.understood ? { scene: ruled.scene, by: 'rules', voice: ruled.voice === 'other' } : { scene, by: 'none' };
  }

  // ---------- the final gate ----------
  /** The checked MP4 waits for the human: approve hands it out, revise redoes one scene and cuts again. */
  private finalGate(e: Entry, src: string, review: Review, what: string) {
    const est = e.store.estimate();
    const cp = e.store.open('final', { video: src, review: review.decision, what }, true, est?.actualSec !== undefined ? est : undefined);
    const summary = (review.decision === 'PASS' ? 'MP4 собран и проверен: ошибок нет. ' : 'MP4 собран, у проверки есть замечания — они справа, время в них перематывает видео. ')
      + 'Посмотрите ролик: «Утвердить» — ролик готов, его можно скачать. Не так — выберите сцену и напишите, что переделать: Клод перерисует её и соберёт MP4 заново.';
    this.emit(e, { type: 'stage', stage: 'final', status: 'awaiting', version: cp.version });
    this.emit(e, { type: 'gate', stage: 'final', version: cp.version, open: true, summary });
    this.step(e, `gate-final-v${cp.version}`, `Финал v${cp.version} ждёт вашего решения`, 'wait', 'Ролик отдам, когда утвердите');
    this.emit(e, { type: 'status', status: 'awaiting' });
  }

  /** The final MP4 came back with a note on one scene: redo it (Claude or rules), then cut and check again. */
  private async redoFinal(e: Entry, n: number, note: string) {
    const changed = await this.edit(e, n, note);
    if (!changed) {
      // nothing changed (the note was not understood without Claude): the same MP4 goes back to the gate as it is
      const prev = e.store.get('final')?.artifact as { video: string; what: string } | undefined, r = e.state.review;
      if (prev && r) return this.finalGate(e, prev.video, r, prev.what);
    }
    e.cutQueued = true;
    try { await this.cut(e); } finally { e.cutQueued = false; }
  }

  /** Everything after the approved storyboard (or script): voice, the sketch and colour drafts of every scene, music;
   *  with `cut` (the storyboard gate was approved) the MP4 is cut and checked right after. `resume`: after a restart,
   *  the voice is not redone when it was finished and only the scenes missing from paint's doneScenes are drawn. */
  private async produce(e: Entry, o: { cut?: boolean; resume?: boolean } = {}) {
    const s = e.state.settings;
    this.emit(e, { type: 'status', status: 'drawing' });
    const voiced = o.resume && e.store.get('voice')?.status === 'completed' && e.scenes.every(r => r.audio || !r.board.line.trim());
    if (s.voice !== 'none' && !voiced) {
      this.setStage(e, 'voice', 'in_progress');
      const t = Date.now(), ok = await this.voiceAll(e);
      if (e.parts) e.parts.voice += (Date.now() - t) / 1000;
      this.setStage(e, 'voice', ok ? 'completed' : 'failed');
      this.save(e);
    } else if (s.voice === 'none') this.setStage(e, 'voice', 'completed');
    const was = o.resume ? e.store.get('paint')?.doneScenes ?? [] : [];
    const doneScenes = was.filter(n => n <= e.scenes.length), todo = e.scenes.map((_, i) => i).filter(i => !doneScenes.includes(i + 1));
    for (const i of todo) this.line(e, `scene-${i + 1}`, `Сцена ${i + 1} — в очереди`, 'wait');
    if (s.music !== 'none') this.line(e, 'music', 'Музыка и сведение звука', 'wait');

    const units = todo.reduce((a, i) => a + this.draftTimes(e.scenes[i].board.duration).length + this.sketchFrames, 0) || 1;
    const t0 = Date.now(); let done = 0;
    this.setStage(e, 'paint', 'in_progress', { doneScenes: [...doneScenes] });
    for (const i of todo) {
      await this.draw(e, i, () => {
        done++;
        const left = (Date.now() - t0) / done * (units - done) / 1000;
        this.emit(e, { type: 'progress', value: +(done / units * .96).toFixed(3), etaSec: Math.round(left + 2) });
      });
      doneScenes.push(i + 1);
      e.store.set('paint', 'in_progress', { doneScenes: [...doneScenes].sort((a, b) => a - b) });
      this.update(e, `scene-${i + 1}`, 'ok', `Сцена ${i + 1} готова начерно`, '');
      this.save(e);   // the resume point: a restart draws only the scenes after this one
    }
    if (e.parts) e.parts.paint += (Date.now() - t0) / 1000;
    this.setStage(e, 'paint', 'completed');
    if (s.music !== 'none') {
      this.update(e, 'music', 'run', `Подбираю музыку · ${MUSIC_NAMES[s.music]}, свожу с голосом`);
      this.emit(e, { type: 'track', kind: 'music', peaks: peaks(music(this.total(e), s.music === 'calm' ? 'calm' : 'upbeat')) });
      this.update(e, 'music', 'ok', `Музыка · ${MUSIC_NAMES[s.music]}, приглушена под голос`);
    }
    this.emit(e, { type: 'progress', value: 1, etaSec: 0 });
    if (o.cut) {
      this.line(e, 'ready', 'Все сцены готовы начерно — собираю MP4', 'ok', `Ролик: ${fmtSec(this.total(e))}`);
      this.save(e);
      e.cutQueued = true;
      try { await this.cut(e); } finally { e.cutQueued = false; }
      return;
    }
    this.line(e, 'ready', 'Все сцены готовы начерно — можно собирать MP4', 'ok', `Ролик: ${fmtSec(this.total(e))}`);
    // without the storyboard gate the cut waits for «Собрать MP4»: that idle time is not the work's fact, so the
    // script gate's estimate is dropped here and the cut gets an estimate (and a fact) of its own
    e.plan = undefined; e.workStart = undefined;
    this.emit(e, { type: 'status', status: 'ready' });
  }

  private async storyboard(e: Entry): Promise<Storyboard> {
    const s = e.state.settings;
    const reply = await this.claude(storyboardPrompt(s), e);
    if (reply) {
      try { return cleanStoryboard(extractJson(reply), s); }
      catch (err) { console.warn(`[inkframe] Claude's storyboard was unusable: ${(err as Error).message}`); }
    }
    return templateStoryboard(s);
  }

  /** Claude's reply, or undefined when Claude is switched off or can't be reached (then it rests for 10 minutes). */
  private async claude(prompt: string, e?: Entry): Promise<string | undefined> {
    if (!this.useClaude || Date.now() < this.claudeDownUntil) return undefined;
    try { const reply = await this.tools.ask(prompt); if (e) e.claudeCalls++; return reply; }
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
      const fresh = jobs.filter(j => !existsSync(j.out + '.mp3')), t0 = Date.now();
      await this.tools.voice(fresh, join(e.dir, 'voice', 'jobs.json'));
      if (fresh.length) this.speed.record('voicePerLine', (Date.now() - t0) / 1000, fresh.length);
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
      this.decide(e, { stage: 'voice', what: 'fallback', chosen: 'ролик без голоса', alternatives: [`голос «${VOICE_NAMES[s.voice]}»`], reason: `озвучка не удалась: ${(err as Error).message.slice(0, 120)}`, confidence: 'low' });
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
  private stage(e: Entry, r: RScene, extra: Partial<StageScene> = {}): StageScene { return { ...r.board.spec, duration: r.board.duration, voice: r.env, format: this.format(e), ...extra }; }
  /** The project's frame format (settings.format; anything unknown is 16:9). */
  private format(e: Entry): Format { return formatOf(e.state.settings.format); }
  /** Draft and key frames: 640×360, 360×640 or 360×360. */
  private draft(e: Entry): FrameOptions { return { ...DRAFT, width: sizeOf(this.format(e), DRAFT_SHORT).w }; }
  /** The MP4's size: finalWidth is the 16:9 width (1280), the other formats keep its short side (720). */
  private video(e: Entry) { return sizeOf(this.format(e), Math.round(this.finalWidth * 9 / 16)); }

  /** Sketch, then the colour draft, streamed to the studio. */
  private async draw(e: Entry, i: number, tick: () => void) {
    const r = e.scenes[i], n = i + 1, dur = r.board.duration, total = Math.round(dur * FINAL_FPS);
    const rel = `frames/s${n}-v${r.version}`, dir = join(e.dir, rel);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const url = (f: string) => `/api/projects/${e.state.id}/files/${rel}/${f}`;
    this.update(e, `scene-${n}`, 'run', `Рисую сцену ${n}: набросок`, `«${r.board.title}»`);
    this.emit(e, { type: 'scene.status', n, status: 'sketch' });
    const sk = Array.from({ length: this.sketchFrames }, (_, k) => round3((k + .5) / this.sketchFrames * dur)), clock = this.clock('draft', e);
    await this.tools.painter.frames(this.stage(e, r, { sketch: true }), sk, this.draft(e), (k, jpg) => {
      clock.frame();
      const f = `sketch-${k}.jpg`; writeFileSync(join(dir, f), jpg); tick();
      this.emit(e, { type: 'frame', n, kind: 'sketch', src: url(f), index: Math.round(sk[k] * FINAL_FPS), total });
    });
    this.update(e, `scene-${n}`, 'run', `Рисую сцену ${n} в цвете`);
    this.emit(e, { type: 'scene.status', n, status: 'painting' });
    const ct = this.draftTimes(dur);
    const clock2 = this.clock('draft', e);
    await this.tools.painter.frames(this.stage(e, r, { fast: true }), ct, this.draft(e), (k, jpg) => {
      clock2.frame();
      const f = `color-${String(k).padStart(3, '0')}.jpg`; writeFileSync(join(dir, f), jpg); tick();
      this.emit(e, { type: 'frame', n, kind: 'color', src: url(f), index: Math.round(ct[k] * FINAL_FPS), total });
    });
    clock.done(); clock2.done();
    this.emit(e, { type: 'scene.status', n, status: 'done' });
    // older drafts of this scene are no longer shown anywhere
    for (const d of readdirSync(join(e.dir, 'frames'))) if (d.startsWith(`s${n}-v`) && d !== `s${n}-v${r.version}`) rmSync(join(e.dir, 'frames', d), { recursive: true, force: true });
  }

  // ---------- edits ----------
  /** false when nothing changed (a request not understood without Claude) */
  private async edit(e: Entry, n: number, request: string, patch?: ScenePatch): Promise<boolean> {
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
      const reply = await this.claude(editPrompt(s, next, request), e);
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
          return false;
        }
        if (ruled.understood) this.decide(e, { stage: 'paint', what: 'fallback', scene: n, chosen: `правка сцены ${n} по простым правилам вместо Claude`, alternatives: ['Claude'], reason: `Claude недоступен; «${request}»`, confidence: 'low' });
        next = ruled.scene; how = how || 'по правилам';
      }
    }
    next.spec = cleanSpec(next.spec);
    if (s.hero === 'none') next.spec.hero = false;
    const revoice = next.line !== r.board.line || voiceOther !== r.voiceOther || next.spec.pace !== r.board.spec.pace;
    const newTemplate = next.spec.template !== r.board.spec.template;
    r.board = next;
    r.voiceOther = voiceOther;
    if (newTemplate) this.templateDecisions(e, 'paint', [i]);
    this.emit(e, { type: 'scene.board', n, patch: this.boardPatch(e, i) });
    if (revoice && s.voice !== 'none') await this.voiceAll(e, [i]);   // the scene keeps its storyboard length or stretches to the new voice
    if (e.state.video || e.state.review) {
      this.emit(e, { type: 'video', src: '' }); this.emit(e, { type: 'status', status: 'ready' });
      this.setStage(e, 'compose', 'pending'); this.setStage(e, 'review', 'pending');
      if (e.store.get('final')?.status === 'completed') this.setStage(e, 'final', 'pending');   // the handed-out MP4 is gone
    }
    this.update(e, id, 'run', `Перерисовываю сцену ${n}`);
    r.version++;
    // the resume point: a restart in the middle of this redraw paints this scene again from its new words
    this.setStage(e, 'paint', 'in_progress', { doneScenes: e.scenes.map((_, k) => k + 1).filter(k => k !== n) });
    this.save(e);
    await this.draw(e, i, () => {});
    this.update(e, `scene-${n}`, 'ok', `Сцена ${n} готова начерно`, '');   // draw() left the scene's own line «running»
    this.setStage(e, 'paint', 'completed', { doneScenes: e.scenes.map((_, k) => k + 1) });
    this.emit(e, { type: 'scene.edited', n, request: what });
    this.update(e, id, 'ok', `Сцена ${n} перерисована: «${what}»`, how === 'Claude' ? 'Правку понял Claude' : how === 'по правилам' ? 'Claude недоступен — правка по правилам' : '');
    return true;
  }

  private boardOf(e: Entry, i: number) { return { n: i + 1, ...this.boardPatch(e, i) }; }
  private boardPatch(e: Entry, i: number) {
    const b = e.scenes[i].board, starts = this.starts(e);
    return { title: b.title, line: b.line, visual: describe(b.spec, e.state.settings.language), caption: b.spec.template === 'card' ? b.spec.title : b.spec.caption ?? '', start: starts[i], duration: b.duration, template: b.spec.template };
  }

  // ---------- the cut ----------
  private async cut(e: Entry) {
    const s = e.state.settings, id = `build-${++e.cut}`, starts = this.starts(e), total = this.total(e);
    this.emit(e, { type: 'status', status: 'building' });
    this.setStage(e, 'compose', 'in_progress');
    this.step(e, id, 'Рисую сцены начисто и склеиваю MP4', 'run', '0 %');
    try {
      mkdirSync(join(e.dir, 'clips'), { recursive: true });
      const fmt = this.format(e), { w, h } = this.video(e), opts: FrameOptions = { rs: Number(process.env.INKFRAME_FINAL_RS) || .5, width: w, quality: .9 };
      const jobs = e.scenes.map((r, i) => {
        const len = r.board.duration + (i < e.scenes.length - 1 ? OVERLAP : 0), stage = this.stage(e, r, { fast: process.env.INKFRAME_WATERCOLOR !== '1' });
        // the renderer's version is in the key: after a change to renderer/** every clip is painted again; the format
        // (in the stage scene too) and the size keep a 9:16 clip from ever standing in for a 16:9 one
        const key = hash(JSON.stringify([stage, len, w, h, fmt, this.rendererVersion ??= rendererVersion()])).slice(0, 12);
        return { i, len, stage, clip: `clips/s${i + 1}-${key}.mp4`, frames: Math.round(len * FINAL_FPS) };
      });
      const todo = jobs.filter(j => !existsSync(join(e.dir, j.clip))), all = todo.reduce((a, j) => a + j.frames, 0) || 1;
      // a cut asked for by hand (after edits) gets its own estimate: only the clips that are not in the cache
      if (!e.plan || e.plan.actualSec !== undefined) this.startWork(e, this.showEstimate(e, 'compose', jobs.map(j => ({ duration: e.scenes[j.i].board.duration, final: todo.includes(j) }))));
      const tc = Date.now(); let paintSec = 0;
      let done = 0;
      for (const j of todo) {
        const tmp = join(e.dir, 'tmp', `s${j.i + 1}`);
        rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
        this.update(e, id, 'run', `Рисую начисто сцену ${j.i + 1} из ${jobs.length}`);
        const times = Array.from({ length: j.frames }, (_, k) => round3(k / FINAL_FPS)), tp = Date.now(), clock = this.clock('final', e);
        await this.tools.painter.frames(j.stage, times, opts, (k, jpg) => {
          clock.frame();
          writeFileSync(join(tmp, `f${String(k).padStart(5, '0')}.jpg`), jpg);
          if (++done % 6 === 0) this.update(e, id, 'run', undefined, `${Math.round(done / all * 85)} %`);
        });
        const painted = (Date.now() - tp) / 1000, te = Date.now();
        paintSec += painted;
        clock.done();
        await this.tools.ffmpeg(['-framerate', String(FINAL_FPS), '-i', join(tmp, 'f%05d.jpg'), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', join(e.dir, j.clip)]);
        this.speed.record('encodePerFrame', (Date.now() - te) / 1000, times.length);
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
      if (cues.length) writeAss(join(e.dir, 'subtitles.ass'), cues, fmt);
      const out = `cut-${e.cut}.mp4`, src = `/api/projects/${e.state.id}/files/${out}`;
      await this.tools.ffmpeg(cutArgs({ clips: jobs.map(j => j.clip), starts, total, audio: hasSound ? 'sound.wav' : undefined, ass: cues.length ? 'subtitles.ass' : undefined, out }), e.dir);
      for (const f of readdirSync(e.dir)) if (/^cut-\d+\.mp4$/.test(f) && f !== out) rmSync(join(e.dir, f), { force: true });
      const used = new Set(jobs.map(j => j.clip.slice(6)));
      for (const f of readdirSync(join(e.dir, 'clips'))) if (!used.has(f)) rmSync(join(e.dir, 'clips', f), { force: true });
      rmSync(join(e.dir, 'tmp'), { recursive: true, force: true });
      const what = `${fmtSec(total)} · ${w}×${h} · ${[clips.length && 'голос', bed && 'музыка', cues.length && 'субтитры'].filter(Boolean).join(', ') || 'без звука'}${todo.length < jobs.length ? ` · перерисовано сцен: ${todo.length} из ${jobs.length}` : ''}`;
      this.update(e, id, 'ok', 'MP4 склеен — проверяю, прежде чем отдать', what);
      this.setStage(e, 'compose', 'completed');

      // the self-review: the MP4 is handed out only when nothing in it is broken
      const rid = `review-${e.cut}`;
      this.setStage(e, 'review', 'in_progress');
      this.step(e, rid, 'Проверяю готовый ролик', 'run', 'длина, чёрные и пустые кадры, голос под репликами, громкость, субтитры');
      const plan: ReviewPlan = {
        file: join(e.dir, out), src, width: w, height: h, fps: 24, duration: total,
        scenes: e.scenes.map((r, i) => ({ n: i + 1, start: starts[i], duration: r.board.duration, dark: DARK_SETTINGS.includes(r.board.spec.setting) })),
        lines: e.scenes.flatMap((r, i) => (r.board.line.trim()
          ? [{ n: i + 1, start: round3(starts[i] + LEAD), end: round3(starts[i] + (r.audio ? LEAD + r.audio.dur : r.board.duration - TAIL)), voiced: !!r.audio }] : [])),
        voice: s.voice !== 'none', sound: hasSound,
        ...(cues.length && { subtitles: { file: join(e.dir, 'subtitles.ass'), burned: true } }),
      };
      let review: Review;
      try { review = await this.tools.review(plan); } catch (err) { review = reviewCrashed(src, err); }
      writeFileSync(join(e.dir, 'review.json'), JSON.stringify(review, null, 1));
      if (e.parts) { e.parts.paint += paintSec; e.parts.cut += (Date.now() - tc) / 1000 - paintSec; }
      this.finishWork(e);
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
      e.cutQueued = false;
      if (this.gates.final) {
        this.update(e, id, 'ok', 'MP4 склеен и проверен — ждёт вашего решения', what);
        return this.finalGate(e, src, review, what);
      }
      const fin = e.store.open('final', { video: src, review: review.decision, what }, false);
      this.emit(e, { type: 'stage', stage: 'final', status: 'completed', version: fin.version });
      this.update(e, id, 'ok', 'MP4 готов — можно скачать', what);
      this.emit(e, { type: 'status', status: 'done' });
    } catch (err) {
      rmSync(join(e.dir, 'tmp'), { recursive: true, force: true });
      this.update(e, id, 'err', 'MP4 не собрался', (err as Error).message.slice(0, 200));
      if (e.state.stages.review.status === 'in_progress') this.setStage(e, 'review', 'failed');
      else this.setStage(e, 'compose', 'failed');
      this.emit(e, { type: 'status', status: 'ready' });
    }
  }

  // ---------- estimates and decisions ----------
  /** Times one painter call from its first frame to its last: the steady speed, without the browser's start-up and
   *  page load (they come before the first frame). One worker's s/frame = interval per frame × workers in parallel. */
  /** Speed is kept per 16:9 frame: a frame of a cheaper format (1:1 ≈ 0.7 of the work) is counted as `cost` of one. */
  private clock(kind: 'draft' | 'final', e: Entry) {
    const start = Date.now(), cost = FORMATS[this.format(e)].cost;
    let first = 0, last = 0, n = 0;
    return {
      frame: () => { last = Date.now(); if (!n++) first = last; },
      done: () => {
        if (n >= 3) this.speed.record(kind, (last - first) / 1000 / cost, n - 1, this.tools.painter.workers);
        // the wait before the first frame, less the frame itself: free pages, a page at another scale, the stage loading
        if (n >= 3) this.speed.record('leadPerCall', Math.max(0, (first - start) / 1000 - (last - first) / 1000 / (n - 1) * Math.min(n, this.tools.painter.workers)), 1);
      },
    };
  }


  /** This server's speed for this project's format: a 1:1 frame costs ≈ 0.7 of a 16:9 one (lib/formats.ts). */
  private formatSpeed(e: Entry) {
    const sp = this.speed.speed(), cost = FORMATS[this.format(e)].cost;
    return cost === 1 ? sp : { ...sp, draft: sp.draft * cost, final: sp.final * cost };
  }

  /** The estimate of the rest of the run as seen from `stage`, shown on the screen and kept in estimate.json. */
  private showEstimate(e: Entry, stage: StageId, scenes?: EstimateScene[]): Estimate {
    const s = e.state.settings, keys = stage === 'script' && this.gates.storyboard;
    const est = estimate({
      stage, draftFps: this.draftFps, sketchFrames: this.sketchFrames, finalFps: FINAL_FPS, overlap: OVERLAP,
      workers: this.tools.painter.workers, speed: this.formatSpeed(e), claudeMade: e.claudeCalls, budget: this.budget,
      scenes: scenes ?? e.scenes.map(r => ({ duration: r.board.duration, key: keys, draft: true, final: true, voice: s.voice !== 'none' && !!r.board.line.trim() })),
    });
    try { e.store.saveEstimate(est); } catch (err) { console.warn('[inkframe] estimate.json:', (err as Error).message); }
    this.emit(e, { type: 'estimate', estimate: est });
    return est;
  }

  /** The work an approve (or a cut by hand) starts: its estimate and the clock for the fact. */
  private startWork(e: Entry, plan: Estimate | undefined) {
    e.workStart = Date.now(); e.parts = { voice: 0, paint: 0, cut: 0 };
    // the board counts the time since the start against the plan
    e.plan = plan && { ...plan, startedAt: new Date(e.workStart).toISOString() };
    if (e.plan) this.emit(e, { type: 'estimate', estimate: e.plan });
  }

  /** The work is over: the fact goes next to the estimate (estimate.json, the screen, the decision log). */
  private finishWork(e: Entry) {
    const plan = e.plan;
    if (!plan || plan.actualSec !== undefined) return;
    const parts = e.parts ?? { voice: 0, paint: 0, cut: 0 };
    const actualSec = round1(e.workStart ? (Date.now() - e.workStart) / 1000 : parts.voice + parts.paint + parts.cut);
    const done: Estimate = { ...plan, actualSec, actual: { paintSec: round1(parts.paint), voiceSec: round1(parts.voice), cutSec: round1(parts.cut) } };
    e.plan = done; e.workStart = undefined;
    try { e.store.saveEstimate(done); } catch (err) { console.warn('[inkframe] estimate.json:', (err as Error).message); }
    this.emit(e, { type: 'estimate', estimate: done });
    const off = plan.totalSec > 0 ? Math.round((actualSec - plan.totalSec) / plan.totalSec * 100) : 0;
    this.decide(e, {
      stage: plan.stage, what: 'estimate', chosen: `оценка ≈ ${fmtSec(plan.totalSec)}, вышло ${fmtSec(actualSec)}`, alternatives: [],
      reason: `${plan.frames} кадров, ${plan.workers} ${plural(plan.workers, 'поток', 'потока', 'потоков')}; скорость ${plan.measured ? 'по последним кадрам этого сервера' : 'по запасным значениям (замеров ещё не было)'}; `
        + `${off === 0 ? 'точно' : off > 0 ? `дольше на ${off} %` : `быстрее на ${-off} %`} (отрисовка ${fmtSec(done.actual!.paintSec)}, голос ${fmtSec(done.actual!.voiceSec)}, склейка и проверка ${fmtSec(done.actual!.cutSec)})`,
      confidence: plan.measured ? 'medium' : 'low', estimate: done,
    });
  }

  private decide(e: Entry, d: Omit<Decision, 'at'>) {
    const decision: Decision = { at: new Date().toISOString(), ...d };
    try { e.store.decide(decision); } catch (err) { console.warn('[inkframe] decisions.jsonl:', (err as Error).message); }
    this.emit(e, { type: 'decision', decision });
  }

  /** Which template each scene got, out of which, and why (Claude's own reason from the storyboard, or the rule). */
  private templateDecisions(e: Entry, stage: StageId, only?: number[]) {
    const s = e.state.settings, claude = e.storyBy === 'claude';
    for (const [i, r] of e.scenes.entries()) {
      if (only && !only.includes(i)) continue;
      const t = r.board.spec.template;
      this.decide(e, {
        stage, what: 'template', scene: i + 1, chosen: t, alternatives: TEMPLATES.filter(x => x !== t && (x !== 'card' || s.ending !== 'none')),
        reason: r.board.why ?? (claude ? 'Claude выбрал, не объяснив почему' : 'раскадровка по шаблону'), confidence: claude ? (r.board.why ? 'high' : 'medium') : 'low',
      });
    }
  }

  /** Style, voice, music and format: what the settings asked for, and what this engine can really do with it. */
  private settingsDecisions(e: Entry) {
    const s = e.state.settings;
    const avail = <T,>(list: { value: T; label: string; soon?: boolean }[], v: T) => list.filter(x => !x.soon && x.value !== v).map(x => x.label);
    const style = STYLES.find(x => x.id === s.style);
    this.decide(e, { stage: 'brief', what: 'style', chosen: style?.title ?? s.style, alternatives: STYLES.filter(x => x.id !== s.style).map(x => x.title + (x.soon ? ' (скоро)' : '')),
      reason: s.style === 'watercolor' ? 'задан на стартовом экране' : 'задан на стартовом экране, но этот движок пока рисует только акварелью', confidence: s.style === 'watercolor' ? 'high' : 'low' });
    this.decide(e, { stage: 'brief', what: 'voice', chosen: VOICE_NAMES[s.voice], alternatives: avail(OPTIONS.voice, s.voice),
      reason: s.voice === 'none' ? 'без голоса — так задано' : `из настроек; голос edge-tts ${voiceId(s.language, s.voice)}`, confidence: 'high' });
    this.decide(e, { stage: 'brief', what: 'music', chosen: MUSIC_NAMES[s.music], alternatives: avail(OPTIONS.music, s.music),
      reason: s.music === 'none' ? 'без музыки — так задано' : 'из настроек; музыка синтезируется и приглушается под голос', confidence: 'high' });
    const fmt = this.format(e), v = this.video(e), known = formatOf(s.format) === s.format;
    this.decide(e, { stage: 'brief', what: 'format', chosen: `${fmt} · ${v.w}×${v.h}`, alternatives: (['16:9', '9:16', '1:1'] as Format[]).filter(f => f !== fmt),
      reason: !known ? `в настройках «${s.format}» — такого формата нет, рисую 16:9`
        : fmt === '9:16' ? 'из настроек; слова и герой — вне верхних 12 % и нижних 20 % кадра, где Reels / Shorts / TikTok кладут свои кнопки'
        : fmt === '1:1' ? 'из настроек; квадрат для ленты' : 'из настроек', confidence: known ? 'high' : 'low' });
  }

  // ---------- resume ----------
  /** After a restart: an unfinished stage goes on from where it stopped; an open gate just waits. */
  private async resume(e: Entry) {
    const cp = (st: StageId) => e.store.get(st), script = cp('script'), board = cp('storyboard');
    const go = (what: string) => this.step(e, `resume-${Date.now()}`, 'Сервер перезапускали — продолжаю с места остановки', 'ok', what);
    if (!script || !e.scenes.length || script.status === 'pending' || script.status === 'in_progress') { go('пишу сценарий заново'); return this.run(e); }
    if (script.status === 'revised') { go('переписываю сценарий по вашему замечанию заново'); return this.rewrite(e, script.approval?.note ?? ''); }
    if (script.status === 'awaiting') return this.emit(e, { type: 'status', status: 'awaiting' });
    if (board?.gate || (!board && this.gates.storyboard)) {
      if (!board || board.status === 'pending' || board.status === 'in_progress') {
        go(`раскадровка: готово ${board?.doneScenes?.length ?? 0} из ${e.scenes.length} кадров — дорисую остальные`);
        this.emit(e, { type: 'status', status: 'drafting' });
        await this.keyframes(e);
        return this.storyboardReady(e);
      }
      if (board.status === 'revised') { go('правлю раскадровку по вашему замечанию заново'); return this.reviseBoard(e, board.approval!); }
      if (board.status === 'awaiting') return this.emit(e, { type: 'status', status: 'awaiting' });
    }
    const cut = !!board?.gate, paint = cp('paint'), compose = cp('compose'), review = cp('review'), voice = cp('voice');
    if (paint?.status !== 'completed' || (e.state.settings.voice !== 'none' && voice?.status !== 'completed' && voice?.status !== 'failed')) {
      go(`отрисовка: готово ${paint?.doneScenes?.length ?? 0} из ${e.scenes.length} сцен — дорисую остальные`);
      if (cut) this.startWork(e, e.store.estimate());
      return this.produce(e, { resume: true, cut });
    }
    if (compose?.status === 'in_progress' || review?.status === 'in_progress' || (cut && compose?.status === 'pending' && cp('final')?.status !== 'completed')) {
      go('сборка: готовые сцены возьму из кэша');
      e.cutQueued = true;
      try { return await this.cut(e); } finally { e.cutQueued = false; }
    }
    this.emit(e, { type: 'status', status: canBuild({ ...e.state, status: 'ready' }) ? 'ready' : e.state.status });
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
  /** A log line with a fixed id: added once, updated after (a resumed run reuses the lines it already has). */
  private line(e: Entry, id: string, text: string, status: StepStatus, detail?: string) {
    if (e.state.log.some(l => l.id === id)) this.update(e, id, status, text, detail ?? '');
    else this.step(e, id, text, status, detail);
  }
  private update(e: Entry, id: string, status: StepStatus, text?: string, detail?: string) {
    this.emit(e, { type: 'log.update', id, status, ...(text !== undefined && { text }), ...(detail !== undefined && { detail }) });
  }

  private emit(e: Entry, ev: EngineEvent) {
    const line = journalLine(ev, e.state);
    e.state = applyEvent(e.state, ev);
    if (line) { try { e.store.log(line); } catch (err) { console.warn('[inkframe] events.jsonl:', (err as Error).message); } }
    for (const l of e.listeners) { try { l(ev); } catch { /* a closed stream */ } }
  }

  /** Writes a stage's status through the store (which refuses `completed` on an unapproved gate), then tells the studio. */
  private setStage(e: Entry, stage: StageId, status: StageStatus, extra?: Partial<Pick<Checkpoint, 'doneScenes' | 'estimate'>>) {
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
    try { writeFileSync(join(e.dir, 'project.json'), JSON.stringify({ state: e.state, scenes: e.scenes, cut: e.cut, storyBy: e.storyBy, claudeCalls: e.claudeCalls, plan: e.plan })); }
    catch (err) { console.warn('[inkframe] could not save', e.state.id, (err as Error).message); }
  }

  private load() {
    for (const id of readdirSync(this.root)) {
      const f = join(this.root, id, 'project.json');
      if (!existsSync(f)) continue;
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'));
        const dir = join(this.root, id);
        const e: Entry = { claudeCalls: 0, ...j, listeners: new Set(), queue: [], running: false, cutQueued: false, dir, store: new StageStore(dir) };
        e.state = normalizeProject(e.state);   // projects made before Inkframe 3 have no stages
        this.projects.set(id, e);
        // a run cut short by the restart goes on from where it stopped (see resume); an open gate just waits
        if (['drafting', 'drawing', 'building'].includes(e.state.status)) {
          e.state = { ...e.state, scenes: e.state.scenes.map(sc => (sc.status === 'sketch' || sc.status === 'painting' ? { ...sc, status: 'queued' as const } : sc)) };
          this.enqueue(e, () => this.resume(e));
        }
      } catch { /* not a project */ }
    }
  }
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const fmtSec = (s: number) => (s < 60 ? `${s.toFixed(1).replace('.', ',')} с` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const scenesWord = (ns: number[]) => `${ns.length > 1 ? 'сцены' : 'сцена'} ${ns.join(', ')}`;
/** The note a storyboard revise gets when only scenes were marked (reviseVersion writes it the same way). */
const marksText = (marks: SceneNote[]) => marks.map(x => `Сцена ${x.n}: ${x.note}`).join('; ');
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
}
