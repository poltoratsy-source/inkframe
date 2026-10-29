// Temporary folders for tests. tmp() is removed when its test ends, tmpForFile() when the file's last test ends —
// each by the exact path it was made with (older /tmp/inkframe-* folders are never touched).
import { after, afterEach } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const perTest: string[] = [], perFile: string[] = [];
const remove = (dirs: string[]) => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); };

export function tmp(prefix = 'inkframe-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  perTest.push(d);
  return d;
}
export function tmpForFile(prefix = 'inkframe-'): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  perFile.push(d);
  return d;
}

// an engine may still save its project a tick after the test saw what it waited for: give it a moment first
afterEach(async () => { if (perTest.length) { await new Promise(r => setTimeout(r, 40)); remove(perTest); } });
after(async () => { await new Promise(r => setTimeout(r, 40)); remove(perTest); remove(perFile); });
