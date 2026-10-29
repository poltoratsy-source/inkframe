// Times single frames of stripped-down scenes, to see where painting time goes.
import { Painter } from '../lib/real/painter.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';
const rs = +(process.argv[2] || .25);
const p = new Painter({ workers: 1, log: console.log });
const base = { mood: 'happy', duration: 5, voice: '' } as const;
const cases: [string, StageScene][] = [
  ['paper only', { ...base, template: 'host', setting: 'none' as never, hero: false }],
  ['sky bg', { ...base, template: 'host', setting: 'sky', hero: false }],
  ['room bg', { ...base, template: 'host', setting: 'room', hero: false }],
  ['clawd only', { ...base, template: 'host', setting: 'none' as never }],
  ['sun only', { ...base, template: 'host', setting: 'none' as never, hero: false, prop: 'sun' }],
  ['sky+clawd+sun', { ...base, template: 'host', setting: 'sky', prop: 'sun' }],
  ['fast clawd only', { ...base, template: 'host', setting: 'none' as never, fast: true }],
  ['fast sky+clawd+sun', { ...base, template: 'host', setting: 'sky', prop: 'sun', fast: true }],
  ['sketch sky+clawd+sun', { ...base, template: 'host', setting: 'sky', prop: 'sun', sketch: true }],
];
await p.frame(cases[0][1], 1, { rs, width: 640 });
for (const [name, sc] of cases) {
  const t0 = Date.now(); for (const t of [1, 2]) await p.frame(sc, t, { rs, width: 640 });
  console.log(name.padEnd(24), ((Date.now() - t0) / 2).toFixed(0), 'ms');
}
await p.close();
