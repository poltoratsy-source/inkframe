// DemoEngine: plays the scripts from demo-script.ts on timers, so the studio can be clicked through without
// Claude or a renderer. State lives in memory; each project runs one script at a time, edits queue behind.
// It stops at the script gate like the real engine (checkpoints in memory, the same rules as the file store), so the
// static demo site shows the gates too.
import { DEMO_CATALOG, type DemoCatalog } from './demo-catalog';
import { buildAssembleScript, buildEditScript, buildProduceScript, buildWriteScript } from './demo-script';
import { applyEvent, canBuild, emptyProject } from './reducer';
import type { EngineEvent, ProjectState, ProjectSummary, ScenePatch, StageId, StartSettings, StudioEngine, TimedEvent } from './types';
import { approveVersion, GateError, reviseVersion } from '../store/gate';
import { DEFAULT_GATES, STAGE_NAMES, type Checkpoint, type GatePolicy } from '../store/types';

interface Entry {
  state: ProjectState; listeners: Set<(ev: EngineEvent) => void>; queue: (() => TimedEvent[])[]; playing: boolean;
  checkpoints: Map<StageId, Checkpoint>;
}

export class DemoEngine implements StudioEngine {
  readonly mode = 'demo' as const;
  private projects = new Map<string, Entry>();
  private speed: number;
  private gates: GatePolicy;
  constructor(private opts: { speed?: number; catalog?: DemoCatalog; gates?: GatePolicy } = {}) {
    this.speed = opts.speed ?? 1;
    this.gates = opts.gates ?? DEFAULT_GATES;
  }
  private get catalog() { return this.opts.catalog ?? DEMO_CATALOG; }

  create(settings: StartSettings): ProjectState {
    if (!settings.idea?.trim()) throw new Error('The idea is empty');
    const id = globalThis.crypto.randomUUID().slice(0, 8);   // Web Crypto: works in Node and in the browser (static demo site)
    const e: Entry = { state: emptyProject(id, settings, 'demo'), listeners: new Set(), queue: [], playing: false, checkpoints: new Map() };
    this.projects.set(id, e);
    const gated = this.gates.script;
    this.enqueue(e, () => buildWriteScript(e.state, this.catalog, this.speed, { version: 1, gated }));
    if (!gated) this.enqueue(e, () => buildProduceScript(e.state, this.catalog, this.speed));
    return e.state;
  }

  approve(id: string, stage: StageId, version: number, note?: string): ProjectState {
    const e = this.entry(id);
    const { cp, changed } = approveVersion(e.checkpoints.get(stage), stage, version, note);
    if (!changed) return e.state;
    e.checkpoints.set(stage, cp);
    this.emit(e, { type: 'stage', stage, status: 'completed', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.emit(e, { type: 'log.update', id: `gate-${stage}-v${version}`, status: 'ok', text: `${STAGE_NAMES[stage]} v${version} утверждён`, detail: cp.approval?.note ? `«${cp.approval.note}»` : '' });
    this.enqueue(e, () => buildProduceScript(e.state, this.catalog, this.speed));
    return e.state;
  }

  revise(id: string, stage: StageId, version: number, note: string): ProjectState {
    const e = this.entry(id);
    const cp = reviseVersion(e.checkpoints.get(stage), stage, version, note);
    e.checkpoints.set(stage, cp);
    this.emit(e, { type: 'stage', stage, status: 'revised', version });
    this.emit(e, { type: 'gate', stage, version, open: false, summary: '' });
    this.emit(e, { type: 'log.update', id: `gate-${stage}-v${version}`, status: 'ok', text: `${STAGE_NAMES[stage]} v${version} вернули с замечанием`, detail: `«${cp.approval!.note}»` });
    this.emit(e, { type: 'status', status: 'drafting' });
    this.enqueue(e, () => buildWriteScript(e.state, this.catalog, this.speed, { version: version + 1, gated: true, note: cp.approval!.note }));
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
    this.enqueue(e, () => buildAssembleScript(e.state, this.catalog, this.speed));
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
      e.checkpoints.set(ev.stage, { stage: ev.stage, status: 'awaiting', version: ev.version, gate: true, startedAt: at, updatedAt: at, artifact: e.state.scenes.map(({ n, title, line, start, duration }) => ({ n, title, line, start, duration })) });
    }
    e.state = applyEvent(e.state, ev);
    for (const l of e.listeners) l(ev);
  }
}
