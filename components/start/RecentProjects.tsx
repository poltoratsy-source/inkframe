'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ProjectSummary } from '@/lib/engine/types';
import { api } from '@/lib/api';
import { asset, studioHref } from '@/lib/site';

// Examples made with the same painted engine, shown until you have projects of your own.
const SHOWCASE = [
  { title: 'Как зарождался ИИ', meta: 'кинетика + акварель · 2:00 · готово', thumb: asset('demo/styles/st-istoriya.jpg') },
  { title: 'Как работает лидар', meta: 'акварель · 1:07 · готово', thumb: asset('demo/styles/k3.jpg') },
  { title: 'ИИ-сотрудник', meta: 'Reels · 0:30 · готово', thumb: asset('demo/styles/st-reels.jpg') },
];
const STATUS: Record<string, string> = { drafting: 'сценарий', awaiting: 'ждёт вас', drawing: 'рисуется', ready: 'готово к сборке', building: 'сборка', done: 'готово' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function RecentProjects() {
  const [mine, setMine] = useState<ProjectSummary[]>([]);
  useEffect(() => { api.listProjects().then(setMine).catch(() => {}); }, []);
  return (
    <aside className="flex flex-col gap-3 overflow-y-auto border-l border-ink-600 bg-ink-850 px-[18px] py-[22px]">
      <h3 className="label">Недавние проекты</h3>
      {mine.slice(0, 5).map(p => (
        <Link key={p.id} href={studioHref(p.id)} className="flex items-center gap-2.5 rounded-[10px] border border-ink-550 bg-ink-750 p-2 hover:border-pen/60">
          {p.thumb ? <img src={p.thumb} alt="" className="h-12 w-[84px] rounded-md object-cover" /> : <div className="h-12 w-[84px] rounded-md bg-ink-600" />}
          <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{p.title}</div><div className="text-[11.5px] text-mist-400">акварель · {mmss(p.duration)} · {STATUS[p.status]}</div></div>
        </Link>
      ))}
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
