import type { Badge } from './types';

const LOOK: Record<Badge, [string, string]> = {
  drawing: ['bg-pen text-pen-ink dot-run', 'рисую'], awaiting: ['bg-gate-bg text-gate', 'ждёт вас'], done: ['bg-ok-bg text-ok', 'готово'],
  error: ['bg-danger-bg text-danger', 'ошибка'], draft: ['bg-ink-600 text-mist-300', 'черновик'],
};

/** The state of a project in the library and in «Недавние». */
export function LibraryBadge({ b }: { b: Badge }) {
  const [cls, text] = LOOK[b];
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}
