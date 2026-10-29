'use client';
import type { KeyboardEvent } from 'react';
import { mmss, STAGE_TITLES, type StageId } from './types';

/** Scrub a finished production: stage marks on the bar, play/pause, speed. */
export function ReplayScrubber({ t, total, playing, speed, marks, onSeek, onPlay, onSpeed }: {
  t: number; total: number; playing: boolean; speed: number; marks: { at: number; stage: StageId }[];
  onSeek: (t: number) => void; onPlay: (v: boolean) => void; onSpeed: (v: number) => void;
}) {
  const key = (e: KeyboardEvent) => {
    const k: Record<string, number> = { ArrowLeft: t - 5, ArrowRight: t + 5, Home: 0, End: total };
    if (e.key in k) { e.preventDefault(); onSeek(Math.max(0, Math.min(total, k[e.key]))); }
    if (e.key === ' ') { e.preventDefault(); onPlay(!playing); }
  };
  return (
    <div className="flex h-11 items-center gap-3 rounded-[10px] bg-ink-750 px-3">
      <button type="button" onClick={() => onPlay(!playing)} aria-label={playing ? 'Пауза' : 'Смотреть'} className="w-8 text-[16px] text-pen">{playing ? '❚❚' : '▶'}</button>
      <div role="slider" tabIndex={0} aria-label="Повтор прогона" aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(t)}
        aria-valuetext={`${mmss(t)} из ${mmss(total)}`} onKeyDown={key}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek(((e.clientX - r.left) / r.width) * total); }}
        className="relative h-2 flex-1 cursor-pointer rounded-full bg-ink-600 focus:outline focus:outline-2 focus:outline-pen">
        <div className="absolute inset-y-0 left-0 rounded-full bg-pen" style={{ width: `${(t / total) * 100}%` }} />
        {marks.map(m => <span key={m.stage} title={STAGE_TITLES[m.stage]} className="absolute -top-1 h-4 w-px bg-mist-400" style={{ left: `${(m.at / total) * 100}%` }} />)}
      </div>
      <span className="w-[92px] text-right text-[12px] tabular-nums text-mist-300">{mmss(t)} из {mmss(total)}</span>
      <div className="flex gap-1" role="group" aria-label="Скорость">
        {[1, 4, 16].map(v => (
          <button key={v} type="button" aria-pressed={speed === v} onClick={() => onSpeed(v)}
            className={`rounded-md px-2 py-0.5 text-[12px] ${speed === v ? 'bg-pen text-pen-ink font-bold' : 'bg-ink-650 text-mist-300'}`}>×{v}</button>
        ))}
      </div>
    </div>
  );
}
