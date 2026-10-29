// Frames of every template and several settings in one format, for a look and for before/after comparisons:
//   node --import tsx scripts/check-formats.ts <16:9|9:16|1:1> sheet <out.jpg> [--watercolor] [--safe] [--rs=.5]
//   node --import tsx scripts/check-formats.ts <format> save <dir>       every frame as a full-size PNG (the "before")
//   node --import tsx scripts/check-formats.ts <format> compare <dir>    the same frames again, compared pixel by pixel
// sheet: a contact sheet, each cell labelled template · setting · t; --safe draws the format's safe area (layout.js).
// compare uses the tolerance of check-determinism.ts (SwiftShader repaints a frame with tiny differences): a frame
// passes when ≤ 0.1 % of its channel values differ, by ≤ 32 levels. Exit code 1 if any frame differs beyond it.
// The PNG folder must be one Chrome may read (a snap Chrome can't read /tmp): use one under projects/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../lib/real/painter.ts';
import { FORMATS, type Format } from '../lib/formats.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';

const [fmtArg = '16:9', mode = 'sheet', target = 'projects/check/formats.jpg', ...rest] = process.argv.slice(2);
const format = fmtArg as Format;
if (!FORMATS[format]) throw new Error(`unknown format ${fmtArg}`);
const watercolor = rest.includes('--watercolor'), safe = rest.includes('--safe');
const rs = +(rest.find(a => a.startsWith('--rs='))?.slice(5) ?? .5);
const voice = '0000000033667755443300000000336677554433000000003366775544330000'.repeat(4);
const S = (s: Omit<StageScene, 'duration' | 'voice'> & { duration?: number }): StageScene => ({ duration: 5, voice, ...s });
const host = S({ template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?' });
const object = S({ template: 'object', setting: 'sky', mood: 'thinking', prop: 'prism', caption: 'Белый свет — это все цвета', labels: ['белый свет', 'радуга'] });
const compare = S({ template: 'compare', setting: 'sky', mood: 'surprised', caption: 'Синий рассеивается сильнее', left: { prop: 'wave', color: 'blue', caption: 'синий: короткие' }, right: { prop: 'wave', color: 'red', caption: 'красный: длинные' } });
const card = S({ template: 'card', setting: 'sunset', mood: 'excited', title: 'НЕБО', subtitle: 'кодовое слово — пиши в комментарии' });
/** [scene, t, label]: the four templates through their moves, then the settings (backgrounds) */
const ITEMS: [StageScene, number][] = [
  [host, .4], [host, 1.5], [host, 3.5],
  [object, .6], [object, 2.2], [object, 4.2],
  [compare, .8], [compare, 2.4], [compare, 4.2],
  [card, .4], [card, 1.5], [card, 3.5],
  [S({ template: 'host', setting: 'room', mood: 'excited', caption: 'Привет!' }), 2.2],
  [S({ template: 'host', setting: 'night', mood: 'hopeful', prop: 'star', caption: 'Ночью видно звёзды' }), 2.2],
  [S({ template: 'host', setting: 'sea', mood: 'playful', prop: 'fish', heroSize: 'big' }), 2.2],
  [S({ template: 'object', setting: 'space', mood: 'starstruck', prop: 'planet', caption: 'Сатурн', labels: ['кольца', 'шар из газа'] }), 4.2],
  [S({ template: 'object', setting: 'board', mood: 'idea', prop: 'atom', caption: 'Атом', labels: ['ядро'] }), 3.5],
  [S({ template: 'compare', setting: 'meadow', mood: 'love', left: { prop: 'tree', caption: 'дерево' }, right: { prop: 'flower', color: 'pink', caption: 'цветок' } }), 4.2],
  [S({ template: 'host', setting: 'sunset', mood: 'proud', prop: 'rocket', hero: false, caption: 'Без героя' }), 2.2],
  [S({ template: 'card', setting: 'space', mood: 'cool', title: 'КОСМОС', subtitle: 'напиши слово в комментариях' }), 2.4],
  [S({ template: 'card', setting: 'meadow', mood: 'love', title: 'ЛЕПЕСТОК' }), 2.4],
];
const scenes = ITEMS.map(([s, t]) => [{ ...s, format, fast: !watercolor }, t] as const);
const label = (s: StageScene, t: number) => `${s.template} · ${s.setting}${s.hero === false ? ' · без героя' : ''} · ${t}s`;

const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true, protocolTimeout: 0,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.error('[stage]', (e as Error).message));
page.on('console', m => { if (m.type() === 'error') console.error('[stage]', m.text()); });
await page.goto(`${pathToFileURL(resolve('renderer/stage.html')).href}?render&rs=${rs}&fmt=${FORMATS[format].query}`);
await page.waitForFunction('window.ready === true', { timeout: 60000 });
// the page code is a string, so the TS loader's helpers never end up in the page
const run = <T>(code: string) => page.evaluate(code) as Promise<T>;
const t0 = Date.now();
let bad = 0;

if (mode === 'sheet') {
  const cols = format === '16:9' ? 3 : format === '9:16' ? 6 : 4, cw = format === '16:9' ? 560 : format === '9:16' ? 300 : 400;
  const rows = Math.ceil(scenes.length / cols);
  await run(`(() => {
    const ch = Math.round(${cw} * H / W), sc = document.createElement('canvas'); sc.width = ${cols} * ${cw}; sc.height = ${rows} * ch;
    window.__sheet = sc; window.__cell = [${cw}, ch];
  })()`);
  for (const [i, [s, t]] of scenes.entries()) {
    await run(`(async () => {
      window.SCENE = ${JSON.stringify(s)}; await renderAt(${t});
      const [cw, ch] = window.__cell, c = window.__sheet.getContext('2d'), x = (${i} % ${cols}) * cw, y = Math.floor(${i} / ${cols}) * ch;
      c.drawImage(document.getElementById('out'), x, y, cw, ch);
      if (${safe} && typeof LAYOUT !== 'undefined') {
        const k = cw / W, z = LAYOUT.safe; c.save(); c.setLineDash([6, 5]); c.strokeStyle = 'rgba(220,30,60,.85)'; c.lineWidth = 1.5;
        c.strokeRect(x + z.x0 * k, y + z.y0 * k, (z.x1 - z.x0) * k, (z.y1 - z.y0) * k);
        if (LAYOUT.subs) { c.strokeStyle = 'rgba(30,90,220,.85)'; c.strokeRect(x + LAYOUT.subs.x0 * k, y + LAYOUT.subs.y0 * k, (LAYOUT.subs.x1 - LAYOUT.subs.x0) * k, (LAYOUT.subs.y1 - LAYOUT.subs.y0) * k); }
        c.restore();
      }
      c.strokeStyle = '#222'; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      c.font = '13px sans-serif'; const txt = ${JSON.stringify(label(s, t))}, tw = c.measureText(txt).width;
      c.fillStyle = 'rgba(0,0,0,.65)'; c.fillRect(x, y, tw + 12, 20); c.fillStyle = '#fff'; c.fillText(txt, x + 6, y + 14);
    })()`);
  }
  const url = await run<string>(`window.__sheet.toDataURL('image/jpeg', .86)`);
  mkdirSync(resolve(target, '..'), { recursive: true });
  writeFileSync(target, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  console.log(`${format}: ${scenes.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${target}`);
} else if (mode === 'save' || mode === 'compare') {
  mkdirSync(target, { recursive: true });
  for (const [i, [s, t]] of scenes.entries()) {
    const file = resolve(target, `f${String(i).padStart(2, '0')}.png`);
    if (mode === 'save') {
      const url = await run<string>(`(async () => { window.SCENE = ${JSON.stringify(s)}; await renderAt(${t}); return document.getElementById('out').toDataURL('image/png'); })()`);
      writeFileSync(file, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      continue;
    }
    const r = await run<{ n: number; m: number; total: number; w: number; h: number }>(`(async () => {
      window.SCENE = ${JSON.stringify(s)}; await renderAt(${t});
      const img = new Image(); img.src = ${JSON.stringify(pathToFileURL(file).href)}; await img.decode();
      const out = document.getElementById('out'), c = document.createElement('canvas'); c.width = out.width; c.height = out.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const a = x.getImageData(0, 0, c.width, c.height).data, b = out.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0, m = 0; for (let j = 0; j < a.length; j++) { const e = Math.abs(a[j] - b[j]); if (e) { n++; if (e > m) m = e; } }
      return { n, m, total: a.length, w: img.width, h: img.height };
    })()`);
    const ok = r.w === FORMATS[format].world.w && r.h === FORMATS[format].world.h && r.n <= r.total * .001 && r.m <= 32;
    if (!ok) bad++;
    console.log(`${ok ? 'same' : 'DIFF'} f${String(i).padStart(2, '0')} ${label(s, t)}: ${r.n} values differ (${(r.n / r.total * 100).toFixed(3)} %), max ${r.m}`);
  }
  console.log(`${mode}: ${scenes.length} frames, ${format}, rs ${rs}, in ${((Date.now() - t0) / 1000).toFixed(0)} s${mode === 'compare' ? `: ${bad} differ` : ''}`);
}
await browser.close();
process.exit(bad ? 1 : 0);
