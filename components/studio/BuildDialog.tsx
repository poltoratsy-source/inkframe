'use client';
import { useEffect, useRef } from 'react';
import type { Review } from '@/lib/engine/types';
import { ReviewReport } from '../board/ReviewReport';

/** The finished cartoon with its self-review: play it here or download the MP4. A cut that failed the review is shown
 *  as a draft to look at (times in the report jump there), without a download, and can be built again. */
export function BuildDialog({ src, review, title, demo, onClose, onRebuild }: {
  src?: string; review?: Review; title: string; demo?: boolean; onClose: () => void; onRebuild?: () => void;
}) {
  const file = 'inkframe-' + (title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').slice(0, 40) || 'cartoon') + '.mp4';
  const failed = review?.decision === 'FAIL', video = src ?? review?.video, player = useRef<HTMLVideoElement>(null);
  const seek = (t: number) => { const v = player.current; if (v) { v.currentTime = t; v.pause(); } };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="build-title" onClick={e => e.stopPropagation()}
        className="max-h-[94vh] w-[min(1280px,94vw)] overflow-y-auto rounded-2xl border border-ink-500 bg-ink-750 p-5">
        <div className="mb-3 flex items-center gap-3">
          <h2 id="build-title" className={`text-lg font-bold ${failed ? 'text-danger' : ''}`}>{failed ? 'MP4 не прошёл проверку' : 'MP4 готов'}</h2>
          <span className="truncate text-mist-400">«{title}»</span>
          <div className="flex-1" />
          <button onClick={onClose} aria-label="Закрыть" className="text-mist-300 hover:text-mist-100">✕</button>
        </div>
        <div className={review ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]' : ''}>
          <div className="min-w-0">
            {video && <video ref={player} src={video} controls autoPlay={!failed} className="aspect-video w-full rounded-lg bg-black" />}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {failed ? (
                <>
                  {onRebuild && <button onClick={onRebuild} className="rounded-lg bg-pen px-4 py-2 font-bold text-pen-ink hover:brightness-110">Собрать MP4 заново</button>}
                  <span className="text-[12.5px] text-mist-400">Это черновик с ошибками: смотреть можно, отдавать нельзя. Нажмите на время в отчёте — видео перемотается туда.</span>
                </>
              ) : (
                <>
                  {src && <a href={src} download={file} className="rounded-lg bg-pen px-4 py-2 font-bold text-pen-ink">⬇ Скачать MP4</a>}
                  {demo && <span className="text-[12.5px] text-mist-400">Демо-режим: показан готовый мультфильм «Как работает лидар», нарисованный тем же движком.</span>}
                </>
              )}
            </div>
          </div>
          {review && (
            <div className="min-w-0">
              <h3 className="label mb-2">Проверка ролика</h3>
              <ReviewReport r={review} onSeek={seek} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
