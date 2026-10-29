'use client';
// /replay/?id=<project> — «Повтор прогона» on static hosting (and ?id=demo, the demo run recorded in advance).
// With a server, /studio/<id>/replay renders the same screen.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ReplayView } from '@/components/replay/ReplayView';
import { DEMO_REPLAY_ID } from '@/lib/site';

function ByQuery() {
  return <ReplayView id={useSearchParams().get('id') || DEMO_REPLAY_ID} />;
}

export default function ReplayByQuery() {
  return <Suspense><ByQuery /></Suspense>;
}
