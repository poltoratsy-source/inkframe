'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@/lib/engine/types';
import { api } from '@/lib/api';
import { DEMO_REPLAY_ID, LIBRARY_HREF, asset, replayHref } from '@/lib/site';
import { LibraryCard } from '../board/LibraryCard';
import { libraryCardOf } from '../board/fromProject';

// Examples made with the same painted engine, shown until you have projects of your own.
const SHOWCASE = [
  { title: 'Как зарождался ИИ', meta: 'кинетика + акварель · 2:00 · готово', thumb: asset('demo/styles/st-istoriya.jpg') },
  { title: 'Как работает лидар', meta: 'акварель · 1:07 · готово', thumb: asset('demo/styles/k3.jpg') },
  { title: 'ИИ-сотрудник', meta: 'Reels · 0:30 · готово', thumb: asset('demo/styles/st-reels.jpg') },
];

/** «Недавние»: your projects with their state (ждёт вас and рисую on top), then the examples. */
export function RecentProjects() {
  const [mine, setMine] = useState<ProjectSummary[]>([]);
  useEffect(() => { api.listProjects().then(setMine).catch(() => {}); }, []);
  return (
    <aside className="flex flex-col gap-3 overflow-y-auto border-l border-ink-600 bg-ink-850 px-[18px] py-[22px]">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="label">Недавние проекты</h3>
        <Link href={LIBRARY_HREF} className="text-[12px] text-mist-300 hover:text-pen focus-visible:outline focus-visible:outline-2 focus-visible:outline-pen">Вся библиотека →</Link>
      </div>
      {mine.slice(0, 5).map(p => <LibraryCard key={p.id} c={libraryCardOf(p)} compact />)}
      <Link href={replayHref(DEMO_REPLAY_ID)} className="flex items-center gap-2.5 rounded-[10px] border border-ink-550 bg-ink-750 p-2 hover:border-pen/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pen">
        <img src={asset('demo/frames/s3-4.jpg')} alt="" className="h-12 w-[84px] rounded-md object-cover" />
        <div className="min-w-0"><div className="text-[13px] font-semibold">▶ Повтор демо-прогона</div><div className="text-[11.5px] text-mist-400">как рисовался «лидар» — за минуту</div></div>
      </Link>
      {SHOWCASE.map(p => (
        <div key={p.title} className="flex items-center gap-2.5 rounded-[10px] border border-ink-550 bg-ink-750 p-2">
          <img src={p.thumb} alt="" className="h-12 w-[84px] rounded-md object-cover" />
          <div><div className="text-[13px] font-semibold">{p.title}</div><div className="text-[11.5px] text-mist-400">{p.meta}</div></div>
        </div>
      ))}
      <h3 className="label mt-2">Подсказка</h3>
      <div className="rounded-[10px] bg-ink-700 p-3 text-[12.5px] leading-normal text-mist-200">
        Пиши как другу: о чём ролик, для кого и какое настроение. Детали — герой, цвета, шутки — Клод придумает сам, а ты поправишь на раскадровке.
      </div>
    </aside>
  );
}
