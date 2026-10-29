// The three frame formats, shared by the engine, the stage page and the studio. Pure (no node imports), so the
// browser demo and the screens use the same table.
//
//   world   the stage's painting space (renderer/layout.js): the short side is 1080 in every format, so brushes,
//           Clawd, props and lettering keep their size in px and only the layout moves things around
//   video   the MP4 at the default 720 short side: 1280×720, 720×1280, 720×720 (same pixel density as the 720p cut)
//   draft   key frames and the on-screen drafts: 360 short side
//   cost    what a frame costs to paint against a 16:9 one (the estimate). Not the bare area (1:1 is 56 % of it): the
//           strokes are the same, only the fills shrink — measured on MSK1 29.10.2026, a 15 s cartoon painted
//           268 s as 9:16 and 189 s as 1:1 for the same frame count, so 1:1 ≈ 0.7
//   subs    where the subtitles sit (the .ass file): font size and margins in video px at the 720 short side.
//           9:16 keeps them above the bottom 20 % that Reels / Shorts / TikTok cover with their buttons and caption;
//           renderer/layout.js keeps the matching band (LAYOUT.subs) free of anything important
export type Format = '16:9' | '9:16' | '1:1';
export const FORMAT_IDS: readonly Format[] = ['16:9', '9:16', '1:1'];

export interface FormatInfo {
  id: Format;
  /** the stage page's ?fmt= value */
  query: '16x9' | '9x16' | '1x1';
  world: { w: number; h: number };
  cost: number;
  subs: { size: number; marginV: number; marginLR: number };
  /** for the studio's labels */
  name: string;
}

export const FORMATS: Record<Format, FormatInfo> = {
  '16:9': { id: '16:9', query: '16x9', world: { w: 1920, h: 1080 }, cost: 1, subs: { size: 40, marginV: 30, marginLR: 90 }, name: 'горизонтальный 16:9' },
  '9:16': { id: '9:16', query: '9x16', world: { w: 1080, h: 1920 }, cost: 1, subs: { size: 42, marginV: 272, marginLR: 50 }, name: 'вертикальный 9:16' },
  '1:1': { id: '1:1', query: '1x1', world: { w: 1080, h: 1080 }, cost: .7, subs: { size: 38, marginV: 36, marginLR: 50 }, name: 'квадрат 1:1' },
};

/** Anything (settings from an old project, a typo) → a known format; 16:9 by default. */
export const formatOf = (v: unknown): Format => (typeof v === 'string' && (FORMAT_IDS as readonly string[]).includes(v) ? v as Format : '16:9');

/** A frame of this format with the given short side (720 → 1280×720, 720×1280, 720×720). Even sizes for H.264. */
export function sizeOf(format: Format, short: number): { w: number; h: number } {
  const { w, h } = FORMATS[format].world, k = short / Math.min(w, h), even = (x: number) => Math.round(x * k / 2) * 2;
  return { w: even(w), h: even(h) };
}

/** The CSS aspect-ratio of a frame of this format ('16 / 9', '9 / 16', '1 / 1'). */
export const aspectOf = (format: Format | undefined) => (format ?? '16:9').replace(':', ' / ');
