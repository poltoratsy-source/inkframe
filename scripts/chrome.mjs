// Finds a Chrome/Chromium for the screenshot and walkthrough scripts: CHROME_PATH, the usual system paths,
// or a Chromium that Playwright downloaded into ~/.cache/ms-playwright.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';

export function findChrome() {
  const pw = `${homedir()}/.cache/ms-playwright`;
  const fromPlaywright = existsSync(pw)
    ? readdirSync(pw).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => b.split('-')[1] - a.split('-')[1]).map(n => `${pw}/${n}/chrome-linux64/chrome`)
    : [];
  const all = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', ...fromPlaywright];
  const found = all.find(p => p && existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

export const CHROME_ARGS = ['--no-sandbox', '--force-device-scale-factor=1', '--window-size=1600,1000', '--hide-scrollbars'];
