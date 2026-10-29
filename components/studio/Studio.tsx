'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { TopBar } from '../TopBar';
import { useProject } from '@/lib/useProject';
import { api } from '@/lib/api';
import { HOME_HREF, STATIC_SITE, replayHref } from '@/lib/site';
import { useNow } from '@/lib/useNow';
import { canBuild } from '@/lib/engine/reducer';
import { STYLES } from '@/lib/options';
import { WorkLog } from './WorkLog';
import { Stage } from './Stage';
import { EditPanel } from './EditPanel';
import { Timeline } from './Timeline';
import { BuildDialog } from './BuildDialog';
import { ScriptGate } from './ScriptGate';
import { StoryboardGate } from './StoryboardGate';
import { FinalGate } from './FinalGate';
import { StageRail } from '../board/StageRail';
import { WorkMeter } from '../board/WorkMeter';
import { LIVE_STAGES, STAGE_NAMES } from '@/lib/store/types';

const len = (s: number) => (s < 60 ? `${s} с` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

export function Studio({ id }: { id: string }) {
  const { state: p, missing } = useProject(id);
  const [picked, setPicked] = useState<number | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const [err, setErr] = useState('');

  // Follow the scene being drawn until the user picks one.
  const drawing = p?.scenes.find(s => s.status === 'sketch' || s.status === 'painting')?.n;
  const selected = picked ?? drawing ?? p?.current?.n ?? 1;
  // a cut that failed its self-review is not handed out: no video, but the report opens so the user sees why
  const failed = p?.review?.decision === 'FAIL' && !p.video;
  useEffect(() => { if ((p?.video && p.status === 'done') || (failed && p?.status === 'ready')) setShowVideo(true); }, [p?.video, p?.status, p?.review?.at, failed]);
  // the time meter: since the work started against the plan; after it, plan against fact
  const working = !!p?.estimate?.startedAt && p.estimate.actualSec === undefined && !p.gate;
  const now = useNow(working);

  if (missing) return (
    <div className="flex h-screen flex-col"><TopBar />
      <div className="m-auto max-w-md text-center">
        <h1 className="mb-2 text-xl font-bold">Проект не найден</h1>
        <p className="mb-5 text-mist-300">{STATIC_SITE ? 'На демо-сайте проекты живут, пока открыта вкладка, и пропадают при её перезагрузке.' : 'Такого проекта нет на этом сервере (в демо-режиме проекты живут в памяти и пропадают после перезапуска).'}</p>
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
  // a gate covers the stage while it waits; a sent-back script or storyboard keeps its panel while it is redone
  // (a sent-back final does not: the scene is redrawn on the stage, right there)
  const gateStage = p.gate?.stage ?? (p.stages.script.status === 'revised' ? 'script' : p.stages.storyboard.status === 'revised' ? 'storyboard' : undefined);

  return (
    <div className="grid h-screen min-h-[760px] grid-rows-[56px_40px_minmax(0,1fr)_auto] overflow-hidden">
      <TopBar middle={<div className="truncate text-mist-300">Проект: «{p.title}» · {len(p.settings.duration)} · {style}</div>}>
        <span className="rounded-full bg-ink-650 px-3 py-1.5 text-[13px] text-mist-200">Рендер: 3 потока{p.engine === 'demo' ? ' · демо' : ''}</span>
        {p.status === 'done' && (
          <Link href={replayHref(id)} className="rounded-[9px] border border-ink-500 bg-ink-650 px-3 py-2 text-[13px] font-semibold text-mist-100 hover:bg-ink-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-pen">
            ▶ Повтор прогона
          </Link>
        )}
        {failed && p.status !== 'building' && (
          <button onClick={() => setShowVideo(true)} className="rounded-full bg-danger-bg px-3 py-1.5 text-[13px] font-semibold text-danger hover:brightness-110">
            Проверка не пройдена — почему?
          </button>
        )}
        <button onClick={build} disabled={!!p.gate || (!p.video && !ready) || p.status === 'building'}
          title={p.gate ? `Сначала решите на панели «${STAGE_NAMES[p.gate.stage]}»` : ready || p.video ? '' : 'Сначала дождись, пока все сцены будут готовы'}
          className="rounded-[9px] bg-pen px-4 py-2 font-bold text-pen-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
          {p.status === 'building' ? 'Собираю…' : p.video ? '▶ Готовый MP4' : 'Собрать MP4'}
        </button>
      </TopBar>
      <StageRail stages={LIVE_STAGES.map(id => ({ id, ...p.stages[id] }))} />
      <div className="grid min-h-0 grid-cols-[330px_minmax(0,1fr)_320px]">
        <WorkLog idea={p.settings.idea} log={p.log} />
        <div className="relative grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
          <Stage project={p} selected={selected} error={err} />
          {p.estimate && (working || (p.estimate.actualSec !== undefined && !p.gate)) && <div className="px-5 pb-3"><WorkMeter e={p.estimate} now={now} /></div>}
          {gateStage && (
            // narrow screens: the three-column studio does not fit yet, so the gate opens on top of everything
            <div className="absolute inset-0 z-10 overflow-y-auto bg-ink-900/85 px-5 py-4 max-lg:fixed max-lg:inset-x-0 max-lg:top-24 max-lg:bottom-0 max-lg:z-40 max-lg:px-4">
              {gateStage === 'script' ? <ScriptGate project={p} /> : gateStage === 'storyboard' ? <StoryboardGate project={p} /> : gateStage === 'final' ? <FinalGate project={p} /> : null}
            </div>
          )}
        </div>
        <EditPanel project={p} n={selected} />
      </div>
      <Timeline project={p} selected={selected} onPick={setPicked} />
      {showVideo && (p.video || failed) && (
        <BuildDialog src={p.video} review={p.review} title={p.title} demo={p.engine === 'demo'} onClose={() => setShowVideo(false)}
          onRebuild={ready ? () => { setShowVideo(false); void build(); } : undefined} />
      )}
    </div>
  );
}
