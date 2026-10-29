import { SceneCard } from './SceneCard';
import type { SceneCardView } from './types';

/** The scene cards in a row that scrolls sideways: they fill in as the scenes are drawn. */
export function Filmstrip({ cards, picked, onPick, empty = 'Сцены появятся, когда Клод напишет сценарий' }: {
  cards: SceneCardView[]; picked?: number; onPick?: (n: number) => void; empty?: string;
}) {
  if (!cards.length) return <div className="flex h-[120px] items-center justify-center rounded-[10px] border-2 border-dashed border-ink-500 text-[13px] text-mist-500">{empty}</div>;
  return (
    <ul className="flex gap-2.5 overflow-x-auto pb-1" aria-label="Сцены">
      {cards.map(c => <li key={c.n} className="w-[188px] flex-none"><SceneCard s={c} picked={picked === c.n} onPick={onPick && (() => onPick(c.n))} /></li>)}
    </ul>
  );
}
