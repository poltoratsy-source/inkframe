'use client';
import { useRef, useState } from 'react';
import { GatePanel } from '../board/GatePanel';
import { ReviewReport } from '../board/ReviewReport';
import { useGate } from './useGate';
import type { ProjectState } from '@/lib/engine/types';

/** The final gate: the checked MP4 with its self-review. «Утвердить» hands it out; «Вернуть с замечанием» redoes
 *  the scene picked below by the note, then the MP4 is cut and checked again (the next version of this gate). */
export function FinalGate({ project: p }: { project: ProjectState }) {
  const { gate, version, state, error, sentNote, send } = useGate(p, 'final');
  const [scene, setScene] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const video = p.video ?? p.review?.video;
  const seek = (t: number) => { const v = player.current; if (v) { v.currentTime = t; v.pause(); } };
  const named = (note: string) => /^(?:сцен[аеуы]?|scene)\s*\d+/i.test(note.trim());
  return (
    <GatePanel key={`final-v${version}`} stage="final" version={version} summary={gate?.summary ?? ''} state={state}
      estimate={gate ? p.estimate : undefined} error={error} note={sentNote}
      canRevise={note => !!note.trim() && (scene > 0 || named(note))}
      onApprove={v => send('approve', v)}
      onRevise={(v, note) => send('revise', v, note, scene ? { scenes: [{ n: scene, note }] } : {})}
      afterNote={
        <label className="flex items-center gap-2 text-[13px]">
          <span className="label">Какую сцену переделать</span>
          <select value={scene} onChange={e => setScene(Number(e.target.value))}
            className="min-w-0 flex-1 rounded-lg border border-mist-450 bg-ink-850 px-2.5 py-1.5 text-[13px] text-mist-100 focus:border-pen focus:outline-none">
            <option value={0}>— выберите сцену —</option>
            {p.scenes.map(sc => <option key={sc.n} value={sc.n}>Сцена {sc.n} · {sc.title}</option>)}
          </select>
        </label>
      }>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        {video && <video ref={player} src={video} controls className="aspect-video w-full rounded-lg bg-black" aria-label="Собранный ролик" />}
        {p.review && <ReviewReport r={p.review} onSeek={seek} />}
      </div>
    </GatePanel>
  );
}
