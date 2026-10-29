'use client';
import { useEffect, useRef, useState } from 'react';
import type { LogStep } from '@/lib/engine/types';
import { alternativesText } from '@/lib/store/decisions';

const SURE = { high: 'уверен', medium: 'скорее да', low: 'запасной вариант' } as const;

/** A «решение: …» line: short; a click opens what else there was and how sure the choice is. */
function DecisionLine({ l }: { l: LogStep }) {
  const [open, setOpen] = useState(false), d = l.decision!, alt = alternativesText(d);
  return (
    <div className="fade-in flex items-start gap-[9px] pl-[27px] text-[12.5px] leading-[1.35]">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="min-w-0 text-left text-mist-300 hover:text-mist-100 focus-visible:outline focus-visible:outline-pen">
        <span className={d.what === 'fallback' ? 'text-warn' : ''}>{l.text}</span>
        {open && <span className="mt-0.5 block text-mist-400">
          {d.reason}{alt && <><br />Были варианты: {alt}</>}<br />{SURE[d.confidence]}
        </span>}
      </button>
    </div>
  );
}

const DOT: Record<LogStep['status'], string> = {
  ok: 'bg-ok-bg text-ok', run: 'bg-pen text-pen-ink dot-run', wait: 'bg-ink-600 text-mist-500', err: 'bg-red-900 text-red-200',
};

/** A stage waiting for the user (its gate line), not a step waiting its turn. */
const gateWait = (l: LogStep) => l.status === 'wait' && l.id.startsWith('gate-');

/** "Клод сейчас делает": every step of the engine as one line. */
export function WorkLog({ idea, log, empty = 'Начинаю…', title = 'Клод сейчас делает' }: { idea: string; log: LogStep[]; empty?: string; title?: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [log.length]);
  return (
    <aside className="flex min-h-0 flex-col gap-3 border-r border-ink-600 bg-ink-850 p-4">
      <h3 className="label">Идея</h3>
      <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 leading-[1.45]">{idea}</div>
      <h3 className="label">{title}</h3>
      <div className="flex min-h-0 flex-col gap-[9px] overflow-y-auto pr-1">
        {log.length === 0 && <div className="text-mist-400">{empty}</div>}
        {log.map((l, i) => l.decision ? <DecisionLine key={l.id} l={l} /> : (
          <div key={l.id} className="fade-in flex items-start gap-[9px] leading-[1.35]">
            <div className={`mt-px flex size-[18px] flex-none items-center justify-center rounded-full text-[11px] ${gateWait(l) ? 'bg-gate-bg text-gate' : DOT[l.status]}`}>
              {l.status === 'ok' ? '✓' : l.status === 'run' ? '●' : l.status === 'err' ? '!' : gateWait(l) ? '?' : l.id === 'music' ? '♪' : (l.id.match(/\d+/)?.[0] ?? i + 1)}
            </div>
            <div className="min-w-0">
              <span className={gateWait(l) ? 'font-semibold text-gate' : l.status === 'run' ? 'font-semibold text-pen-soft' : l.status === 'wait' ? 'text-mist-400' : ''}>{l.text}</span>
              {l.detail && <><br /><span className="text-mist-400">{l.detail}</span></>}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
    </aside>
  );
}
