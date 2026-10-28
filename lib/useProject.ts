'use client';
import { useEffect, useReducer } from 'react';
import { applyEvent } from './engine/reducer';
import type { EngineEvent, ProjectState } from './engine/types';

type View = { state?: ProjectState; missing: boolean };

/** Live project state: the server's snapshot, then every engine event folded in with the shared reducer. */
export function useProject(id: string): View {
  const [view, dispatch] = useReducer((v: View, ev: EngineEvent | { type: 'missing' }): View => {
    if (ev.type === 'missing') return { missing: true };
    return { missing: false, state: ev.type === 'snapshot' ? ev.state : v.state && applyEvent(v.state, ev) };
  }, { missing: false });

  useEffect(() => {
    let es: EventSource | undefined, closed = false;
    fetch(`/api/projects/${id}`).then(r => {
      if (r.status === 404) { dispatch({ type: 'missing' }); return; }
      if (closed) return;
      es = new EventSource(`/api/projects/${id}/events`);   // reconnects by itself; each connect starts with a snapshot
      es.onmessage = m => dispatch(JSON.parse(m.data));
    }).catch(() => dispatch({ type: 'missing' }));
    return () => { closed = true; es?.close(); };
  }, [id]);
  return view;
}
