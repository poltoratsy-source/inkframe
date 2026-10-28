'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopBar } from '../TopBar';
import { useProject } from '@/lib/useProject';
import { api } from '@/lib/api';
import { HOME_HREF, STATIC_SITE } from '@/lib/site';
import { canBuild } from '@/lib/engine/reducer';
import { STYLES } from '@/lib/options';
import { WorkLog } from './WorkLog';
import { Stage } from './Stage';
import { EditPanel } from './EditPanel';
import { Timeline } from './Timeline';
import { BuildDialog } from './BuildDialog';

const len = (s: number) => (s < 60 ? `${s} с` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export function Studio({ id }: { id: string }) {
  const { state: p, missing } = useProject(id);
  const [picked, setPicked] = useState<number | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [err, setErr] = useState('');

  // Follow the scene being drawn until the user picks one.
  const drawing = p?.scenes.find(s => s.status === 'sketch' || s.status === 'painting')?.n;
  const selected = picked ?? drawing ?? p?.current?.n ?? 1;
  useEffect(() => { if (p?.video && p.status === 'done') setShowVideo(true); }, [p?.video, p?.status]);

  if (missing) return (
    <div className="flex h-screen flex-col"><TopBar />
      <div className="m-auto max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">Проект не найден</h1>
        <p className="mb-5 text-mist-300">{STATIC_SITE ? 'На демо-сайте проекты живут, пока открыта вкладка, и пропадают при её перезагрузке.' : 'В демо-режиме проекты живут в памяти сервера и пропадают после его перезапуска.'}</p>
        <Link href={HOME_HREF} className="rounded-xl bg-pen px-5 py-3 font-bold text-pen-ink">Начать новый</Link>
      </div>
    </div>
  );
  if (!p) return <div className="flex h-screen flex-col"><TopBar /><div className="m-auto text-mist-400">Открываю студию…</div></div>;

  const style = STYLES.find(s => s.id === p.settings.style)?.title.toLowerCase();
  const build = async () => {
    setErr('');
    if (p.video) { setShowVideo(true); return; }
    try { await api.build(id); } catch (e) { setErr((e as Error).message); }
  };
  const ready = canBuild(p);

  return (
    <div className="grid h-screen min-h-[760px] grid-rows-[56px_minmax(0,1fr)_auto] overflow-hidden">
      <TopBar middle={<div className="truncate text-mist-300">Проект: «{p.title}» · {len(p.settings.duration)} · {style}</div>}>
        <span className="rounded-full bg-ink-650 px-3 py-1.5 text-[13px] text-mist-200">Рендер: 3 потока{p.engine === 'demo' ? ' · демо' : ''}</span>
        <button onClick={build} disabled={!ready || p.status === 'building'} title={ready ? '' : 'Сначала дождись, пока все сцены будут готовы'}
          className="rounded-[9px] bg-pen px-4 py-2 font-bold text-pen-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          {p.status === 'building' ? 'Собираю…' : p.video ? '▶ Готовый MP4' : 'Собрать MP4'}
        </button>
      </TopBar>
      <div className="grid min-h-0 grid-cols-[330px_minmax(0,1fr)_320px]">
        <WorkLog idea={p.settings.idea} log={p.log} />
        <Stage project={p} selected={selected} error={err} />
        <EditPanel project={p} n={selected} />
      </div>
      <Timeline project={p} selected={selected} onPick={setPicked} />
      {showVideo && p.video && <BuildDialog src={p.video} title={p.title} onClose={() => setShowVideo(false)} />}
    </div>
  );
}
