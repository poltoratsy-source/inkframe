// node scripts/check-m5.mjs <siteUrl> <replayId> <outDir> [--studio=<id>] [--video=<file.mp4>] — M5 in a running studio
// (server or static site): the library at 1600 and 390 px (cards, badges, «ждёт вас» / «рисую» on top, keyboard focus,
// no sideways scroll), the replay at 1600 and 390 px (plays, the slider answers the keyboard, the board in the
// middle of «Отрисовка»), optionally the live board of a project being drawn, and a short screen recording of the
// replay. Writes M5-library.png, M5-library-390.png, M5-replay.png, M5-replay-390.png, M5-board.png. Exits 1 on a failure.
import puppeteer from 'puppeteer-core';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const args = process.argv.slice(2), flag = n => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const [site = 'http://127.0.0.1:3700/', replayId = 'demo', out = 'replica/clone-screens'] = args.filter(a => !a.startsWith('--'));
const studioId = flag('studio'), video = flag('video');
mkdirSync(out, { recursive: true });
const base = site.endsWith('/') ? site : site + '/';
const isStatic = await fetch(new URL('replay/', base)).then(r => r.ok).catch(() => false) && !(await fetch(new URL('api/settings', base)).then(r => r.ok).catch(() => false));
const href = { library: new URL('library/', base).href, replay: new URL(isStatic ? `replay/?id=${replayId}` : `studio/${replayId}/replay`, base).href, studio: id => new URL(isStatic ? `studio/?id=${id}` : `studio/${id}`, base).href };
const LOAD = { waitUntil: 'domcontentloaded', timeout: 180000 };   // a dev server compiles a page on its first visit
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const view = (w, h = 1000) => page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
const noSideScroll = () => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
const slider = '[role="slider"][aria-label="Повтор прогона"]';
const now = () => page.$eval(slider, el => Number(el.getAttribute('aria-valuenow')));

// ---------- library ----------
await view(1600);
await page.goto(href.library, LOAD);
await page.waitForFunction(() => document.querySelector('main ul li a') || document.body.textContent.includes('Здесь будут ваши мультфильмы'), { timeout: 120000 });
const cards = await page.$$eval('main ul li a', as => as.map(a => a.getAttribute('aria-label')));
console.log(`     library: ${cards.length} cards: ${cards.join(' | ')}`);
ok(cards.length > 0, 'the library lists projects');
const badges = await page.$$eval('main ul li a', as => as.map(a => a.querySelector('span span, span')?.textContent?.trim()));
const rank = b => (b === 'ждёт вас' ? 0 : b === 'рисую' ? 1 : 2);
ok(badges.every((b, i) => i === 0 || rank(badges[i - 1]) <= rank(b)), `«ждёт вас» and «рисую» first (${badges.join(', ')})`);
await page.keyboard.press('Tab');
for (let i = 0; i < 12 && !(await page.evaluate(() => !!document.activeElement?.closest('main ul li'))); i++) await page.keyboard.press('Tab');
ok(await page.evaluate(() => { const a = document.activeElement; return !!a?.closest('main ul li') && getComputedStyle(a).outlineStyle !== 'none'; }), 'a card takes the keyboard focus, with a visible ring');
await page.screenshot({ path: join(out, 'M5-library.png') });
await view(390, 844);
await page.reload(LOAD);
await page.waitForSelector('main ul li a', { timeout: 120000 });
ok(await noSideScroll(), 'library at 390 px: no sideways scroll');
await page.screenshot({ path: join(out, 'M5-library-390.png') });

// ---------- replay ----------
async function openReplay(w, h) {
  await view(w, h);
  await page.goto(href.replay, LOAD);
  await page.waitForSelector(slider, { timeout: 120000 });
}
/** pauses and puts the replay a little after the start of «Отрисовка» */
async function toPaint(share = .35) {
  const pause = await page.$('button[aria-label="Пауза"]');
  if (pause) await pause.click();
  const at = await page.evaluate((sel, share) => {
    const bar = document.querySelector(sel), marks = [...bar.querySelectorAll('span[title]')];
    const left = t => parseFloat(marks.find(m => m.title === t)?.style.left ?? 'NaN') / 100;
    const a = left('Отрисовка'), b = left('Сборка');
    return Number.isFinite(a) ? a + ((Number.isFinite(b) ? b : 1) - a) * share : .5;
  }, slider, share);
  const r = await page.$eval(slider, el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  await page.mouse.click(r.x + r.w * at, r.y + r.h / 2);
  await sleep(700);
}
await openReplay(1600, 1000);
const t1 = await now(); await sleep(2000); const t2 = await now();
ok(t2 > t1, `the replay plays by itself (${t1} → ${t2} s)`);
await page.focus(slider);
await page.keyboard.press('Space'); await sleep(200);
ok(!!(await page.$('button[aria-label="Смотреть"]')), 'space pauses');
await page.keyboard.press('End'); await sleep(300);
const max = await page.$eval(slider, el => Number(el.getAttribute('aria-valuemax')));
ok(await now() === max, 'End goes to the end');
await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await sleep(200);
ok(await now() === 5, '→ moves 5 s');
await toPaint();
const rail = await page.$$eval('ol li', lis => lis.map(li => li.textContent));
ok(rail.some(t => /Отрисовка.*идёт/.test(t)), `the rail mid-paint: ${rail.join(' · ')}`);
ok(await page.evaluate(() => [...document.querySelectorAll('[aria-label="Сцены"] img')].some(i => i.complete && i.naturalWidth > 0)), 'scene cards show their frames');
await page.mouse.move(0, 0);
await page.screenshot({ path: join(out, 'M5-replay.png') });
await openReplay(390, 844);
await toPaint(.5);
ok(await noSideScroll(), 'replay at 390 px: no sideways scroll');
await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
await page.mouse.move(0, 0);
await page.screenshot({ path: join(out, 'M5-replay-390.png') });

// ---------- the live board ----------
if (studioId) {
  await view(1600);
  await page.goto(href.studio(studioId), LOAD);
  await page.waitForFunction(() => document.body.textContent.includes('Клод сейчас делает'), { timeout: 120000 });
  await sleep(2500);
  ok(await page.evaluate(() => !!document.querySelector('[aria-label="План и факт по времени"], [aria-label="Оценка затрат"]')), 'the board shows the time meter');
  await page.screenshot({ path: join(out, 'M5-board.png') });
}

// ---------- a short recording of the replay ----------
if (video) {
  const dir = video.replace(/\.mp4$/, '') + '-frames';
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  await openReplay(1280, 800);
  await page.click('button[aria-label="Пауза"]').catch(() => {});
  await page.click('[role="group"][aria-label="Скорость"] button:last-child');
  await page.keyboard.press('Home');
  await page.$eval(slider, el => el.blur());
  await page.click('button[aria-label="Смотреть"]');
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < 16000) writeFileSync(join(dir, `f${String(n++).padStart(4, '0')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 82 }));
  const fps = Math.max(1, Math.round(n / ((Date.now() - t0) / 1000)));
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.jpg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-r', '24', video]);
  rmSync(dir, { recursive: true, force: true });
  ok(r.status === 0, `recording: ${n} frames at ${fps} fps → ${video}`);
}

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
await browser.close();
