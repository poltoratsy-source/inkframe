import { dur, needsPermission, type EstimateView } from './types';

const parts = (paint: number, voice: number, cut: number) =>
  [`отрисовка ${dur(paint)}`, voice > 0 && `голос ${dur(voice)}`, cut > 0 && `сборка и проверка ${dur(cut)}`].filter(Boolean).join(' · ');

/** What the next step will cost, before it runs; after it ran, plan against fact. */
export function EstimateMeter({ e, onAllow, allowed }: { e: EstimateView; onAllow?: (v: boolean) => void; allowed?: boolean }) {
  const total = e.paintSec + e.voiceSec + e.cutSec, over = e.capSec !== undefined && total > e.capSec;
  const done = e.actualSec !== undefined, capped = needsPermission(e);
  const tone = !done && e.mode === 'cap' && over ? 'text-danger' : !done && e.mode === 'warn' && over ? 'text-warn' : 'text-mist-200';
  const off = done && total > 0 ? Math.round((e.actualSec! - total) / total * 100) : 0;
  return (
    <div className="rounded-lg bg-ink-650 px-3 py-2 text-[12px] leading-[1.5]" aria-label="Оценка затрат">
      <div className={tone}>
        {done
          ? <>План <b>≈ {dur(total)}</b> · факт <b>{dur(e.actualSec!)}</b>{off !== 0 && <span className="text-mist-400"> ({off > 0 ? `дольше на ${off} %` : `быстрее на ${-off} %`})</span>}</>
          : <>Оценка: <b>≈ {dur(total)}</b> <span className="text-mist-300">— {parts(e.paintSec, e.voiceSec, e.cutSec)}</span></>}
      </div>
      <div className="text-mist-400">
        {e.frames} кадров{e.keyFrames || e.draftFrames || e.finalFrames ? ` (${[e.keyFrames && `ключевых ${e.keyFrames}`, e.draftFrames && `черновых ${e.draftFrames}`, e.finalFrames && `чистовых ${e.finalFrames}`].filter(Boolean).join(', ')})` : ''}
        {' '}· {e.workers} {e.workers === 1 ? 'поток' : 'потока'} · Claude {e.claudeCalls} запр. · {e.diskMb} МБ на диске
        {e.measured !== undefined && <> · скорость {e.measured ? 'по замерам этого сервера' : 'примерная (замеров ещё нет)'}</>}
      </div>
      {done && e.actual && <div className="text-mist-400">Факт по частям: {parts(e.actual.paintSec, e.actual.voiceSec, e.actual.cutSec)}</div>}
      {!done && over && e.mode === 'warn' && <div className="mt-1 text-warn">Дольше обычного порога ({dur(e.capSec!)}).</div>}
      {!done && over && e.mode === 'cap' && (
        <label className="mt-1.5 flex items-center gap-2 text-danger">
          <input type="checkbox" checked={!!allowed} onChange={ev => onAllow?.(ev.target.checked)} className="accent-[var(--color-pen)]" />
          <span>Выше лимита {dur(e.capSec!)} — <b>Разрешаю превысить лимит</b>{capped && !allowed ? ' (без этого «Утвердить» не сработает)' : ''}</span>
        </label>
      )}
    </div>
  );
}
