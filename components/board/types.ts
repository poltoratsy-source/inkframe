// View types for the production board (Inkframe 3). The engine's own types (lib/store/types.ts) map onto these;
// the board components only draw what they are given, so /design can show every state with sample data.

export type StageId = 'brief' | 'script' | 'storyboard' | 'paint' | 'voice' | 'compose' | 'review' | 'final';
export type StageStatus = 'pending' | 'in_progress' | 'awaiting' | 'completed' | 'revised' | 'failed';
export interface StageView { id: StageId; status: StageStatus; version: number }

export const STAGE_TITLES: Record<StageId, string> = {
  brief: 'Бриф', script: 'Сценарий', storyboard: 'Раскадровка', paint: 'Отрисовка',
  voice: 'Голос', compose: 'Сборка', review: 'Проверка', final: 'Финал',
};

export type CardStatus = 'queued' | 'sketch' | 'painting' | 'done' | 'awaiting' | 'redraw';
export interface SceneCardView { n: number; title: string; line: string; start: number; duration: number; template: string; frame?: string; status: CardStatus; edits: number; note?: string }

export interface EstimateView { frames: number; workers: number; paintSec: number; voiceSec: number; cutSec: number; claudeCalls: number; diskMb: number; mode: 'observe' | 'warn' | 'cap'; capSec?: number; actualSec?: number }

export type CheckId = 'probe' | 'duration' | 'black' | 'blank' | 'silence' | 'clipping' | 'subtitles' | 'slideshow';
export interface ReviewView { decision: 'PASS' | 'WARN' | 'FAIL'; checks: { id: CheckId; ok: boolean; warn?: boolean; detail: string; at?: number[] }[] }

export type Badge = 'drawing' | 'awaiting' | 'done' | 'error' | 'draft';

export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const dur = (s: number) => (s < 60 ? `${Math.round(s)} с` : `${Math.round(s / 60)} мин`);
