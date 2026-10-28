// node scripts/screenshot.mjs <url> <out.png> [waitMs]  — one 1600×1000 screenshot of a page.
import puppeteer from 'puppeteer-core';
import { findChrome, CHROME_ARGS } from './chrome.mjs';

const [url, out, wait = '1500'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: CHROME_ARGS });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
// not networkidle: the studio keeps an event stream open
await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await new Promise(r => setTimeout(r, +wait));
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
