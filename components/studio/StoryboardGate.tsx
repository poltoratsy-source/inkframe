'use client';
import { useState } from 'react';
import { GatePanel } from '../board/GatePanel';
import { SceneCard } from '../board/SceneCard';
import type { CardStatus } from '../board/types';
import { useGate } from './useGate';
import { TEMPLATE_NAMES } from '@/lib/store/decisions';
import type { ProjectState } from '@/lib/engine/types';

/** The storyboard gate: a contact sheet — one draft key frame per scene with its words, timing and template.
 *  A card pressed is marked «перерисовать» and gets its own note; only marked (or, for a general note, changed)
 *  scenes are painted again. */
export function StoryboardGate({ project: p }: { project: ProjectState }) {
  const { gate, version, revising, state, error, sentNote, send } = useGate(p, 'storyboard');
  const [marks, setMarks] = useState<Record<number, string>>({});
  const open = !!gate && state !== 'sending';
  const toggle = (n: number) => open && setMarks(m => {
    const next = { ...m };
    if (n in next) delete next[n]; else next[n] = '';
    return next;
  });
  const scenes = Object.entries(marks).map(([n, note]) => ({ n: Number(n), note: note.trim() })).filter(x => x.note);
  const status = (n: number, key?: string): CardStatus => (n in marks ? 'redraw' : !key ? (revising || p.stages.storyboard.status === 'in_progress' ? 'painting' : 'queued') : gate ? 'awaiting' : 'done');
  const summary = revising
    ? 'Клод правит раскадровку по вашему замечанию: перерисует только те сцены, которые изменятся. Новая версия появится здесь сама.'
    : gate?.summary ?? 'Клод рисует по одному ключевому кадру на сцену…';
  return (
    <GatePanel key={`storyboard-v${version}`} stage="storyboard" version={version} summary={summary} state={state}
      estimate={gate && p.estimate?.stage === 'storyboard' ? p.estimate : undefined} error={error} note={sentNote}
      canRevise={note => !!note.trim() || scenes.length > 0}
      onApprove={(v, allowOverCap) => send('approve', v, undefined, { allowOverCap })}
      onRevise={async (v, note) => { if (await send('revise', v, note, { scenes })) setMarks({}); }}>
      <div className="flex flex-col gap-1.5">
        <div className="text-[12px] text-mist-400">{open ? 'Нажмите на кадр, чтобы отметить сцену «перерисовать» и написать, что в ней поменять.' : ' '}</div>
        <ul aria-label="Раскадровка: ключевые кадры сцен" className={`grid gap-2.5 ${p.format === '9:16' ? 'grid-cols-5 max-lg:grid-cols-3 max-sm:grid-cols-2' : p.format === '1:1' ? 'grid-cols-4 max-lg:grid-cols-3 max-sm:grid-cols-2' : 'grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1'}`}>
          {p.scenes.map(sc => (
            <li key={sc.n} className="flex flex-col gap-1.5">
              <SceneCard picked={sc.n in marks} onPick={() => toggle(sc.n)}
                s={{ n: sc.n, title: sc.title, line: sc.line, start: sc.start, duration: sc.duration, template: TEMPLATE_NAMES[sc.template ?? ''] ?? sc.template ?? '', frame: sc.key, status: status(sc.n, sc.key), edits: sc.edits.length, note: marks[sc.n] || undefined, format: p.format }} />
              {sc.n in marks && (
                <input autoFocus value={marks[sc.n]} maxLength={300} onChange={e => setMarks(m => ({ ...m, [sc.n]: e.target.value }))}
                  aria-label={`Что поменять в сцене ${sc.n}`} placeholder={`Сцена ${sc.n}: что поменять?`}
                  className="rounded-lg border border-gate/60 bg-ink-850 px-2.5 py-1.5 text-[12.5px] text-mist-100 placeholder:text-mist-500 focus:border-pen focus:outline-none" />
              )}
            </li>
          ))}
        </ul>
      </div>
    </GatePanel>
  );
}
