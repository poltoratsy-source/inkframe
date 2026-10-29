// The style packs (renderer/styles/<id>/style.json), shared by the engine, the start screen and the static demo.
// Pure (the JSON is bundled, no node imports): the stage page reads the same files itself (?style=<id>), so the studio,
// the estimate and the painter always agree on what a pack is. Notes for the storyboard (STYLE.md) are read on the
// server only (lib/real/styles.ts).
//
//   paper, ink, palette   the colours (Clawd's clay is the same in every pack: he is the brand)
//   texture               the paper: blotches, fibres, grain, vignette
//   brushes               the pack's ink / inkfine / dry brushes (p5.brush)
//   brush                 how a shape is painted: washes in colour or faded to `tint`, fills, hatching, every line in
//                         the ink (mono), an outline for shapes drawn without one (outlineAll), light (glow 0..1)
//   clawd                 how Clawd sits in the pack (his shadow); his shape and colours never change
//   boil                  fps, amp, inkOnly (only ink lines boil, fills hold), hold, holdStill
//   springs               which spring preset each kind of move uses: pop, arrive, land, letters
//   letters               lettering colours: fill, stroke (null = none), shadow, the card's title and subtitle
//   grammar               (Ink) colour only by meaning: structure, flow, problem, good, the tint of a role's washes and
//                         the default roles of arrows and the card title
//   speed.cost            what a frame of this pack costs to paint against a Watercolour one (the estimate)
//   preview               a real frame of the pack for the start screen (public/…)
import watercolor from '../renderer/styles/watercolor/style.json';
import ink from '../renderer/styles/ink/style.json';

export const STYLE_IDS = ['watercolor', 'ink'] as const;
export type StyleId = (typeof STYLE_IDS)[number];
/** A colour-grammar role a scene may give an element; without one it is the plain structure colour. */
export const ROLES = ['flow', 'problem', 'good'] as const;
export type Role = (typeof ROLES)[number];
export type SpringPreset = 'settle' | 'overshoot' | 'bouncy' | 'soft';

export interface StylePack {
  id: StyleId;
  name: { ru: string; en: string };
  line: { ru: string; en: string };
  paper: string; ink: string; palette: Record<string, string>;
  texture: {
    blotches: { n: number; rgb: string; alpha: number; r0: number; dr: number };
    fibres: { n: number; rgb: string; alpha0: number; alpha1: number };
    grain: { density: number; depth: number; tint: number[] };
    vignette: { rgb: string; alpha: number };
  };
  brushes: Record<string, Record<string, unknown>>;
  brush: { wash: boolean; fill: boolean; hatch: boolean; bleed: number; texture: number; tint: number; mono: boolean; outlineAll: boolean; glow: number };
  boil: { fps: number; amp: number; inkOnly: boolean; hold: boolean; holdStill: boolean };
  springs: { pop: SpringPreset; arrive: SpringPreset; land: SpringPreset; letters: SpringPreset };
  letters: { fill: string; stroke: string | null; shadow: boolean; title: string; sub: string };
  grammar?: { structure: string; flow: string; problem: string; good: string; tint: number; defaults: { arrow?: Role; title?: Role } };
  /** how Clawd sits in the pack: his shadow a soft wash (default) or two ink strokes (line) */
  clawd?: { shadow?: 'wash' | 'line' };
  kit?: string;
  speed: { cost: number };
  preview: string;
}

const HEX = /^#[0-9a-f]{6}$/i;
const SPRINGS: readonly string[] = ['settle', 'overshoot', 'bouncy', 'soft'];
/** Clawd's colours: every pack keeps them, whatever else it changes. */
export const BRAND = { clay: '#D97757', clayDk: '#A84D33', clayLt: '#F2A283' } as const;

/** What is wrong with a pack (an empty list = it is fine): required fields, colours, ranges, the brand colours. */
export function checkPack(v: unknown, id?: string): string[] {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, any>, bad: string[] = [];
  const need = (ok: unknown, what: string) => { if (!ok) bad.push(what); };
  const num = (x: unknown, a: number, b: number) => typeof x === 'number' && x >= a && x <= b;
  const bool = (x: unknown) => typeof x === 'boolean';
  need(typeof p.id === 'string' && /^[a-z0-9-]+$/.test(p.id) && (!id || p.id === id), `id (${p.id})`);
  need(p.name?.ru && p.name?.en, 'name.ru / name.en');
  need(p.line?.ru && p.line?.en, 'line.ru / line.en');
  need(HEX.test(p.paper ?? ''), 'paper: #rrggbb');
  need(HEX.test(p.ink ?? ''), 'ink: #rrggbb');
  const pal = p.palette ?? {};
  for (const [k, c] of Object.entries(pal)) need(HEX.test(String(c)), `palette.${k}: #rrggbb`);
  for (const [k, c] of Object.entries(BRAND)) need(String(pal[k] ?? '').toUpperCase() === c, `palette.${k} must stay ${c} (Clawd)`);
  const x = p.texture ?? {};
  need(num(x.blotches?.n, 0, 500) && num(x.blotches?.alpha, 0, 1) && /^\d+,\d+,\d+$/.test(x.blotches?.rgb ?? ''), 'texture.blotches');
  need(num(x.fibres?.n, 0, 5000) && num(x.fibres?.alpha0, 0, 1) && num(x.fibres?.alpha1, 0, 1), 'texture.fibres');
  need(num(x.grain?.density, 0, 1) && num(x.grain?.depth, 0, 128) && Array.isArray(x.grain?.tint) && x.grain.tint.length === 3, 'texture.grain');
  need(num(x.vignette?.alpha, 0, 1), 'texture.vignette');
  for (const b of ['ink', 'inkfine', 'dry']) need(p.brushes?.[b] && typeof p.brushes[b].weight === 'number', `brushes.${b}`);
  const br = p.brush ?? {};
  need(['wash', 'fill', 'hatch', 'mono', 'outlineAll'].every(k => bool(br[k])) && num(br.bleed, 0, 4) && num(br.texture, 0, 4) && num(br.tint, 0, 1) && num(br.glow, 0, 2), 'brush');
  need(p.clawd === undefined || [undefined, 'wash', 'line'].includes(p.clawd?.shadow), 'clawd.shadow: wash / line');
  need(num(p.boil?.fps, 1, 24) && num(p.boil?.amp, 0, 5) && bool(p.boil?.inkOnly) && bool(p.boil?.hold) && bool(p.boil?.holdStill), 'boil {fps 1–24, amp, inkOnly, hold, holdStill}');
  need(['pop', 'arrive', 'land', 'letters'].every(k => SPRINGS.includes(p.springs?.[k])), 'springs {pop, arrive, land, letters}');
  const l = p.letters ?? {};
  need(HEX.test(l.fill ?? '') && (l.stroke === null || HEX.test(l.stroke ?? '')) && bool(l.shadow) && HEX.test(l.title ?? '') && HEX.test(l.sub ?? ''), 'letters');
  if (p.grammar !== undefined) {
    const g = p.grammar;
    need(['structure', 'flow', 'problem', 'good'].every(k => HEX.test(g?.[k] ?? '')) && num(g?.tint, 0, 1), 'grammar colours');
    need(Object.values(g?.defaults ?? {}).every(r => (ROLES as readonly string[]).includes(String(r))), 'grammar.defaults: flow / problem / good');
  }
  need(p.kit === undefined || /^[a-z0-9-]+\.js$/.test(p.kit), 'kit: a .js file name');
  need(num(p.speed?.cost, .1, 10), 'speed.cost');
  need(typeof p.preview === 'string' && p.preview.length > 0, 'preview');
  return bad;
}

export const STYLE_PACKS: Record<StyleId, StylePack> = { watercolor: watercolor as StylePack, ink: ink as StylePack };

/** Anything (an old project's «kinetic», a typo) → a pack that exists; Watercolour by default. */
export const styleOf = (v: unknown): StyleId => (typeof v === 'string' && (STYLE_IDS as readonly string[]).includes(v) ? v as StyleId : 'watercolor');
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
/** A pack's role colours, or none (a pack without a colour grammar ignores roles). */
export const grammarOf = (id: StyleId) => STYLE_PACKS[id].grammar;
