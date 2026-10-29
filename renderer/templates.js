// templates.js: the four scene templates Inkframe paints from a storyboard. A storyboard never carries code, only a
// SceneSpec (lib/real/scene-spec.ts): which template, which setting, which props, which words. Every frame is a pure
// function of the scene time lt, so frames can be rendered in any order and in parallel.
//
//   host     Clawd talks to the viewer, optionally with a prop that pops up beside him
//   object   one big prop in the middle, up to two labels with arrows, a small Clawd pointing at it
//   compare  two props side by side with captions, Clawd in the middle looking from one to the other
//   card     the final card: a big title (the code word), a subtitle, Clawd cheering, stars falling
//
// window.SCENE = { template, setting, mood, prop, propColor, caption, labels, left, right, title, subtitle,
//                  heroSize, hero, pace, duration, voice, sketch }
// voice is the mouth envelope: one digit 0..9 per 1/24 s. sketch = true draws only pencil outlines (the draft pass).
const SC = () => window.SCENE || {};
const GROUND = 860;
const voiceAt = lt => +((SC().voice || '')[Math.floor(lt * 24)] || 0);
const paceOf = s => (s.pace === 'slow' ? .7 : s.pace === 'fast' ? 1.3 : 1);

// ---------- sketch pass: pencil outlines only, no washes, no light ----------
const paintAtColour = paintAt, glowColour = glow;
paintAt = function (pts, o) {
  if (SC().fast && o.fill) {
    // fast colour: a flat wash instead of the (slow) watercolour fill; the paper grain still shows through
    o = { ...o, wash: o.wash || o.fill, washOp: o.wash ? o.washOp : Math.min(255, (o.fillOp ?? 170) + 60) }; delete o.fill;
  }
  if (!SC().sketch) return paintAtColour(pts, o);
  brush.noWash(); brush.noFill(); brush.noHatch();
  brush.set('inkfine', '#6A6470', Math.max(.5, (o.sw ?? 1) * .9));
  brush.beginShape(o.curv || 0); for (const p of pts) brush.vertex(p[0], p[1]); brush.endShape(true);
};
glow = function (...a) { if (!SC().sketch) glowColour(...a); };

// ---------- settings (backgrounds) ----------
function wall(col, key) { boilSeed(key); paint(rectPts(-700, -500, W + 1400, H + 1000), { wash: col, ink: null }); }
function hills(cols, key) {
  cols.forEach((col, i) => {
    const y0 = GROUND - 40 + i * 50, ridge = [];
    for (let k = 0; k <= 12; k++) ridge.push([-400 + k * (W + 800) / 12, y0 - 40 * Math.sin(k * 1.3 + i * 2) - 30 * hash(k + i * 7)]);
    const pts = through(ridge, 4).concat([[W + 400, H + 300], [-400, H + 300]]);
    boilSeed(key + i); paint(pts, { wash: col, ink: PAL.ink, sw: .7 });
  });
}
function starsField(lt, n, key) {
  for (let i = 0; i < n; i++) {
    const x = hash(i * 3.1) * W, y = hash(i * 5.7) * (GROUND - 200), r = 6 + 10 * hash(i * 9.3), tw = .5 + .5 * Math.sin(lt * (1 + hash(i)) * 3 + i);
    boilSeed(key + i); glow(x, y, r * 5, '#FFF1B8', .5 * tw);
    paint(starPts(x, y, r, .45, 4), { wash: '#FFF1C2', ink: null });
  }
}
const SETTINGS = {
  none() {},
  room(lt) {
    wall('#F6E3C4', 'wall');
    boilSeed('wall2'); paint(ellPts(W * .3, H * .3, W * .5, H * .35, 24, 10), { wash: '#FBF0DC', washOp: 140, ink: null });
    boilSeed('floor'); paint(rectPts(-700, GROUND - 6, W + 1400, 700, 3), { wash: '#E3B989', ink: null });
    boilSeed('floorline'); inkLine([[-700, GROUND - 4], [W / 2, GROUND - 10], [W + 700, GROUND - 2]], 1, PAL.ink, 'ink', .5);
    boilSeed('window'); paint(rrPts(1460, 150, 300, 260, 14), { wash: '#BFE3EF', ink: PAL.ink, sw: .8 });
    boilSeed('window-x'); inkLine([[1610, 155], [1610, 405]], .8); inkLine([[1465, 280], [1755, 280]], .8);
  },
  sky(lt) {
    wall('#9CCBEA', 'sky');
    boilSeed('sky-hi'); paint(ellPts(W / 2, GROUND - 40, W * .9, 320, 30, 12), { wash: '#CFE6F3', washOp: 150, ink: null });
    for (let i = 0; i < 2; i++) { const x = (hash(i * 4) * W + lt * (14 + 8 * i)) % (W + 400) - 200; boilSeed('skycl' + i); drawProp('cloud', x, 215 + i * 85, .5 - i * .12, lt, null); }
    hills(['#9DBF6A', '#7FAE5A'], 'hill');
  },
  meadow(lt) {
    wall('#A8D3EC', 'sky');
    hills(['#B5CF7A', '#8DB85F'], 'mhill');
    for (let i = 0; i < 6; i++) drawProp('flower', 120 + i * 330 + 60 * hash(i), GROUND + 70 + 40 * hash(i * 3), .32, lt + i, ['pink', 'yellow', 'violet'][i % 3]);
  },
  sunset(lt) {
    wall('#F2B27D', 'sunset');
    boilSeed('sunset-b'); paint(rectPts(-700, -500, W + 1400, 760), { wash: '#E98C86', washOp: 170, ink: null });
    drawProp('sun', 1500, GROUND - 120, .9, lt * .3, 'orange');
    hills(['#B07A6A', '#8C5E5A'], 'shill');
  },
  night(lt) {
    wall('#232A5C', 'night');
    starsField(lt, 14, 'nstar');
    drawProp('moon', 1600, 190, .8, lt, null);
    hills(['#2F3C7A', '#27306A'], 'nhill');
  },
  space(lt) {
    wall('#1F1B3E', 'space');
    boilSeed('nebula'); paint(ellPts(W * .65, H * .35, 600, 300, 24, 20), { wash: '#4A3C7A', washOp: 120, ink: null });
    starsField(lt, 18, 'sstar');
  },
  sea(lt) {
    wall('#9CCBEA', 'sky');
    boilSeed('sea'); paint(rectPts(-700, GROUND - 160, W + 1400, 900), { wash: '#4F8FBF', fill: '#3A6E9C', fillOp: 60, ink: null });
    for (let i = 0; i < 5; i++) {
      const y = GROUND - 120 + i * 60, ph = lt * (1 + i * .2), pts = [];
      for (let k = 0; k <= 10; k++) pts.push([-100 + k * 220, y + 10 * Math.sin(k * 1.4 + ph)]);
      boilSeed('wave' + i); inkLine(pts, .7, '#DCEBF5', 'inkfine', .5);
    }
    boilSeed('sand'); paint(rectPts(-700, GROUND + 60, W + 1400, 600, 3), { wash: '#E9CF98', ink: PAL.ink, sw: .6 });
  },
  board(lt) {
    SETTINGS.room(lt);
    boilSeed('board'); paint(rrPts(260, 110, 1400, 560, 16), { wash: '#3E5E4C', fill: '#2F4A3B', fillOp: 70, ink: '#5A3E2B', sw: 1.6 });
  },
};
function setting(name, lt) { (SETTINGS[name] || SETTINGS.sky)(lt); }
const DARK = new Set(['night', 'space', 'board']);

// ---------- words ----------
function fitSize(txt, max, width) { return Math.min(max, width / Math.max(1, txt.length * .42)); }
function caption(s, lt, y = 112) {
  const txt = (s.caption || '').trim(); if (!txt) return;
  const size = fitSize(txt, 104, 1700);
  letter(txt, 960, y, size, s.sketch ? '#8B8590' : '#FFF5E2', { font: `700 ${size}px Caveat`, stroke: PAL.ink, pop: lt * 2.6, rot: -.015, screen: true });
}
function label(txt, x, y, k, s, size = 84) {
  if (!txt || k <= 0) return;
  size = fitSize(txt, size, 620);
  letter(txt, x, y, size, s.sketch ? '#8B8590' : '#FFF5E2', { font: `700 ${size}px Caveat`, stroke: PAL.ink, pop: k * 1.4, screen: true });
}
function arrow(a, b, k, key) {
  if (k <= .02) return;
  const e = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)], d = Math.atan2(e[1] - a[1], e[0] - a[0]);
  boilSeed('arrow' + key); inkLine([a, [lerp(a[0], e[0], .5), lerp(a[1], e[1], .5) - 24], e], 2.2, PAL.ink, 'ink', .5);
  if (k > .9) { inkLine([e, [e[0] - Math.cos(d - .5) * 40, e[1] - Math.sin(d - .5) * 40]], 2.2); inkLine([e, [e[0] - Math.cos(d + .5) * 40, e[1] - Math.sin(d + .5) * 40]], 2.2); }
}

// ---------- the host ----------
function host(lt, s, x, u, extra = {}) {
  if (s.hero === false) return;
  const p = paceOf(s), v = voiceAt(lt), mood = s.mood || 'happy';
  const m = emotions(lt * p, [[0, mood], [Math.max(1, s.duration * .6) * p, s.mood2 || mood, { lookX: extra.lookX ?? 0 }]], { take: .6 });
  const talk = v >= 6 ? 'O' : v >= 3 ? 'o' : m.mouth;
  const arm = extra.point ? { aR: .9 + .06 * Math.sin(lt * 6) } : v > 2 ? { aR: m.aR != null ? m.aR : .25 + .35 * Math.sin(lt * 5) } : {};
  clawd(x, GROUND + (extra.gy || 0), u, { ...m, ...arm, ...extra.pose, mouth: talk, boilKey: 'host' });
}
const hostU = (s, base) => (s.heroSize === 'big' ? base * 1.35 : base);

// ---------- templates ----------
const TEMPLATES = {
  host(t, s) {
    const lt = t, d = s.duration, hasProp = !!PROPS[s.prop];
    camBegin(960 + 18 * Math.sin(lt * .35), 560, kf(lt, [[0, 1.07], [d, 1.0]]));
    setting(s.setting, lt);
    if (hasProp) drawProp(s.prop, s.hero === false ? 960 : 1330, 470, (s.hero === false ? 1.7 : 1.25) * backOut(seg(lt, .5, 1.2)), lt, s.propColor);
    host(lt, s, hasProp ? 640 : 960, hostU(s, 26), { lookX: hasProp ? .8 : 0, point: hasProp && lt > 1.2 && lt < d * .7,
      pose: lt < 1.6 && !hasProp ? { aR: 1.2 + .45 * Math.sin(lt * 12) } : {} });
    camEnd();
    caption(s, lt);
  },
  object(t, s) {
    const lt = t, d = s.duration, k = backOut(seg(lt, .2, .9));
    camBegin(960 + 10 * Math.sin(lt * .4), 540, kf(lt, [[0, 1.0], [d, 1.05]]));
    setting(s.setting, lt);
    drawProp(PROPS[s.prop] ? s.prop : 'question', 1000, 500, 1.75 * k * (1 + .025 * Math.sin(lt * 2)), lt, s.propColor);
    host(lt, s, 270, hostU(s, 13), { lookX: .9, point: lt > 1 });
    camEnd();
    const labels = (s.labels || []).slice(0, 2), spots = [[400, 300, [770, 450]], [1580, 300, [1240, 430]]];
    labels.forEach((txt, i) => {
      const kk = seg(lt, d * (.3 + .25 * i), d * (.3 + .25 * i) + .5), [x, y, tip] = spots[i];
      arrow([x + (i ? -60 : 60), y + 50], tip, kk, i);
      label(txt, x, y, kk, s);
    });
    caption(s, lt);
  },
  compare(t, s) {
    const lt = t, d = s.duration, L = s.left || {}, R = s.right || {};
    camBegin(960, 540 + 6 * Math.sin(lt * .5), kf(lt, [[0, 1.04], [d, 1.0]]));
    setting(s.setting, lt);
    const kL = backOut(seg(lt, .3, .9)), kR = backOut(seg(lt, d * .4, d * .4 + .6));
    for (const [side, P, k, x] of [['L', L, kL, 520], ['R', R, kR, 1400]]) {
      drawProp(PROPS[P.prop] ? P.prop : 'question', x, 470, 1.3 * k, lt, P.color);
    }
    const look = kf(lt, [[0, -.9], [d * .38, -.9], [d * .46, .9], [d * .8, .9], [d * .9, 0]]);
    host(lt, s, 960, hostU(s, 15), { lookX: look, pose: { flip: look < 0 } });
    camEnd();
    label(L.caption, 520, 680, seg(lt, .6, 1.1), s, 88);
    label(R.caption, 1400, 680, seg(lt, d * .4 + .3, d * .4 + .8), s, 88);
    caption(s, lt);
  },
  card(t, s) {
    const lt = t, d = s.duration, k = backOut(seg(lt, .1, .7));
    setting(s.setting || 'sunset', lt);
    for (let i = 0; i < 12; i++) {
      const x = hash(i * 7.7) * W, y = ((hash(i * 3.3) * H + lt * (120 + 80 * hash(i))) % (H + 200)) - 100;
      boilSeed('conf' + i); paint(starPts(x, y, 16 + 10 * hash(i), .45, 5, lt * 2 + i), { wash: ['#F7C948', '#E27A92', '#8EC3E6', '#6E9F58'][i % 4], ink: null });
    }
    push(); translate(960, 380); scale(k); translate(-960, -380);
    boilSeed('card'); paint(rrPts(330, 150, 1260, 470, 28, 2), { wash: '#FFF5E2', fill: PAL.clayLt, fillOp: 40, ink: PAL.clayDk, sw: 1.6 });
    pop();
    host(lt, s, 960, hostU(s, 18), { pose: { ...jump(lt % 1.6, .5, .9, 1.2), aR: 1.3 + .3 * Math.sin(lt * 10), aL: 1.3 + .3 * Math.sin(lt * 10 + 1) } });
    const title = (s.title || s.caption || '').trim(), sub = (s.subtitle || '').trim();
    if (title && k > .3) { const size = fitSize(title, 190, 1100); letter(title, 960, sub ? 340 : 385, size, s.sketch ? '#8B8590' : PAL.clay, { font: `700 ${size}px Caveat`, stroke: PAL.ink, pop: (lt - .4) * 2.2, rot: -.03, screen: true }); }
    if (sub && k > .3) { const size = fitSize(sub, 72, 1100); letter(sub, 960, 500, size, s.sketch ? '#8B8590' : PAL.ink, { font: `700 ${size}px Caveat`, pop: (lt - .9) * 2.4, ink: false, screen: true }); }
  },
};

shots([[0, t => (TEMPLATES[SC().template] || TEMPLATES.host)(t, { duration: 4, ...SC() })]]);

// Render one frame and hand it back as a JPEG data URL `w` px wide (the stage is always painted at 1920×1080 × RS).
let smallC = null;
window.renderScaled = async (t, w = 1280, q = .9) => {
  T = t; await redraw(); composite(t);
  if (w >= W) return outC.toDataURL('image/jpeg', q);
  smallC ??= document.createElement('canvas');
  smallC.width = w; smallC.height = Math.round(w * H / W);
  const c = smallC.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(outC, 0, 0, smallC.width, smallC.height);
  return smallC.toDataURL('image/jpeg', q);
};
