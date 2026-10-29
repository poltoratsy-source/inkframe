'use client';
import type { ProjectState } from '@/lib/engine/types';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const STATUS = { queued: 'в очереди', sketch: 'набросок', painting: 'рисую', done: 'готово' } as const;

function Wave({ peaks, color, dim, empty }: { peaks?: number[]; color: string; dim?: boolean; empty: string }) {
  if (!peaks) return <div className="flex h-[34px] min-w-0 flex-1 items-center rounded-[7px] bg-ink-700 px-3 text-[12px] text-mist-500">{empty}</div>;
  const bars = 240, step = peaks.length / bars;
  return (
    <div className={`fade-in flex h-[34px] min-w-0 flex-1 items-center gap-[2px] overflow-hidden rounded-[7px] bg-ink-700 px-2 ${dim ? 'opacity-50' : ''}`}>
      {Array.from({ length: bars }, (_, i) => {
        const v = peaks[Math.floor(i * step)] ?? 0;
        return <i key={i} className="block min-w-px max-w-[3px] flex-1 rounded-sm" style={{ height: `${Math.max(3, v * 30)}px`, background: color }} />;
      })}
    </div>
  );
}

/** Bottom strip: one card per scene, then the voice and music lanes. The cards fill in as the run goes:
 *  в очереди → набросок → рисую (the pen runs over the newest frame) → готово, with the version after a redraw. */
export function Timeline({ project: p, selected, onPick }: { project: ProjectState; selected: number; onPick: (n: number) => void }) {
  const placeholders = p.scenes.length ? [] : [1, 2, 3];
  return (
    <footer className="flex flex-col gap-2.5 border-t border-ink-600 bg-ink-850 px-5 py-3">
      <div className="flex h-[120px] gap-2.5" aria-label="Сцены" role="group">
        {p.scenes.map(sc => {
          const img = sc.frame ?? sc.key, live = sc.status === 'sketch' || sc.status === 'painting';
          const word = sc.status === 'done' ? (sc.edited ? 'изменено' : 'готово') : STATUS[sc.status];
          const more = [sc.version > 1 && `v${sc.version}`, sc.edits.length > 0 && `правок ${sc.edits.length}`].filter(Boolean).join(' · ');
          return (
            <button key={sc.n} type="button" onClick={() => onPick(sc.n)} aria-label={`Сцена ${sc.n}: ${word}${more ? `, ${more}` : ''}`}
              className={`relative min-w-0 flex-1 overflow-hidden rounded-[9px] border-2 bg-ink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen ${sc.n === selected ? 'border-pen' : img ? 'border-transparent' : 'border-dashed border-ink-500'}`}>
              {img
                ? <img key={img} src={img} alt="" className={`fade-in size-full object-cover ${sc.status === 'sketch' ? 'sketchy' : ''} ${sc.status === 'queued' ? 'opacity-45' : ''}`}
                  style={{ filter: sc.frameKind === 'color' && sc.status !== 'sketch' ? sc.look.filter : undefined, transform: `scale(${sc.look.zoom})` }} />
                : <span className="text-mist-500">{sc.n} · в очереди</span>}
              {sc.status === 'painting' && img && <div key={img + '-pen'} className="pen" style={{ ['--pen-ms' as string]: '600ms' }} />}
              {img && <span className="absolute top-1.5 left-1.5 rounded-md bg-black/70 px-[7px] py-0.5 text-[12px]">{sc.n}</span>}
              {img && <span className={`absolute right-1.5 bottom-1.5 rounded-md px-1.5 py-0.5 text-[11px] ${sc.edited && sc.status === 'done' ? 'bg-pen text-pen-ink' : live ? 'bg-pen/90 font-semibold text-pen-ink' : 'bg-black/70'}`}>
                {sc.status === 'queued' ? 'в очереди' : `${mmss(sc.start)} · ${word}`}</span>}
              {more && <span className="absolute top-1.5 right-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] text-mist-200">{sc.edited && sc.status === 'done' ? '✎ ' : ''}{more}</span>}
            </button>
          );
        })}
        {placeholders.map(n => <div key={n} className="flex min-w-0 flex-1 items-center justify-center rounded-[9px] border-2 border-dashed border-ink-500 text-mist-500">сцена {n} · пишется</div>)}
      </div>
      <div className="flex h-[38px] items-center gap-2.5"><div className="w-[110px] text-[13px] text-mist-300">🎙 Голос</div>
        <Wave peaks={p.tracks.voice} color="var(--color-voice)" empty={p.settings.voice === 'none' ? 'без голоса' : 'ждёт озвучки…'} /></div>
      <div className="flex h-[38px] items-center gap-2.5"><div className="w-[110px] text-[13px] text-mist-300">♪ Музыка</div>
        <Wave peaks={p.tracks.music} color="var(--color-music)" dim empty={p.settings.music === 'none' ? 'без музыки' : 'подберу после сцен'} /></div>
    </footer>
  );
}
