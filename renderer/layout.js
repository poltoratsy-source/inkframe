// layout.js: where things go in each frame format. The templates (templates.js) and the backgrounds take their points
// from LAYOUT instead of fixed 1920×1080 numbers, so one scene paints as 16:9, 9:16 or 1:1.
// The format comes from the page address (?fmt=16x9 | 9x16 | 1x1, read in core.js as FMT_Q); W × H is its painting
// space (the short side is 1080 in every format, so Clawd, props, brushes and lettering keep their size in px).
//
//   safe     where words and anything the viewer must see may go. 9:16 keeps clear of the top ~12 % and the bottom
//            20 % that Reels / Shorts / TikTok cover with their own buttons, names and captions; 1:1 and 16:9 keep a
//            small title-safe margin
//   subs     the band the burned-in subtitles take (lib/formats.ts sets them in the .ass file to match): nothing that
//            carries the story is placed there — in every format it is the floor under Clawd's feet
//   ground   the line Clawd stands on (hills, floor, sea and sand are drawn from it)
//   caption  the big words at the top; lines: 2 lets a long caption break in two instead of shrinking
//   host / object / compare / card    the slots of each template: hero (x, u = body unit), props (x, y, s = scale),
//            labels with their arrows (a = where the arrow starts, tip = where it lands), the card and its words
//   bg       the fixed points of the backgrounds: room window, clouds, flowers, the sunset sun, the moon, the board
//
// 16:9 holds exactly the numbers the templates had before the layout layer, so a 16:9 frame paints as it always did.
// layoutFor(q) is pure and reads nothing from the page: tests/layout.test.ts loads this file and checks every slot of
// every format against its safe area.
function layoutFor(q) {
  const L = {
    '16x9': {
      id: '16:9', W: 1920, H: 1080, ground: 860,
      safe: { x0: 30, y0: 40, x1: 1890, y1: 1040 },
      subs: { x0: 135, y0: 885, x1: 1785, y1: 1035 },
      caption: { x: 960, y: 112, w: 1700, max: 104, lines: 1 },
      cam: { host: [960, 560], object: [960, 540], compare: [960, 540] },
      host: { prop: { x: 1330, y: 470, s: 1.25 }, solo: { x: 960, y: 470, s: 1.7 }, hero: { x: 640, x0: 960, u: 26 } },
      object: { prop: { x: 1000, y: 500, s: 1.75 }, hero: { x: 270, u: 13 }, labelW: 620,
        labels: [{ x: 400, y: 300, a: [460, 350], tip: [770, 450] }, { x: 1580, y: 300, a: [1520, 350], tip: [1240, 430] }] },
      compare: { vertical: false, L: { x: 520, y: 470, s: 1.3, cx: 520, cy: 680 }, R: { x: 1400, y: 470, s: 1.3, cx: 1400, cy: 680 },
        hero: { x: 960, u: 15 }, capW: 620 },
      card: { box: [330, 150, 1260, 470], pivot: [960, 380], title: { x: 960, y: 385, ySub: 340, w: 1100, max: 190 },
        sub: { x: 960, y: 500, w: 1100, max: 72, lines: 1 }, hero: { x: 960, u: 18 } },
      bg: { window: [1460, 150, 300, 260], clouds: [215, 85], flowers: { n: 6, x0: 120, dx: 330 }, sun: [1500, -120],
        moon: [1600, 190], board: [260, 110, 1400, 560] },
    },
    // vertical: Clawd stands low, what he talks about floats above him; compare is top / bottom; the card sits in the
    // middle of the safe area; the subtitles run over the floor below his feet, above the apps' bottom 20 %
    '9x16': {
      id: '9:16', W: 1080, H: 1920, ground: 1300,
      safe: { x0: 60, y0: 232, x1: 1020, y1: 1536 },
      subs: { x0: 75, y0: 1340, x1: 1005, y1: 1512 },
      caption: { x: 540, y: 330, w: 940, max: 96, lines: 2 },
      cam: { host: [540, 960], object: [540, 960], compare: [540, 960] },
      host: { prop: { x: 640, y: 740, s: 1.6 }, solo: { x: 540, y: 820, s: 2.2 }, hero: { x: 390, x0: 540, u: 30, lookY: -.8 } },
      object: { prop: { x: 540, y: 800, s: 1.55 }, hero: { x: 200, u: 15, lookY: -.6 }, labelW: 460,
        labels: [{ x: 300, y: 470, a: [350, 520], tip: [420, 650] }, { x: 790, y: 1150, a: [740, 1100], tip: [680, 970] }] },
      compare: { vertical: true, L: { x: 540, y: 520, s: 1.25, cx: 540, cy: 735 }, R: { x: 540, y: 935, s: 1.25, cx: 540, cy: 1150 },
        hero: { x: 905, u: 13 }, capW: 480 },
      card: { box: [90, 470, 900, 620], pivot: [540, 780], title: { x: 540, y: 780, ySub: 735, w: 680, max: 170 },
        sub: { x: 540, y: 905, w: 800, max: 72, lines: 2 }, hero: { x: 540, u: 18 } },
      bg: { window: [720, 420, 240, 220], clouds: [135, 65], flowers: { n: 4, x0: 90, dx: 270 }, sun: [870, -90],
        moon: [860, 560], board: [60, 420, 960, 800] },
    },
    // square: the 16:9 arrangement pulled in to 1080 wide; captions may break in two
    '1x1': {
      id: '1:1', W: 1080, H: 1080, ground: 860,
      safe: { x0: 54, y0: 54, x1: 1026, y1: 1026 },
      subs: { x0: 75, y0: 880, x1: 1005, y1: 1026 },
      caption: { x: 540, y: 112, w: 960, max: 96, lines: 2 },
      cam: { host: [540, 560], object: [540, 540], compare: [540, 540] },
      host: { prop: { x: 770, y: 450, s: 1.15 }, solo: { x: 540, y: 480, s: 1.6 }, hero: { x: 330, x0: 540, u: 22 } },
      object: { prop: { x: 580, y: 500, s: 1.3 }, hero: { x: 150, u: 11 }, labelW: 360,
        labels: [{ x: 250, y: 290, a: [300, 335], tip: [430, 440] }, { x: 830, y: 290, a: [780, 335], tip: [745, 430] }] },
      compare: { vertical: false, L: { x: 290, y: 470, s: 1.0, cx: 290, cy: 670 }, R: { x: 790, y: 470, s: 1.0, cx: 790, cy: 670 },
        hero: { x: 540, u: 12 }, capW: 420 },
      card: { box: [90, 170, 900, 440], pivot: [540, 390], title: { x: 540, y: 395, ySub: 350, w: 680, max: 165 },
        sub: { x: 540, y: 500, w: 800, max: 64, lines: 2 }, hero: { x: 540, u: 17 } },
      bg: { window: [780, 130, 220, 200], clouds: [200, 80], flowers: { n: 4, x0: 90, dx: 270 }, sun: [860, -120],
        moon: [940, 250], board: [70, 120, 940, 560] },
    },
  };
  return L[q] || L['16x9'];
}
const LAYOUT = layoutFor(typeof FMT_Q === 'string' ? FMT_Q : '16x9');
