// DemoEngine: plays the scripts from demo-script.ts on timers, so the studio can be clicked through without
// Claude or a renderer. State lives in memory; each project runs one script at a time, edits queue behind.
import { DEMO_CATALOG, type DemoCatalog } from './demo-catalog';
import { buildAssembleScript, buildEditScript, buildRunScript } from './demo-script';
import { applyEvent, canBuild, emptyProject } from './reducer';
import type { EngineEvent, ProjectState, ProjectSummary, StartSettings, StudioEngine, TimedEvent } from './types';

interface Entry { state: ProjectState; listeners: Set<(ev: EngineEvent) => void>; queue: (() => TimedEvent[])[]; playing: boolean }

export class DemoEngine implements StudioEngine {
  readonly mode = 'demo' as const;
  private projects = new Map<string, Entry>();
  private speed: number;
  constructor(private opts: { speed?: number; catalog?: DemoCatalog } = {}) { this.speed = opts.speed ?? 1; }
  private get catalog() { return this.opts.catalog ?? DEMO_CATALOG; }

  create(settings: StartSettings): ProjectState {
    if (!settings.idea?.trim()) throw new Error('The idea is empty');
    const id = globalThis.crypto.randomUUID().slice(0, 8);   // Web Crypto: works in Node and in the browser (static demo site)
    const e: Entry = { state: emptyProject(id, settings, 'demo'), listeners: new Set(), queue: [], playing: false };
    this.projects.set(id, e);
    this.enqueue(e, () => buildRunScript(e.state, this.catalog, this.speed));
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

  editScene(id: string, n: number, request: string) {
    const e = this.entry(id);
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
    e.state = applyEvent(e.state, ev);
    for (const l of e.listeners) l(ev);
  }
}
