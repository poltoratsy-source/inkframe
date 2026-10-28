'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SettingsDialog } from './SettingsDialog';

/** The logo bar shared by both screens. `children` go on the right, before the Claude pill. */
export function TopBar({ middle, children, local = false }: { middle?: React.ReactNode; children?: React.ReactNode; local?: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<{ hasKey: boolean; engine: string } | null>(null);
  useEffect(() => { fetch('/api/settings').then(r => r.json()).then(setKey).catch(() => {}); }, [open]);
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-ink-600 bg-ink-800 px-5">
      <Link href="/" className="text-[20px] font-extrabold tracking-[.3px]">Ink<b className="text-pen">frame</b></Link>
      {middle}
      <div className="flex-1" />
      {local && <span className="rounded-full bg-ink-650 px-3 py-1.5 text-[13px] text-mist-200"><span className="text-ok">●</span> Локально · этот компьютер</span>}
      <button onClick={() => setOpen(true)} className="rounded-full bg-ink-650 px-3 py-1.5 text-[13px] text-mist-200 hover:bg-ink-550" title="Подключение Claude">
        {key?.engine === 'demo' ? 'Claude · демо-режим' : key?.hasKey ? 'Claude · ключ подключён ✓' : 'Claude · вход Claude Code'}
      </button>
      {children}
      {local && <button onClick={() => setOpen(true)} className="rounded-full bg-ink-650 px-3 py-1.5 text-[13px] text-mist-200 hover:bg-ink-550">⚙ Настройки</button>}
      {open && <SettingsDialog onClose={() => setOpen(false)} />}
    </header>
  );
}
