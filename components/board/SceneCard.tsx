import { frameBox, mmss, type SceneCardView } from './types';

const SAY: Record<SceneCardView['status'], string> = {
  queued: 'в очереди', sketch: 'набросок', painting: 'рисую', done: 'готово', awaiting: 'ждёт вас', redraw: 'перерисовать',
};

/** One scene on the contact sheet or the filmstrip: key frame, words, timing. */
export function SceneCard({ s, picked, onPick }: { s: SceneCardView; picked?: boolean; onPick?: () => void }) {
  const ring = picked ? 'border-pen' : s.status === 'awaiting' ? 'border-gate/60' : 'border-ink-500';
  return (
    <button type="button" onClick={onPick} aria-pressed={onPick ? !!picked : undefined}
      className={`flex w-full flex-col gap-2 rounded-[10px] border-2 ${ring} bg-ink-700 p-2 text-left hover:bg-ink-650 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen`}>
      <div className="relative overflow-hidden rounded-md bg-ink-950" style={frameBox(s.format)}>
        {s.frame
          ? <img src={s.frame} alt={s.title} className={`fade-in size-full object-cover ${s.status === 'sketch' ? 'sketchy' : ''}`} />
          : <div className="flex size-full items-center justify-center text-[12px] text-mist-500">кадр появится здесь</div>}
        {s.status === 'painting' && <div className="pen" style={{ ['--pen-ms' as string]: '1800ms' }} />}
        <span className="absolute left-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold">№{s.n}</span>
        <span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] text-mist-200">{SAY[s.status]}</span>
      </div>
      <div className="px-0.5">
        <div className="truncate text-[13px] font-semibold">{s.title}</div>
        <div className="line-clamp-2 text-[12px] leading-[1.35] text-mist-300">«{s.line}»</div>
        <div className="mt-1 flex gap-2 text-[11px] text-mist-400">
          <span>{mmss(s.start)}–{mmss(s.start + s.duration)}</span><span>· {s.template}</span>
          {(s.version ?? 1) > 1 && <span>· v{s.version}</span>}
          {s.edits > 0 && <span>· правок {s.edits}</span>}
        </div>
        {s.status === 'redraw' && s.note && <div className="mt-1 text-[12px] text-gate">↺ {s.note}</div>}
      </div>
    </button>
  );
}
