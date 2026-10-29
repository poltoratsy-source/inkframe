// node scripts/check-static.mjs <siteUrl> [shotsDir] — smoke test of the static demo in headless Chrome:
// the start screen opens, "Начать рисовать" starts the simulation, it stops at the script gate, "Утвердить" lets it
// draw, and the video in "MP4 готов" plays.
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
await sleep(8000);
const frames = await page.evaluate(() => [...document.images].filter(i => i.src.includes('demo/frames/') && i.complete && i.naturalWidth > 0).length);
ok(frames > 0, `simulation draws frames (${frames} frame images on screen)`);
if (shots) await page.screenshot({ path: `${shots}/static-03-studio.png` });
const t0 = Date.now();
await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Собрать MP4') && !b.disabled), { timeout: 600000, polling: 1000 });
console.log(`     run finished in ${Math.round((Date.now() - t0) / 1000) + 8} s`);
await clickText('button', 'Собрать MP4');
await page.waitForSelector('video', { timeout: 300000 });
await sleep(4000);
const v = await page.evaluate(() => { const v = document.querySelector('video'); return { t: v.currentTime, paused: v.paused, w: v.videoWidth, h: v.videoHeight, err: v.error && v.error.code }; });
ok(!v.err && v.t > 1 && v.w > 0, `video plays in "MP4 готов" (t=${v.t.toFixed(1)} s, ${v.w}×${v.h})`);
if (shots) await page.screenshot({ path: `${shots}/static-04-mp4.png` });
ok(errors.length === 0, 'no page errors or failed requests' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
await browser.close();
