import { dur, type EstimateView } from './types';

/** What the next step will cost, before it runs; after it ran, plan against fact. */
export function EstimateMeter({ e, onAllow, allowed }: { e: EstimateView; onAllow?: (v: boolean) => void; allowed?: boolean }) {
  const total = e.paintSec + e.voiceSec + e.cutSec, over = e.capSec !== undefined && total > e.capSec;
  const tone = e.mode === 'cap' && over ? 'text-danger' : e.mode === 'warn' && over ? 'text-warn' : 'text-mist-200';
  return (
    <div className="rounded-lg bg-ink-650 px-3 py-2 text-[12px]">
      <div className={tone}>
        <b>≈ {dur(total)}</b> · {e.frames} кадров · {e.workers} потока · Claude {e.claudeCalls} запр. · {e.diskMb} МБ
        {e.actualSec !== undefined && <> · факт <b>{dur(e.actualSec)}</b></>}
      </div>
      {over && e.mode === 'warn' && <div className="mt-1 text-warn">Дольше обычного порога ({dur(e.capSec!)}).</div>}
      {over && e.mode === 'cap' && (
        <label className="mt-1.5 flex items-center gap-2 text-danger">
          <input type="checkbox" checked={!!allowed} onChange={ev => onAllow?.(ev.target.checked)} className="accent-[var(--color-pen)]" />
          Выше лимита {dur(e.capSec!)} — нужно ваше разрешение
        </label>
      )}
    </div>
  );
}
