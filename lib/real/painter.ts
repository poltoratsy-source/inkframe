// Painter: paints scene frames in headless Chrome with the painted engine (renderer/stage.html: p5.js + p5.brush).
// One browser, at most `workers` pages painting at once (3 by default). A page is opened at one internal render
// scale (RS: .25 for drafts, .5 for the final cut) and reused for every frame at that scale.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import type { StageScene } from './scene-spec';

export interface PainterOptions { chrome?: string; workers?: number; softGl?: boolean; stage?: string; log?: (s: string) => void }
export interface FrameOptions { rs: number; width: number; quality?: number }

export function findChrome(explicit?: string): string {
  const pw = `${homedir()}/.cache/ms-playwright`;
  const fromPlaywright = existsSync(pw)
    ? readdirSync(pw).filter(n => /^chromium-\d+$/.test(n)).sort((a, b) => +b.split('-')[1] - +a.split('-')[1]).map(n => `${pw}/${n}/chrome-linux64/chrome`)
    : [];
  const all = [explicit, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ...fromPlaywright];
  const found = all.find(p => p && existsSync(p));
  if (!found) throw new Error('Chrome not found: set CHROME_PATH');
  return found;
}

/** The painter's own version: a hash of everything a frame is painted with — renderer/** (not the voice script)
 *  and the p5 / p5.brush it loads. Final clips are cached under it, so a changed renderer repaints them. */
export function rendererVersion(dir = resolve('renderer'), modules = resolve('node_modules')): string {
  const h = createHash('sha1'), walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap(x => (x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)])).sort();
  if (existsSync(dir)) {
    for (const f of walk(dir)) {
      const rel = relative(dir, f);
      if (rel.endsWith('.py') || rel.includes('__pycache__')) continue;
      h.update(rel).update('\0').update(readFileSync(f)).update('\0');
    }
  }
  for (const m of ['p5', 'p5.brush']) {
    try { h.update(`${m}@${JSON.parse(readFileSync(join(modules, m, 'package.json'), 'utf8')).version}`); } catch { h.update(`${m}@?`); }
  }
  return h.digest('hex').slice(0, 10);
}

interface Slot { page: Page; rs: number }

export class Painter {
  readonly workers: number;
  private browser?: Promise<Browser>;
  private free: Slot[] = [];
  private open = 0;
  private active = 0;
  private waiting: (() => void)[] = [];
  private stageUrl: string;

  constructor(private opts: PainterOptions = {}) {
    this.workers = Math.max(1, Math.min(3, opts.workers ?? 3));
    this.stageUrl = pathToFileURL(resolve(opts.stage ?? 'renderer/stage.html')).href;
  }

  private launch(): Promise<Browser> {
    const softGl = this.opts.softGl ?? process.env.INKFRAME_SOFT_GL !== '0';
    return this.browser ??= puppeteer.launch({
      executablePath: findChrome(this.opts.chrome), headless: true, protocolTimeout: 0,
      args: ['--no-sandbox', '--allow-file-access-from-files', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
        '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--window-size=1920,1080',
        ...(softGl ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-gl=angle'])],
    });
  }

  private async newSlot(rs: number): Promise<Slot> {
    const page = await (await this.launch()).newPage();
    page.on('pageerror', e => this.opts.log?.(`[stage] ${(e as Error).message}`));
    page.on('console', m => { if (m.type() === 'error') this.opts.log?.(`[stage] ${m.text()}`); });
    await page.goto(`${this.stageUrl}?render&rs=${rs}`, { waitUntil: 'load' });
    await page.waitForFunction('window.ready === true', { timeout: 60000 });
    return { page, rs };
  }

  /** Waits for a free worker, then lends it a page at render scale `rs`. */
  private async acquire(rs: number): Promise<Slot> {
    while (this.active >= this.workers) await new Promise<void>(r => this.waiting.push(r));
    this.active++;
    try {
      const i = this.free.findIndex(s => s.rs === rs);
      if (i >= 0) return this.free.splice(i, 1)[0];
      if (this.open >= this.workers && this.free.length) { const old = this.free.shift()!; this.open--; await old.page.close().catch(() => {}); }
      this.open++;
      try { return await this.newSlot(rs); } catch (e) { this.open--; throw e; }
    } catch (e) { this.release(); throw e; }
  }

  private release(slot?: Slot) {
    if (slot) this.free.push(slot);
    this.active--;
    this.waiting.shift()?.();
  }

  /** One frame of a scene at scene time t, as JPEG bytes. */
  async frame(scene: StageScene, t: number, o: FrameOptions): Promise<Buffer> {
    const slot = await this.acquire(o.rs);
    let ok = false;
    try {
      const url = await slot.page.evaluate(async (scene, t, w, q) => {
        (window as unknown as { SCENE: unknown }).SCENE = scene;
        return (window as unknown as { renderScaled: (t: number, w: number, q: number) => Promise<string> }).renderScaled(t, w, q);
      }, scene, t, o.width, o.quality ?? .88);
      ok = true;
      return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    } finally {
      if (ok) this.release(slot);
      else { this.open--; slot.page.close().catch(() => {}); this.release(); }
    }
  }

  /** Paints several times of one scene in parallel; onFrame is called in time order as frames become ready. */
  async frames(scene: StageScene, times: number[], o: FrameOptions, onFrame: (i: number, jpeg: Buffer) => void | Promise<void>, signal?: { cancelled: boolean }) {
    const ready = new Map<number, Buffer>();
    let next = 0, emitted = 0;
    const flush = async () => { while (ready.has(emitted)) { const b = ready.get(emitted)!; ready.delete(emitted); await onFrame(emitted++, b); } };
    await Promise.all(Array.from({ length: Math.min(this.workers, times.length) }, async () => {
      while (next < times.length && !signal?.cancelled) {
        const i = next++;
        ready.set(i, await this.frame(scene, times[i], o));
        await flush();
      }
    }));
    await flush();
  }

  async close() {
    const b = this.browser; this.browser = undefined; this.free = []; this.open = 0;
    if (b) await (await b).close().catch(() => {});
  }
}
