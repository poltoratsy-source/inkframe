// Folds engine events into project state. Pure, so the server and the browser fold the same way.
import type { EngineEvent, ProjectState, StartSettings } from './types';

export const NO_LOOK = { filter: 'none', zoom: 1 };

export function emptyProject(id: string, settings: StartSettings, engine: 'demo' | 'real', createdAt = new Date().toISOString()): ProjectState {
  const idea = settings.idea.trim();
  return {
    id, engine, createdAt, settings,
    title: idea.length > 60 ? idea.slice(0, 57) + '…' : idea,
    status: 'drafting', scenes: [], log: [], progress: 0, etaSec: 0, tracks: {},
  };
}

export function applyEvent(s: ProjectState, ev: EngineEvent): ProjectState {
  const scene = (n: number, f: (sc: ProjectState['scenes'][number]) => ProjectState['scenes'][number]) =>
    ({ ...s, scenes: s.scenes.map(sc => (sc.n === n ? f(sc) : sc)) });
  switch (ev.type) {
    case 'snapshot': return ev.state;
    case 'log.add': return { ...s, log: [...s.log, ev.step] };
    case 'log.update': return {
      ...s, log: s.log.map(l => (l.id === ev.id ? {
        ...l, status: ev.status, ...(ev.text !== undefined && { text: ev.text }), ...(ev.detail !== undefined && { detail: ev.detail }),
      } : l)),
    };
    case 'storyboard': return {
      ...s, title: ev.title, status: 'drawing',
      scenes: ev.scenes.map(b => ({ ...b, status: 'queued', colors: [], look: NO_LOOK, edited: false, version: 1, edits: [] })),
    };
    case 'scene.status': return scene(ev.n, sc => ({ ...sc, status: ev.status, ...(ev.status === 'sketch' && { colors: [] }) }));
    case 'frame': {
      const { type: _t, ...current } = ev;
      return {
        ...scene(ev.n, sc => ({
          ...sc, frame: ev.src, frameKind: ev.kind,
          colors: ev.kind === 'color' && !sc.colors.includes(ev.src) ? [...sc.colors, ev.src] : sc.colors,
        })),
        current,
      };
    }
    case 'scene.look': return scene(ev.n, sc => ({ ...sc, look: ev.look }));
    case 'scene.board': return scene(ev.n, sc => ({ ...sc, ...ev.patch }));
    case 'scene.edited': return scene(ev.n, sc => ({ ...sc, edited: true, version: sc.version + 1, edits: [...sc.edits, ev.request] }));
    case 'progress': return { ...s, progress: ev.value, etaSec: ev.etaSec };
    case 'track': return { ...s, tracks: { ...s.tracks, [ev.kind]: ev.peaks } };
    case 'video': return { ...s, video: ev.src || undefined };
    case 'status': return { ...s, status: ev.status };
  }
}

export const canBuild = (s: ProjectState) =>
  (s.status === 'ready' || s.status === 'done') && s.scenes.length > 0 && s.scenes.every(sc => sc.status === 'done');
