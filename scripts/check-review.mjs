// node scripts/check-review.mjs <baseUrl> <projectId> <out.png> — the self-review in a running studio: opens the
// project after its cut, waits for the MP4 dialog with the report, shoots it at 1600×1000, then checks that a time
// chip seeks the video and that Escape closes the dialog. Exits 1 if a check fails.
import puppeteer from 'puppeteer-core';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const [base = 'http://127.0.0.1:3700', id, out = 'replica/clone-screens/M3-review.png'] = process.argv.slice(2);
if (!id) { console.error('usage: node scripts/check-review.mjs <baseUrl> <projectId> <out.png>'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`${base}/studio/${id}`, { waitUntil: 'load', timeout: 120000 });
await page.waitForSelector('[role="dialog"] [aria-label="Проверка ролика"]', { timeout: 120000 });
await page.evaluate(() => { const v = document.querySelector('[role="dialog"] video'); if (v) { v.pause(); v.currentTime = Math.min(4, v.duration || 4); } });
await sleep(1500);
await page.screenshot({ path: out });
console.log('wrote', out);

const report = await page.evaluate(() => document.querySelector('[aria-label="Проверка ролика"]').innerText);
ok(/Проверка пройдена|Есть замечания|Нашлись ошибки/.test(report), `the decision is written in words: ${report.split('\n')[0]}`);
const chip = await page.$('[aria-label="Проверка ролика"] button');
if (chip) {
  const label = await chip.evaluate(b => b.textContent);
  await chip.click();
  await sleep(500);
  const t = await page.evaluate(() => document.querySelector('[role="dialog"] video').currentTime);
  const [m, s] = label.split(':').map(Number);
  ok(Math.abs(t - (m * 60 + s)) < 1.5, `the chip ${label} seeks the video (now at ${t.toFixed(1)} s)`);
} else console.log('—    no time chips in this report (nothing to seek to)');
await page.keyboard.press('Escape');
await sleep(300);
ok(!(await page.$('[role="dialog"]')), 'Escape closes the dialog');
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
