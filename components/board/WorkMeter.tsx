import { EstimateMeter } from './EstimateMeter';
import { dur, mmss, type EstimateView } from './types';

/** The time meter on the board while the work runs: time since the start against the plan; once the work is over,
 *  plan against fact. `now` is the clock it counts by (the wall clock live, the replay's clock in a replay). */
export function WorkMeter({ e, now }: { e: EstimateView; now: number }) {
  if (e.actualSec !== undefined) return <EstimateMeter e={e} />;
  if (!e.startedAt) return null;
  const plan = e.paintSec + e.voiceSec + e.cutSec, gone = Math.max(0, (now - Date.parse(e.startedAt)) / 1000);
  const share = plan > 0 ? Math.min(1, gone / plan) : 0, over = gone > plan;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-ink-650 px-3 py-2 text-[12px] leading-[1.4]" aria-label="План и факт по времени">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-mist-200">Идёт работа: прошло <b className="tabular-nums">{mmss(gone)}</b> из плана <b>≈ {dur(plan)}</b></span>
        <span className={over ? 'text-warn' : 'text-mist-400'}>{over ? `дольше плана на ${dur(gone - plan)}` : `осталось ≈ ${dur(plan - gone)}`}</span>
      </div>
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-ink-600">
        <i className={`block h-full rounded-full ${over ? 'bg-warn' : 'bg-pen'}`} style={{ width: `${share * 100}%` }} />
      </div>
      <div className="text-mist-400">{e.frames} кадров · {e.workers} {e.workers === 1 ? 'поток' : 'потока'}</div>
    </div>
  );
}
