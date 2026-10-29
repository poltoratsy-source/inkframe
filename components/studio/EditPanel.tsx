'use client';
import { useState } from 'react';
import type { ProjectState } from '@/lib/engine/types';
import { api } from '@/lib/api';
import { STAGE_NAMES } from '@/lib/store/types';

const QUICK = ['ночь', 'крупнее герой', 'медленнее', 'веселее', 'другой голос'];

/** Right column: what the selected scene is, and a text box to redraw just that scene. */
export function EditPanel({ project: p, n }: { project: ProjectState; n: number }) {
  const sc = p.scenes.find(s => s.n === n);
  const [text, setText] = useState('');
  const [sent, setSent] = useState('');
  const [words, setWords] = useState<{ line: string; caption: string } | null>(null);
  const send = async (request: string) => {
    if (!request.trim() || !sc) return;
    setSent('');
    try { await api.editScene(p.id, n, request); setText(''); setSent(`Принято: «${request}»`); }
    catch (e) { setSent((e as Error).message); }
  };
  const saveWords = async () => {
    if (!sc || !words) return;
    const patch = { ...(words.line.trim() !== sc.line && { line: words.line.trim() }), ...(words.caption.trim() !== (sc.caption ?? '') && { caption: words.caption.trim() }) };
    if (!Object.keys(patch).length) { setWords(null); return; }
    setSent('');
    try { await api.editScene(p.id, n, '', patch); setWords(null); setSent('Принято: новые слова, сцена перерисуется'); }
    catch (e) { setSent((e as Error).message); }
  };
  const busy = !!sc && (sc.status === 'sketch' || sc.status === 'painting');
  // scenes are redrawn only after the script is approved and while no gate is open; until then notes go to the gate
  const locked = p.stages.script.status !== 'completed' || !!p.gate;
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-ink-600 bg-ink-850 p-4">
      <h3 className="label">{sc ? `Сцена ${n} — правка` : 'Правка сцены'}</h3>
      {!sc ? <div className="text-mist-400">Сцены появятся, как только Клод допишет раскадровку.</div> : <>
        <div className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 leading-[1.45]"><div className="text-[12px] text-mist-400">Что на экране · «{sc.title}»</div>{sc.visual}</div>
        {locked ? <div className="rounded-[10px] border border-gate/60 bg-gate-bg p-3 text-[13px] leading-[1.45] text-gate">
          {p.gate && p.gate.stage !== 'script'
            ? <>Пока открыто утверждение «{STAGE_NAMES[p.gate.stage]}», замечания пишите на его панели посередине{p.gate.stage === 'storyboard' ? ' — можно отметить отдельные сцены «перерисовать»' : ' — выберите там сцену'}.</>
            : 'Сцены можно будет править, когда сценарий утверждён. Сейчас замечания — на панели «Сценарий» посередине.'}
        </div> : <>
        {words ? (
          <form onSubmit={e => { e.preventDefault(); saveWords(); }} className="flex flex-col gap-2 rounded-[10px] border border-pen/55 bg-ink-700 p-3">
            <label className="text-[12px] text-mist-400">Реплика</label>
            <textarea value={words.line} onChange={e => setWords({ ...words, line: e.target.value })} rows={3} maxLength={300}
              className="resize-none rounded-[8px] border border-ink-500 bg-ink-950 p-2 text-mist-100 outline-none focus:border-pen" />
            <label className="text-[12px] text-mist-400">Надпись на экране</label>
            <input value={words.caption} onChange={e => setWords({ ...words, caption: e.target.value })} maxLength={60}
              className="rounded-[8px] border border-ink-500 bg-ink-950 p-2 text-mist-100 outline-none focus:border-pen" />
            <div className="flex gap-2">
              <button disabled={!words.line.trim()} className="rounded-lg bg-pen px-3 py-1.5 text-[13px] font-bold text-pen-ink disabled:opacity-40">Сохранить и перерисовать</button>
              <button type="button" onClick={() => setWords(null)} className="rounded-lg bg-ink-550 px-3 py-1.5 text-[13px]">Отмена</button>
            </div>
          </form>
        ) : (
          <button onClick={() => setWords({ line: sc.line, caption: sc.caption ?? '' })} title="Изменить реплику и надпись этой сцены"
            className="rounded-[10px] border border-ink-500 bg-ink-700 p-3 text-left leading-[1.45] hover:border-pen/60">
            <div className="text-[12px] text-mist-400">Реплика · {sc.duration.toFixed(1).replace('.', ',')} с · ✎ изменить</div>«{sc.line}»
            {sc.caption ? <div className="mt-1 text-[12px] text-mist-300">Надпись: «{sc.caption}»</div> : null}
          </button>
        )}
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
      </>}
    </aside>
  );
}
