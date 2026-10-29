// What a storyboard may ask the painter for. Claude never writes drawing code: it fills these fields, and
// renderer/templates.js + renderer/props.js paint them. clean*() turns anything (Claude's JSON included) into a
// valid spec, dropping what it doesn't know.

export const TEMPLATES = ['host', 'object', 'compare', 'card'] as const;
export const SETTINGS = ['room', 'sky', 'meadow', 'sunset', 'night', 'space', 'sea', 'board'] as const;
export const PROP_IDS = ['sun', 'cloud', 'earth', 'moon', 'star', 'drop', 'rainbow', 'bulb', 'heart', 'book', 'prism', 'eye', 'tree',
  'flower', 'rocket', 'clock', 'atom', 'apple', 'gift', 'wave', 'planet', 'cat', 'fish', 'question', 'mountain'] as const;
export const MOODS = ['happy', 'excited', 'laugh', 'love', 'proud', 'playful', 'hopeful', 'cool', 'thinking', 'idea', 'surprised',
  'confused', 'determined', 'shy', 'sad', 'nervous', 'starstruck', 'mischief'] as const;
export const COLOR_NAMES = ['blue', 'sky', 'red', 'orange', 'yellow', 'green', 'teal', 'violet', 'pink', 'brown', 'grey', 'white', 'clay'] as const;

export type TemplateId = (typeof TEMPLATES)[number];
export type SettingId = (typeof SETTINGS)[number];
export type PropId = (typeof PROP_IDS)[number];
export type Mood = (typeof MOODS)[number];
export type ColorName = (typeof COLOR_NAMES)[number];

export interface Side { prop: PropId; color?: ColorName; caption?: string }
export interface SceneSpec {
  template: TemplateId;
  setting: SettingId;
  mood: Mood;
  mood2?: Mood;
  prop?: PropId;
  propColor?: ColorName;
  /** big words at the top of the frame (or the card title) */
  caption?: string;
  /** object: up to two labels with arrows */
  labels?: string[];
  /** compare: the two sides */
  left?: Side;
  right?: Side;
  /** card: the big title and a line under it */
  title?: string;
  subtitle?: string;
  heroSize?: 'normal' | 'big';
  hero?: boolean;
  pace?: 'slow' | 'normal' | 'fast';
}

/** What the stage page gets for one frame (renderer/templates.js reads window.SCENE). */
export interface StageScene extends SceneSpec { duration: number; voice: string; sketch?: boolean; fast?: boolean }

const pick = <T extends string>(list: readonly T[], v: unknown, d?: T): T | undefined =>
  (typeof v === 'string' && (list as readonly string[]).includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() as T : d);
/** Short words for the frame: one line, no markup, at most `n` characters. */
export const words = (v: unknown, n: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/[\u0000-\u001f<>{}\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s) : undefined;
};

function cleanSide(v: unknown): Side | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>, prop = pick(PROP_IDS, o.prop);
  if (!prop) return undefined;
  return { prop, ...(pick(COLOR_NAMES, o.color) && { color: pick(COLOR_NAMES, o.color) }), ...(words(o.caption, 28) && { caption: words(o.caption, 28) }) };
}

export function cleanSpec(v: unknown, fallback: Partial<SceneSpec> = {}): SceneSpec {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const s: SceneSpec = {
    template: pick(TEMPLATES, o.template, fallback.template ?? 'host')!,
    setting: pick(SETTINGS, o.setting, fallback.setting ?? 'sky')!,
    mood: pick(MOODS, o.mood, fallback.mood ?? 'happy')!,
  };
  const mood2 = pick(MOODS, o.mood2); if (mood2) s.mood2 = mood2;
  const prop = pick(PROP_IDS, o.prop); if (prop) s.prop = prop;
  const pc = pick(COLOR_NAMES, o.propColor); if (pc) s.propColor = pc;
  const cap = words(o.caption, 42); if (cap) s.caption = cap;
  if (Array.isArray(o.labels)) { const l = o.labels.map(x => words(x, 24)).filter((x): x is string => !!x).slice(0, 2); if (l.length) s.labels = l; }
  const left = cleanSide(o.left), right = cleanSide(o.right);
  if (left) s.left = left;
  if (right) s.right = right;
  const title = words(o.title, 24); if (title) s.title = title;
  const sub = words(o.subtitle, 48); if (sub) s.subtitle = sub;
  if (o.heroSize === 'big') s.heroSize = 'big';
  if (o.hero === false) s.hero = false;
  const pace = pick(['slow', 'normal', 'fast'] as const, o.pace); if (pace && pace !== 'normal') s.pace = pace;
  // a template that lacks what it needs falls back to one that doesn't
  if (s.template === 'compare' && !(s.left && s.right)) s.template = s.prop ? 'object' : 'host';
  if (s.template === 'object' && !s.prop) s.prop = 'question';
  if (s.template === 'card' && !s.title) s.title = s.caption ?? '★';
  return s;
}

/** A plain-language description of the frame, for the studio's "What is on screen" card. */
export function describe(s: SceneSpec, lang: 'ru' | 'en' | 'kk' = 'ru'): string {
  const ru = lang !== 'en';
  const hero = s.hero === false ? '' : ru ? 'Клод' : 'Clawd';
  const where = (ru ? { room: 'в комнате', sky: 'под голубым небом', meadow: 'на лугу', sunset: 'на закате', night: 'ночью под звёздами', space: 'в космосе', sea: 'у моря', board: 'у доски' }
    : { room: 'in a room', sky: 'under a blue sky', meadow: 'in a meadow', sunset: 'at sunset', night: 'at night under the stars', space: 'in space', sea: 'by the sea', board: 'at the blackboard' })[s.setting];
  const words = [s.caption && `«${s.caption}»`].filter(Boolean).join(' ');
  switch (s.template) {
    case 'host': return [hero && `${hero} ${ru ? 'рассказывает' : 'talks'} ${where}`, s.prop && `${ru ? 'рядом' : 'next to'}: ${s.prop}`, words].filter(Boolean).join(', ');
    case 'object': return [`${ru ? 'Крупно' : 'Close up'}: ${s.prop} ${where}`, s.labels?.length && `${ru ? 'подписи' : 'labels'}: ${s.labels.join(', ')}`, words].filter(Boolean).join(', ');
    case 'compare': return [`${ru ? 'Сравнение' : 'Comparison'}: ${s.left?.prop}${s.left?.caption ? ` («${s.left.caption}»)` : ''} ${ru ? 'и' : 'and'} ${s.right?.prop}${s.right?.caption ? ` («${s.right.caption}»)` : ''}`, words].filter(Boolean).join(', ');
    case 'card': return `${ru ? 'Финальная карточка' : 'End card'}: «${s.title}»${s.subtitle ? `, ${s.subtitle}` : ''}`;
  }
}
