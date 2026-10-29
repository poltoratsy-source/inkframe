import { mmss, type CheckId, type ReviewView } from './types';

const NAME: Record<CheckId, string> = {
  probe: 'Файл читается', duration: 'Длина', black: 'Чёрные кадры', blank: 'Пустые кадры', silence: 'Тишина',
  clipping: 'Перегруз звука', subtitles: 'Субтитры', slideshow: 'Не «слайд-шоу»',
};
const HEAD = {
  PASS: ['bg-ok-bg text-ok', 'Проверка пройдена'], WARN: ['bg-warn-bg text-warn', 'Есть замечания'], FAIL: ['bg-danger-bg text-danger', 'Нашлись ошибки — MP4 не отдаю'],
} as const;

/** The self-review of a finished MP4; times are chips that jump the video there. */
export function ReviewReport({ r, onSeek }: { r: ReviewView; onSeek?: (t: number) => void }) {
  const [cls, title] = HEAD[r.decision];
  return (
    <section aria-label="Проверка ролика" className="overflow-hidden rounded-[10px] border border-ink-500 bg-ink-750">
      <div className={`px-3 py-2 text-[13px] font-bold ${cls}`}>{title}</div>
      <ul className="flex flex-col gap-1.5 p-3 text-[13px]">
        {r.checks.map(c => (
          <li key={c.id} className="flex items-start gap-2">
            <span aria-hidden className={`w-4 flex-none text-center ${c.ok ? 'text-ok' : c.warn ? 'text-warn' : 'text-danger'}`}>{c.ok ? '✓' : c.warn ? '!' : '✕'}</span>
            <span className="min-w-0"><b className="font-semibold">{NAME[c.id]}</b><span className="sr-only">{c.ok ? ' — да' : ' — нет'}</span>
              <span className="text-mist-300"> — {c.detail}</span>
              {c.at?.map(t => <button key={t} type="button" onClick={() => onSeek?.(t)} className="ml-1.5 rounded-full bg-ink-600 px-2 py-0.5 text-[11px] text-mist-200 hover:bg-ink-500">{mmss(t)}</button>)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
