'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { GateState } from '../board/GatePanel';
import type { ProjectState, SceneNote, StageId } from '@/lib/engine/types';

/** One gate as the studio sees it: its version, its panel state and the send function (approve / revise). */
export function useGate(p: ProjectState, stage: StageId) {
  const gate = p.gate?.stage === stage ? p.gate : undefined;
  const st = p.stages[stage];
  const version = gate?.version ?? st.version;
  const revising = !gate && st.status === 'revised';
  const [ui, setUi] = useState<{ state: 'sending' | 'error'; version: number; error?: string } | null>(null);
  const [sentNote, setSentNote] = useState<string>();

  const send = async (decision: 'approve' | 'revise', v: number, note?: string, o: { scenes?: SceneNote[]; allowOverCap?: boolean } = {}) => {
    setUi({ state: 'sending', version: v });
    try {
      await api.gate(p.id, stage, v, decision, note, o);
      if (decision === 'revise') setSentNote(note || o.scenes?.map(x => `сцена ${x.n}: ${x.note}`).join('; '));
      setUi(null);
      return true;
    } catch (e) {
      setUi({ state: 'error', version: v, error: (e as Error).message || 'Не дошло до студии — попробуйте ещё раз.' });
      return false;
    }
  };

  const mine = ui && ui.version === version ? ui : null;
  const state: GateState = revising ? 'revised' : mine?.state ?? 'awaiting';
  return { gate, version, revising, state, error: mine?.state === 'error' ? mine.error : undefined, sentNote, send };
}
