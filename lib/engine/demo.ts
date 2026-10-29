// DemoEngine: plays the scripts from demo-script.ts on timers, so the studio can be clicked through without
// Claude or a renderer. State lives in memory; each project runs one script at a time, edits queue behind.
// It stops at the same three gates as the real engine — script, storyboard (a contact sheet of key frames), final
// (the MP4 with its review) — with checkpoints in memory and the same rules as the file store, so the static demo
// site shows the gates too: approve goes on, revise shows «переделываю» and the next version.
import { DEMO_CATALOG, type DemoCatalog } from './demo-catalog';
import { buildAssembleScript, buildEditScript, buildKeysScript, buildProduceScript, buildWriteScript, demoEstimate } from './demo-script';
import { applyEvent, canBuild, emptyProject } from './reducer';
import type { ApproveOptions, EngineEvent, Estimate, ProjectState, ProjectSummary, ReviseOptions, ScenePatch, StageId, StartSettings, StudioEngine, TimedEvent } from './types';
import { approveVersion, GateError, reviseVersion } from '../store/gate';
import { DEFAULT_BUDGET, DEFAULT_GATES, STAGE_NAMES, approvedWord, type BudgetPolicy, type Checkpoint, type GatePolicy, type SceneNote } from '../store/types';

interface Entry {
  state: ProjectState; listeners: Set<(ev: EngineEvent) => void>; queue: (() => TimedEvent[])[]; playing: boolean;
  checkpoints: Map<StageId, Checkpoint>;
  /** the estimate of the work an approve started, and when it started (the fact is the demo's own playing time) */
  plan?: Estimate; workStart?: number; cuts: number;
}

export class DemoEngine implements StudioEngine {
  readonly mode = 'demo' as const;
  private projects = new Map<string, Entry>();
  private speed: number;
  private gates: GatePolicy;
  private budget: BudgetPolicy;
  constructor(private opts: { speed?: number; catalog?: DemoCatalog; gates?: GatePolicy; budget?: BudgetPolicy } = {}) {
    this.speed = opts.speed ?? 1;
    this.gates = opts.gates ?? DEFAULT_GATES;
    this.budget = opts.budget ?? DEFAULT_BUDGET;
  }
  private get catalog() { return this.opts.catalog ?? DEMO_CATALOG; }

  create(settings: StartSettings): ProjectState {
    if (!settings.idea?.trim()) throw new Error('The idea is empty');
    const id = globalThis.crypto.randomUUID().slice(0, 8);   // Web Crypto: works in Node and in the browser (static demo site)
    const e: Entry = { state: emptyProject(id, settings, 'demo'), listeners: new Set(), queue: [], playing: false, checkpoints: new Map(), cuts: 0 };
    this.projects.set(id, e);
    const gated = this.gates.script;
    this.enqueue(e, () => buildWriteScript(e.state, this.catalog, this.speed, {
      version: 1, gated, storyboardNext: this.gates.storyboard, estimate: demoEstimate(e.state, this.catalog, 'script', this.budget, this.gates.storyboard),
    }));
    if (!gated) this.afterScript(e);
    return e.state;
  }

  /** After the script: the storyboard gate, or straight to paint (then «Собрать MP4» by hand, as before). */
  private afterScript(e: Entry) {
    if (this.gates.storyboard) {
      this.enqueue(e, () => buildKeysScript(e.state, this.catalog, this.speed, { version: 1, estimate: demoEstimate(e.state, this.catalog, 'storyboard', this.budget) }));
    } else {
      this.enqueue(e, () => [{ at: 0, ev: { type: 'stage', stage: 'storyboard', status: 'completed', version: 1 } }, ...buildProduceScript(e.state, this.catalog, this.speed)]);
    }
  }

  /** Paint, then the cut and its review; with the final gate on, it ends at the gate. */
  private paintAndCut(e: Entry, finalVersion: number) {
    this.enqueue(e, () => buildProduceScript(e.state, this.catalog, this.speed, { cut: true }));
    this.cut(e, finalVersion);
  }
  private cut(e: Entry, finalVersion: number) {
    const n = ++e.cuts;
    this.enqueue(e, () => buildAssembleScript(e.state, this.catalog, this.speed, { n, ...(this.gates.final && { final: { version: finalVersion } }) }));
  }

  approve(id: string, stage: StageId, version: number, note?: string, o: ApproveOptions = {}): ProjectState {
    const e = this.entry(id);
    const { cp, changed } = approveVersion(e.checkpoints.get(stage), stage, version, note, undefined, o.allowOverCap === true);
    if (!changed) return e.state;
    e.checkpoints.set(stage, cp);
    this.emit(e, { type: 'stage', stage, status: 'completed', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.emit(e, { type: 'log.update', id: `gate-${stage}-v${version}`, status: 'ok', text: stage === 'final' ? `Финал v${version} утверждён — ролик отдан` : `${STAGE_NAMES[stage]} v${version} ${approvedWord(stage)}`, detail: cp.approval?.note ? `«${cp.approval.note}»` : '' });
    if (stage === 'script') {
      if (!this.gates.storyboard) { e.plan = cp.estimate; e.workStart = Date.now(); }
      this.afterScript(e);
    } else if (stage === 'storyboard') {
      e.plan = cp.estimate; e.workStart = Date.now();
      this.paintAndCut(e, 1);
    } else if (stage === 'final') {
      this.emit(e, { type: 'status', status: 'done' });
    }
    return e.state;
  }

  revise(id: string, stage: StageId, version: number, note: string, o: ReviseOptions = {}): ProjectState {
    const e = this.entry(id);
    const redo = stage === 'final' ? sceneOf(e.state, note, o.scenes) : undefined;
    if (stage === 'final' && !redo) throw new GateError('Выберите сцену, которую переделать (или начните замечание со слов «сцена 2: …»)', 400);
    const cp = reviseVersion(e.checkpoints.get(stage), stage, version, note, undefined, o.scenes);
    e.checkpoints.set(stage, cp);
    this.emit(e, { type: 'stage', stage, status: 'revised', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.emit(e, { type: 'log.update', id: `gate-${stage}-v${version}`, status: 'ok', text: `${STAGE_NAMES[stage]} v${version} вернули с замечанием`, detail: `«${cp.approval!.note}»` });
    this.emit(e, { type: 'status', status: stage === 'final' ? 'drawing' : 'drafting' });
    if (stage === 'script') {
      this.enqueue(e, () => buildWriteScript(e.state, this.catalog, this.speed, {
        version: version + 1, gated: true, note: cp.approval!.note, storyboardNext: this.gates.storyboard, estimate: demoEstimate(e.state, this.catalog, 'script', this.budget, this.gates.storyboard),
      }));
    } else if (stage === 'storyboard') {
      this.enqueue(e, () => buildKeysScript(e.state, this.catalog, this.speed, { version: version + 1, note: cp.approval!.note, marks: cp.approval!.scenes, estimate: demoEstimate(e.state, this.catalog, 'storyboard', this.budget) }));
    } else if (stage === 'final') {
      e.workStart = Date.now(); e.plan = undefined;
      this.enqueue(e, () => buildEditScript(e.state, redo!.n, redo!.note, this.catalog, this.speed));
      this.cut(e, version + 1);
    }
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
    if (e.state.gate) throw new GateError(`Сейчас открыто утверждение «${STAGE_NAMES[e.state.gate.stage]}» — замечания пишите на его панели`, 409);
    // new words typed into the edit panel: the demo shows them and redraws the scene like any other edit
    if (patch?.line?.trim() || patch?.caption?.trim()) {
      if (patch.line?.trim()) this.emit(e, { type: 'scene.board', n, patch: { line: patch.line.trim().slice(0, 220) } });
      if (patch.caption !== undefined) this.emit(e, { type: 'scene.board', n, patch: { caption: patch.caption.trim().slice(0, 42) } });
      request = request.trim() || (patch.line?.trim() ? 'новая реплика' : 'новая подпись');
    }
    if (!request.trim()) throw new Error('The edit request is empty');
    if (e.state.scenes.length && !e.state.scenes.some(sc => sc.n === n)) throw new Error(`No scene ${n} in this project`);
    if (!e.state.scenes.length && n > 6) throw new Error(`No scene ${n} in this project`);
    // Built when its turn comes, so it sees the scene as the run left it.
    this.enqueue(e, () => buildEditScript(e.state, n, request.trim().slice(0, 300), this.catalog, this.speed));
  }

  build(id: string) {
    const e = this.entry(id);
    if (!canBuild(e.state) || e.playing) throw new Error('The cartoon is not ready to build yet');
    e.workStart = Date.now(); e.plan = undefined;
    this.cut(e, (e.checkpoints.get('final')?.version ?? 0) + 1);
  }

  private entry(id: string) {
    const e = this.projects.get(id);
    if (!e) throw new Error(`Project ${id} not found`);
    return e;
  }

  private enqueue(e: Entry, make: () => TimedEvent[]) {
    e.queue.push(make);
    if (!e.playing) this.playNext(e);
  }

  private playNext(e: Entry) {
    const make = e.queue.shift();
    if (!make) { e.playing = false; return; }
    e.playing = true;
    const script = make(), t0 = Date.now();
    let i = 0;
    const tick = () => {
      while (i < script.length && script[i].at <= Date.now() - t0) this.emit(e, script[i++].ev);
      if (i < script.length) setTimeout(tick, Math.max(0, script[i].at - (Date.now() - t0)));
      else this.playNext(e);
    };
    tick();
  }

  private emit(e: Entry, ev: EngineEvent) {
    // a gate opening in the script is the checkpoint of that version (in memory; the real engine keeps files)
    if (ev.type === 'gate' && ev.open) {
      const at = new Date().toISOString();
      // the final gate shows the estimate of the work with its fact: the demo's own playing time
      if (ev.stage === 'final' && e.plan && e.workStart) {
        const done = { ...e.plan, actualSec: Math.round((Date.now() - e.workStart) / 100) / 10 };
        e.plan = undefined; e.workStart = undefined;
        e.state = applyEvent(e.state, { type: 'estimate', estimate: done });
        for (const l of e.listeners) l({ type: 'estimate', estimate: done });
      }
      const estimate = ev.stage !== 'final' ? e.state.estimate : undefined;
      e.checkpoints.set(ev.stage, {
        stage: ev.stage, status: 'awaiting', version: ev.version, gate: true, startedAt: at, updatedAt: at, ...(estimate && { estimate }),
        artifact: e.state.scenes.map(({ n, title, line, start, duration }) => ({ n, title, line, start, duration })),
      });
    }
    e.state = applyEvent(e.state, ev);
    for (const l of e.listeners) l(ev);
  }
}

/** The scene a final-gate note is about: picked in the panel, or «сцена 2: …» at the start of the note. */
function sceneOf(p: ProjectState, note: string, scenes?: SceneNote[]): SceneNote | undefined {
  const picked = scenes?.find(x => Number.isInteger(x.n));
  const m = note.trim().match(/^(?:сцен[аеуы]?|scene)\s*(\d+)\s*[:—,.-]?\s*(.*)$/is);
  const n = picked?.n ?? (m ? Number(m[1]) : NaN), text = (picked?.note?.trim() || (m && !picked ? m[2] : note)).trim();
  return n >= 1 && n <= p.scenes.length && text ? { n, note: text.slice(0, 300) } : undefined;
}
