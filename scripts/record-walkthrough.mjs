// node scripts/record-walkthrough.mjs [baseUrl] [outDir]
// Clicks through the whole demo like a visitor would and records it: start screen → "Начать рисовать" →
// the script gate → "Утвердить" → the cartoon draws itself → quick edit of scene 2 → free-text edit of scene 3 → "Собрать MP4".
// Writes walkthrough.mp4 plus five screenshots. Needs ffmpeg and a Chrome (see scripts/chrome.mjs).
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:3700';
const OUT = process.argv[3] || 'demo';
mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: [...CHROME_ARGS, '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });

// A visible cursor with a click ring, so the recording shows what is being pressed.
await page.evaluateOnNewDocument(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;left:0;top:0;width:22px;height:22px;pointer-events:none;transition:transform .05s;' +
      'background:url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2222%22 height=%2222%22><path d=%22M2 2 L2 18 L7 13 L11 21 L14 19.5 L10 12 L17 12 Z%22 fill=%22white%22 stroke=%22black%22 stroke-width=%221.5%22/></svg>") no-repeat';
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
    addEventListener('mousedown', e => {
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #ff8a3d;pointer-events:none;transition:all .45s ease-out;opacity:1`;
      document.body.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  });
});

// Frames from the DevTools screencast, re-timed into a constant 25 fps MP4.
const cdp = await page.createCDPSession();
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '25', '-c:v', 'mjpeg', '-i', '-',
  '-vf', 'scale=1600:1000,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-movflags', '+faststart', `${OUT}/walkthrough.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
let last = null, lastAt = 0, t0 = 0, written = 0;
const pump = now => { while (last && written < Math.floor((now - t0) / 40)) { ff.stdin.write(last); written++; } };
cdp.on('Page.screencastFrame', async f => {
  const now = Date.now(); if (!t0) t0 = now;
  pump(now); last = Buffer.from(f.data, 'base64'); lastAt = now;
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const keepAlive = setInterval(() => pump(Date.now()), 40);

async function moveAndClick(selectorOrHandle, pause = 500) {
  const el = typeof selectorOrHandle === 'string' ? await page.waitForSelector(selectorOrHandle, { timeout: 60000 }) : selectorOrHandle;
  const box = await el.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await sleep(250);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(pause);
}
const byText = async (tag, text) => {
  const h = await page.waitForFunction((tag, text) => [...document.querySelectorAll(tag)].find(e => e.textContent.trim().includes(text) && !e.disabled), { timeout: 90000 }, tag, text);
  return h.asElement();
};
const shot = name => page.screenshot({ path: `${OUT}/${name}` });

await page.goto(BASE + '/', { waitUntil: 'load' });
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1600, maxHeight: 1000, everyNthFrame: 1 });
await page.mouse.move(800, 500);
await sleep(1500);
await moveAndClick(await byText('button', 'Почему кошки мурчат'), 700);
await moveAndClick(await byText('button', 'Короткий мультфильм'), 700);
await moveAndClick(await byText('button', '15 с'), 400);
await moveAndClick(await byText('button', 'Светлана'), 600);
await shot('01-start.png');
await moveAndClick(await byText('button', 'Начать рисовать'), 0);

await page.waitForFunction(() => location.pathname.includes('/studio/'), { timeout: 30000 });
// the script gate: read the scenes, then approve
await page.waitForSelector('[aria-label="Утверждение этапа"]', { timeout: 60000 });
await sleep(1500);
await shot('02a-script-gate.png');
await moveAndClick(await byText('button', 'Утвердить'), 0);
await page.mouse.move(800, 380, { steps: 10 });
await sleep(13000);
await shot('02-studio-drawing.png');
await page.waitForFunction(() => document.body.innerText.includes('можно собирать MP4'), { timeout: 120000 });
await sleep(800);

// quick edit of scene 2
const cards = await page.$$('footer button');
await moveAndClick(cards[1], 1200);
await moveAndClick(await byText('button', 'ночь'), 300);
await sleep(2600);
await shot('03-edit-scene.png');
await page.waitForFunction(() => document.body.innerText.includes('перерисована'), { timeout: 60000 });
await sleep(1200);

// free-text edit of scene 3
await moveAndClick((await page.$$('footer button'))[2], 900);
await moveAndClick('aside textarea', 200);
await page.keyboard.type('Сделай лучи зелёными', { delay: 55 });
await sleep(400);
await moveAndClick(await byText('button', 'Перерисовать сцену'), 300);
await page.waitForFunction(() => (document.body.innerText.match(/перерисована/g) || []).length >= 2, { timeout: 60000 });
await sleep(1500);

// build the MP4
await moveAndClick(await byText('button', 'Собрать MP4'), 300);
await page.waitForSelector('video', { timeout: 60000 });
await sleep(4500);
await shot('04-mp4-ready.png');
await sleep(1500);

await cdp.send('Page.stopScreencast');
clearInterval(keepAlive); pump(Date.now());
ff.stdin.end(); await new Promise(r => ff.on('close', r));
await browser.close();
console.log(`wrote ${OUT}/walkthrough.mp4 (${(written / 25).toFixed(1)} s) and 4 screenshots`);
