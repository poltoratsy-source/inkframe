// Storyboard: idea + settings → scenes (title, line, duration, SceneSpec). Claude writes it when it can be reached
// (`claude -p` on this machine, see claude.ts); otherwise a plain template storyboard keeps the studio working.
import type { StartSettings } from '../engine/types';
import { COLOR_NAMES, MOODS, PROP_IDS, SETTINGS, TEMPLATES, cleanSpec, words, type PropId, type SceneSpec, type SettingId } from './scene-spec';

export interface BoardScene { title: string; line: string; duration: number; spec: SceneSpec }
export interface Storyboard { title: string; scenes: BoardScene[]; by: 'claude' | 'template' }

export const sceneCount = (sec: number) => Math.max(3, Math.min(10, Math.round(sec / 7)));
/** Words a narrator says in `sec` seconds at a calm pace. */
export const wordsFor = (sec: number) => Math.max(4, Math.floor(sec * 2.1));

/** Splits `total` seconds over `n` scenes, giving the last one the remainder (whole tenths). */
export function splitDurations(total: number, n: number): number[] {
  const base = Math.round(total / n * 10) / 10;
  return Array.from({ length: n }, (_, i) => (i < n - 1 ? base : Math.round((total - base * (n - 1)) * 10) / 10));
}

// ---------- prompt ----------
const LANG = { ru: 'Russian', en: 'English', kk: 'Kazakh' } as const;
const AUDIENCE = { kids: 'young children (5-8)', school: 'school kids (9-14)', adults: 'adults', clients: 'potential clients of a business' } as const;

export function storyboardPrompt(s: StartSettings): string {
  const n = sceneCount(s.duration), per = splitDurations(s.duration, n);
  const ending = s.ending === 'codeword'
    ? 'The LAST scene is template "card": title = one short CODE WORD in capitals that sums up the cartoon (viewers type it in the comments), subtitle = a short call to write it in the comments; its line invites viewers to write the code word in the comments.'
    : s.ending === 'subscribe' ? 'The LAST scene is template "card": title = a short call to subscribe, subtitle = what they will get; its line asks viewers to subscribe.'
      : 'Do not use the "card" template.';
  return `You write storyboards for Inkframe, a studio that paints short watercolour cartoons with a fixed set of scene templates.

IDEA: ${s.idea}
LENGTH: ${s.duration} seconds, exactly ${n} scenes (planned lengths in seconds: ${per.join(', ')}).
AUDIENCE: ${AUDIENCE[s.audience]}. LANGUAGE of every line, caption and label: ${LANG[s.language]}.
HOST: ${s.hero === 'none' ? 'no on-screen host: set "hero": false in every spec' : 'Clawd, a small friendly terracotta creature, explains things to the viewer'}.
${ending}

Each scene has: "title" (2-4 words, for the editor), "line" (what the narrator says in this scene: one or two short sentences,
at most ${wordsFor(per[0])} words for a ${per[0]} s scene, natural spoken ${LANG[s.language]}, no emoji), "duration" (seconds), and "spec":
- "template": one of ${TEMPLATES.join(', ')}
    host = the host talks to the viewer, optional "prop" pops up beside him;
    object = one big "prop" in the middle with up to two short "labels" (arrows point at it);
    compare = two things side by side: "left" and "right", each {"prop", "color"?, "caption"}, the host looks from one to the other;
    card = final card with "title" and "subtitle".
- "setting": one of ${SETTINGS.join(', ')}
- "mood": host emotion, one of ${MOODS.join(', ')}; optional "mood2" for the end of the scene
- "prop", "left.prop", "right.prop": one of ${PROP_IDS.join(', ')}
    (wave = a light wave: blue/violet are drawn short and quick, red/orange long and lazy; prism splits white light into a rainbow)
- "propColor", "left.color", "right.color": optional, one of ${COLOR_NAMES.join(', ')}
- "caption": optional big words at the top of the frame, at most 6 words (the key fact of the scene, not the whole line)
- "labels": optional, object template only, up to 2 labels of 1-3 words
- "pace": optional, slow | fast

Make it one small story: a hook in the first scene (a question or a surprise), then the explanation step by step with
the clearest possible picture for each step, a satisfying answer, then the ending. Facts must be correct. Pick props that
really show the idea; never invent props or templates outside the lists.

Reply with ONLY a JSON object, no markdown fences:
{"title": "...", "scenes": [{"title": "...", "line": "...", "duration": ${per[0]}, "spec": {"template": "host", "setting": "sky", "mood": "happy", "prop": "sun", "caption": "..."}}, ...]}`;
}

export function editPrompt(s: StartSettings, scene: BoardScene, request: string): string {
  return `You edit one scene of a short watercolour cartoon in Inkframe. Keep everything the request does not ask to change.
Language of line, caption and labels: ${LANG[s.language]}. The scene lasts about ${scene.duration} s, so the line has at most ${wordsFor(scene.duration) + 3} words.
Allowed values: template ${TEMPLATES.join('|')}; setting ${SETTINGS.join('|')}; mood ${MOODS.join('|')}; prop ${PROP_IDS.join('|')}; color ${COLOR_NAMES.join('|')}; heroSize normal|big; pace slow|normal|fast.

CURRENT SCENE:
${JSON.stringify(scene)}

REQUEST: ${request}

Reply with ONLY the whole updated scene as JSON (same shape: {"title", "line", "duration", "spec"}), no markdown fences.`;
}

/** The whole storyboard sent back with the author's note (the script gate's "Вернуть с замечанием"). */
export function revisePrompt(s: StartSettings, board: Storyboard, note: string): string {
  const n = sceneCount(s.duration);
  return `You rewrite the storyboard of a short watercolour cartoon in Inkframe after the author read it and sent it back with a note.
Do what the note asks; keep everything it does not mention. Same rules as before: language of every line, caption and label ${LANG[s.language]};
about ${n} scenes (the note may ask for more or fewer, at most 12), total length about ${s.duration} s, each line short enough for its scene
(a calm narrator says about 2 words per second).
Allowed values: template ${TEMPLATES.join('|')}; setting ${SETTINGS.join('|')}; mood ${MOODS.join('|')}; prop ${PROP_IDS.join('|')}; color ${COLOR_NAMES.join('|')}; heroSize normal|big; pace slow|normal|fast.
${s.ending === 'none' ? 'Do not use the "card" template.' : 'Keep the final "card" scene unless the note says otherwise.'}

CURRENT STORYBOARD:
${JSON.stringify({ title: board.title, scenes: board.scenes })}

NOTE FROM THE AUTHOR: ${note}

Reply with ONLY the whole updated storyboard as JSON (same shape: {"title", "scenes": [{"title", "line", "duration", "spec"}, ...]}), no markdown fences.`;
}

// ---------- parsing ----------
/** The first JSON object in a reply (Claude sometimes wraps it in fences or a sentence). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('no JSON object in the reply');
  return JSON.parse(t.slice(a, b + 1));
}

export function cleanScene(v: unknown, fallbackDuration: number, s: StartSettings): BoardScene | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const line = words(o.line, 220);
  if (!line) return undefined;
  const spec = cleanSpec(o.spec);
  if (s.hero === 'none') spec.hero = false;
  const d = Number(o.duration);
  return { title: words(o.title, 40) ?? line.split(/[.!?]/)[0].slice(0, 40), line, duration: d >= 2 && d <= 40 ? Math.round(d * 10) / 10 : fallbackDuration, spec };
}

export function cleanStoryboard(raw: unknown, s: StartSettings): Storyboard {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(o.scenes) ? o.scenes : [];
  const n = sceneCount(s.duration), per = splitDurations(s.duration, Math.min(Math.max(list.length, 1), 12));
  const scenes = list.slice(0, 12).map((x, i) => cleanScene(x, per[i] ?? per[0], s)).filter((x): x is BoardScene => !!x);
  if (scenes.length < Math.min(2, n)) throw new Error('the storyboard has too few usable scenes');
  if (s.ending === 'none') for (const sc of scenes) if (sc.spec.template === 'card') sc.spec = cleanSpec({ ...sc.spec, template: 'host' });
  // keep the planned total: scale scene lengths so they add up to the asked duration
  const sum = scenes.reduce((a, b) => a + b.duration, 0);
  for (const sc of scenes) sc.duration = Math.max(2, Math.round(sc.duration * s.duration / sum * 10) / 10);
  return { title: words(o.title, 60) ?? s.idea.slice(0, 60), scenes, by: 'claude' };
}

// ---------- the template storyboard (no AI) ----------
const PROP_HINTS: [RegExp, PropId][] = [
  [/неб|sky|солн|sun|күн|аспан/i, 'sun'], [/лун|moon/i, 'moon'], [/звёзд|звезд|star|жұлдыз/i, 'star'], [/космос|планет|space|planet/i, 'planet'],
  [/радуг|rainbow/i, 'rainbow'], [/свет|light|лазер|лидар|laser|lidar/i, 'prism'], [/вод|дожд|water|rain/i, 'drop'],
  [/кош|кот|cat|мысық/i, 'cat'], [/рыб|fish|балық/i, 'fish'], [/дерев|лес|tree|forest|ағаш/i, 'tree'], [/цвет[оы]|flower|гүл/i, 'flower'],
  [/ракет|rocket/i, 'rocket'], [/врем|час|time|clock|уақыт/i, 'clock'], [/атом|atom|молекул/i, 'atom'], [/яблок|apple|алма/i, 'apple'],
  [/подар|рожден|праздн|gift|birthday|сыйлық/i, 'gift'], [/книг|чита|book|read|кітап/i, 'book'], [/глаз|видит|eye|see|көз/i, 'eye'],
  [/гор[аыу]|mountain|тау/i, 'mountain'], [/земл|earth|жер/i, 'earth'], [/сердц|любов|мам|love|heart|mom|жүрек|ана/i, 'heart'],
  [/иде|(?<!\p{L})ии(?!\p{L})|\bai\b|нейро|мозг|brain|neural/iu, 'bulb'], [/волн|wave|звук|sound|толқын/i, 'wave'], [/облак|cloud|бұлт/i, 'cloud'],
];
const SETTING_HINTS: [RegExp, SettingId][] = [
  [/ноч|звёзд|звезд|лун|night|star|moon|түн/i, 'night'], [/космос|планет|space|planet|ғарыш/i, 'space'], [/мор|океан|sea|ocean|рыб|fish|теңіз/i, 'sea'],
  [/кош|кот|дом|cat|home|мысық|үй/i, 'room'], [/цвет|луг|flower|meadow|гүл/i, 'meadow'], [/урок|школ|формул|school|lesson|сабақ/i, 'board'],
];
const STOP = new Set(['почему', 'как', 'что', 'зачем', 'где', 'когда', 'кто', 'отчего', 'такое', 'это', 'весело', 'для', 'про', 'the', 'why', 'how', 'what', 'does', 'is', 'are', 'a', 'an', 'of', 'неге', 'қалай', 'не']);

/** The idea without "a short cartoon:" and "Clawd explains" in front, as a question if it is one. */
export function topicOf(idea: string): string {
  let t = idea.trim().replace(/\s+/g, ' ');
  if (/^[^:]{0,40}:/.test(t) && /мульт|cartoon|ролик|видео|video/i.test(t.split(':')[0])) t = t.slice(t.indexOf(':') + 1).trim();
  t = t.replace(/^(клод|claude|clawd)\s+(объясняет|рассказывает|explains|tells)[,:]?\s*/i, '').replace(/\s+[—-]\s+.*$/, '');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (/^(почему|как|что|зачем|где|когда|кто|отчего|why|how|what|where|when|who|неге|қалай)(?!\p{L})/iu.test(t) && !/[?!.]$/.test(t)) t += '?';
  return t;
}
export function codeWordOf(topic: string): string {
  const w = topic.toLowerCase().replace(/[^\p{L}\s-]/gu, ' ').split(/\s+/).filter(x => x.length >= 3 && !STOP.has(x));
  return (w[0] ?? 'мульт').toUpperCase();
}

const LINES = {
  ru: {
    hello: (t: string) => `Привет! Я Клод. ${t} Сейчас разберёмся!`,
    look: 'Посмотри внимательно: ответ прячется прямо здесь.',
    steps: ['Разберём по шагам — всё проще, чем кажется.', 'Сравни сам — разница сразу видна.', 'Вот и ответ — теперь ты знаешь секрет!'],
    close: (c: string) => `Понравилось? Напиши в комментариях кодовое слово «${c}»!`,
    sub: 'Подпишись — дальше будет ещё интереснее!',
    codeHint: 'напиши его в комментариях', subTitle: 'Подпишись!', subHint: 'новые мультики каждую неделю',
    titles: ['Вопрос', 'Смотрим поближе', 'Разбираем', 'Сравниваем', 'Ответ', 'Финал'],
  },
  en: {
    hello: (t: string) => `Hi! I'm Clawd. ${t} Let's find out!`,
    look: 'Look closely: the answer is hiding right here.',
    steps: ["Let's go step by step: it's simpler than it looks.", 'Compare them: the difference jumps out.', 'And there it is: now you know the secret!'],
    close: (c: string) => `Liked it? Type the code word "${c}" in the comments!`,
    sub: 'Subscribe: there is more to come!',
    codeHint: 'type it in the comments', subTitle: 'Subscribe!', subHint: 'new cartoons every week',
    titles: ['The question', 'A closer look', 'Step by step', 'Compare', 'The answer', 'The end'],
  },
} as const;

export function templateStoryboard(s: StartSettings): Storyboard {
  const L = s.language === 'en' ? LINES.en : LINES.ru, topic = topicOf(s.idea), code = codeWordOf(topic);
  const prop = PROP_HINTS.find(([re]) => re.test(s.idea))?.[1] ?? 'question';
  const setting = SETTING_HINTS.find(([re]) => re.test(s.idea))?.[1] ?? 'sky';
  const n = sceneCount(s.duration), per = splitDurations(s.duration, n), hero = s.hero === 'none' ? { hero: false } : {};
  const withCard = s.ending !== 'none';
  const scenes: BoardScene[] = [];
  scenes.push({ title: L.titles[0], line: L.hello(topic), duration: per[0], spec: cleanSpec({ template: 'host', setting, mood: 'excited', mood2: 'thinking', caption: words(topic, 42), ...hero }) });
  const middle = n - 1 - (withCard ? 1 : 0);
  for (let i = 0; i < middle; i++) {
    const last = i === middle - 1 && !withCard;
    scenes.push({
      title: L.titles[Math.min(1 + i, 4)], line: i === 0 ? L.look : L.steps[Math.min(i - 1, 2)], duration: per[1 + i],
      spec: cleanSpec({ template: i % 2 === 0 ? 'object' : 'host', setting, mood: last ? 'proud' : i % 2 ? 'idea' : 'thinking', prop, ...hero }),
    });
  }
  if (withCard) {
    const codeword = s.ending === 'codeword';
    scenes.push({ title: L.titles[5], line: codeword ? L.close(code) : L.sub, duration: per[n - 1],
      spec: cleanSpec({ template: 'card', setting: 'sunset', mood: 'excited', title: codeword ? code : L.subTitle, subtitle: codeword ? L.codeHint : L.subHint, ...hero }) });
  }
  return { title: topic.replace(/\?$/, ''), scenes, by: 'template' };
}

// ---------- a sent-back script without AI ----------
/** The author's note applied by simple rules: "сцена 2: …" goes to that scene (as a scene edit would), otherwise
 *  quick words such as «ночь», «медленнее», «веселее» go to every scene. `understood: false` = nothing changed. */
export function reviseByRules(board: Storyboard, note: string): { board: Storyboard; understood: boolean } {
  const m = note.trim().match(/^(?:сцен[аеуы]?|scene)\s*(\d+)\s*[:—,.-]\s*(.+)$/is);
  const scenes = board.scenes.map(sc => ({ ...sc, spec: { ...sc.spec } }));
  let understood = false;
  if (m) {
    const i = Number(m[1]) - 1;
    if (scenes[i]) { const r = editByRules(scenes[i], m[2]); scenes[i] = r.scene; understood = r.understood; }
  } else if (!/^(?:реплика|текст реплики|скажи|line|say|подпись|надпись|текст|caption|title|заголовок)\s*[:—-]/i.test(note.trim())) {
    for (const [i, sc] of scenes.entries()) {
      const r = editByRules(sc, note);
      if (r.understood && !r.voice) { scenes[i] = r.scene; understood = true; }
    }
  }
  return { board: { ...board, scenes }, understood };
}

// ---------- edits without AI ----------
/** Applies an edit request by simple rules: "реплика: …" / "line: …", "подпись: …" / "caption: …" and the quick chips. */
export function editByRules(scene: BoardScene, request: string): { scene: BoardScene; voice?: 'other'; understood: boolean } {
  const r = request.trim(), out: BoardScene = { ...scene, spec: { ...scene.spec } };
  let understood = false, voice: 'other' | undefined;
  const after = (re: RegExp) => { const m = r.match(re); return m ? words(m[1].replace(/^[«"“]|[»"”]$/g, ''), 220) : undefined; };
  const line = after(/^(?:реплика|текст реплики|скажи|line|say)\s*[:—-]\s*(.+)$/is);
  const cap = after(/^(?:подпись|надпись|текст|caption|title|заголовок)\s*[:—-]\s*(.+)$/is);
  if (line) { out.line = line; understood = true; }
  if (cap) { if (out.spec.template === 'card') out.spec.title = words(cap, 24); else out.spec.caption = words(cap, 42); understood = true; }
  if (!line && !cap) {
    if (/ноч|темн|night|dark/i.test(r)) { out.spec.setting = 'night'; understood = true; }
    if (/космос|space/i.test(r)) { out.spec.setting = 'space'; understood = true; }
    if (/мор|sea/i.test(r)) { out.spec.setting = 'sea'; understood = true; }
    if (/день|дн[её]м|небо|day|sky/i.test(r) && !/ноч/i.test(r)) { out.spec.setting = 'sky'; understood = true; }
    if (/крупн|ближе|больше|bigger|closer/i.test(r)) { out.spec.heroSize = 'big'; understood = true; }
    if (/медлен|спокой|slower|calm/i.test(r)) { out.spec.pace = 'slow'; understood = true; }
    if (/быстр|faster/i.test(r)) { out.spec.pace = 'fast'; understood = true; }
    if (/весел|ярч|радост|fun|happ|bright/i.test(r)) { out.spec.mood = 'excited'; out.spec.mood2 = 'laugh'; if (['night', 'space', 'board'].includes(out.spec.setting)) out.spec.setting = 'sunset'; understood = true; }
    if (/груст|sad/i.test(r)) { out.spec.mood = 'sad'; understood = true; }
    if (/голос|voice/i.test(r)) { voice = 'other'; understood = true; }
    for (const p of PROP_IDS) if (new RegExp(`\\b${p}\\b`, 'i').test(r)) { out.spec.prop = p; understood = true; }
    const hint = PROP_HINTS.find(([re]) => re.test(r) && !/голос|voice/i.test(r));
    if (hint && /добав|покажи|нарисуй|вместо|add|show|draw/i.test(r)) { out.spec.prop = hint[1]; if (out.spec.template === 'card') out.spec.template = 'host'; understood = true; }
  }
  out.spec = cleanSpec(out.spec);
  return { scene: out, voice, understood };
}
