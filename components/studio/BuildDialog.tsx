'use client';

/** The finished cartoon: play it here or download the MP4. */
export function BuildDialog({ src, title, onClose }: { src: string; title: string; onClose: () => void }) {
  const file = 'inkframe-' + (title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').slice(0, 40) || 'cartoon') + '.mp4';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="w-[min(960px,92vw)] rounded-2xl border border-ink-500 bg-ink-750 p-5" onClick={e => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-lg font-bold">MP4 готов</h2>
          <span className="truncate text-mist-400">«{title}»</span>
          <div className="flex-1" />
          <button onClick={onClose} className="text-mist-300 hover:text-mist-100">✕</button>
        </div>
        <video src={src} controls autoPlay className="aspect-video w-full rounded-lg bg-black" />
        <div className="mt-3 flex items-center gap-3">
          <a href={src} download={file} className="rounded-lg bg-pen px-4 py-2 font-bold text-pen-ink">⬇ Скачать MP4</a>
          <span className="text-[12.5px] text-mist-400">Демо-режим: показан готовый мультфильм «Как работает лидар», нарисованный тем же движком.</span>
        </div>
      </div>
    </div>
  );
}
