// node scripts/check-gate.mjs [baseUrl] [shotsDir] — the script gate in a running studio (npm run dev), keyboard only:
// a new project stops at the gate, focus lands in the panel, Tab → note → «Вернуть с замечанием» gives v2, then
// «Утвердить» lets it draw. Also shoots the gate at 1600×1000 and at 390 px wide. Exits 1 if a check fails.
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const [base = 'http://127.0.0.1:3700', shots = 'replica/clone-screens'] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const idea = 'Почему небо голубое — объясняет Клод для школьников';
const start = async () => {
  const r = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idea, duration: 30 }) });
  return (await r.json()).id;
};
const GATE = '[aria-label="Утверждение этапа"]';
const focusInGate = page => page.evaluate(sel => !!document.querySelector(sel)?.contains(document.activeElement), GATE);
const focused = page => page.evaluate(() => { const a = document.activeElement; return `${a.tagName.toLowerCase()}:${(a.textContent || a.getAttribute('placeholder') || '').trim().slice(0, 30)}`; });

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
const errors = [];
const open = async (w, h, id) => {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${base}/studio/${id}`, { waitUntil: 'load', timeout: 120000 });
  return page;
};

// wide: the whole flow from the keyboard
const page = await open(1600, 1000, await start());
await page.waitForSelector(GATE, { timeout: 180000 });
await sleep(900);
ok(await focusInGate(page), 'focus moves into the gate panel when it opens');
ok(await page.evaluate(() => ![...document.images].some(i => i.src.includes('/frames/'))), 'nothing is drawn while the script waits');
ok(await page.evaluate(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Собрать MP4') && b.disabled)), '«Собрать MP4» is disabled');
ok(await page.evaluate(() => document.body.innerText.includes('ждёт вашего решения')), 'the work log says the script waits');
await page.screenshot({ path: `${shots}/S02-gate-script.png` });

await page.keyboard.press('Tab');
ok((await focused(page)).startsWith('textarea'), `Tab → the note (${await focused(page)})`);
await page.keyboard.type('Сцена 2: ночь. И короче вступление.');
await page.keyboard.press('Enter');   // a new line, not a submit
ok(await page.$(GATE) !== null && await page.evaluate(sel => document.querySelector(sel).textContent.includes('ждёт вашего решения'), GATE), 'Enter in the note does not send');
await page.keyboard.press('Tab');
ok((await focused(page)).includes('Утвердить'), `Tab → «Утвердить» (${await focused(page)})`);
await page.keyboard.press('Tab');
ok((await focused(page)).includes('Вернуть'), `Tab → «Вернуть с замечанием» (${await focused(page)})`);
await page.keyboard.press('Enter');
await page.waitForFunction(sel => document.querySelector(sel)?.textContent.includes('вернули на доработку'), { timeout: 20000 }, GATE);
ok(true, 'sent back: the panel shows the note while the script is rewritten');
await page.screenshot({ path: `${shots}/S02-gate-revised.png` });
await page.waitForFunction(sel => /v2/.test(document.querySelector(sel)?.querySelector('h2')?.textContent ?? '') && document.querySelector(sel).textContent.includes('ждёт вашего решения'), { timeout: 240000 }, GATE);
await sleep(600);
ok(await focusInGate(page), 'version 2 at the gate, focus back in the panel');
await page.screenshot({ path: `${shots}/S02-gate-script-v2.png` });
await page.keyboard.press('Tab');
await page.keyboard.press('Tab');
ok((await focused(page)).includes('Утвердить'), 'Tab Tab → «Утвердить»');
await page.keyboard.press('Enter');
await page.waitForFunction(sel => !document.querySelector(sel), { timeout: 20000 }, GATE);
ok(true, 'approved: the panel closes');
await page.waitForFunction(() => [...document.images].some(i => i.src.includes('/frames/')), { timeout: 240000 });
ok(true, 'drawing starts after approval');
await sleep(2500);
await page.screenshot({ path: `${shots}/S02-after-approve.png` });

// narrow: the gate on top of the studio
const narrow = await open(390, 844, await start());
await narrow.waitForSelector(GATE, { timeout: 180000 });
await sleep(900);
const fits = await narrow.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }, GATE);
ok(fits, 'at 390 px the gate panel fits the screen width');
await narrow.screenshot({ path: `${shots}/S02-gate-script-390.png` });

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
await browser.close();
