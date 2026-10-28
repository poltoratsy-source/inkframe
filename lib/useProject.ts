'use client';
import { useEffect, useReducer } from 'react';
import { api, type ProjectEvent } from './api';
import { applyEvent } from './engine/reducer';
import type { ProjectState } from './engine/types';

type View = { state?: ProjectState; missing: boolean };

/** Live project state: a snapshot, then every engine event folded in with the shared reducer. */
export function useProject(id: string): View {
  const [view, dispatch] = useReducer((v: View, ev: ProjectEvent): View => {
    if (ev.type === 'missing') return { missing: true };
    return { missing: false, state: ev.type === 'snapshot' ? ev.state : v.state && applyEvent(v.state, ev) };
  }, { missing: false });

  useEffect(() => (id ? api.openProject(id, dispatch) : dispatch({ type: 'missing' })), [id]);
  return view;
}
