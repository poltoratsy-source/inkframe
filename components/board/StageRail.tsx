import { STAGE_TITLES, type StageStatus, type StageView } from './types';

const DOT: Record<StageStatus, string> = {
  pending: 'bg-ink-500', in_progress: 'bg-pen dot-run', awaiting: 'bg-gate', completed: 'bg-ok-bg text-ok',
  revised: 'bg-ink-500 text-mist-200', failed: 'bg-danger-bg text-danger',
};
const SAY: Record<StageStatus, string> = {
  pending: 'впереди', in_progress: 'идёт', awaiting: 'ждёт вас', completed: 'готово', revised: 'переделано', failed: 'ошибка',
};

/** The production's stages, left to right; the live one is marked for screen readers too. */
export function StageRail({ stages }: { stages: StageView[] }) {
  return (
    <ol className="flex h-10 items-center gap-1.5 overflow-x-auto border-b border-ink-600 bg-ink-850 px-4 text-[12px] font-semibold">
      {stages.map((s, i) => (
        <li key={s.id} aria-current={s.status === 'in_progress' || s.status === 'awaiting' ? 'step' : undefined}
          className={`flex flex-none items-center gap-1.5 ${s.status === 'pending' ? 'text-mist-500' : s.status === 'awaiting' ? 'text-gate' : 'text-mist-200'}`}>
          {i > 0 && <span aria-hidden className="mx-1 h-px w-4 bg-ink-500" />}
          <span aria-hidden className={`flex size-[16px] items-center justify-center rounded-full text-[10px] ${DOT[s.status]}`}>
            {s.status === 'completed' ? '✓' : s.status === 'revised' ? '↺' : s.status === 'failed' ? '!' : ''}
          </span>
          <span>{STAGE_TITLES[s.id]}{s.version > 1 && <span className="ml-1 text-mist-400">v{s.version}</span>}</span>
          <span className="sr-only">: {SAY[s.status]}</span>
          {s.status === 'awaiting' && <span className="rounded-full bg-gate-bg px-2 py-0.5 text-[11px] text-gate">ждёт вас</span>}
        </li>
      ))}
    </ol>
  );
}
