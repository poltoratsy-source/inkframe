'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { TopBar } from '../TopBar';
import { DEFAULT_SETTINGS, EXAMPLES, OPTIONS, OPTION_TITLES, STYLES } from '@/lib/options';
import type { StartSettings } from '@/lib/engine/types';
import { RecentProjects } from './RecentProjects';

type OptionKey = keyof typeof OPTIONS;

export function StartScreen() {
  const router = useRouter();
  const [s, setS] = useState<StartSettings>({ ...DEFAULT_SETTINGS, idea: EXAMPLES[0] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = <K extends keyof StartSettings>(k: K, v: StartSettings[K]) => setS(p => ({ ...p, [k]: v }));
  const minutes = Math.max(1, Math.round(s.duration / 60 * 15));

  const start = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(s) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Не получилось начать');
      router.push(`/studio/${j.id}`);
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
          <div className="grid grid-cols-7 gap-3">
            {STYLES.map(st => {
              const sel = s.style === st.id;
              return (
                <button key={st.id} disabled={st.soon} onClick={() => set('style', st.id)}
                  className={`relative overflow-hidden rounded-xl border-2 bg-ink-750 text-left ${sel ? 'border-pen shadow-[0_0_0_4px_#ff8a3d22]' : 'border-ink-550'} ${st.soon ? 'cursor-not-allowed' : ''}`}>
                  {st.thumb
                    ? <img src={st.thumb} alt="" className={`block h-[104px] w-full object-cover ${st.soon ? 'opacity-60' : ''}`} />
                    : <div className="flex h-[104px] items-center justify-center bg-[linear-gradient(135deg,#3a2a5a,#ff8a3d55)] text-4xl opacity-60">🥤</div>}
                  {sel && <span className="absolute top-[7px] right-[7px] rounded-md bg-pen px-[7px] py-0.5 text-[11px] text-pen-ink">выбран</span>}
                  {!sel && st.soon && <span className="absolute top-[7px] right-[7px] rounded-md bg-[#7f78c8] px-[7px] py-0.5 text-[11px] text-white">скоро</span>}
                  {st.badge && <span className="absolute top-[7px] left-[7px] rounded-md bg-black/70 px-[7px] py-0.5 text-[11px]">{st.badge}</span>}
                  <div className="px-2.5 pt-[9px] pb-0.5 text-[13.5px] font-bold">{st.title}</div>
                  <div className="px-2.5 pb-2.5 text-[11.5px] leading-[1.35] text-mist-300">{st.text}</div>
                </button>
              );
            })}
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
