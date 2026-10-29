'use client';
// /library — every project with its state: «ждёт вас» and «рисую» first, a filter by state, a click opens the studio.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopBar } from '../TopBar';
import { LibraryCard } from '../board/LibraryCard';
import { LibraryBadge } from '../board/LibraryBadge';
import { libraryCardOf } from '../board/fromProject';
import type { Badge } from '../board/types';
import type { ProjectSummary } from '@/lib/engine/types';
import { api } from '@/lib/api';
import { DEMO_REPLAY_ID, HOME_HREF, STATIC_SITE, asset, replayHref } from '@/lib/site';

const FILTERS: { id: Badge | 'all'; label: string }[] = [
  { id: 'all', label: 'Все' }, { id: 'awaiting', label: 'Ждут вас' }, { id: 'drawing', label: 'Рисую' },
  { id: 'done', label: 'Готово' }, { id: 'error', label: 'С ошибкой' }, { id: 'draft', label: 'Черновики' },
];
const focus = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen';

/** The demo run recorded in advance: a replay to watch without making anything. */
function DemoReplayCard() {
  return (
    <Link href={replayHref(DEMO_REPLAY_ID)} className={`flex items-center gap-3 rounded-[10px] border border-ink-550 bg-ink-750 p-2.5 hover:border-pen/60 ${focus}`}>
      <img src={asset('demo/frames/s3-4.jpg')} alt="" className="h-14 w-[100px] flex-none rounded-md object-cover" />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">▶ Повтор демо-прогона</div>
        <div className="text-[12px] text-mist-400">Как Клод пишет, рисует и проверяет мультфильм — от брифа до финала, за минуту</div>
      </div>
    </Link>
  );
}

export function Library() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Badge | 'all'>('all');

  useEffect(() => {
    let live = true;
    setError(''); setList(null);
    api.listProjects().then(xs => { if (live) setList(xs); }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [attempt]);

  const count = (b: Badge | 'all') => (list ?? []).filter(p => b === 'all' || p.badge === b).length;
  const shown = (list ?? []).filter(p => filter === 'all' || p.badge === filter);

  return (
    <div className="flex min-h-screen flex-col bg-ink-900">
      <TopBar middle={<div className="truncate text-mist-300 max-sm:hidden">Библиотека</div>} />
      <main className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[24px] font-extrabold tracking-[-.2px]">Библиотека</h1>
          <Link href={HOME_HREF} className={`rounded-[9px] bg-pen px-4 py-2 font-bold text-pen-ink hover:brightness-110 ${focus}`}>✏ Новый мультфильм</Link>
        </div>

        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] bg-danger-bg px-4 py-3 text-[13px] text-danger">
            <span>Не получилось загрузить библиотеку: {error}</span>
            <button type="button" onClick={() => setAttempt(a => a + 1)} className={`rounded-md bg-ink-750 px-3 py-1.5 font-semibold text-mist-100 ${focus}`}>Попробовать ещё раз</button>
          </div>
        )}

        {!error && list === null && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Загружаю библиотеку">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-[220px] animate-pulse rounded-[10px] bg-ink-750" />)}
          </div>
        )}

        {list && list.length === 0 && (
          <div className="flex flex-col items-center gap-4 rounded-[14px] border-2 border-dashed border-ink-500 px-4 py-10 text-center">
            <div aria-hidden className="text-4xl">✏</div>
            <h2 className="text-[18px] font-bold">Здесь будут ваши мультфильмы</h2>
            <p className="max-w-md text-mist-300">{STATIC_SITE ? 'На демо-сайте проекты живут, пока открыта вкладка.' : 'Пока ни одного проекта.'} Опишите идею на главной — Клод напишет сценарий и начнёт рисовать, а проект появится здесь.</p>
            <Link href={HOME_HREF} className={`rounded-xl bg-pen px-5 py-3 font-bold text-pen-ink ${focus}`}>Начать первый</Link>
            <div className="w-full max-w-md text-left"><DemoReplayCard /></div>
          </div>
        )}

        {list && list.length > 0 && <>
          <div role="group" aria-label="Показать" className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => {
              const n = count(f.id);
              if (f.id !== 'all' && n === 0) return null;
              return (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] ${focus} ${filter === f.id ? 'bg-pen font-bold text-pen-ink' : 'bg-ink-650 text-mist-200 hover:bg-ink-550'}`}>
                  {f.id !== 'all' && filter !== f.id && <LibraryBadge b={f.id} />}
                  {(f.id === 'all' || filter === f.id) && f.label}<span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {shown.map(p => <li key={p.id}><LibraryCard c={libraryCardOf(p)} /></li>)}
          </ul>
          {shown.length === 0 && <p className="text-mist-400">В этом состоянии проектов нет.</p>}
          <div className="max-w-md"><DemoReplayCard /></div>
        </>}
      </main>
    </div>
  );
}
