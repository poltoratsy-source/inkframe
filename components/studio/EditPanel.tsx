'use client';
import { useState } from 'react';
import type { ProjectState } from '@/lib/engine/types';

const QUICK = ['ночь', 'крупнее герой', 'медленнее', 'веселее', 'другой голос'];

/** Right column: what the selected scene is, and a text box to redraw just that scene. */
export function EditPanel({ project: p, n }: { project: ProjectState; n: number }) {
  const sc = p.scenes.find(s => s.n === n);
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const send = async (request: string) => {
    if (!request.trim() || !sc) return;
    setSent('');
    const r = await fetch(`/api/projects/${p.id}/edit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: n, request }) });
    const j = await r.json();
    if (r.ok) { setText(''); setSent(`Принято: «${request}»`); } else setSent(j.error);
  };
  const busy = !!sc && (sc.status === 'sketch' || sc.status === 'painting');
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-ink-600 bg-ink-850 p-4">
      <h3 className="label">{sc ? `Сцена ${n} — правка` : 'Правка сцены'}</h3>
      {!sc ? <div className="text-mist-400">Сцены появятся, как только Клод допишет раскадровку.</div> : <>
        <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 leading-[1.45]"><div className="text-[12px] text-mist-400">Что на экране · «{sc.title}»</div>{sc.visual}</div>
        <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 leading-[1.45]"><div className="text-[12px] text-mist-400">Реплика · {sc.duration.toFixed(1).replace('.', ',')} с</div>«{sc.line}»</div>
        <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3">
          <div className="mb-2 text-[12px] text-mist-400">Быстрые правки</div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map(q => <button key={q} onClick={() => send(q)} className="rounded-[14px] bg-ink-550 px-2.5 py-[5px] text-[12px] hover:bg-pen hover:text-pen-ink">{q}</button>)}
          </div>
        </div>
        <form onSubmit={e => { e.preventDefault(); send(text); }} className="flex flex-col gap-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} maxLength={300}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }}
            placeholder="Сделай лучи зелёными и добавь собаку, которая бежит за машиной…"
            className="resize-none rounded-[9px] border border-pen/55 bg-ink-950 p-[11px] text-mist-100 outline-none placeholder:text-mist-400 focus:border-pen" />
          <button disabled={!text.trim()} className="self-start rounded-lg bg-pen px-3.5 py-1.5 text-[13px] font-bold text-pen-ink disabled:opacity-40">Перерисовать сцену</button>
        </form>
        <div className="text-[12px] text-mist-400">{busy ? 'Сцена сейчас рисуется — правка встанет в очередь.' : 'Клод перерисует только эту сцену, остальное не тронет.'}</div>
        {sent && <div className="fade-in text-[12.5px] text-pen-soft">{sent}</div>}
        {sc.edits.length > 0 && <div className="text-[12px] text-mist-300">Правки: {sc.edits.map(e => `«${e}»`).join(', ')}</div>}
      </>}
    </aside>
  );
}
