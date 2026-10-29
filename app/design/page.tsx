'use client';
// /design — the Inkframe 3 board components in every state, with sample data (replica-design step 4).
// Not linked from the studio; a place to check the look before the components go into real screens.
import { useState, type ReactNode } from 'react';
import { TopBar } from '@/components/TopBar';
import { asset } from '@/lib/site';
import { StageRail } from '@/components/board/StageRail';
import { GatePanel, type GateState } from '@/components/board/GatePanel';
import { SceneCard } from '@/components/board/SceneCard';
import { EstimateMeter } from '@/components/board/EstimateMeter';
import { ReviewReport } from '@/components/board/ReviewReport';
import { ReplayScrubber } from '@/components/board/ReplayScrubber';
import { LibraryBadge } from '@/components/board/LibraryBadge';
import { StylePicker } from '@/components/board/StylePicker';
import type { EstimateView, ReviewView, SceneCardView, StageView } from '@/components/board/types';

const STAGES: StageView[] = [
  { id: 'brief', status: 'completed', version: 1 }, { id: 'script', status: 'revised', version: 2 },
  { id: 'storyboard', status: 'awaiting', version: 1 }, { id: 'paint', status: 'pending', version: 1 },
  { id: 'voice', status: 'pending', version: 1 }, { id: 'compose', status: 'pending', version: 1 },
  { id: 'review', status: 'pending', version: 1 }, { id: 'final', status: 'pending', version: 1 },
];
const RAIL_LIVE: StageView[] = STAGES.map((s, i) => ({ ...s, status: i < 3 ? 'completed' : i === 3 ? 'in_progress' : i === 6 ? 'failed' : 'pending' }));
const f = (n: number, k: number, sketch = false) => asset(`demo/frames/s${n}-${k}${sketch ? '-sketch' : ''}.jpg`);
const CARDS: SceneCardView[] = [
  { n: 1, title: 'Клод знакомится', line: 'Привет! Меня зовут Клод. Сегодня наша тема — почему небо голубое.', start: 0, duration: 4.2, template: 'ведущий', frame: f(1, 3), status: 'done', edits: 0 },
  { n: 2, title: 'Солнечный свет', line: 'Белый свет — это все цвета сразу.', start: 4.2, duration: 3.8, template: 'предмет', frame: f(2, 1, true), status: 'sketch', edits: 0 },
  { n: 3, title: 'Воздух рассеивает синий', line: 'Синий свет рассеивается сильнее красного.', start: 8, duration: 4.4, template: 'сравнение', frame: f(3, 2), status: 'painting', edits: 1 },
  { n: 4, title: 'Закат', line: 'Вечером свет идёт дольше, и до нас доходит красный.', start: 12.4, duration: 4, template: 'предмет', status: 'queued', edits: 0 },
  { n: 5, title: 'Кодовое слово', line: 'Напишите НЕБО — и я пришлю вам курс.', start: 16.4, duration: 3, template: 'карточка', frame: f(4, 2), status: 'redraw', edits: 2, note: 'слово крупнее, по центру' },
  { n: 6, title: 'Проверка вопроса', line: 'А почему тогда облака белые?', start: 19.4, duration: 3.2, template: 'ведущий', frame: f(5, 1), status: 'awaiting', edits: 0 },
];
const EST: Record<string, EstimateView> = {
  observe: { frames: 216, workers: 3, paintSec: 150, voiceSec: 20, cutSec: 40, claudeCalls: 2, diskMb: 38, mode: 'observe' },
  warn: { frames: 960, workers: 3, paintSec: 600, voiceSec: 60, cutSec: 150, claudeCalls: 3, diskMb: 160, mode: 'warn', capSec: 600 },
  cap: { frames: 1800, workers: 3, paintSec: 1100, voiceSec: 90, cutSec: 240, claudeCalls: 3, diskMb: 300, mode: 'cap', capSec: 900 },
  fact: { frames: 216, workers: 3, paintSec: 150, voiceSec: 20, cutSec: 40, claudeCalls: 2, diskMb: 38, mode: 'observe', actualSec: 232 },
};
const REVIEWS: ReviewView[] = [
  { decision: 'PASS', checks: [
    { id: 'probe', ok: true, detail: '1280×720, 24 к/с, звук 48 кГц' }, { id: 'duration', ok: true, detail: '22,6 с — как в раскадровке' },
    { id: 'black', ok: true, detail: 'нет' }, { id: 'silence', ok: true, detail: 'голос на всех сценах' }, { id: 'subtitles', ok: true, detail: 'есть, 9 строк' }] },
  { decision: 'WARN', checks: [
    { id: 'probe', ok: true, detail: '1080×1920, 24 к/с' }, { id: 'clipping', ok: false, warn: true, detail: 'звук упирается в потолок', at: [12.4] },
    { id: 'slideshow', ok: false, warn: true, detail: 'три сцены подряд одного вида' }] },
  { decision: 'FAIL', checks: [
    { id: 'probe', ok: true, detail: 'читается' }, { id: 'black', ok: false, detail: 'чёрный кадр 0,8 с', at: [8.1] },
    { id: 'silence', ok: false, detail: 'нет голоса в сцене 4', at: [12.4, 14] }] },
];

export default function DesignPage() {
  const [gate, setGate] = useState<GateState>('awaiting');
  const [picked, setPicked] = useState(3);
  const [style, setStyle] = useState('watercolor');
  const [t, setT] = useState(134), [play, setPlay] = useState(false), [speed, setSpeed] = useState(4);
  const Box = ({ title, children }: { title: string; children: ReactNode }) => (
    <section className="flex flex-col gap-3"><h2 className="label">{title}</h2>{children}</section>
  );
  return (
    <div className="min-h-screen">
      <TopBar middle={<div className="text-mist-300">Inkframe 3 · компоненты доски</div>} />
      <StageRail stages={STAGES} />
      <StageRail stages={RAIL_LIVE} />
      <main className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_420px] gap-8 p-6">
        <div className="flex flex-col gap-8">
          <Box title="Лист раскадровки (контрольная точка)">
            <GatePanel stage="storyboard" version={1} state={gate} note="короче вторую сцену"
              summary="6 сцен, 22,6 с. Посмотрите кадры и слова: после «Утвердить» Клод нарисует всё начисто, озвучит и соберёт MP4."
              estimate={EST.observe} error={gate === 'error' ? 'Не дошло до студии — попробуйте ещё раз.' : undefined}
              onApprove={() => setGate('approved')} onRevise={() => setGate('revised')}>
              <div className="grid grid-cols-3 gap-2.5">{CARDS.map(c => <SceneCard key={c.n} s={c} picked={picked === c.n} onPick={() => setPicked(c.n)} />)}</div>
            </GatePanel>
            <div className="flex gap-2">
              {(['awaiting', 'sending', 'approved', 'revised', 'error'] as GateState[]).map(s => (
                <button key={s} type="button" onClick={() => setGate(s)} className={`rounded-md px-2.5 py-1 text-[12px] ${gate === s ? 'bg-pen font-bold text-pen-ink' : 'bg-ink-650 text-mist-300'}`}>{s}</button>
              ))}
            </div>
          </Box>
          <Box title="Повтор прогона">
            <ReplayScrubber t={t} total={400} playing={play} speed={speed} onSeek={setT} onPlay={setPlay} onSpeed={setSpeed}
              marks={[{ at: 0, stage: 'brief' }, { at: 30, stage: 'script' }, { at: 95, stage: 'storyboard' }, { at: 170, stage: 'paint' }, { at: 330, stage: 'voice' }, { at: 360, stage: 'compose' }, { at: 392, stage: 'review' }]} />
          </Box>
        </div>
        <aside className="flex flex-col gap-8">
          <Box title="Оценка затрат">
            {Object.entries(EST).map(([k, e]) => <EstimateMeter key={k} e={e} />)}
          </Box>
          <Box title="Самопроверка MP4">{REVIEWS.map(r => <ReviewReport key={r.decision} r={r} />)}</Box>
          <Box title="Значки библиотеки">
            <div className="flex flex-wrap gap-2">{(['drawing', 'awaiting', 'done', 'error', 'draft'] as const).map(b => <LibraryBadge key={b} b={b} />)}</div>
          </Box>
          <Box title="Стиль рисунка">
            <StylePicker value={style} onChange={setStyle} styles={[
              { id: 'watercolor', name: 'Акварель', line: 'Мягкие заливки на бумаге, как сейчас', preview: asset('demo/frames/s1-3.jpg') },
              { id: 'ink', name: 'Тушь', line: 'Чёрная линия на белом, цвет только по делу', preview: asset('demo/frames/s3-2-sketch.jpg') },
              { id: 'chalk', name: 'Мел', line: 'Доска и мел', unavailable: 'Будет позже' },
            ]} />
          </Box>
        </aside>
      </main>
    </div>
  );
}
