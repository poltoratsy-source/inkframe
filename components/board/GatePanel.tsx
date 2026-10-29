'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EstimateMeter } from './EstimateMeter';
import { STAGE_TITLES, needsPermission, type EstimateView, type StageId } from './types';

export type GateState = 'awaiting' | 'sending' | 'approved' | 'revised' | 'error';

const PLACEHOLDER: Partial<Record<StageId, string>> = {
  script: 'Например: короче вторую сцену, в конце — кодовое слово крупно',
  storyboard: 'Например: во второй сцене ночь, в последней герой крупнее',
  final: 'Например: в этой сцене реплика короче и медленнее',
};

/** A stage that waits for a human: approve it, or send it back with a note. The version goes with the answer,
 *  so a second tab cannot approve something that was already replaced. Budget mode `cap`: above the cap
 *  «Утвердить» stays off until the permission box is ticked (and the server refuses it without that too). */
export function GatePanel({ stage, version, summary, estimate, state = 'awaiting', error, note: sentNote, children, canRevise, afterNote, onApprove, onRevise }: {
  stage: StageId; version: number; summary: string; estimate?: EstimateView; state?: GateState; error?: string; note?: string;
  children?: ReactNode;
  /** when «Вернуть с замечанием» may be pressed (default: the note has text) */
  canRevise?: (note: string) => boolean;
  /** shown under the note (the final gate's scene picker) */
  afterNote?: ReactNode;
  onApprove?: (version: number, allowOverCap: boolean) => void; onRevise?: (version: number, note: string) => void;
}) {
  const [note, setNote] = useState('');
  const [allowed, setAllowed] = useState(false);
  const box = useRef<HTMLElement>(null);
  useEffect(() => { if (state === 'awaiting') box.current?.focus(); }, [state, version]);
  const capped = needsPermission(estimate) && !allowed;
  const reviseOk = canRevise ? canRevise(note) : !!note.trim();

  if (state === 'approved') return <div className="rounded-[10px] bg-ink-750 px-3 py-2 text-[13px] text-ok">✓ {STAGE_TITLES[stage]} v{version} {['storyboard', 'paint', 'compose', 'review'].includes(stage) ? 'утверждена' : 'утверждён'}</div>;
  return (
    <section ref={box} tabIndex={-1} role="region" aria-label="Утверждение этапа"
      className="fade-in flex flex-col gap-3 rounded-xl border-2 border-gate/60 bg-ink-750 p-4 shadow-[0_16px_40px_rgba(0,0,0,.45)] outline-none">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold">{STAGE_TITLES[stage]} <span className="text-mist-400">v{version}</span></h2>
        <span className="rounded-full bg-gate-bg px-2.5 py-1 text-[12px] font-semibold text-gate">
          {state === 'revised' ? 'вернули на доработку' : 'ждёт вашего решения'}
        </span>
      </div>
      <p className="text-[13px] leading-[1.45] text-mist-200">{summary}</p>
      {children}
      {estimate && <EstimateMeter e={estimate} allowed={allowed} onAllow={setAllowed} />}
      {state === 'revised' && sentNote && <div className="text-[13px] text-gate">Ваше замечание: «{sentNote}». Клод переделывает этот этап.</div>}
      {state !== 'revised' && <>
        <label className="flex flex-col gap-1.5">
          <span className="label">Замечание (если вернуть)</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} maxLength={300}
            placeholder={PLACEHOLDER[stage] ?? PLACEHOLDER.script}
            className="resize-none rounded-lg border border-mist-450 bg-ink-850 px-3 py-2 text-[13px] text-mist-100 placeholder:text-mist-500 focus:border-pen focus:outline-none" />
        </label>
        {afterNote}
        {error && <div role="alert" className="text-[13px] text-danger">{error}</div>}
        <div className="flex gap-2.5">
          <button type="button" disabled={state === 'sending' || capped} onClick={() => onApprove?.(version, allowed)}
            title={capped ? 'Оценка выше лимита: сначала отметьте «Разрешаю превысить лимит»' : ''}
            className="rounded-[9px] bg-pen px-4 py-2 font-bold text-pen-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
            {state === 'sending' ? 'Отправляю…' : 'Утвердить'}
          </button>
          <button type="button" disabled={state === 'sending' || !reviseOk} onClick={() => onRevise?.(version, note.trim())}
            className="rounded-[9px] border border-ink-500 bg-ink-650 px-4 py-2 font-semibold text-mist-100 hover:bg-ink-600 disabled:cursor-not-allowed disabled:opacity-40">
            Вернуть с замечанием
          </button>
        </div>
      </>}
    </section>
  );
}
