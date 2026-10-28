'use client';
import { useEffect, useRef } from 'react';
import type { LogStep } from '@/lib/engine/types';

const DOT: Record<LogStep['status'], string> = {
  ok: 'bg-ok-bg text-ok', run: 'bg-pen text-pen-ink dot-run', wait: 'bg-ink-600 text-mist-500', err: 'bg-red-900 text-red-200',
};

/** "Клод сейчас делает": every step of the engine as one line. */
export function WorkLog({ idea, log }: { idea: string; log: LogStep[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [log.length]);
  return (
    <aside className="flex min-h-0 flex-col gap-3 border-r border-ink-600 bg-ink-850 p-4">
      <h3 className="label">Идея</h3>
      <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 leading-[1.45]">{idea}</div>
      <h3 className="label">Клод сейчас делает</h3>
      <div className="flex min-h-0 flex-col gap-[9px] overflow-y-auto pr-1">
        {log.length === 0 && <div className="text-mist-400">Начинаю…</div>}
        {log.map((l, i) => (
          <div key={l.id} className="fade-in flex items-start gap-[9px] leading-[1.35]">
            <div className={`mt-px flex size-[18px] flex-none items-center justify-center rounded-full text-[11px] ${DOT[l.status]}`}>
              {l.status === 'ok' ? '✓' : l.status === 'run' ? '●' : l.status === 'err' ? '!' : l.id === 'music' ? '♪' : (l.id.match(/\d+/)?.[0] ?? i + 1)}
            </div>
            <div className="min-w-0">
              <span className={l.status === 'run' ? 'font-semibold text-pen-soft' : l.status === 'wait' ? 'text-mist-400' : ''}>{l.text}</span>
              {l.detail && <><br /><span className="text-mist-400">{l.detail}</span></>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </aside>
  );
}
