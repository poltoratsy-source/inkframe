'use client';
import type { KeyboardEvent } from 'react';

export interface StyleCard { id: string; name: string; line: string; preview?: string; unavailable?: string }

/** Style packs as a radio group: arrows move the choice. */
export function StylePicker({ styles, value, onChange }: { styles: StyleCard[]; value: string; onChange: (id: string) => void }) {
  const ok = styles.filter(s => !s.unavailable);
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const i = ok.findIndex(s => s.id === value), next = ok[(i + d + ok.length) % ok.length].id;
    onChange(next);
    // focus follows the choice, as in any radio group
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-style="${next}"]`)?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Стиль рисунка" onKeyDown={key} className="grid grid-cols-2 gap-2.5">
      {styles.map(s => (
        <button key={s.id} type="button" role="radio" data-style={s.id} aria-checked={value === s.id} tabIndex={value === s.id ? 0 : -1}
          disabled={!!s.unavailable} title={s.unavailable} onClick={() => onChange(s.id)}
          className={`flex flex-col gap-1.5 rounded-[10px] border-2 bg-ink-700 p-2 text-left disabled:opacity-40 ${value === s.id ? 'border-pen' : 'border-ink-500 hover:border-mist-450'}`}>
          <div className="aspect-video overflow-hidden rounded-md bg-ink-950">{s.preview && <img src={s.preview} alt={`Кадр в стиле «${s.name}»`} className="size-full object-cover" />}</div>
          <div className="text-[13px] font-semibold">{s.name}</div>
          <div className="text-[12px] leading-[1.35] text-mist-300">{s.line}</div>
        </button>
      ))}
    </div>
  );
}
