// styles/ink/kit.js: the Ink pack's own backgrounds. Loaded after templates.js (stage.html), it replaces the settings'
// washes with a light line hint of the place — a horizon, a window, a floor, stars as dots — so at least a third of the
// frame stays bare paper and the eye goes to the subject. Every point still comes from LAYOUT (layout.js), so the
// hints sit where the watercolour backgrounds do in each format. Pure functions of lt, like everything on the stage.
(() => {
  const HAIR = .55, THIN = .75;
  // a straight stroke as three points (a two-point brush spline may paint nothing)
  const seg3 = (a, b) => [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b];
  // a run of a line broken into a few strokes with small gaps, the way a pen lifts off the paper
  const broken = (pts, key, sw = THIN, br = 'inkfine', gaps = [.34, .71]) => {
    const n = pts.length, cut = [0, ...gaps.map(g => Math.round(g * (n - 1))), n - 1];
    for (let i = 0; i + 1 < cut.length; i++) {
      const a = cut[i] + (i ? 1 : 0), b = cut[i + 1];
      if (b - a < 2) continue;
      boilSeed(`${key}-${i}`); inkLine(pts.slice(a, b + 1), sw, PAL.ink, br, .5);
    }
  };
  // a solid ink dot (stars, sand), painted as drawn: no outline of its own
  const dot = (x, y, r) => { KEEP++; try { paint(ellPts(x, y, r, r, 9), { wash: PAL.ink, ink: null }); } finally { KEEP--; } };
  // the land: a bare-paper shape with a ridge line on top, so a sun or a moon behind it is hidden like a real horizon
  // (a brush outline of a shape this big gets lost, so the ridge is its own ink line over a bare-paper shape)
  const land = (y0, amp, key, sw = THIN, ph = 0) => {
    const ridge = [];
    for (let k = 0; k <= 12; k++) ridge.push([-200 + k * (W + 400) / 12, y0 - amp * Math.sin(k * 1.3 + ph) - amp * .7 * hash(k + ph * 7)]);
    const line = through(ridge, 4);
    boilSeed(key); KEEP++; try { paint(line.concat([[W + 200, H + 300], [-200, H + 300]]), { wash: PAL.paper, ink: null }); } finally { KEEP--; }
    broken(line, key + '-ridge', sw, 'ink', [.4, .77]);
  };
  const tufts = (y, n, key) => {
    for (let i = 0; i < n; i++) {
      const x = (i + .5) / n * W + 50 * (hash(i * 4.1) - .5), h = 18 + 14 * hash(i * 2.3), yy = y + 30 * hash(i * 7.7);
      boilSeed(`${key}${i}`); inkLine([[x - 10, yy], [x - 4, yy - h], [x, yy - 2], [x + 6, yy - h * .8], [x + 11, yy]], HAIR, PAL.ink, 'inkfine', .3);
    }
  };
  const starDots = (n, key, yMax) => {
    boilSeed(key);
    for (let i = 0; i < n; i++) dot(hash(i * 3.1) * W, 40 + hash(i * 5.7) * (yMax - 40), 2.2 + 3.2 * hash(i * 9.3));
  };
  const S = SETTINGS;
  S.none = () => {};
  S.room = () => {
    const pts = []; for (let k = 0; k <= 16; k++) pts.push([-60 + k * (W + 120) / 16, GROUND - 6 + 3 * Math.sin(k * 1.7)]);
    broken(pts, 'floor', THIN, 'ink', [.42]);
    const [wx, wy, ww, wh] = LY.bg.window;
    boilSeed('window'); paint(rrPts(wx, wy, ww, wh, 10), { wash: PAL.paper, ink: PAL.ink, sw: THIN });
    boilSeed('window-x'); inkLine(seg3([wx + ww / 2, wy + 6], [wx + ww / 2, wy + wh - 6]), HAIR, PAL.ink, 'inkfine', .5); inkLine(seg3([wx + 6, wy + wh / 2], [wx + ww - 6, wy + wh / 2]), HAIR, PAL.ink, 'inkfine', .5);
    boilSeed('sill'); inkLine(seg3([wx - 18, wy + wh + 10], [wx + ww + 18, wy + wh + 10]), THIN, PAL.ink, 'inkfine', .5);
  };
  // clouds only where they sit clear of the caption (above it, in 9:16); in 16:9 and 1:1 the sky is the horizon alone —
  // an outlined cloud over black lettering reads as a scribble
  S.sky = lt => {
    if (LY.bg.clouds[0] < LY.caption.y) for (let i = 0; i < 2; i++) { const x = (hash(i * 4) * W + lt * (14 + 8 * i)) % (W + 400) - 200; boilSeed('skycl' + i); drawProp('cloud', x, LY.bg.clouds[0] + i * LY.bg.clouds[1], .5 - i * .12, lt, null); }
    land(GROUND - 10, 34, 'hill');
  };
  S.meadow = lt => {
    land(GROUND - 10, 30, 'mhill', THIN, 1);
    tufts(GROUND + 40, 7, 'tuft');
    const F = LY.bg.flowers;
    for (let i = 0; i < F.n; i += 2) drawProp('flower', F.x0 + i * F.dx + 60 * hash(i), GROUND + 70 + 40 * hash(i * 3), .32, lt + i, null);
  };
  S.sunset = lt => {
    drawProp('sun', LY.bg.sun[0], GROUND + LY.bg.sun[1], .9, lt * .3, null);
    land(GROUND - 20, 26, 'shill', THIN, 2);
    for (let i = 0; i < 3; i++) { boilSeed('sbird' + i); const x = W * (.18 + .07 * i), y = H * (.2 + .05 * hash(i)) + 6 * Math.sin(lt * 2 + i); inkLine([[x - 16, y - 6], [x, y + 4], [x + 16, y - 6]], HAIR, PAL.ink, 'inkfine', .5); }
  };
  S.night = lt => {
    starDots(16, 'nstar', GROUND - 220);
    drawProp('moon', LY.bg.moon[0], LY.bg.moon[1], .8, lt, null);
    land(GROUND - 10, 30, 'nhill', THIN, 3);
  };
  S.space = lt => {
    starDots(26, 'sstar', H - 60);
    for (let i = 0; i < 3; i++) {
      const x = W * (.3 + .3 * i + .05 * hash(i)), y = H * (.12 + .3 * hash(i * 3.3)), r = 12 + 6 * Math.sin(lt * 1.5 + i);
      boilSeed('spark' + i); inkLine(seg3([x - r, y], [x + r, y]), HAIR, PAL.ink, 'inkfine', 0); inkLine(seg3([x, y - r], [x, y + r]), HAIR, PAL.ink, 'inkfine', 0);
    }
  };
  S.sea = lt => {
    const hz = []; for (let k = 0; k <= 16; k++) hz.push([-60 + k * (W + 120) / 16, GROUND - 160 + 2 * Math.sin(k * 2.1)]);
    broken(hz, 'horizon', THIN, 'inkfine', [.55]);
    for (let i = 0; i < 4; i++) {
      const y = GROUND - 110 + i * 42, x0 = W * (.08 + .22 * i) + 30 * Math.sin(lt * .6 + i), pts = [];
      for (let k = 0; k <= 6; k++) pts.push([x0 + k * 34, y + 9 * Math.sin(k * 1.4 + lt * (1.2 + .2 * i))]);
      boilSeed('wave' + i); inkLine(pts, HAIR, PAL.ink, 'inkfine', .5);
    }
    const sand = []; for (let k = 0; k <= 16; k++) sand.push([-60 + k * (W + 120) / 16, GROUND + 60 + 8 * Math.sin(k * .9)]);
    broken(sand, 'sand', THIN, 'ink', [.3, .8]);
    boilSeed('sand-dots'); for (let i = 0; i < 9; i++) dot((i + .5) / 9 * W + 40 * hash(i), GROUND + 110 + 50 * hash(i * 2.9), 2.2);
  };
  S.board = () => {
    const pts = []; for (let k = 0; k <= 16; k++) pts.push([-60 + k * (W + 120) / 16, GROUND - 6 + 3 * Math.sin(k * 1.7)]);
    broken(pts, 'floor', THIN, 'ink', [.42]);
    // the board starts a little lower than the watercolour one where needed, so its frame never runs through the caption
    const [bx, by0, bw, bh0] = LY.bg.board, dy = Math.max(0, LY.caption.y + 70 - by0), by = by0 + dy, bh = bh0 - dy;
    boilSeed('board'); paint(rrPts(bx, by, bw, bh, 12), { wash: PAL.paper, ink: PAL.ink, sw: 1.3 });
    boilSeed('board-ledge'); inkLine(seg3([bx + bw * .2, by + bh + 14], [bx + bw * .8, by + bh + 14]), THIN, PAL.ink, 'inkfine', .5);
  };
})();
