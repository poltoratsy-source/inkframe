// What the screens call. With a server: the API routes and the SSE stream. On the static demo site: the same
// DemoEngine, running right here in the browser tab. The screens never need to know which one they talk to.
import type { EngineEvent, ProjectState, ProjectSummary, Review, SceneNote, ScenePatch, StageId, StartSettings, StudioEngine } from './engine/types';
import type { Replay } from './engine/replay';
import { DEMO_REPLAY_ID, STATIC_SITE } from './site';

export interface SettingsInfo { hasKey: boolean; engine: string; staticSite?: boolean }
export type ProjectEvent = EngineEvent | { type: 'missing' };

// ---------- static site: one DemoEngine per tab ----------
let local: Promise<StudioEngine> | undefined;
const engine = () => (local ??= import('./engine/demo').then(m => new m.DemoEngine()));
const run = async <T>(f: (e: StudioEngine) => T): Promise<T> => f(await engine());

// ---------- server ----------
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j as T;
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  listProjects: (): Promise<ProjectSummary[]> =>
    STATIC_SITE ? run(e => e.list()) : call<{ projects: ProjectSummary[] }>('/api/projects').then(j => j.projects || []),

  /** Starts a cartoon and returns its id. */
  createProject: (s: StartSettings): Promise<string> =>
    STATIC_SITE ? run(e => e.create(s).id) : call<{ id: string }>('/api/projects', post(s)).then(j => j.id),

  /** Streams a project: a snapshot first, then every event; `missing` if there is no such project. Returns a stop function. */
  openProject(id: string, onEvent: (ev: ProjectEvent) => void): () => void {
    let stop = () => {}, closed = false;
    if (STATIC_SITE) {
      engine().then(e => {
        if (closed) return;
        if (!e.get(id)) { onEvent({ type: 'missing' }); return; }
        stop = e.subscribe(id, onEvent);
      });
    } else {
      fetch(`/api/projects/${id}`).then(r => {
        if (r.status === 404) { onEvent({ type: 'missing' }); return; }
        if (closed) return;
        const es = new EventSource(`/api/projects/${id}/events`);   // reconnects by itself; each connect starts with a snapshot
        es.onmessage = m => onEvent(JSON.parse(m.data));
        stop = () => es.close();
      }).catch(() => onEvent({ type: 'missing' }));
    }
    return () => { closed = true; stop(); };
  },

  editScene: (id: string, scene: number, request: string, patch?: ScenePatch): Promise<unknown> =>
    STATIC_SITE ? run(e => e.editScene(id, scene, request, patch)) : call(`/api/projects/${id}/edit`, post({ scene, request, ...patch })),

  /** Approves a stage waiting at its gate, or sends it back with a note; answers with the project's new state.
   *  `scenes`: scenes marked one by one (storyboard «перерисовать», the final's scene to redo); `allowOverCap`: the
   *  permission to go over the budget cap. */
  gate: (id: string, stage: StageId, version: number, decision: 'approve' | 'revise', note?: string, o: { scenes?: SceneNote[]; allowOverCap?: boolean } = {}): Promise<ProjectState> =>
    STATIC_SITE
      ? run(e => (decision === 'approve' ? e.approve(id, stage, version, note, { allowOverCap: o.allowOverCap }) : e.revise(id, stage, version, note ?? '', { scenes: o.scenes })))
      : call<ProjectState>(`/api/projects/${id}/gate`, post({ stage, version, decision, ...(note && { note }), ...(o.scenes?.length && { scenes: o.scenes }), ...(o.allowOverCap && { allowOverCap: true }) })),

  build: (id: string): Promise<unknown> =>
    STATIC_SITE ? run(e => e.build(id)) : call(`/api/projects/${id}/build`, { method: 'POST' }),

  /** The self-review of the newest cut; fails when the cartoon has not been cut and checked yet. */
  review: (id: string): Promise<Review> =>
    STATIC_SITE
      ? run(e => { const r = e.get(id)?.review; if (!r) throw new Error('Ролик ещё не проверяли: сначала соберите MP4'); return r; })
      : call<Review>(`/api/projects/${id}/review`),

  /** The run of a project as timed events (from its journal), or the demo run recorded in advance (DEMO_REPLAY_ID).
   *  Fails with `missing` set when there is no such project. */
  replay: async (id: string): Promise<Replay> => {
    if (id === DEMO_REPLAY_ID) return import('./engine/demo').then(m => m.demoReplay());
    if (!STATIC_SITE) return call<Replay>(`/api/projects/${encodeURIComponent(id)}/replay`).catch(e => { throw Object.assign(e, { missing: /не найден/.test(e.message) }); });
    const r = await run(e => e.replay(id));
    if (!r) throw Object.assign(new Error('Проект не найден'), { missing: true });
    return r;
  },

  settings: (): Promise<SettingsInfo> =>
    STATIC_SITE ? Promise.resolve({ hasKey: false, engine: 'demo', staticSite: true }) : call<SettingsInfo>('/api/settings'),

  /** Saves (or with '' removes) the own API key in .env.local on the machine running Inkframe. */
  saveApiKey: (apiKey: string): Promise<SettingsInfo> =>
    STATIC_SITE ? Promise.reject(new Error('The demo site has no server to keep a key')) : call<SettingsInfo>('/api/settings', post({ apiKey })),
};
