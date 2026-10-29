// Determinism check for the painted engine: a frame must be a pure function of t. Paints the same frames in two
// separate pages, in different orders (page B starts with other scenes and goes backwards), and compares the pixels.
//   node --import tsx scripts/check-determinism.ts [rs=.25] [--watercolor]
// Exit code 1 if any frame differs beyond the tolerance. Needs Chrome (the same one the painter uses); ~2 min here.
// Tolerance: with SwiftShader (CPU WebGL) a repeat render of the very same t, even in the same page, can differ in a
// few dozen to a few thousand channel values by at most ~16/255 (measured 29.10.2026, the pre-M2 renderer too); a real
// order dependence (a re-boil) changes ~10⁵–10⁶ values by up to ~200. So: ≤ 0.1 % of values and ≤ 32 levels passes.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Page } from 'puppeteer-core';
import { findChrome } from '../lib/real/painter.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';

const args = process.argv.slice(2), rs = +(args.find(a => !a.startsWith('--')) || .25), watercolor = args.includes('--watercolor');
const voice = '0000000033667755443300000000336677554433000000003366775544330000'.repeat(4);
const base: StageScene[] = [
  { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?', duration: 5, voice },
  { template: 'host', setting: 'room', mood: 'excited', caption: 'Привет!', duration: 4, voice },
  { template: 'object', setting: 'sky', mood: 'thinking', prop: 'prism', caption: 'Белый свет', labels: ['белый свет', 'радуга'], duration: 5, voice },
  { template: 'compare', setting: 'sky', mood: 'surprised', left: { prop: 'wave', color: 'blue', caption: 'синий' }, right: { prop: 'wave', color: 'red', caption: 'красный' }, duration: 5, voice },
  { template: 'card', setting: 'sunset', mood: 'excited', title: 'НЕБО', subtitle: 'кодовое слово', duration: 5, voice },
  // the boil options: ink-only boil at 9 fps with still props holding
  { template: 'host', setting: 'meadow', mood: 'happy', prop: 'tree', caption: 'Тушь', duration: 4, voice, boil: { fps: 9, amp: 1.6, inkOnly: true, holdStill: true } },
];
const scenes = base.map(s => ({ ...s, fast: !watercolor }));
const times = [.12, .45, .62, 1.05, 2.37, 3.3];

const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true, protocolTimeout: 0,
  args: ['--no-sandbox', '--allow-file-access-from-files', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1920,1080',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
});
const url = `${pathToFileURL(resolve('renderer/stage.html')).href}?render&rs=${rs}`;
const open = async () => { const p = await browser.newPage(); p.on('pageerror', e => console.error('[stage]', (e as Error).message)); await p.goto(url); await p.waitForFunction('window.ready === true', { timeout: 60000 }); return p; };
// Paints a frame and returns a hash of its pixels (FNV-1a over the RGBA bytes); raw = true returns the bytes (base64).
// The page code is a string, so the TS loader's helpers (__name) never end up in the page.
const paint = (p: Page, sc: StageScene, t: number, raw = false) => p.evaluate(`(async () => {
  window.SCENE = ${JSON.stringify(sc)};
  await renderAt(${t});
  const c = document.getElementById('out'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  if (${raw}) { let s = ''; for (let i = 0; i < d.length; i += 32768) s += String.fromCharCode.apply(null, d.subarray(i, i + 32768)); return btoa(s); }
  let h = 2166136261; for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
  return String(h >>> 0);
})()`) as Promise<string>;

const [A, B] = await Promise.all([open(), open()]);
const t0 = Date.now(), a = new Map<string, string>(), b = new Map<string, string>();
for (const [i, sc] of scenes.entries()) for (const t of times) a.set(`${i}@${t}`, await paint(A, sc, t));
await paint(B, scenes[4], 4.4);   // something else first, so B starts from a different state
for (const [i, sc] of [...scenes.entries()].reverse()) for (const t of [...times].reverse()) b.set(`${i}@${t}`, await paint(B, sc, t));

let bad = 0, exact = 0, near = 0, worst = 0;
for (const [k, h] of a) {
  if (h === b.get(k)) { exact++; continue; }
  const [i, t] = k.split('@').map(Number), [p, q] = await Promise.all([paint(A, scenes[i], t, true), paint(B, scenes[i], t, true)]).then(r => r.map(x => Buffer.from(x, 'base64')));
  let n = 0, m = 0; for (let j = 0; j < p.length; j++) { const e = Math.abs(p[j] - q[j]); if (e) { n++; m = Math.max(m, e); } }
  worst = Math.max(worst, n / p.length);
  if (n <= p.length * .001 && m <= 32) { near++; continue; }
  bad++; console.log(`DIFF ${scenes[i].template} #${k}: ${n} channel values differ, max ${m}`);
}
await browser.close();
console.log(`${a.size} frames × 2 pages (${watercolor ? 'watercolour' : 'fast colour'}, rs ${rs}) in ${((Date.now() - t0) / 1000).toFixed(0)} s: ` +
  `${exact} identical, ${near} within the tolerance (worst ${(worst * 100).toFixed(3)} % of values), ${bad} differ`);
process.exit(bad ? 1 : 0);
