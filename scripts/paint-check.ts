// Paints a few frames of sample scenes with the real painter and tiles them into one image, for a quick look:
//   node --import tsx scripts/paint-check.ts [out.jpg] [rs] [width] [sketch]
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Painter } from '../lib/real/painter.ts';
import type { StageScene } from '../lib/real/scene-spec.ts';

const [out = 'projects/check/sheet.jpg', rs = '.25', width = '640', sketch = ''] = process.argv.slice(2);
const voice = '0000000033667755443300000000336677554433000000003366775544330000'.repeat(4);
const scenes: StageScene[] = [
  { template: 'host', setting: 'sky', mood: 'happy', prop: 'sun', caption: 'Почему небо голубое?', duration: 5, voice },
  { template: 'object', setting: 'sky', mood: 'thinking', prop: 'prism', caption: 'Белый свет — это все цвета', labels: ['белый свет', 'радуга'], duration: 5, voice },
  { template: 'compare', setting: 'sky', mood: 'surprised', caption: 'Синий рассеивается сильнее', left: { prop: 'wave', color: 'blue', caption: 'синий: короткие' }, right: { prop: 'wave', color: 'red', caption: 'красный: длинные' }, duration: 5, voice },
  { template: 'card', setting: 'sunset', mood: 'excited', title: 'НЕБО', subtitle: 'кодовое слово — пиши в комментарии', duration: 5, voice },
];
const times = [0.4, 1.5, 3.5];
const p = new Painter({ log: console.log });
const dir = out.replace(/\.jpg$/, '') + '-frames';
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
let k = 0; const t0 = Date.now();
for (const sc of scenes) {
  const s0 = Date.now();
  await p.frames({ ...sc, sketch: sketch === "sketch", fast: sketch === "fast" }, times, { rs: +rs, width: +width }, (i, b) => { writeFileSync(`${dir}/f${String(k++).padStart(3, '0')}.jpg`, b); });
  console.log(sc.template, ((Date.now() - s0) / times.length).toFixed(0), 'ms/frame (3 workers, wall)');
}
await p.close();
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${dir}/f%03d.jpg`, '-vf', `tile=${times.length}x${scenes.length}`, '-frames:v', '1', '-q:v', '3', out]);
console.log('wrote', out, 'in', ((Date.now() - t0) / 1000).toFixed(1), 's');
