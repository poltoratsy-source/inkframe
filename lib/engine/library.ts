// The library: one card per project, the same for both engines. Pure, so the static demo site sorts the same way.
import type { LibraryBadge, ProjectState, ProjectSummary, StageId } from './types';
import { STAGE_IDS } from '../store/types';

const RUNNING = ['drafting', 'drawing', 'building'];

/** рисую / ждёт вас / готово / ошибка / черновик */
export function badgeOf(s: ProjectState): LibraryBadge {
  const lastErr = s.log.length > 0 && s.log[s.log.length - 1].status === 'err';
  if (s.gate || s.status === 'awaiting') return 'awaiting';
  if (RUNNING.includes(s.status) && !lastErr) return 'drawing';
  if (s.status === 'done') return 'done';
  if (lastErr || STAGE_IDS.some(id => s.stages[id].status === 'failed')) return 'error';
  return s.video ? 'done' : 'draft';
}

/** The stage a project is at: the open gate, the live stage, the last failed one, else the last one done. */
export function stageOf(s: ProjectState): StageId {
  if (s.gate) return s.gate.stage;
  const by = (...st: string[]) => STAGE_IDS.filter(id => st.includes(s.stages[id].status));
  return by('awaiting', 'in_progress', 'revised')[0] ?? by('failed').at(-1) ?? by('completed').at(-1) ?? 'brief';
}

export function summarize(s: ProjectState): ProjectSummary {
  const stage = stageOf(s);
  return {
    id: s.id, title: s.title, status: s.status, duration: s.settings.duration, style: s.settings.style, createdAt: s.createdAt,
    thumb: s.scenes.find(sc => sc.frameKind === 'color')?.frame ?? s.scenes.find(sc => sc.key)?.key ?? s.scenes[0]?.frame,
    stage, stageStatus: s.stages[stage].status, badge: badgeOf(s), scenes: s.scenes.length, format: s.format ?? '16:9',
    ...(s.gate && { awaiting: s.gate.stage }),
  };
}

/** «ждёт вас» first, then «рисую», then the rest, newest first within each. */
const RANK: Record<LibraryBadge, number> = { awaiting: 0, drawing: 1, error: 2, draft: 2, done: 2 };
export const sortLibrary = (xs: ProjectSummary[]) =>
  [...xs].sort((a, b) => RANK[a.badge] - RANK[b.badge] || b.createdAt.localeCompare(a.createdAt));

export const libraryOf = (states: Iterable<ProjectState>) => sortLibrary([...states].map(summarize));
