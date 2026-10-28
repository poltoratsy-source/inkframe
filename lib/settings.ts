// The "own API key" setting: one line in .env.local, which .gitignore keeps out of the repo.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const LINE = /^ANTHROPIC_API_KEY=/;
const VALID = /^sk-ant-[A-Za-z0-9_-]{8,200}$/;

const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l, i, a) => l || i < a.length - 1) : []);

export function hasApiKey(file: string): boolean {
  return lines(file).some(l => LINE.test(l) && l.length > 'ANTHROPIC_API_KEY='.length);
}

/** Writes (or with '' removes) the key; refuses anything that isn't a single Anthropic key. */
export function saveApiKey(file: string, key: string): void {
  if (key && !VALID.test(key)) throw new Error('This does not look like an Anthropic API key (sk-ant-…)');
  const rest = lines(file);
  const i = rest.findIndex(l => LINE.test(l));
  if (key) { if (i >= 0) rest[i] = `ANTHROPIC_API_KEY=${key}`; else rest.push(`ANTHROPIC_API_KEY=${key}`); }
  else if (i >= 0) rest.splice(i, 1);
  writeFileSync(file, rest.length ? rest.join('\n') + '\n' : '', { mode: 0o600 });
  if (key) process.env.ANTHROPIC_API_KEY = key; else delete process.env.ANTHROPIC_API_KEY;
}
