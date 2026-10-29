// What the demo engine plays back: six scenes cut from "Как работает лидар", a cartoon made with the same
// painted engine Inkframe will drive in stage 2. Frames and peaks come from scripts/prepare-demo-assets.sh.
import { asset } from '../site';
import type { ReviewCheck } from '../store/types';
import peaks from '../../public/demo/peaks.json' with { type: 'json' };

export interface DemoScene { title: string; visual: string; line: string; frames: number }
export interface DemoCatalog {
  scenes: DemoScene[]; framesDir: string; video: string; videoLabel: string; voicePeaks: number[]; musicPeaks: number[];
  /** the self-review of the demo MP4 (lib/real/review.ts run on public/demo/result.mp4, 29.10.2026) */
  review: ReviewCheck[];
}

const smooth = (xs: number[], r: number) => xs.map((_, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - r); j <= Math.min(xs.length - 1, i + r); j++) { s += xs[j]; n++; }
  return +(0.35 + 0.5 * s / n).toFixed(3);
});

export const DEMO_CATALOG: DemoCatalog = {
  framesDir: asset('demo/frames'),
  video: asset('demo/result.mp4'),
  videoLabel: '1:07 · 1280×720 · голос и музыка',
  voicePeaks: peaks as number[],
  musicPeaks: smooth(peaks as number[], 12),
  review: [
    { id: 'probe', ok: true, detail: '1280×720, 30 кадров/с, видео и звук на месте' },
    { id: 'duration', ok: true, detail: '67,0 с — как в раскадровке' },
    { id: 'black', ok: true, detail: 'чёрных кусков нет: ночная улица тёмная, но рисунок виден' },
    { id: 'blank', ok: true, detail: '4 кадра (0:06, 0:23, 0:40, 0:57) — на всех есть рисунок' },
    { id: 'silence', ok: true, detail: 'тишины дольше 1 с под репликами нет' },
    { id: 'clipping', ok: true, detail: 'звук не упирается в потолок: самое громкое место −1,4 дБ' },
    { id: 'subtitles', ok: true, detail: 'в этом ролике субтитры не заказывали — не проверял' },
  ],
  scenes: [
    { title: 'Знакомство', visual: 'Клод на крыше машины машет зрителю, ночная улица, фары светятся.', line: 'Привет! Меня зовут Клод. Сегодня разберём, как беспилотная машина видит в полной темноте.', frames: 8 },
    { title: 'Вспышки', visual: 'Лидар на голове Клода вспыхивает, крошечные искры летят во все стороны.', line: 'Лидар стреляет в мир крошечными вспышками лазера — сотни тысяч в секунду.', frames: 8 },
    { title: 'Туда и обратно', visual: 'Одна вспышка летит к прохожему, ударяется и возвращается к Клоду.', line: 'Каждая вспышка летит, ударяется о предмет и возвращается обратно.', frames: 8 },
    { title: 'Засекаем время', visual: 'Крупный текст и линейка: свет проходит 30 см за наносекунду.', line: 'Свет проходит тридцать сантиметров за одну наносекунду — так лидар узнаёт расстояние.', frames: 8 },
    { title: 'Облако точек', visual: 'Лучи веером сканируют улицу, на дереве и человеке загораются точки.', line: 'Точка за точкой складывается облако точек — объёмная карта всего вокруг.', frames: 8 },
    { title: 'Секрет', visual: 'Клод крупно, довольный, подмигивает и показывает язык.', line: 'Свет — туда и обратно. Вот и весь секрет!', frames: 8 },
  ],
};

export const frameSrc = (c: DemoCatalog, scene: number, k: number, kind: 'sketch' | 'color') =>
  `${c.framesDir}/s${scene}-${k}${kind === 'sketch' ? '-sketch' : ''}.jpg`;
