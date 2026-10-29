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
//                  heroSize, hero, pace, duration, voice, sketch, style,
//                  propRole, captionRole, labelRoles, titleRole, left.role, right.role }
// The roles (flow / problem / good) colour an element in a pack with a colour grammar (Ink: orange, red, blue); in a
// pack without one (Watercolour) they change nothing. Arrows and the card title take the grammar's default roles.
// voice is the mouth envelope: one digit 0..9 per 1/24 s. sketch = true draws only pencil outlines (the draft pass).
// Every point comes from LAYOUT (layout.js), so the same scene paints as 16:9, 9:16 or 1:1 (the page's ?fmt=), and every
// colour of lettering and every spring of a pop from the style pack (LET, SPR in core.js; the page's ?style=).
const SC = () => window.SCENE || {};
const LY = LAYOUT, GROUND = LY.ground;
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
    const [wx, wy, ww, wh] = LY.bg.window;
    boilSeed('window'); paint(rrPts(wx, wy, ww, wh, 14), { wash: '#BFE3EF', ink: PAL.ink, sw: .8 });
    boilSeed('window-x'); inkLine([[wx + ww / 2, wy + 5], [wx + ww / 2, wy + wh - 5]], .8); inkLine([[wx + 5, wy + wh / 2], [wx + ww - 5, wy + wh / 2]], .8);
  },
  sky(lt) {
    wall('#9CCBEA', 'sky');
    boilSeed('sky-hi'); paint(ellPts(W / 2, GROUND - 40, W * .9, 320, 30, 12), { wash: '#CFE6F3', washOp: 150, ink: null });
    for (let i = 0; i < 2; i++) { const x = (hash(i * 4) * W + lt * (14 + 8 * i)) % (W + 400) - 200; boilSeed('skycl' + i); drawProp('cloud', x, LY.bg.clouds[0] + i * LY.bg.clouds[1], .5 - i * .12, lt, null); }
    hills(['#9DBF6A', '#7FAE5A'], 'hill');
  },
  meadow(lt) {
    wall('#A8D3EC', 'sky');
    hills(['#B5CF7A', '#8DB85F'], 'mhill');
    const F = LY.bg.flowers;
    for (let i = 0; i < F.n; i++) drawProp('flower', F.x0 + i * F.dx + 60 * hash(i), GROUND + 70 + 40 * hash(i * 3), .32, lt + i, ['pink', 'yellow', 'violet'][i % 3]);
  },
  sunset(lt) {
    wall('#F2B27D', 'sunset');
    boilSeed('sunset-b'); paint(rectPts(-700, -500, W + 1400, 760), { wash: '#E98C86', washOp: 170, ink: null });
    drawProp('sun', LY.bg.sun[0], GROUND + LY.bg.sun[1], .9, lt * .3, 'orange');
    hills(['#B07A6A', '#8C5E5A'], 'shill');
  },
  night(lt) {
    wall('#232A5C', 'night');
    starsField(lt, 14, 'nstar');
    drawProp('moon', LY.bg.moon[0], LY.bg.moon[1], .8, lt, null);
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
    boilSeed('board'); paint(rrPts(...LY.bg.board, 16), { wash: '#3E5E4C', fill: '#2F4A3B', fillOp: 70, ink: '#5A3E2B', sw: 1.6 });
  },
};
// with boil.holdStill the background holds its drawing (the clouds drift, but don't boil)
function setting(name, lt) { withBoil(BOILP.holdStill ? { hold: true } : null, () => (SETTINGS[name] || SETTINGS.sky)(lt)); }
const DARK = new Set(['night', 'space', 'board']);

// ---------- words ----------
function fitSize(txt, max, width) { return Math.min(max, width / Math.max(1, txt.length * .42)); }
// Words that would shrink a lot on one line break in two (when the layout allows two lines): at the space nearest the
// middle, if that makes the letters bigger. Returns { size, rows }.
function wrapWords(txt, max, width, lines = 1) {
  const one = fitSize(txt, max, width);
  if (lines < 2 || one >= max * .85 || !txt.includes(' ')) return { size: one, rows: [txt] };
  let best = -1;
  for (let i = txt.indexOf(' '); i >= 0; i = txt.indexOf(' ', i + 1)) if (best < 0 || Math.abs(i - txt.length / 2) < Math.abs(best - txt.length / 2)) best = i;
  const rows = [txt.slice(0, best).trim(), txt.slice(best + 1).trim()], two = Math.min(...rows.map(r => fitSize(r, max, width)));
  return two > one * 1.1 ? { size: two, rows } : { size: one, rows: [txt] };
}
// lettering colour: the pencil grey in a sketch, else the role's colour (grammar), else the pack's
const letCol = (s, role, d = LET.fill) => (s.sketch ? '#8B8590' : roleCol(role) || d);
function caption(s, lt, y = LY.caption.y) {
  const txt = (s.caption || '').trim(); if (!txt) return;
  const C = LY.caption, { size, rows } = wrapWords(txt, C.max, C.w, C.lines);
  // a second line goes below the first, so the top line stays where a one-line caption is
  rows.forEach((row, i) => letter(row, C.x, y + i * size * .92, size, letCol(s, s.captionRole), { font: `700 ${size}px Caveat`, stroke: LET.stroke, pop: lt * 2.6 - i * .25, rot: -.015, screen: true }));
}
function label(txt, x, y, k, s, size = 84, width = 620, role) {
  if (!txt || k <= 0) return;
  size = fitSize(txt, size, width);
  letter(txt, x, y, size, letCol(s, role), { font: `700 ${size}px Caveat`, stroke: LET.stroke, pop: k * 1.4, screen: true });
}
// k = 0..1 through the arrow's draw-on: the shaft settles onto the target, then the head pops open. An arrow is a flow
// in the colour grammar (its default role); a label's own role overrides it.
function arrow(a, b, k, key, role = GRAM && GRAM.defaults && GRAM.defaults.arrow) {
  if (k <= .02) return;
  const kk = springK(k, SPR.arrive), e = [lerp(a[0], b[0], kk), lerp(a[1], b[1], kk)], d = Math.atan2(b[1] - a[1], b[0] - a[0]);
  withRole(role, () => {
    boilSeed('arrow' + key); inkLine([a, [lerp(a[0], e[0], .5), lerp(a[1], e[1], .5) - 24], e], 2.2, PAL.ink, 'ink', .5);
    const hl = 40 * springK(seg(k, .55, 1), SPR.pop);
    // one stroke wing–tip–wing (a two-point brush spline paints nothing, so the old two-stroke head never showed)
    if (hl > 2) inkLine([[e[0] - Math.cos(d - .5) * hl, e[1] - Math.sin(d - .5) * hl], e, [e[0] - Math.cos(d + .5) * hl, e[1] - Math.sin(d + .5) * hl]], 2.2, PAL.ink, 'ink', 0);
  });
}

// A pop-in on the overshoot spring with squash and stretch that follows its speed: stretched while it shoots up,
// squashed as it springs back. Returns { k (scale, ~1.16 at the peak), sq (for drawProp), boil (hold once settled) }.
function popIn(lt, t0, dur, preset = SPR.pop) {
  const k = springTo(lt, t0, dur, preset), sq = clamp(-springVel(lt, t0, dur, preset) * dur * .022, -.14, .14);
  return { k, sq, boil: BOILP.holdStill && lt > t0 + dur ? { hold: true } : null };
}

// ---------- the host ----------
function host(lt, s, x, u, extra = {}) {
  if (s.hero === false) return;
  const p = paceOf(s), v = voiceAt(lt), mood = s.mood || 'happy';
  const look = extra.lookY != null ? { lookX: extra.lookX ?? 0, lookY: extra.lookY } : { lookX: extra.lookX ?? 0 };
  const m = emotions(lt * p, [[0, mood], [Math.max(1, s.duration * .6) * p, s.mood2 || mood, look]], { take: .6 });
  const talk = v >= 6 ? 'O' : v >= 3 ? 'o' : m.mouth;
  // the right arm: talking, waving hello until extra.wave, pointing during extra.point = [from, to]; it springs
  // between these instead of snapping
  let aR = v > 2 ? (m.aR != null ? m.aR : .25 + .35 * Math.sin(lt * 5)) : m.aR;
  if (extra.wave) aR = lerp(aR ?? .2, 1.2 + .45 * Math.sin(lt * 12), 1 - springTo(lt, extra.wave, .45, SPR.arrive));
  if (extra.point) aR = lerp(aR ?? .2, .9 + .06 * Math.sin(lt * 6), springTo(lt, extra.point[0], .45, SPR.pop) * (1 - springTo(lt, extra.point[1], .5, SPR.arrive)));
  // hops add to the mood's own body motion: extra.hops = [[t0, t1, h], ...]
  let dy = m.dy || 0, sq = m.sq || 0;
  for (const [h0, h1, hh, ho] of extra.hops || []) { const j = hop(lt, h0, h1, hh, ho); dy += j.dy; sq += j.sq; }
  if (extra.hops) sq = clamp(sq, -.2, .24);   // a hop on top of a bouncy mood must not turn him to rubber
  clawd(x, GROUND + (extra.gy || 0), u, { ...m, ...extra.pose, aR: (extra.pose && extra.pose.aR) ?? aR, dy, sq, mouth: talk, boilKey: 'host' });
}
const hostU = (s, base) => (s.heroSize === 'big' ? base * 1.35 : base);

// ---------- templates ----------
const TEMPLATES = {
  host(t, s) {
    const lt = t, d = s.duration, hasProp = !!PROPS[s.prop], Y = LY.host, P = s.hero === false ? Y.solo : Y.prop;
    camBegin(LY.cam.host[0] + 18 * Math.sin(lt * .35), LY.cam.host[1], kf(lt, [[0, 1.07], [d, 1.0]]));
    setting(s.setting, lt);
    const pp = popIn(lt, .5, .75);
    if (hasProp) drawProp(s.prop, P.x, P.y, P.s * pp.k, lt, s.propColor, { ...pp, role: s.propRole });
    // Clawd hops into the shot (a crouch, the hop, a small rebound), then waves or points at the prop
    // (in 9:16 the prop floats above him, so he looks up at it)
    host(lt, s, hasProp ? Y.hero.x : Y.hero.x0, hostU(s, Y.hero.u), { lookX: hasProp ? .8 : 0, ...(hasProp && Y.hero.lookY != null && { lookY: Y.hero.lookY }),
      point: hasProp ? [1.2, d * .7] : null, wave: hasProp ? null : 1.5, hops: [[.36, .7, 1.4]] });
    camEnd();
    caption(s, lt);
  },
  object(t, s) {
    const lt = t, d = s.duration, pp = popIn(lt, .2, .8), Y = LY.object;
    camBegin(LY.cam.object[0] + 10 * Math.sin(lt * .4), LY.cam.object[1], kf(lt, [[0, 1.0], [d, 1.05]]));
    setting(s.setting, lt);
    drawProp(PROPS[s.prop] ? s.prop : 'question', Y.prop.x, Y.prop.y, Y.prop.s * pp.k * (1 + .025 * Math.sin(lt * 2)), lt, s.propColor, { ...pp, role: s.propRole });
    // "look at this!": a little hop as he starts pointing
    host(lt, s, Y.hero.x, hostU(s, Y.hero.u), { lookX: .9, ...(Y.hero.lookY != null && { lookY: Y.hero.lookY }), point: [1, d + 1], hops: [[.95, 1.25, 1.1]] });
    camEnd();
    const labels = (s.labels || []).slice(0, 2);
    labels.forEach((txt, i) => {
      const kk = seg(lt, d * (.3 + .25 * i), d * (.3 + .25 * i) + .5), sp = Y.labels[i], role = (s.labelRoles || [])[i];
      if (role) arrow(sp.a, sp.tip, kk, i, role); else arrow(sp.a, sp.tip, kk, i);
      label(txt, sp.x, sp.y, kk, s, 84, Y.labelW, role);
    });
    caption(s, lt);
  },
  compare(t, s) {
    const lt = t, d = s.duration, L = s.left || {}, R = s.right || {}, Y = LY.compare;
    camBegin(LY.cam.compare[0], LY.cam.compare[1] + 6 * Math.sin(lt * .5), kf(lt, [[0, 1.04], [d, 1.0]]));
    setting(s.setting, lt);
    const pL = popIn(lt, .3, .7), pR = popIn(lt, d * .4, .7);
    for (const [P, pp, at] of [[L, pL, Y.L], [R, pR, Y.R]]) {
      drawProp(PROPS[P.prop] ? P.prop : 'question', at.x, at.y, at.s * pp.k, lt, P.color, { ...pp, role: P.role });
    }
    // he turns from one side to the other in a small hop, flipping at the top of it; in 9:16 the sides are top and
    // bottom, so he stands beside them and looks up, then down
    const look = kf(lt, [[0, -.9], [d * .38, -.9], [d * .46, .9], [d * .8, .9], [d * .9, 0]]);
    const eyes = Y.vertical ? { lookX: -.6, lookY: lerp(-.9, .7, (look + .9) / 1.8), pose: { flip: true } } : { lookX: look, pose: { flip: look < 0 } };
    host(lt, s, Y.hero.x, hostU(s, Y.hero.u), { ...eyes, hops: [[d * .42 - .15, d * .42 + .15, 1]] });
    camEnd();
    label(L.caption, Y.L.cx, Y.L.cy, seg(lt, .6, 1.1), s, 88, Y.capW, L.role);
    label(R.caption, Y.R.cx, Y.R.cy, seg(lt, d * .4 + .3, d * .4 + .8), s, 88, Y.capW, R.role);
    caption(s, lt);
  },
  card(t, s) {
    const lt = t, d = s.duration, pc = popIn(lt, .1, .8), k = pc.k;
    setting(s.setting || 'sunset', lt);
    for (let i = 0; i < 12; i++) {
      const x = hash(i * 7.7) * W, y = ((hash(i * 3.3) * H + lt * (120 + 80 * hash(i))) % (H + 200)) - 100;
      boilSeed('conf' + i); paint(starPts(x, y, 16 + 10 * hash(i), .45, 5, lt * 2 + i), { wash: ['#F7C948', '#E27A92', '#8EC3E6', '#6E9F58'][i % 4], ink: null });
    }
    const Y = LY.card, [px, py] = Y.pivot, Tt = Y.title, Sb = Y.sub;
    push(); translate(px, py); scale(k * (1 + pc.sq * .6), k * (1 - pc.sq)); translate(-px, -py);
    boilSeed('card'); paint(rrPts(...Y.box, 28, 2), { wash: '#FFF5E2', fill: PAL.clayLt, fillOp: 40, ink: PAL.clayDk, sw: 1.6 });
    pop();
    // cheering: hops on a 1.6 s loop, each with a crouch before and a bounce after
    const hl = lt % 1.6, hops = [[.5, .9, 1.4]].map(([a, b, h]) => [a + lt - hl, b + lt - hl, h]);
    host(lt, s, Y.hero.x, hostU(s, Y.hero.u), { hops, pose: { aR: 1.3 + .3 * Math.sin(lt * 10), aL: 1.3 + .3 * Math.sin(lt * 10 + 1) } });
    const title = (s.title || s.caption || '').trim(), sub = (s.subtitle || '').trim();
    const titleRole = s.titleRole || (GRAM && GRAM.defaults && GRAM.defaults.title);
    if (title && k > .3) { const size = fitSize(title, Tt.max, Tt.w); letter(title, Tt.x, sub ? Tt.ySub : Tt.y, size, letCol(s, titleRole, LET.title), { font: `700 ${size}px Caveat`, stroke: LET.stroke, pop: (lt - .4) * 2.2, rot: -.03, screen: true }); }
    if (sub && k > .3) {
      // a long line under the title may break in two (9:16, 1:1), centred where one line would be
      const { size, rows } = wrapWords(sub, Sb.max, Sb.w, Sb.lines);
      rows.forEach((row, i) => letter(row, Sb.x, Sb.y + (i - (rows.length - 1) / 2) * size * .95, size, letCol(s, null, LET.sub), { font: `700 ${size}px Caveat`, pop: (lt - .9) * 2.4 - i * .2, ink: false, screen: true }));
    }
  },
};

shots([[0, t => (TEMPLATES[SC().template] || TEMPLATES.host)(t, { duration: 4, ...SC() })]]);

// Render one frame and hand it back as a JPEG data URL `w` px wide (the stage is painted at W×H × RS of its format).
// A scene meant for another format is refused: the painter keeps one page per format and must never mix them up.
let smallC = null;
window.renderScaled = async (t, w = 1280, q = .9) => {
  const want = SC().format, style = SC().style;
  if (want && want !== LY.id) throw new Error(`this stage paints ${LY.id}, the scene asks for ${want}`);
  if (style && style !== STYLE.id) throw new Error(`this stage paints the ${STYLE.id} style, the scene asks for ${style}`);
  T = t; await redraw(); composite(t);
  if (w >= W) return outC.toDataURL('image/jpeg', q);
  smallC ??= document.createElement('canvas');
  smallC.width = w; smallC.height = Math.round(w * H / W);
  const c = smallC.getContext('2d'); c.imageSmoothingQuality = 'high'; c.drawImage(outC, 0, 0, smallC.width, smallC.height);
  return smallC.toDataURL('image/jpeg', q);
};
