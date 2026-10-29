'use client';
// «Повтор прогона»: the run played again from its journal. The same reducer folds the same events, so the stage rail,
// the scene cards, the big frame, the time meter and the activity feed change as they did live.
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from '../TopBar';
import { StageRail } from '../board/StageRail';
import { ReplayScrubber } from '../board/ReplayScrubber';
import { Filmstrip } from '../board/Filmstrip';
import { WorkMeter } from '../board/WorkMeter';
import { cardOf, stageViews } from '../board/fromProject';
import { Stage } from '../studio/Stage';
import { WorkLog } from '../studio/WorkLog';
import { api } from '@/lib/api';
import { applyEvent } from '@/lib/engine/reducer';
import { realOffset, type Replay } from '@/lib/engine/replay';
import type { ProjectState } from '@/lib/engine/types';
import { DEMO_REPLAY_ID, HOME_HREF, LIBRARY_HREF, STATIC_SITE, replayHref, studioHref } from '@/lib/site';

type Load = { r?: Replay; error?: string; missing?: boolean };

const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
};
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const linkCls = 'rounded-[9px] border border-ink-500 bg-ink-650 px-3 py-2 text-[13px] font-semibold text-mist-100 hover:bg-ink-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pen';

/** Folds the replay up to `ms`, going on from the last position when time moves forward (no refold on every tick). */
function useFold(r: Replay | undefined, ms: number): ProjectState | undefined {
  const cur = useRef<{ r?: Replay; i: number; s?: ProjectState; ms: number }>({ i: 0, ms: -1 });
  return useMemo(() => {
    if (!r) return undefined;
    let c = cur.current;
    if (c.r !== r || ms < c.ms || !c.s) c = { r, i: 0, s: r.initial, ms: -1 };
    let { i, s } = c;
    while (i < r.events.length && r.events[i].at <= ms) s = applyEvent(s!, r.events[i++].ev);
    cur.current = { r, i, s, ms };
    return s;
  }, [r, ms]);
}

export function ReplayView({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({});
  const [attempt, setAttempt] = useState(0);
  const [t, setT] = useState(0);              // ms into the replay
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setLoad({});
    api.replay(id)
      .then(r => { if (!live) return; setLoad({ r }); setT(0); setPlaying(r.events.length > 0); })
      .catch((e: Error & { missing?: boolean }) => { if (live) setLoad({ error: e.message, missing: e.missing }); });
    return () => { live = false; };
  }, [id, attempt]);

  const r = load.r, total = r?.durationMs ?? 0;
  useEffect(() => {
    if (!playing || !r) return;
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now(), dt = (now - last) * speed;
      last = now;
      setT(x => {
        const next = Math.min(total, x + dt);
        if (next >= total) setPlaying(false);
        return next;
      });
    }, 100);
    return () => clearInterval(tick);
  }, [playing, speed, r, total]);

  const p = useFold(r, t);
  const demo = id === DEMO_REPLAY_ID;
  const back = demo ? null : <Link href={studioHref(id)} className={linkCls}>В студию</Link>;
  const top = (title?: string) => (
    <TopBar middle={title && <div className="min-w-0 truncate text-mist-300 max-sm:hidden">Повтор: «{title}»</div>}>
      {back}
      <Link href={LIBRARY_HREF} className={`${linkCls} max-sm:hidden`}>Библиотека</Link>
    </TopBar>
  );

  if (load.error) return (
    <div className="flex min-h-screen flex-col bg-ink-900">{top()}
      <div role="alert" className="m-auto flex max-w-md flex-col items-center gap-4 px-4 text-center">
        <h1 className="text-xl font-bold">{load.missing ? 'Проект не найден' : 'Не получилось загрузить повтор'}</h1>
        <p className="text-mist-300">{load.missing
          ? (STATIC_SITE ? 'На демо-сайте проекты живут, пока открыта вкладка. Посмотрите повтор демо-прогона — он записан заранее.' : 'Такого проекта нет на этом сервере.')
          : `Сервер ответил: «${load.error}». Попробуйте ещё раз через минуту.`}</p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {!load.missing && <button type="button" onClick={() => setAttempt(a => a + 1)} className="rounded-xl bg-pen px-5 py-3 font-bold text-pen-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pen">Попробовать ещё раз</button>}
          {load.missing && STATIC_SITE && <Link href={replayHref(DEMO_REPLAY_ID)} className="rounded-xl bg-pen px-5 py-3 font-bold text-pen-ink">▶ Повтор демо-прогона</Link>}
          <Link href={HOME_HREF} className={linkCls}>На главную</Link>
        </div>
      </div>
    </div>
  );

  if (!r || !p) return (
    <div className="flex min-h-screen flex-col bg-ink-900">{top()}
      <div className="flex flex-col gap-3 px-4 py-4 lg:px-5" aria-busy="true" aria-label="Загружаю повтор">
        <div className="h-11 animate-pulse rounded-[10px] bg-ink-750" />
        <div className="aspect-video w-full max-w-[900px] animate-pulse self-center rounded-xl bg-ink-750" />
        <div className="h-[150px] animate-pulse rounded-[10px] bg-ink-750" />
      </div>
    </div>
  );

  if (r.journal === 'none') return (
    <div className="flex min-h-screen flex-col bg-ink-900">{top(r.title)}
      <div className="m-auto flex max-w-md flex-col items-center gap-4 px-4 text-center">
        <div aria-hidden className="text-4xl">✏</div>
        <h1 className="text-xl font-bold">Журнала нет</h1>
        <p className="text-mist-300">Этот проект сделан до Inkframe 3: шаги работы тогда не записывались, повторить прогон не по чему. Сам мультфильм открывается в студии как раньше.</p>
        <div className="flex flex-wrap justify-center gap-2.5">{back}<Link href={LIBRARY_HREF} className={linkCls}>Библиотека</Link></div>
      </div>
    </div>
  );

  const drawing = p.scenes.find(s => s.status === 'sketch' || s.status === 'painting')?.n;
  const selected = picked ?? drawing ?? p.current?.n ?? 1;
  const squeezed = r.idle.reduce((a, w) => a + w.ms, 0);
  const now = r.startedAt ? Date.parse(r.startedAt) + realOffset(r, t) : Date.now();
  const seek = (sec: number) => { setT(Math.max(0, Math.min(total, sec * 1000))); };
  const play = (v: boolean) => { if (v && t >= total) setT(0); setPlaying(v); };

  return (
    <div className="flex min-h-screen flex-col bg-ink-900">
      {top(r.title)}
      <StageRail stages={stageViews(p)} />
      <main className="flex min-w-0 flex-col gap-3 px-4 py-3 lg:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-[18px] font-bold">Повтор прогона{demo && <span className="ml-2 text-[13px] font-semibold text-mist-400">демо, записан заранее</span>}</h1>
          <p className="min-w-0 text-[12.5px] text-mist-400">
            «{r.title}»{r.startedAt && <> · начат {when(r.startedAt)}</>} · шёл {minutes(r.realMs)}
            {r.idle.length > 0 && <> · ожидание ваших решений сокращено ({r.idle.length} {r.idle.length === 1 ? 'пауза' : r.idle.length < 5 ? 'паузы' : 'пауз'}, {minutes(squeezed)})</>}
          </p>
        </div>
        {r.journal === 'partial' && <div className="rounded-lg bg-warn-bg px-3 py-2 text-[12.5px] text-warn">Это ранний журнал: в нём только этапы, утверждения и шаги сцен — реплик Клода в нём нет.</div>}
        <ReplayScrubber t={t / 1000} total={total / 1000} playing={playing} speed={speed} marks={r.marks.map(m => ({ ...m, at: m.at / 1000 }))}
          onSeek={seek} onPlay={play} onSpeed={setSpeed} />
        <div className="grid min-w-0 gap-3 lg:grid-cols-[330px_minmax(0,1fr)]">
          {/* on a wide screen the frame is sized so the whole board fits the window without scrolling */}
          <div className="mx-auto flex w-full min-w-0 flex-col gap-2 lg:col-start-2 lg:row-start-1 lg:max-w-[max(560px,calc((100vh_-_600px)*16/9))]">
            <div className="[&>section]:px-0 [&>section]:py-0"><Stage project={p} selected={selected} /></div>
            {p.estimate && (p.estimate.startedAt || p.estimate.actualSec !== undefined) && !p.gate && <WorkMeter e={p.estimate} now={now} />}
          </div>
          <div className="min-w-0 lg:col-start-2 lg:row-start-2">
            <Filmstrip cards={p.scenes.map(sc => cardOf(sc, p))} picked={picked ?? undefined} onPick={n => setPicked(x => (x === n ? null : n))} />
          </div>
          <div className="flex h-[420px] min-h-0 flex-col overflow-hidden rounded-[10px] border border-ink-600 lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:h-auto lg:max-h-[calc(100vh_-_190px)] [&>aside]:min-h-0 [&>aside]:flex-1 [&>aside]:border-r-0">
            <WorkLog idea={p.settings.idea} log={p.log} empty="Пока тихо" title="Журнал прогона" />
          </div>
        </div>
      </main>
    </div>
  );
}
