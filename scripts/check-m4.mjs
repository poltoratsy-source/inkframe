// node scripts/check-m4.mjs <baseUrl> <projectId> <outDir> — the three gates of M4 in a running studio (real engine,
// best with INKFRAME_BUDGET=cap:<sec> so the cap shows): approves the script (ticking the permission box when the
// estimate is over the cap), sends the storyboard back once with scene 2 marked «перерисовать», shoots the contact
// sheet of v2 and its estimate, approves it, waits for the final gate (MP4 + self-review), shoots it, opens the
// decision lines in WorkLog and shoots them, approves the final and checks that the MP4 dialog opens. 1600×1000.
// Writes M4-storyboard-gate.png, M4-cap.png, M4-final-gate.png, M4-decisions.png. Exits 1 if a check fails.
import puppeteer from 'puppeteer-core';
import { findChrome, CHROME_ARGS } from './chrome.mjs';
import { join } from 'node:path';

const [base = 'http://127.0.0.1:3700', id, out = 'replica/clone-screens'] = process.argv.slice(2);
if (!id) { console.error('usage: node scripts/check-m4.mjs <baseUrl> <projectId> <outDir>'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const state = () => fetch(`${base}/api/projects/${id}`).then(r => r.json());
async function waitGate(stage, version, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (s.gate?.stage === stage && s.gate.version === version) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`no ${stage} v${version} gate after ${timeoutMs / 1000} s (status ${s.status})`);
    await sleep(1500);
  }
}

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
const panel = '[role="region"][aria-label="Утверждение этапа"]';
const click = async text => {
  const done = await page.evaluate((panel, text) => {
    const b = [...document.querySelectorAll(`${panel} button`)].find(x => x.textContent.trim().startsWith(text));
    if (!b || b.disabled) return b ? 'disabled' : 'missing';
    b.click(); return 'ok';
  }, panel, text);
  if (done !== 'ok') throw new Error(`button «${text}»: ${done}`);
};
const tickCap = async () => {
  const box = await page.$(`${panel} [aria-label="Оценка затрат"] input[type=checkbox]`);
  if (box) { await box.click(); await sleep(200); }
  return !!box;
};

try {
  // ---- script gate
  await waitGate('script', 1, 300000);
  await page.goto(`${base}/studio/${id}`, { waitUntil: 'load', timeout: 180000 });
  await page.waitForSelector(panel, { timeout: 120000 });
  const capped = await page.evaluate(p => [...document.querySelectorAll(`${p} button`)].find(b => b.textContent.trim() === 'Утвердить')?.disabled, panel);
  const hasBox = await tickCap();
  ok(!hasBox || capped, `cap: «Утвердить» is off until the permission box is ticked (box: ${hasBox})`);
  await click('Утвердить');

  // ---- storyboard gate v1: mark scene 2 «перерисовать», send back
  await waitGate('storyboard', 1, 300000);
  await page.waitForFunction(p => document.querySelector(p)?.textContent.includes('Раскадровка'), { timeout: 60000 }, panel);
  await sleep(1500);
  const cards = await page.$$(`${panel} ul[aria-label^="Раскадровка"] li > button`);
  ok(cards.length >= 3, `the contact sheet has a card per scene (${cards.length})`);
  const imgs = await page.$$eval(`${panel} ul[aria-label^="Раскадровка"] img`, xs => xs.map(x => x.naturalWidth));
  ok(imgs.length === cards.length && imgs.every(w => w > 0), `every card shows its key frame (${imgs.join(', ')} px)`);
  await cards[1].click();
  await page.type(`${panel} input[aria-label="Что поменять в сцене 2"]`, 'ночь');
  await click('Вернуть с замечанием');
  await waitGate('storyboard', 2, 300000);
  await sleep(2500);
  await page.screenshot({ path: join(out, 'M4-storyboard-gate.png') });
  console.log('wrote', join(out, 'M4-storyboard-gate.png'));
  const meter = await page.$(`${panel} [aria-label="Оценка затрат"]`);
  if (meter) await meter.evaluate(x => x.scrollIntoView({ block: 'center' }));
  await sleep(400);
  // the cap as it is before the permission: «Утвердить» is off, the box waits
  await page.screenshot({ path: join(out, 'M4-cap.png') });
  console.log('wrote', join(out, 'M4-cap.png'));
  const capText = meter ? await meter.evaluate(x => x.innerText) : '';
  ok(/Оценка/.test(capText), `the estimate is on the storyboard gate: ${capText.replace(/\s+/g, ' ').slice(0, 220)}`);
  await tickCap();
  await click('Утвердить');

  // ---- final gate: the MP4 with its self-review
  const fin = await waitGate('final', 1, 900000);
  await page.waitForFunction(p => document.querySelector(`${p} video`) && document.querySelector('[aria-label="Проверка ролика"]'), { timeout: 60000 }, panel);
  await page.evaluate(p => { const v = document.querySelector(`${p} video`); v.pause(); v.currentTime = 5; }, panel);
  await sleep(2000);
  await page.screenshot({ path: join(out, 'M4-final-gate.png') });
  console.log('wrote', join(out, 'M4-final-gate.png'));
  ok(fin.review?.decision !== 'FAIL' && !!fin.video, `the final gate opens with the MP4 and a ${fin.review?.decision} review`);
  ok(fin.estimate?.actualSec !== undefined, `plan ${fin.estimate?.totalSec} s, fact ${fin.estimate?.actualSec} s`);

  // ---- decisions in WorkLog: open a few
  const opened = await page.evaluate(() => {
    const bs = [...document.querySelectorAll('aside button[aria-expanded]')];
    const pick = [...new Set([bs.find(b => /вместо/.test(b.textContent)), bs.find(b => /сцена 2 — шаблон/.test(b.textContent)), bs.find(b => /^решение: оценка/.test(b.textContent))].filter(Boolean))];
    for (const b of pick) b.click();
    return { all: bs.length, opened: pick.length };
  });
  await sleep(300);
  // the decisions about the script near the top, the estimate line in view below
  await page.evaluate(() => { const b = [...document.querySelectorAll('aside button[aria-expanded="true"]')]; b[0]?.scrollIntoView({ block: 'start' }); });
  await sleep(500);
  await page.screenshot({ path: join(out, 'M4-decisions.png') });
  console.log('wrote', join(out, 'M4-decisions.png'));
  ok(opened.all >= 6, `WorkLog has «решение» lines (${opened.all}), ${opened.opened} opened`);

  await click('Утвердить');
  await page.waitForSelector('[role="dialog"]', { timeout: 30000 });
  const s = await state();
  ok(s.status === 'done' && s.stages.final.status === 'completed', `after «Утвердить» the project is done (${s.status})`);
  ok(!!(await page.$('[role="dialog"] a[download]')), 'the MP4 dialog offers the download');
} catch (e) {
  ok(false, e.message);
  await page.screenshot({ path: join(out, 'M4-error.png') }).catch(() => {});
}
ok(errors.length === 0, `no console errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
