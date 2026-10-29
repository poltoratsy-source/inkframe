// node scripts/check-static.mjs <siteUrl> [shotsDir] — smoke test of the static demo in headless Chrome:
// the start screen opens, "Начать рисовать" starts the simulation, it stops at the script gate, "Утвердить" opens the
// storyboard gate (a key frame on every card), "Утвердить" lets it draw and cut, the final gate shows the MP4 with its
// review, "Утвердить" hands it out and the video in "MP4 готов" plays. M5: «▶ Повтор прогона» replays that run (the
// slider plays, End shows every stage done and every card with its frame), the library shows the project as «готово»,
// and the demo run recorded in advance replays from the start screen.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const [url = 'http://127.0.0.1:3701/', shots = ''] = process.argv.slice(2);
if (shots) mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: [...CHROME_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', r => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') errors.push('failed: ' + r.url()); });   // aborted = prefetch cancelled by navigation
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`); });
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const clickText = (sel, text) => page.evaluate((sel, text) => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent.includes(text) && !e.disabled);
  if (el) el.click(); return !!el;
}, sel, text);

await page.goto(url, { waitUntil: 'networkidle0' });
ok(await page.evaluate(() => document.body.textContent.includes('Что снимем')), 'start screen opens');
if (shots) await page.screenshot({ path: `${shots}/static-01-start.png` });
await clickText('button', '15 с');
ok(await clickText('button', 'Начать рисовать'), '"Начать рисовать" pressed');
await page.waitForFunction(() => location.href.includes('studio'), { timeout: 15000 });   // /studio/?id= or #/studio?id=
await page.waitForFunction(() => document.body.textContent.includes('Клод сейчас делает'), { timeout: 15000 });
await page.waitForSelector('[aria-label="Утверждение этапа"]', { timeout: 30000 });
ok(await page.evaluate(() => ![...document.images].some(i => i.src.includes('demo/frames/'))), 'stops at the script gate: no frames yet');
if (shots) await page.screenshot({ path: `${shots}/static-02-gate.png` });
ok(await clickText('button', 'Утвердить'), '"Утвердить" pressed');
// the storyboard gate: a key frame on every card
const gateOf = title => page.waitForFunction(t => [...document.querySelectorAll('[aria-label="Утверждение этапа"] h2')].some(h => h.textContent.startsWith(t)), { timeout: 120000, polling: 500 }, title);
await gateOf('Раскадровка');
await page.waitForFunction(() => { const im = [...document.querySelectorAll('[aria-label^="Раскадровка"] img')]; return im.length >= 3 && im.every(i => i.complete && i.naturalWidth > 0); }, { timeout: 60000 });
ok(true, 'the storyboard gate shows a key frame on every card');
if (shots) await page.screenshot({ path: `${shots}/static-02b-storyboard.png` });
ok(await clickText('[aria-label="Утверждение этапа"] button', 'Утвердить'), 'storyboard: "Утвердить" pressed');
await sleep(8000);
const frames = await page.evaluate(() => [...document.images].filter(i => i.src.includes('demo/frames/') && i.complete && i.naturalWidth > 0).length);
ok(frames > 0, `simulation draws frames (${frames} frame images on screen)`);
if (shots) await page.screenshot({ path: `${shots}/static-03-studio.png` });
const t0 = Date.now();
// the final gate: the MP4 with its self-review
await page.waitForFunction(() => document.querySelector('[aria-label="Утверждение этапа"] video') && document.querySelector('[aria-label="Проверка ролика"]'), { timeout: 600000, polling: 1000 });
console.log(`     run finished in ${Math.round((Date.now() - t0) / 1000) + 8} s`);
ok(true, 'the final gate shows the MP4 and its review');
if (shots) await page.screenshot({ path: `${shots}/static-03b-final.png` });
ok(await clickText('[aria-label="Утверждение этапа"] button', 'Утвердить'), 'final: "Утвердить" pressed');
await page.waitForSelector('[role="dialog"] video', { timeout: 300000 });
await sleep(4000);
const v = await page.evaluate(() => { const v = document.querySelector('[role="dialog"] video'); return { t: v.currentTime, paused: v.paused, w: v.videoWidth, h: v.videoHeight, err: v.error && v.error.code }; });
ok(!v.err && v.t > 1 && v.w > 0, `video plays in "MP4 готов" (t=${v.t.toFixed(1)} s, ${v.w}×${v.h})`);
if (shots) await page.screenshot({ path: `${shots}/static-04-mp4.png` });

// M5: the replay of this very run, from the demo engine's journal
await page.keyboard.press('Escape');
await sleep(300);
ok(await clickText('a', 'Повтор прогона'), '«▶ Повтор прогона» in the studio');
const slider = '[role="slider"][aria-label="Повтор прогона"]';
await page.waitForSelector(slider, { timeout: 15000 });
const now = () => page.$eval(slider, el => Number(el.getAttribute('aria-valuenow')));
const t1 = await now(); await sleep(2500); const t2 = await now();
ok(t2 > t1, `the replay plays (${t1} → ${t2} s)`);
if (shots) await page.screenshot({ path: `${shots}/static-05-replay.png` });
await page.focus(slider); await page.keyboard.press('End'); await sleep(600);
const atEnd = await page.evaluate(() => ({
  done: document.querySelectorAll('ol li .sr-only').length && [...document.querySelectorAll('ol li .sr-only')].every(s => s.textContent.includes('готово')),
  cards: [...document.querySelectorAll('[aria-label="Сцены"] img')].filter(i => i.complete && i.naturalWidth > 0).length,
}));
ok(atEnd.done && atEnd.cards >= 3, `End: every stage done, ${atEnd.cards} cards with frames`);
await page.focus(slider); await page.keyboard.press('Home'); await sleep(400);
ok(await now() === 0, 'Home goes back to the start');
// the library, reached in-app (a reload would start a fresh demo engine: the static site keeps projects per tab)
ok(await clickText('header a', 'Библиотека'), 'replay → «Библиотека»');
await page.waitForFunction(() => document.querySelector('main ul li a'), { timeout: 15000 }).catch(() => {});
const card = await page.evaluate(() => document.querySelector('main ul li a')?.textContent ?? '');
ok(/готово/.test(card), `the library shows the project as «готово» (${card.slice(0, 60)})`);
ok(await page.evaluate(() => document.body.textContent.includes('Повтор демо-прогона')), 'the library offers the demo replay');
if (shots) await page.screenshot({ path: `${shots}/static-06-library.png` });
await page.goto(url, { waitUntil: 'networkidle0' });
ok(await clickText('a', 'Повтор демо-прогона'), 'start screen: «▶ Повтор демо-прогона»');
await page.waitForSelector(slider, { timeout: 15000 });
await sleep(2500);
ok(await now() > 0 && await page.evaluate(() => document.body.textContent.includes('демо, записан заранее')), 'the demo run recorded in advance plays');
ok(errors.length === 0, 'no page errors or failed requests' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
await browser.close();
