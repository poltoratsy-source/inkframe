'use client';
import { useState } from 'react';
import { GatePanel, type GateState } from '../board/GatePanel';
import { mmss } from '../board/types';
import { api } from '@/lib/api';
import type { ProjectState, Scene } from '@/lib/engine/types';

const sec = (s: number) => s.toFixed(1).replace('.', ',').replace(/,0$/, '');

/** The script as a table: what is said in each scene and when. On a phone each row folds into a small card. */
function ScriptTable({ scenes, dim }: { scenes: Scene[]; dim?: boolean }) {
  if (!scenes.length) return <div className="text-[13px] text-mist-400">Сцен пока нет.</div>;
  return (
    <div className={`overflow-x-auto rounded-lg border border-ink-500 ${dim ? 'opacity-50' : ''}`}>
      <table className="w-full border-collapse text-left text-[13px] max-sm:block">
        <caption className="sr-only">Сцены сценария</caption>
        <thead className="bg-ink-700 text-[12px] text-mist-400 max-sm:hidden">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">№</th>
            <th scope="col" className="px-3 py-2 font-semibold">Сцена</th>
            <th scope="col" className="px-3 py-2 font-semibold">Реплика и что на экране</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold">Время</th>
          </tr>
        </thead>
        <tbody className="max-sm:block">
          {scenes.map(sc => (
            <tr key={sc.n} className="border-t border-ink-600 align-top first:border-t-0 max-sm:grid max-sm:grid-cols-[28px_minmax(0,1fr)] max-sm:py-1.5">
              <td className="px-3 py-2 text-mist-400 max-sm:row-span-3 max-sm:pr-0">{sc.n}</td>
              <td className="px-3 py-2 font-semibold max-sm:py-0.5 sm:min-w-[110px]">
                {sc.title}
                {sc.caption ? <div className="mt-0.5 text-[12px] font-normal text-mist-400">надпись «{sc.caption}»</div> : null}
              </td>
              <td className="px-3 py-2 leading-[1.45] text-mist-100 max-sm:col-start-2 max-sm:py-0.5 sm:min-w-[220px]">
                «{sc.line}»
                <div className="mt-0.5 text-[12px] text-mist-400">{sc.visual}</div>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right text-mist-300 max-sm:col-start-2 max-sm:py-0.5 max-sm:text-left max-sm:text-[12px]">
                {mmss(sc.start)}–{mmss(sc.start + sc.duration)}
                <div className="text-[12px] text-mist-400 max-sm:ml-1.5 max-sm:inline">{sec(sc.duration)} с</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The script gate in the studio: the scene list, «Утвердить» and «Вернуть с замечанием». While a sent-back script
 *  is being rewritten the panel stays, showing the note, until the next version opens the gate again. */
export function ScriptGate({ project: p }: { project: ProjectState }) {
  const gate = p.gate?.stage === 'script' ? p.gate : undefined;
  const st = p.stages.script;
  const version = gate?.version ?? st.version;
  const revising = !gate && st.status === 'revised';
  const [ui, setUi] = useState<{ state: 'sending' | 'error'; version: number; error?: string } | null>(null);
  const [sentNote, setSentNote] = useState<string>();

  const send = async (decision: 'approve' | 'revise', v: number, note?: string) => {
    setUi({ state: 'sending', version: v });
    try {
      await api.gate(p.id, 'script', v, decision, note);
      if (decision === 'revise') setSentNote(note);
      setUi(null);
    } catch (e) {
      setUi({ state: 'error', version: v, error: (e as Error).message || 'Не дошло до студии — попробуйте ещё раз.' });
    }
  };

  const mine = ui && ui.version === version ? ui : null;
  const state: GateState = revising ? 'revised' : mine?.state ?? 'awaiting';
  const summary = revising
    ? 'Клод переписывает сценарий по вашему замечанию. Новая версия появится здесь сама, и её снова нужно будет утвердить.'
    : gate?.summary ?? '';
  return (
    <GatePanel key={`script-v${version}`} stage="script" version={version} summary={summary} state={state}
      error={mine?.state === 'error' ? mine.error : undefined} note={sentNote}
      onApprove={v => send('approve', v)} onRevise={(v, note) => send('revise', v, note)}>
      <ScriptTable scenes={p.scenes} dim={revising} />
    </GatePanel>
  );
}
