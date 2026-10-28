'use client';
import { useEffect, useState } from 'react';
import { api, type SettingsInfo } from '@/lib/api';

/** Own Anthropic API key. The server writes it to .env.local only; it is never sent back to the browser. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [info, setInfo] = useState<SettingsInfo | null>(null);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { api.settings().then(setInfo).catch(() => {}); }, []);
  const save = async (value: string) => {
    try { setInfo(await api.saveApiKey(value)); } catch (e) { setMsg((e as Error).message || 'Не получилось сохранить'); return; }
    setKey(''); setMsg(value ? 'Ключ сохранён в .env.local' : 'Ключ убран — будет использован вход Claude Code');
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[460px] rounded-2xl border border-ink-500 bg-ink-750 p-6" onClick={e => e.stopPropagation()}>
        <h2 className="mb-1 text-lg font-bold">Подключение Claude</h2>
        <p className="mb-4 text-[13px] leading-relaxed text-mist-300">
          Свой API-ключ Anthropic хранится только у тебя на компьютере, в файле <code>.env.local</code>, и не попадает в git.
          Без ключа Inkframe использует вход Claude Code на этом компьютере.
        </p>
        {info?.staticSite ? <>
          <div className="mb-4 rounded-lg bg-ink-700 p-3 text-[13px] leading-relaxed text-mist-200">
            Это демо-сайт: Claude здесь не подключён, студия проигрывает заранее нарисованный мультфильм.
            Чтобы ввести свой ключ, запусти Inkframe у себя: <code className="text-pen-soft">npm i &amp;&amp; npm run dev</code>.
          </div>
          <div className="flex justify-end"><button onClick={onClose} className="rounded-lg px-4 py-2 text-mist-300 hover:text-mist-100">Закрыть</button></div>
        </> : <>
        <div className="mb-2 text-[12px] text-mist-400">Сейчас: {info ? (info.hasKey ? 'свой ключ подключён ✓' : 'вход Claude Code') : '…'}{info?.engine === 'demo' ? ' · работает демо-режим' : ''}</div>
        <input value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" type="password" autoComplete="off"
          className="mb-3 w-full rounded-lg border border-pen/50 bg-ink-950 px-3 py-2.5 text-mist-100 outline-none focus:border-pen" />
        {msg && <div className="mb-3 text-[12.5px] text-pen-soft">{msg}</div>}
        <div className="flex gap-2">
          <button disabled={!key.trim()} onClick={() => save(key.trim())} className="rounded-lg bg-pen px-4 py-2 font-bold text-pen-ink disabled:opacity-40">Сохранить ключ</button>
          {info?.hasKey && <button onClick={() => save('')} className="rounded-lg bg-ink-650 px-4 py-2 text-mist-200">Убрать ключ</button>}
          <div className="flex-1" />
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-mist-300 hover:text-mist-100">Закрыть</button>
        </div>
        </>}
      </div>
    </div>
  );
}
