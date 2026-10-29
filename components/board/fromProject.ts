// The engine's state as the board components see it (they draw only what they are given; see types.ts).
import type { ProjectState, ProjectSummary, Scene } from '@/lib/engine/types';
import { LIVE_STAGES } from '@/lib/store/types';
import { TEMPLATE_NAMES } from '@/lib/store/decisions';
import { STYLES } from '@/lib/options';
import { studioHref } from '@/lib/site';
import type { LibraryCardView } from './LibraryCard';
import { STAGE_TITLES, mmss, type SceneCardView, type StageView } from './types';

export const stageViews = (p: ProjectState): StageView[] => LIVE_STAGES.map(id => ({ id, ...p.stages[id] }));

export function cardOf(sc: Scene, p: ProjectState): SceneCardView {
  const atGate = p.gate?.stage === 'storyboard' && sc.status === 'queued' && !!sc.key;
  return {
    n: sc.n, title: sc.title, line: sc.line, start: sc.start, duration: sc.duration,
    template: TEMPLATE_NAMES[sc.template ?? ''] ?? sc.template ?? '', frame: sc.frame ?? sc.key,
    status: atGate ? 'awaiting' : sc.status, edits: sc.edits.length, version: sc.version,
  };
}

const styleName = (id: string) => STYLES.find(s => s.id === id)?.title.toLowerCase() ?? id;

export function libraryCardOf(s: ProjectSummary): LibraryCardView {
  const stage = STAGE_TITLES[s.stage];
  const stageText = s.badge === 'awaiting' ? `${stage} ждёт вас`
    : s.badge === 'drawing' ? `${stage} · идёт`
    : s.badge === 'done' ? 'готово'
    : s.badge === 'error' ? `${stage}: ошибка`
    : `черновик · ${stage.toLowerCase()}`;
  return { id: s.id, title: s.title || 'Без названия', href: studioHref(s.id), badge: s.badge, thumb: s.thumb, length: mmss(s.duration), style: styleName(s.style), stage: s.stage, stageText };
}
