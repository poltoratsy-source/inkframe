// How a Decision reads in WorkLog: «решение: …» in a few words (the reason goes under it, the alternatives on a click).
import type { Decision } from './types';

export const TEMPLATE_NAMES: Record<string, string> = { host: 'ведущий', object: 'предмет крупно', compare: 'сравнение', card: 'карточка' };
const tpl = (t: string) => (TEMPLATE_NAMES[t] ? `«${TEMPLATE_NAMES[t]}»` : `«${t}»`);
const WHAT: Record<Decision['what'], string> = {
  template: 'шаблон', style: 'стиль', voice: 'голос', music: 'музыка', fallback: 'запасной путь', format: 'формат', estimate: 'оценка', other: 'решение',
};

export function describeDecision(d: Decision): string {
  if (d.what === 'template') return `решение: сцена ${d.scene ?? '?'} — шаблон ${tpl(d.chosen)}`;
  if (d.what === 'fallback') return `решение: ${d.chosen}`;
  if (d.what === 'estimate') return `решение: ${d.chosen}`;
  return `решение: ${WHAT[d.what]} — ${d.chosen}`;
}

/** The alternatives in words, for the expanded line. */
export const alternativesText = (d: Decision) =>
  d.alternatives.length ? (d.what === 'template' ? d.alternatives.map(tpl) : d.alternatives.map(a => `«${a}»`)).join(', ') : '';
