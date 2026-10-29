// props.js: the painted objects a storyboard may ask for. Each PROP draws around (x, y), about 200·s px across,
// as a pure function of the scene time lt. `c` overrides the main colour (a COLORS name or a hex value).
// Keep the list in sync with PROP_IDS in lib/real/scene-spec.ts.
const COLORS = {
  blue: '#5B8FD6', sky: '#8EC3E6', red: '#D9534A', orange: '#E8893A', yellow: '#F2C94C', green: '#6E9F58',
  teal: '#3A9C98', violet: '#7B5CA8', pink: '#E27A92', brown: '#8A6240', grey: '#9C9AA5', white: '#FFF5E2', clay: '#D97757',
};
const colOf = (c, d) => (c && (COLORS[c] || (/^#[0-9a-f]{6}$/i.test(c) ? c : null))) || d;

const PROPS = (() => {
  const S = (key) => boilSeed('prop-' + key);
  const bumpy = (x, y, rx, ry, n, amp, ph = 0) => {
    const p = []; for (let i = 0; i < 40; i++) { const a = i / 40 * TAU, r = 1 + amp * Math.abs(Math.sin(a * n / 2 + ph)); p.push([x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r]); } return p;
  };
  const P = {};
  P.sun = (x, y, s, lt, c) => {
    S('sun'); glow(x, y, 260 * s, '#FFD96A', .55);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU + lt * .25, r0 = 92 * s, r1 = (128 + 14 * Math.sin(lt * 3 + i)) * s;
      paint(ribbon([[x + Math.cos(a) * r0, y + Math.sin(a) * r0], [x + Math.cos(a) * r1, y + Math.sin(a) * r1]], 18 * s, 6 * s), { wash: PAL.ochre, ink: PAL.ink, sw: .5 });
    }
    paint(ellPts(x, y, 80 * s, 80 * s, 28, 1), { wash: colOf(c, '#F7C948'), fill: PAL.ochre, fillOp: 70, ink: PAL.ink, sw: .9 });
  };
  P.cloud = (x, y, s, lt, c) => {
    S('cloud'); const dx = 10 * s * Math.sin(lt * .6);
    paint(through(bumpy(x + dx, y, 110 * s, 55 * s, 5, .32), 2), { wash: colOf(c, '#FFFDF6'), fill: '#DCE7EF', fillOp: 70, ink: PAL.ink, sw: .8 });
  };
  P.earth = (x, y, s, lt, c) => {
    S('earth'); paint(ellPts(x, y, 95 * s, 95 * s, 30, 1), { wash: colOf(c, '#5B8FD6'), fill: PAL.teal, fillOp: 80, ink: PAL.ink, sw: .9 });
    const o = 30 * s * Math.sin(lt * .4);
    S('earth-land1'); paint(through(bumpy(x - 30 * s + o, y - 25 * s, 35 * s, 25 * s, 3, .4), 2), { wash: PAL.sap, ink: PAL.ink, sw: .5 });
    S('earth-land2'); paint(through(bumpy(x + 35 * s + o * .6, y + 30 * s, 28 * s, 20 * s, 4, .35, 1), 2), { wash: PAL.sap, ink: PAL.ink, sw: .5 });
  };
  P.moon = (x, y, s, lt, c) => {
    S('moon'); glow(x, y, 200 * s, '#FFF1B8', .4);
    const pts = [], r = 85 * s;
    for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + i / 20 * Math.PI; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    for (let i = 20; i >= 0; i--) { const a = -Math.PI / 2 + i / 20 * Math.PI; pts.push([x + Math.cos(a) * r * .45, y + Math.sin(a) * r]); }
    paint(pts, { wash: colOf(c, '#FFF1C2'), fill: PAL.ochre, fillOp: 40, ink: PAL.ink, sw: .8 });
  };
  P.star = (x, y, s, lt, c) => {
    S('star'); glow(x, y, 180 * s, '#FFD96A', .6 + .2 * Math.sin(lt * 4));
    paint(starPts(x, y, 90 * s, .45, 5, -Math.PI / 2 + .1 * Math.sin(lt * 2)), { wash: colOf(c, '#F7C948'), fill: PAL.ochre, fillOp: 60, ink: PAL.ink, sw: .8 });
  };
  P.drop = (x, y, s, lt, c) => {
    S('drop'); const pts = [], b = 4 * s * Math.sin(lt * 2.4);
    for (let i = 0; i <= 30; i++) { const a = i / 30 * TAU, k = Math.sin(a / 2); pts.push([x + Math.sin(a) * 70 * s * k * k * 1.3, y - 100 * s * Math.cos(a / 2) * (1 - .1 * k) + 40 * s + b]); }
    paint(pts, { wash: colOf(c, '#8EC3E6'), fill: '#5B8FD6', fillOp: 60, ink: PAL.ink, sw: .8 });
    S('drop-hi'); paint(ellPts(x - 20 * s, y + 20 * s + b, 10 * s, 18 * s, 12), { wash: '#FFFDF6', ink: null });
  };
  P.rainbow = (x, y, s, lt) => {
    const cols = ['#D9534A', '#E8893A', '#F2C94C', '#6E9F58', '#5B8FD6', '#7B5CA8'], grow = easeOut(lt / 1.2);
    cols.forEach((col, i) => {
      const r = (150 - i * 18) * s, pts = [];
      for (let k = 0; k <= 16; k++) { const a = Math.PI + k / 16 * Math.PI * grow; pts.push([x + Math.cos(a) * r, y + 60 * s + Math.sin(a) * r]); }
      S('rb' + i); if (pts.length > 2 && grow > .05) paint(ribbon(pts, 18 * s), { wash: col, ink: null });
    });
  };
  P.bulb = (x, y, s, lt, c) => {
    const on = .6 + .4 * Math.sin(lt * 5); S('bulb'); glow(x, y - 20 * s, 220 * s, '#FFD96A', on);
    paint(ellPts(x, y - 20 * s, 75 * s, 82 * s, 24, 1), { wash: colOf(c, '#FFE49A'), ink: PAL.ink, sw: .9 });
    paint(rrPts(x - 34 * s, y + 55 * s, 68 * s, 50 * s, 8 * s), { wash: '#8C8478', ink: PAL.ink, sw: .7 });
    inkLine([[x - 22 * s, y], [x - 8 * s, y - 34 * s], [x + 8 * s, y], [x + 22 * s, y - 34 * s]], .8, PAL.ink, 'inkfine', .3);
  };
  P.heart = (x, y, s, lt, c) => {
    const k = 1 + .08 * pulse(lt, 5); S('heart'); paint(heartPts(x, y, 80 * s * k), { wash: colOf(c, PAL.rose), fill: '#D9534A', fillOp: 60, ink: PAL.ink, sw: .9 });
  };
  P.book = (x, y, s, lt, c) => {
    const f = 6 * s * Math.sin(lt * 2);
    S('book'); paint([[x - 150 * s, y - 70 * s], [x, y - 50 * s], [x + 150 * s, y - 70 * s], [x + 150 * s, y + 80 * s], [x, y + 100 * s], [x - 150 * s, y + 80 * s]], { wash: colOf(c, PAL.clay), ink: PAL.ink, sw: .9 });
    S('book-l'); paint([[x - 140 * s, y - 80 * s + f], [x - 4 * s, y - 60 * s], [x - 4 * s, y + 85 * s], [x - 140 * s, y + 68 * s]], { wash: '#FFF8EA', ink: PAL.ink, sw: .7 });
    S('book-r'); paint([[x + 4 * s, y - 60 * s], [x + 140 * s, y - 80 * s - f], [x + 140 * s, y + 68 * s], [x + 4 * s, y + 85 * s]], { wash: '#FFF8EA', ink: PAL.ink, sw: .7 });
    for (let i = 0; i < 4; i++) { const yy = y - 40 * s + i * 28 * s; inkLine([[x - 120 * s, yy], [x - 24 * s, yy + 8 * s]], .5, PAL.ink, 'inkfine', 0); inkLine([[x + 24 * s, yy + 8 * s], [x + 120 * s, yy]], .5, PAL.ink, 'inkfine', 0); }
  };
  P.prism = (x, y, s, lt) => {
    const beam = easeOut(lt / 1);
    S('prism-in'); paint(ribbon([[x - 330 * s, y + 20 * s], [lerp(x - 330 * s, x - 45 * s, beam), lerp(y + 20 * s, y + 5 * s, beam)]], 14 * s), { wash: '#FFFDF6', ink: PAL.ink, sw: .4 });
    const cols = ['#D9534A', '#E8893A', '#F2C94C', '#6E9F58', '#5B8FD6', '#7B5CA8'], out = easeOut((lt - .5) / 1);
    if (out > 0) cols.forEach((col, i) => {
      const a = -.28 + i * .11, L = 320 * s * out;
      S('prism-out' + i); paint(ribbon([[x + 40 * s, y + 5 * s], [x + 40 * s + Math.cos(a) * L, y + 5 * s + Math.sin(a) * L]], 6 * s, 22 * s), { wash: col, ink: null });
    });
    S('prism'); paint([[x, y - 110 * s], [x + 110 * s, y + 80 * s], [x - 110 * s, y + 80 * s]], { wash: '#E6F1F5', fill: '#BFE3EF', fillOp: 90, ink: PAL.ink, sw: 1 });
  };
  P.eye = (x, y, s, lt, c) => {
    const blink = Math.max(0, 1 - Math.abs(((lt % 3.2) - 2.9) / .1)), oy = 1 - .9 * blink, pts = [];
    for (let i = 0; i <= 16; i++) { const k = i / 16; pts.push([x - 130 * s + 260 * s * k, y - 70 * s * oy * Math.sin(k * Math.PI)]); }
    for (let i = 15; i > 0; i--) { const k = i / 16; pts.push([x - 130 * s + 260 * s * k, y + 70 * s * oy * Math.sin(k * Math.PI)]); }
    S('eye'); paint(pts, { wash: '#FFFDF6', ink: PAL.ink, sw: 1 });
    if (oy > .3) { const lx = 18 * s * Math.sin(lt * .9); S('eye-i'); paint(ellPts(x + lx, y, 46 * s, 46 * s * oy, 20), { wash: colOf(c, '#5B8FD6'), ink: PAL.ink, sw: .6 }); S('eye-p'); paint(ellPts(x + lx, y, 20 * s, 20 * s * oy, 14), { wash: PAL.ink, ink: null }); }
  };
  P.tree = (x, y, s, lt, c) => {
    const sw = 5 * s * Math.sin(lt * 1.3);
    S('tree-t'); paint(rectPts(x - 22 * s, y, 44 * s, 140 * s, 2), { wash: '#8A6240', ink: PAL.ink, sw: .8 });
    S('tree-c'); paint(through(bumpy(x + sw, y - 40 * s, 120 * s, 100 * s, 6, .18), 2), { wash: colOf(c, PAL.sap), fill: '#4E7F3E', fillOp: 70, ink: PAL.ink, sw: .9 });
  };
  P.flower = (x, y, s, lt, c) => {
    const sw = .08 * Math.sin(lt * 1.6);
    S('fl-stem'); inkLine([[x, y + 160 * s], [x + 10 * s, y + 80 * s], [x, y]], 1.4, '#4E7F3E', 'ink', .5);
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + sw; S('fl-p' + i); paint(ellPts(x + Math.cos(a) * 48 * s, y + Math.sin(a) * 48 * s, 34 * s, 22 * s, 16, 0, a), { wash: colOf(c, PAL.rose), ink: PAL.ink, sw: .6 }); }
    S('fl-c'); paint(ellPts(x, y, 28 * s, 28 * s, 16), { wash: PAL.ochre, ink: PAL.ink, sw: .6 });
  };
  P.rocket = (x, y, s, lt, c) => {
    const dy = -10 * s * Math.sin(lt * 3);
    S('rk-flame'); glow(x, y + 140 * s + dy, 120 * s, '#FFB45A', .8);
    paint([[x - 30 * s, y + 110 * s + dy], [x, y + (190 + 20 * Math.sin(lt * 20)) * s + dy], [x + 30 * s, y + 110 * s + dy]], { wash: PAL.ochre, ink: null });
    for (const d of [-1, 1]) { S('rk-fin' + d); paint([[x + d * 45 * s, y + 40 * s + dy], [x + d * 90 * s, y + 120 * s + dy], [x + d * 40 * s, y + 110 * s + dy]], { wash: PAL.clayDk, ink: PAL.ink, sw: .7 }); }
    S('rk-body'); paint(through([[x, y - 150 * s + dy], [x + 55 * s, y - 40 * s + dy], [x + 48 * s, y + 115 * s + dy], [x - 48 * s, y + 115 * s + dy], [x - 55 * s, y - 40 * s + dy], [x, y - 150 * s + dy]], 4), { wash: colOf(c, '#F3EEE6'), ink: PAL.ink, sw: .9 });
    S('rk-win'); paint(ellPts(x, y - 30 * s + dy, 26 * s, 26 * s, 16), { wash: '#8EC3E6', ink: PAL.ink, sw: .7 });
  };
  P.clock = (x, y, s, lt, c) => {
    S('clock'); paint(ellPts(x, y, 100 * s, 100 * s, 30, 1), { wash: '#FFF8EA', fill: colOf(c, PAL.clay), fillOp: 40, ink: PAL.ink, sw: 1 });
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; inkLine([[x + Math.cos(a) * 80 * s, y + Math.sin(a) * 80 * s], [x + Math.cos(a) * 90 * s, y + Math.sin(a) * 90 * s]], .7, PAL.ink, 'inkfine', 0); }
    const am = lt * 1.2 - Math.PI / 2, ah = lt * .1 - Math.PI / 2 + 1;
    S('clock-h'); inkLine([[x, y], [x + Math.cos(ah) * 48 * s, y + Math.sin(ah) * 48 * s]], 2, PAL.ink, 'ink', 0);
    S('clock-m'); inkLine([[x, y], [x + Math.cos(am) * 72 * s, y + Math.sin(am) * 72 * s]], 1.4, PAL.clayDk, 'ink', 0);
  };
  P.atom = (x, y, s, lt, c) => {
    for (let k = 0; k < 3; k++) {
      const rot = k * Math.PI / 3; S('atom-o' + k); inkLine(ellPts(x, y, 140 * s, 48 * s, 40, 0, rot).concat([ellPts(x, y, 140 * s, 48 * s, 40, 0, rot)[0]]), .9, PAL.indigo, 'ink', .5);
      const a = lt * 2.2 + k * 2.1, ex = Math.cos(a) * 140 * s, ey = Math.sin(a) * 48 * s;
      S('atom-e' + k); glow(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot), 40 * s, '#8EC3E6', .7);
      paint(ellPts(x + ex * Math.cos(rot) - ey * Math.sin(rot), y + ex * Math.sin(rot) + ey * Math.cos(rot), 13 * s, 13 * s, 12), { wash: '#5B8FD6', ink: PAL.ink, sw: .5 });
    }
    S('atom-n'); paint(ellPts(x, y, 34 * s, 34 * s, 18), { wash: colOf(c, PAL.clay), ink: PAL.ink, sw: .8 });
  };
  P.apple = (x, y, s, lt, c) => {
    S('apple'); paint(through([[x, y - 60 * s], [x + 70 * s, y - 80 * s], [x + 100 * s, y], [x + 50 * s, y + 95 * s], [x, y + 80 * s], [x - 50 * s, y + 95 * s], [x - 100 * s, y], [x - 70 * s, y - 80 * s], [x, y - 60 * s]], 4), { wash: colOf(c, '#D9534A'), fill: '#A83A33', fillOp: 50, ink: PAL.ink, sw: .9 });
    S('apple-st'); inkLine([[x, y - 60 * s], [x + 6 * s, y - 100 * s]], 1.4, '#6B4A2E', 'ink', 0);
    S('apple-lf'); paint(ellPts(x + 36 * s, y - 100 * s, 30 * s, 13 * s, 14, 0, -.5 + .1 * Math.sin(lt * 2)), { wash: PAL.sap, ink: PAL.ink, sw: .5 });
  };
  P.gift = (x, y, s, lt, c) => {
    const hop = Math.max(0, Math.sin(lt * 3)) * 10 * s;
    S('gift'); paint(rectPts(x - 100 * s, y - 60 * s - hop, 200 * s, 150 * s, 2), { wash: colOf(c, PAL.teal), ink: PAL.ink, sw: .9 });
    S('gift-lid'); paint(rectPts(x - 112 * s, y - 95 * s - hop * 1.4, 224 * s, 40 * s, 2), { wash: colOf(c, PAL.teal), ink: PAL.ink, sw: .9 });
    S('gift-rb'); paint(rectPts(x - 16 * s, y - 95 * s - hop, 32 * s, 185 * s, 1), { wash: PAL.rose, ink: PAL.ink, sw: .5 });
    for (const d of [-1, 1]) { S('gift-bow' + d); paint(ellPts(x + d * 34 * s, y - 112 * s - hop * 1.4, 34 * s, 18 * s, 14, 0, d * .4), { wash: PAL.rose, ink: PAL.ink, sw: .6 }); }
  };
  P.wave = (x, y, s, lt, c) => {
    // a light wave: blue / violet ones are short and quick, red / orange ones long and lazy
    const col = colOf(c, '#5B8FD6'), short = ['blue', 'violet', 'sky', 'teal'].includes(c) || !c, k = short ? 5 : 2, sp = short ? 4 : 2, pts = [];
    for (let i = 0; i <= 60; i++) { const u = i / 60; pts.push([x - 170 * s + 340 * s * u, y + 55 * s * Math.sin(u * k * TAU - lt * sp)]); }
    S('wave-' + (c || '')); paint(ribbon(pts, 14 * s), { wash: col, ink: PAL.ink, sw: .4 });
  };
  P.planet = (x, y, s, lt, c) => {
    S('pl-back'); inkLine(ellPts(x, y, 170 * s, 40 * s, 40, 0, -.25).slice(20, 41), 1.4, PAL.ochre, 'ink', .5);
    S('planet'); paint(ellPts(x, y, 90 * s, 90 * s, 28, 1), { wash: colOf(c, PAL.violet), fill: PAL.rose, fillOp: 60, ink: PAL.ink, sw: .9 });
    S('pl-front'); paint(ribbon(ellPts(x, y, 170 * s, 40 * s, 40, 0, -.25).slice(0, 21), 12 * s), { wash: PAL.ochre, ink: PAL.ink, sw: .4 });
  };
  P.cat = (x, y, s, lt, c) => {
    const tw = .2 * Math.sin(lt * 2.4);
    S('cat-tail'); paint(ribbon([[x + 80 * s, y + 70 * s], [x + 150 * s, y + 20 * s], [x + 140 * s + 30 * s * tw, y - 60 * s]], 26 * s, 12 * s), { wash: colOf(c, '#9C8C84'), ink: PAL.ink, sw: .6 });
    S('cat-body'); paint(ellPts(x + 20 * s, y + 60 * s, 100 * s, 60 * s, 24, 1), { wash: colOf(c, '#9C8C84'), ink: PAL.ink, sw: .8 });
    const hx = x - 40 * s, hy = y - 20 * s;
    S('cat-head'); paint([[hx - 64 * s, hy - 10 * s], [hx - 58 * s, hy - 86 * s], [hx - 20 * s, hy - 50 * s], [hx + 20 * s, hy - 50 * s], [hx + 58 * s, hy - 86 * s], [hx + 64 * s, hy - 10 * s], [hx + 56 * s, hy + 40 * s], [hx, hy + 60 * s], [hx - 56 * s, hy + 40 * s]], { wash: colOf(c, '#9C8C84'), ink: PAL.ink, sw: .8, curv: .25 });
    const bl = (lt % 2.7) > 2.55 ? .15 : 1;
    for (const d of [-1, 1]) { S('cat-eye' + d); paint(ellPts(hx + d * 24 * s, hy - 4 * s, 9 * s, 13 * s * bl, 10), { wash: '#B9D96A', ink: PAL.ink, sw: .4 }); }
    S('cat-nose'); paint([[hx - 9 * s, hy + 16 * s], [hx + 9 * s, hy + 16 * s], [hx, hy + 27 * s]], { wash: PAL.rose, ink: null });
    for (const d of [-1, 1]) for (const k of [-1, 1]) inkLine([[hx + d * 18 * s, hy + 26 * s], [hx + d * 80 * s, hy + (26 + 12 * k) * s]], .5, PAL.ink, 'inkfine', 0);
  };
  P.fish = (x, y, s, lt, c) => {
    const w = .15 * Math.sin(lt * 4), dy = 8 * s * Math.sin(lt * 2);
    S('fish-tail'); paint([[x + 90 * s, y + dy], [x + 160 * s, y - 60 * s + dy + 20 * w * s], [x + 160 * s, y + 60 * s + dy + 20 * w * s]], { wash: colOf(c, PAL.ochre), ink: PAL.ink, sw: .7 });
    S('fish'); paint(ellPts(x, y + dy, 110 * s, 62 * s, 26, 1, w * .3), { wash: colOf(c, PAL.ochre), fill: PAL.clay, fillOp: 50, ink: PAL.ink, sw: .9 });
    S('fish-eye'); paint(ellPts(x - 60 * s, y - 12 * s + dy, 11 * s, 11 * s, 10), { wash: PAL.ink, ink: null });
  };
  P.question = (x, y, s, lt) => { S('q'); emote('?', x, y, 3.2 * s * 30, 1, lt); };
  P.idea = (x, y, s, lt, c) => P.bulb(x, y, s, lt, c);
  P.mountain = (x, y, s, lt, c) => {
    S('mt'); paint([[x - 200 * s, y + 110 * s], [x - 40 * s, y - 120 * s], [x + 20 * s, y - 60 * s], [x + 80 * s, y - 140 * s], [x + 220 * s, y + 110 * s]], { wash: colOf(c, '#8C8DB5'), fill: PAL.indigo, fillOp: 40, ink: PAL.ink, sw: .9 });
    S('mt-snow'); paint([[x + 80 * s, y - 140 * s], [x + 115 * s, y - 85 * s], [x + 85 * s, y - 95 * s], [x + 55 * s, y - 80 * s]], { wash: '#FFFDF6', ink: PAL.ink, sw: .5 });
  };
  return P;
})();

function drawProp(id, x, y, s, lt, c) {
  const f = PROPS[id]; if (!f || s <= .01) return;
  f(x, y, s, lt, c);
}
