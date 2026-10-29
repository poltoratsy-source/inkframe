'use client';
import { useEffect, useRef, useState } from 'react';
import type { Look, ProjectState } from '@/lib/engine/types';
import { STAGE_NAMES } from '@/lib/store/types';
import { fitIn169 } from '../board/types';

const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const eta = (s: number) => (s < 60 ? `~${Math.max(1, Math.round(s))} с` : `~${Math.round(s / 60)} мин`);
const lookStyle = (look: Look, color: boolean) => ({ filter: color ? look.filter : 'none', transform: `scale(${look.zoom})` });

/** The big frame. A new frame wipes in behind the orange "pen"; finished scenes play back as a flipbook. */
export function Stage({ project: p, selected, error }: { project: ProjectState; selected: number; error?: string }) {
  const sc = p.scenes.find(s => s.n === selected);
  const live = p.current && p.current.n === selected && sc && (sc.status === 'sketch' || sc.status === 'painting') ? p.current : undefined;

  // remember the frame under the one being revealed
  const [layers, setLayers] = useState<{ prev?: string; cur?: string }>({});
  const shown = live?.src;
  useEffect(() => { if (shown) setLayers(l => (l.cur === shown ? l : { prev: l.cur, cur: shown })); }, [shown]);

  // flipbook of a finished scene
  const [tick, setTick] = useState(0);
  const playing = !live && !!sc && sc.status === 'done' && sc.colors.length > 0;
  useEffect(() => { if (!playing) return; const t = setInterval(() => setTick(x => x + 1), 220); return () => clearInterval(t); }, [playing]);
  const lastIdx = useRef(0);
  if (playing) lastIdx.current = tick % sc.colors.length;

  const color = live ? live.kind === 'color' : true;
  const tag = live
    ? `Сцена ${sc!.n} · ${clock(sc!.start + live.index / 12)} · кадр ${live.index}/${live.total}`
    : sc ? `Сцена ${sc.n} · ${clock(sc.start)} · ${sc.duration} с` : 'Раскадровка';
  const pill = !sc ? null : sc.status === 'painting' ? '● рисуется' : sc.status === 'sketch' ? '✎ набросок' : sc.status === 'done' ? (sc.edited ? '✓ изменено' : '✓ готово') : 'в очереди';
  const pct = Math.round(p.progress * 100);
  // a 9:16 or 1:1 frame is shown whole in the 16:9 stage, on the paper colour, never stretched or cropped
  const fit = fitIn169(p.format);

  return (
    <section className="flex min-h-0 min-w-0 flex-col gap-2.5 px-5 py-4">
      <div className="relative aspect-video max-h-[calc(100%-36px)] w-full overflow-hidden rounded-xl border border-ink-500 bg-[#f3ebdc]">
        {live && layers.cur && <>
          {layers.prev && <img src={layers.prev} alt="" className={`absolute inset-0 size-full ${fit}`} style={lookStyle(sc!.look, !layers.prev.includes('-sketch'))} />}
          <div key={layers.cur} className="reveal absolute inset-0" style={{ ['--pen-ms' as string]: color ? '560ms' : '420ms' }}>
            <img src={layers.cur} alt="" className={`size-full ${fit}`} style={lookStyle(sc!.look, color)} />
          </div>
          <div key={layers.cur + '-pen'} className="pen" style={{ ['--pen-ms' as string]: color ? '560ms' : '420ms' }} />
        </>}
        {playing && <img src={sc.colors[lastIdx.current]} alt="" className={`absolute inset-0 size-full ${fit}`} style={lookStyle(sc.look, true)} />}
        {!live && !playing && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-ink-750 text-mist-400">
            <div className="text-4xl">✏</div>
            <div>{!sc ? 'Клод пишет сценарий…' : `Сцена ${sc.n} ждёт своей очереди`}</div>
          </div>
        )}
        <div className="absolute top-3.5 left-3.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-[13px]">{tag}</div>
        {p.format && p.format !== '16:9' && <div className="absolute bottom-3.5 left-3.5 rounded-lg bg-black/65 px-2 py-1 text-[12px] text-mist-200" title="формат кадра">{p.format}</div>}
        {p.engine === 'demo' && p.settings.format !== '16:9' && (
          <div className="absolute bottom-3.5 left-3.5 max-w-[45%] rounded-lg bg-black/70 px-2 py-1 text-[12px] text-mist-200">демо-ролик горизонтальный: {p.settings.format} рисует настоящий движок</div>
        )}
        {pill && <div className={`absolute top-3.5 right-3.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold ${sc?.status === 'done' ? 'bg-ok-bg text-ok' : 'bg-pen/95 text-pen-ink'}`}>{pill}</div>}
        {sc && <div className="absolute bottom-[18px] left-1/2 max-w-[78%] -translate-x-1/2 rounded-lg bg-black/70 px-3.5 py-2 text-center text-[15px]">«{sc.line}»</div>}
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-mist-400">Весь ролик</span>
        <div className="h-2 flex-1 overflow-hidden rounded bg-ink-600"><i className="block h-full bg-[linear-gradient(90deg,#ff8a3d,#ffb27d)] transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
        <span className="min-w-[170px] text-right text-mist-400">
          {error ? <span className="text-pen-soft">{error}</span>
            : p.status === 'done' ? 'MP4 собран' : p.status === 'building' ? 'Собираю MP4…' : p.status === 'ready' ? '100 % · можно собирать MP4'
            : p.status === 'drafting' ? (p.stages.script.status === 'completed' ? 'рисую раскадровку…' : 'пишу сценарий…')
            : p.status === 'awaiting' ? `${STAGE_NAMES[p.gate?.stage ?? 'script'].toLowerCase()} ждёт вашего решения` : `${pct} % · осталось ${eta(p.etaSec)}`}
        </span>
      </div>
    </section>
  );
}
