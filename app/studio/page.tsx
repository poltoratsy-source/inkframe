'use client';
// /studio/?id=<project> — the studio on static hosting (GitHub Pages can't serve /studio/<random id>).
// With a server, /studio/<id> (app/studio/[id]) is used instead; both render the same screen.
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Studio } from '@/components/studio/Studio';

function ByQuery() {
  return <Studio id={useSearchParams().get('id') ?? ''} />;
}

export default function StudioByQuery() {
  return <Suspense><ByQuery /></Suspense>;
}
