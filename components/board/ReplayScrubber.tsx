'use client';
import type { KeyboardEvent, PointerEvent } from 'react';
import { mmss, STAGE_TITLES, type StageId } from './types';

const SPEEDS = [1, 4, 16];
const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen';

/** Scrub a finished production: stage marks on the bar, play/pause, speed. `t` and `total` are seconds.
 *  The bar is a slider: ← → 5 s, PgUp / PgDn 30 s, Home / End; space plays or pauses. */
export function ReplayScrubber({ t, total, playing, speed, marks, onSeek, onPlay, onSpeed }: {
  t: number; total: number; playing: boolean; speed: number; marks: { at: number; stage: StageId }[];
  onSeek: (t: number) => void; onPlay: (v: boolean) => void; onSpeed: (v: number) => void;
}) {
  const len = Math.max(total, .001), atEnd = t >= total - .05;
  const key = (e: KeyboardEvent) => {
    const k: Record<string, number> = { ArrowLeft: t - 5, ArrowDown: t - 5, ArrowRight: t + 5, ArrowUp: t + 5, PageDown: t - 30, PageUp: t + 30, Home: 0, End: total };
    if (e.key in k) { e.preventDefault(); onSeek(Math.max(0, Math.min(total, k[e.key]))); }
    if (e.key === ' ') { e.preventDefault(); onPlay(!playing); }
  };
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total);
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-ink-750 px-3 py-2">
      <button type="button" onClick={() => onPlay(!playing)} aria-label={playing ? 'Пауза' : atEnd ? 'Смотреть сначала' : 'Смотреть'}
        className={`flex h-8 w-9 items-center justify-center rounded-md text-[16px] text-pen hover:bg-ink-650 ${focus}`}>{playing ? '❚❚' : atEnd ? '↺' : '▶'}</button>
      <div role="slider" tabIndex={0} aria-label="Повтор прогона" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}
        aria-valuetext={`${mmss(t)} из ${mmss(total)}`} onKeyDown={key}
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seek(e); }}
        onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(e); }}
        className="relative order-last h-6 basis-full cursor-pointer touch-none rounded-full focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-pen sm:order-none sm:flex-1 sm:basis-auto">
        <div className="absolute inset-x-0 top-2 h-2 rounded-full bg-ink-600">
          <div className="absolute inset-y-0 left-0 rounded-full bg-pen" style={{ width: `${(t / len) * 100}%` }} />
          {marks.map(m => <span key={m.stage} title={STAGE_TITLES[m.stage]} aria-hidden className="absolute -top-1 h-4 w-px bg-mist-400" style={{ left: `${(m.at / len) * 100}%` }} />)}
          <span aria-hidden className="absolute -top-1 size-4 -translate-x-1/2 rounded-full border-2 border-ink-900 bg-pen" style={{ left: `${(t / len) * 100}%` }} />
        </div>
      </div>
      <span className="min-w-[92px] flex-1 text-[12px] tabular-nums text-mist-300 sm:flex-none sm:text-right">{mmss(t)} из {mmss(total)}</span>
      <div className="flex gap-1" role="group" aria-label="Скорость">
        {SPEEDS.map(v => (
          <button key={v} type="button" aria-pressed={speed === v} onClick={() => onSpeed(v)}
            className={`rounded-md px-2 py-0.5 text-[12px] ${focus} ${speed === v ? 'bg-pen font-bold text-pen-ink' : 'bg-ink-650 text-mist-300 hover:bg-ink-600'}`}>×{v}</button>
        ))}
      </div>
    </div>
  );
}
