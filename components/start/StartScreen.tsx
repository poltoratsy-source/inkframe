'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TopBar } from '../TopBar';
import { DEFAULT_SETTINGS, EXAMPLES, OPTIONS, OPTION_TITLES, STYLES } from '@/lib/options';
import type { StartSettings } from '@/lib/engine/types';
import { RecentProjects } from './RecentProjects';
import { StylePicker } from '../board/StylePicker';
import { STYLE_PACKS } from '@/lib/styles';
import { api } from '@/lib/api';
import { studioHref } from '@/lib/site';

type OptionKey = keyof typeof OPTIONS;

export function StartScreen() {
  const router = useRouter();
  const [s, setS] = useState<StartSettings>({ ...DEFAULT_SETTINGS, idea: EXAMPLES[0] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof StartSettings>(k: K, v: StartSettings[K]) => setS(p => ({ ...p, [k]: v }));
  // a rough figure for the start screen; a frame of the pack costs speed.cost of a watercolour one (the gates show the real estimate)
  const minutes = Math.max(1, Math.round(s.duration / 60 * 15 * STYLE_PACKS[s.style].speed.cost));

  const start = async () => {
    setBusy(true); setErr('');
    try {
      if (!s.idea.trim()) throw new Error('Опиши идею — хотя бы одну фразу');
      router.push(studioHref(await api.createProject(s)));
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div className="flex h-screen min-h-[760px] flex-col overflow-hidden">
      <TopBar local />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px]">
        <main className="flex min-w-0 flex-col gap-[18px] overflow-y-auto px-10 py-6">
          <h1 className="text-[30px] font-extrabold tracking-[-.3px]">Что снимем <b className="text-pen">сегодня?</b></h1>

          <div className="relative rounded-[14px] border-2 border-pen bg-ink-750 px-[18px] pt-4 pb-12">
            <textarea value={s.idea} onChange={e => set('idea', e.target.value)} rows={2} maxLength={600}
              placeholder="Например: мультфильм для школьников, как лидар видит мир, 60 секунд"
              className="w-full resize-none bg-transparent text-[17px] leading-normal text-[#f2eff8] outline-none placeholder:text-mist-500" />
            <div className="text-[13px] text-mist-400">Опиши идею своими словами — Клод сам напишет сценарий, нарисует и озвучит.</div>
            <div className="absolute right-3.5 bottom-3 flex gap-2">
              <span className="cursor-not-allowed rounded-lg bg-ink-650 px-2.5 py-1.5 text-[12px] text-mist-200 opacity-70" title="скоро">🎙 голосом</span>
              <span className="cursor-not-allowed rounded-lg bg-ink-650 px-2.5 py-1.5 text-[12px] text-mist-200 opacity-70" title="скоро">📎 фото / сценарий</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map(x => (
              <button key={x} onClick={() => set('idea', x)} className="rounded-2xl border border-ink-500 bg-ink-700 px-3 py-1.5 text-[12.5px] text-mist-200 hover:border-pen/60">💡 {x}</button>
            ))}
          </div>

          <h3 className="label">Стиль</h3>
          <div className="max-w-[620px]">
            <StylePicker value={s.style} onChange={id => set('style', id as StartSettings['style'])}
              styles={STYLES.map(st => ({ id: st.id, name: st.title, line: st.text, preview: st.thumb }))} />
          </div>

          <div className="grid grid-cols-4 gap-3">
            {(Object.keys(OPTIONS) as OptionKey[]).map(k => (
              <div key={k} className="rounded-xl border border-ink-550 bg-ink-750 p-3">
                <div className="mb-2 text-[12px] text-mist-400">{OPTION_TITLES[k]}</div>
                <div className="flex flex-wrap gap-1.5">
                  {OPTIONS[k].map(o => {
                    const on = s[k] === o.value;
                    return (
                      <button key={String(o.value)} disabled={o.soon} title={o.soon ? 'скоро' : undefined}
                        onClick={() => set(k, o.value as never)}
                        className={`rounded-lg px-2.5 py-1.5 text-[12.5px] ${on ? 'bg-pen font-bold text-pen-ink' : 'bg-ink-650 text-mist-200 hover:bg-ink-550'} ${o.soon ? 'cursor-not-allowed opacity-45' : ''}`}>
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <button onClick={start} disabled={busy || !s.idea.trim()}
              className="rounded-xl bg-pen px-[26px] py-3.5 text-[16px] font-extrabold text-pen-ink hover:brightness-110 disabled:opacity-40">
              {busy ? 'Начинаю…' : '✏ Начать рисовать'}
            </button>
            <div className="text-[13px] leading-normal text-mist-300">
              {err ? <span className="text-pen-soft">{err}</span> : <>Сначала через ~1 мин — сценарий и наброски всех сцен, их можно поправить.<br />
                Чистовик {OPTIONS.duration.find(d => d.value === s.duration)?.label} ≈ {minutes}–{minutes + 5} мин на этом компьютере · ≈ {(0.1 + s.duration / 200).toFixed(1).replace('.', ',')} $ за работу Клода</>}
            </div>
          </div>
        </main>
        <RecentProjects />
      </div>
    </div>
  );
}
