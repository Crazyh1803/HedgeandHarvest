/* Cornfield Carver - cozy fieldwork.
 * Part 1: pure game core (no DOM, exported for Node tests).
 * Part 2: Canvas renderer + controller (browser only).
 * All art is drawn from code; the map format is versioned JSON data only.
 */
(function (root) {
  'use strict';

  /* ===================================================================
   * PART 1 - CORE
   * =================================================================== */
  var FORMAT = 'cornfield-carver';
  var VERSION = 1;
  var MAX_UNDO = 150;
  var MAX_JSON = 40000;
  var MAX_NAME = 40;
  var DEFAULT_NAME = 'My cornfield';

  var SIZES = {
    small: { w: 15, h: 11, label: 'Cozy plot' },
    medium: { w: 25, h: 17, label: 'Family farm' },
    large: { w: 35, h: 23, label: 'Great field' }
  };
  var SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  var ANIMALS = ['dog', 'cat', 'cow', 'horse', 'pig', 'chicken'];
  var BRAID = { spring: 0.04, summer: 0, autumn: 0.08, winter: 0.12 };
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // right, down, left, up

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isInt(n) { return typeof n === 'number' && isFinite(n) && Math.floor(n) === n; }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function cleanName(n) {
    if (typeof n !== 'string') return DEFAULT_NAME;
    n = n.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    return n || DEFAULT_NAME;
  }

  function dirIndex(dx, dy) {
    for (var i = 0; i < 4; i++) if (DIRS[i][0] === dx && DIRS[i][1] === dy) return i;
    return 0;
  }

  /** Build a game state object. grid: Uint8Array, 1 = corn, 0 = cleared. */
  function createState(o) {
    var d = SIZES[o.size];
    var s = {
      size: o.size, season: o.season, animal: o.animal,
      seed: o.seed >>> 0, name: cleanName(o.name),
      w: d.w, h: d.h, grid: o.grid,
      start: { x: o.start.x, y: o.start.y },
      exit: { x: o.exit.x, y: o.exit.y },
      tractor: { x: o.start.x, y: o.start.y, dir: 0 },
      run: null, history: [], stroke: null, strokeOpen: false, dirty: false
    };
    resetRun(s);
    return s;
  }

  function resetRun(s) {
    s.run = { x: s.start.x, y: s.start.y, moves: 0, won: false };
  }

  function inBounds(s, x, y) { return x >= 0 && y >= 0 && x < s.w && y < s.h; }
  function idx(s, x, y) { return y * s.w + x; }

  /** Generate a perfect (plus optional braided) maze grid for a size/season/seed. */
  function generateMaze(size, season, seed) {
    var d = SIZES[size], w = d.w, h = d.h, rnd = mulberry32(seed);
    var g = new Uint8Array(w * h);
    g.fill(1);
    var cellRows = (h - 1) / 2;
    var sy = 2 * Math.floor(rnd() * cellRows) + 1;
    var ey = 2 * Math.floor(rnd() * cellRows) + 1;
    var stack = [[1, sy]];
    g[sy * w + 1] = 0;
    while (stack.length) {
      var cur = stack[stack.length - 1], opts = [];
      for (var i = 0; i < 4; i++) {
        var nx = cur[0] + DIRS[i][0] * 2, ny = cur[1] + DIRS[i][1] * 2;
        if (nx >= 1 && ny >= 1 && nx <= w - 2 && ny <= h - 2 && g[ny * w + nx] === 1) opts.push(i);
      }
      if (!opts.length) { stack.pop(); continue; }
      var k = opts[Math.floor(rnd() * opts.length)];
      g[(cur[1] + DIRS[k][1]) * w + cur[0] + DIRS[k][0]] = 0;
      g[(cur[1] + DIRS[k][1] * 2) * w + cur[0] + DIRS[k][0] * 2] = 0;
      stack.push([cur[0] + DIRS[k][0] * 2, cur[1] + DIRS[k][1] * 2]);
    }
    var braid = BRAID[season] || 0;
    if (braid > 0) {
      for (var y = 1; y < h - 1; y++) {
        for (var x = 1; x < w - 1; x++) {
          if (g[y * w + x] !== 1 || (x % 2) === (y % 2)) continue;
          var open = (x % 2 === 0) ? (g[y * w + x - 1] === 0 && g[y * w + x + 1] === 0)
                                   : (g[(y - 1) * w + x] === 0 && g[(y + 1) * w + x] === 0);
          if (open && rnd() < braid) g[y * w + x] = 0;
        }
      }
    }
    g[sy * w] = 0;
    g[ey * w + w - 1] = 0;
    return { grid: g, start: { x: 0, y: sy }, exit: { x: w - 1, y: ey } };
  }

  function newMaze(o) {
    var seed = (o.seed === undefined ? 1 : o.seed) >>> 0;
    var m = generateMaze(o.size, o.season, seed);
    return createState({ size: o.size, season: o.season, animal: o.animal, seed: seed, name: o.name,
      grid: m.grid, start: m.start, exit: m.exit });
  }

  function blankLayout(size) {
    var d = SIZES[size], mid = 2 * Math.floor((d.h - 1) / 4) + 1;
    var g = new Uint8Array(d.w * d.h);
    g.fill(1);
    g[mid * d.w] = 0;
    g[mid * d.w + d.w - 1] = 0;
    return { grid: g, start: { x: 0, y: mid }, exit: { x: d.w - 1, y: mid } };
  }

  function newBlank(o) {
    var b = blankLayout(o.size);
    return createState({ size: o.size, season: o.season, animal: o.animal, seed: o.seed || 0, name: o.name,
      grid: b.grid, start: b.start, exit: b.exit });
  }

  /* ---- history ---- */
  function pushEntry(s, e) {
    s.history.push(e);
    if (s.history.length > MAX_UNDO) s.history.shift();
    return e;
  }
  function snapshotMeta(s) {
    return { c: [], tx: s.tractor.x, ty: s.tractor.y, td: s.tractor.dir,
      start: { x: s.start.x, y: s.start.y }, exit: { x: s.exit.x, y: s.exit.y }, seed: s.seed };
  }
  function beginStroke(s) { s.strokeOpen = true; s.stroke = null; }
  function endStroke(s) { s.strokeOpen = false; s.stroke = null; }

  function recordCarve(s, i) {
    if (!s.stroke) s.stroke = pushEntry(s, snapshotMeta(s));
    s.stroke.c.push([i, 1]);
  }

  function undo(s) {
    var e = s.history.pop();
    s.stroke = null;
    if (!e) return false;
    for (var i = e.c.length - 1; i >= 0; i--) s.grid[e.c[i][0]] = e.c[i][1];
    var layoutChanged = s.start.x !== e.start.x || s.start.y !== e.start.y || s.exit.x !== e.exit.x || s.exit.y !== e.exit.y;
    s.start = { x: e.start.x, y: e.start.y };
    s.exit = { x: e.exit.x, y: e.exit.y };
    s.seed = e.seed;
    s.tractor = { x: e.tx, y: e.ty, dir: e.td };
    if (s.run.won || layoutChanged || s.grid[idx(s, s.run.x, s.run.y)] === 1) resetRun(s);
    s.dirty = true;
    return true;
  }

  /** Replace the whole grid as one undoable step. */
  function applyGrid(s, grid, start, exit, seed) {
    var e = snapshotMeta(s);
    for (var i = 0; i < grid.length; i++) if (s.grid[i] !== grid[i]) e.c.push([i, s.grid[i]]);
    pushEntry(s, e);
    s.stroke = null;
    s.grid = grid;
    s.start = { x: start.x, y: start.y };
    s.exit = { x: exit.x, y: exit.y };
    s.seed = seed >>> 0;
    s.tractor = { x: start.x, y: start.y, dir: 0 };
    resetRun(s);
    s.dirty = false;
  }

  function regenerate(s, seed) {
    var m = generateMaze(s.size, s.season, seed);
    applyGrid(s, m.grid, m.start, m.exit, seed);
  }

  function replant(s) {
    var g = new Uint8Array(s.w * s.h);
    g.fill(1);
    g[idx(s, s.start.x, s.start.y)] = 0;
    g[idx(s, s.exit.x, s.exit.y)] = 0;
    applyGrid(s, g, s.start, s.exit, s.seed);
  }

  /* ---- tractor ---- */
  function moveTractor(s, dx, dy) {
    var t = s.tractor, nx = t.x + dx, ny = t.y + dy;
    t.dir = dirIndex(dx, dy);
    if (!inBounds(s, nx, ny)) return { moved: false, carved: false, x: t.x, y: t.y };
    var i = idx(s, nx, ny), carved = false;
    if (s.grid[i] === 1) {
      recordCarve(s, i);
      s.grid[i] = 0;
      s.dirty = true;
      carved = true;
    }
    t.x = nx; t.y = ny;
    if (!s.strokeOpen) s.stroke = null;
    return { moved: true, carved: carved, x: nx, y: ny };
  }

  function stepToward(x, y, tx, ty) {
    var ddx = tx - x, ddy = ty - y;
    if (!ddx && !ddy) return null;
    if (Math.abs(ddx) >= Math.abs(ddy)) return [ddx > 0 ? 1 : -1, 0];
    return [0, ddy > 0 ? 1 : -1];
  }

  /** Drive the tractor toward a tile, carving along the way. */
  function carveTo(s, tx, ty, maxSteps) {
    var steps = 0, carved = 0, lim = maxSteps || 60;
    if (!inBounds(s, tx, ty)) return { steps: 0, carved: 0 };
    while (steps < lim) {
      var st = stepToward(s.tractor.x, s.tractor.y, tx, ty);
      if (!st) break;
      var r = moveTractor(s, st[0], st[1]);
      if (!r.moved) break;
      steps++;
      if (r.carved) carved++;
    }
    return { steps: steps, carved: carved };
  }

  /* ---- runner ---- */
  function moveRunner(s, dx, dy) {
    var r = s.run;
    if (r.won) return { moved: false, blocked: false, won: true };
    var nx = r.x + dx, ny = r.y + dy;
    if (!inBounds(s, nx, ny) || s.grid[idx(s, nx, ny)] === 1) return { moved: false, blocked: true, won: false };
    r.x = nx; r.y = ny; r.moves++;
    if (nx === s.exit.x && ny === s.exit.y) r.won = true;
    return { moved: true, blocked: false, won: r.won };
  }

  /** Move the runner toward a tile, sliding along corn when blocked. */
  function runTo(s, tx, ty, maxSteps) {
    var steps = 0, lim = maxSteps || 8;
    while (steps < lim && !s.run.won) {
      var x = s.run.x, y = s.run.y, st = stepToward(x, y, tx, ty);
      if (!st) break;
      var r = moveRunner(s, st[0], st[1]);
      if (!r.moved) {
        var alt = st[0] ? [0, Math.sign(ty - y)] : [Math.sign(tx - x), 0];
        if (!alt[0] && !alt[1]) break;
        r = moveRunner(s, alt[0], alt[1]);
        if (!r.moved) break;
      }
      steps++;
    }
    return steps;
  }

  /** Shortest cleared route from (fx,fy) to the exit, excluding the origin; null if blocked. */
  function findPath(s, fx, fy) {
    if (!inBounds(s, fx, fy) || s.grid[idx(s, fx, fy)] === 1) return null;
    var n = s.w * s.h, prev = new Int32Array(n).fill(-2), q = [idx(s, fx, fy)], head = 0;
    prev[q[0]] = -1;
    var goal = idx(s, s.exit.x, s.exit.y);
    while (head < q.length) {
      var c = q[head++];
      if (c === goal) break;
      var cx = c % s.w, cy = (c - cx) / s.w;
      for (var i = 0; i < 4; i++) {
        var nx = cx + DIRS[i][0], ny = cy + DIRS[i][1];
        if (!inBounds(s, nx, ny)) continue;
        var ni = ny * s.w + nx;
        if (prev[ni] !== -2 || s.grid[ni] === 1) continue;
        prev[ni] = c; q.push(ni);
      }
    }
    if (prev[goal] === -2) return null;
    var path = [], c2 = goal;
    while (prev[c2] !== -1) { path.push([c2 % s.w, Math.floor(c2 / s.w)]); c2 = prev[c2]; }
    return path.reverse();
  }

  function isSolvable(s) { return findPath(s, s.start.x, s.start.y) !== null; }

  function counts(s) {
    var corn = 0;
    for (var i = 0; i < s.grid.length; i++) corn += s.grid[i];
    return { corn: corn, cleared: s.grid.length - corn };
  }

  /* ---- JSON ---- */
  function serialize(s, opts) {
    var rows = [];
    for (var y = 0; y < s.h; y++) {
      var r = '';
      for (var x = 0; x < s.w; x++) r += s.grid[y * s.w + x] ? '#' : '.';
      rows.push(r);
    }
    var o = {
      format: FORMAT, version: VERSION, name: s.name, size: s.size, season: s.season, animal: s.animal,
      seed: s.seed, width: s.w, height: s.h, start: [s.start.x, s.start.y], exit: [s.exit.x, s.exit.y], rows: rows
    };
    if (opts && opts.tractor) o.tractor = [s.tractor.x, s.tractor.y];
    return o;
  }
  function stringify(s, opts) { return JSON.stringify(serialize(s, opts)); }

  function fail(msg) { return { ok: false, error: msg }; }

  /** Validate untrusted JSON text. Never evaluates anything; only copies known, checked fields. */
  function parse(text) {
    if (typeof text !== 'string') return fail('Nothing to import.');
    if (text.length > MAX_JSON) return fail('That is too large to be a cornfield (limit ' + MAX_JSON + ' characters).');
    var o;
    try { o = JSON.parse(text); } catch (e) { return fail('That is not valid JSON.'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return fail('Expected a cornfield object.');
    if (o.format !== FORMAT) return fail('This is not a Cornfield Carver creation.');
    if (!isInt(o.version) || o.version < 1) return fail('Missing or invalid version.');
    if (o.version > VERSION) return fail('This creation was made with a newer version of the game.');
    if (typeof o.size !== 'string' || !hasOwn(SIZES, o.size)) return fail('Unknown field size.');
    if (typeof o.season !== 'string' || SEASONS.indexOf(o.season) < 0) return fail('Unknown season.');
    if (typeof o.animal !== 'string' || ANIMALS.indexOf(o.animal) < 0) return fail('Unknown runner animal.');
    var d = SIZES[o.size];
    if (o.width !== d.w || o.height !== d.h) return fail('Field dimensions do not match its size.');
    if (!Array.isArray(o.rows) || o.rows.length !== d.h) return fail('Field rows are missing or the wrong count.');
    var g = new Uint8Array(d.w * d.h);
    for (var y = 0; y < d.h; y++) {
      var row = o.rows[y];
      if (typeof row !== 'string' || row.length !== d.w || !/^[#.]+$/.test(row)) return fail('Row ' + (y + 1) + ' is invalid.');
      for (var x = 0; x < d.w; x++) g[y * d.w + x] = row.charAt(x) === '#' ? 1 : 0;
    }
    var seed = 0;
    if (o.seed !== undefined) {
      if (!isInt(o.seed) || o.seed < 0 || o.seed > 4294967295) return fail('Invalid seed.');
      seed = o.seed;
    }
    function pt(p, label) {
      if (!Array.isArray(p) || p.length !== 2 || !isInt(p[0]) || !isInt(p[1]) ||
          p[0] < 0 || p[1] < 0 || p[0] >= d.w || p[1] >= d.h) return null;
      return { x: p[0], y: p[1] };
    }
    var st = pt(o.start), ex = pt(o.exit);
    if (!st) return fail('Invalid start position.');
    if (!ex) return fail('Invalid exit position.');
    if (g[st.y * d.w + st.x] || g[ex.y * d.w + ex.x]) return fail('Start and exit tiles must be cleared.');
    if (st.x === ex.x && st.y === ex.y) return fail('Start and exit must differ.');
    var tr = null;
    if (o.tractor !== undefined) {
      tr = pt(o.tractor);
      if (!tr) return fail('Invalid tractor position.');
    }
    var s = createState({ size: o.size, season: o.season, animal: o.animal, seed: seed, name: o.name,
      grid: g, start: st, exit: ex });
    if (tr) { s.tractor.x = tr.x; s.tractor.y = tr.y; }
    return { ok: true, state: s };
  }

  var core = {
    FORMAT: FORMAT, VERSION: VERSION, MAX_UNDO: MAX_UNDO, MAX_JSON: MAX_JSON, MAX_NAME: MAX_NAME,
    SIZES: SIZES, SEASONS: SEASONS, ANIMALS: ANIMALS, DIRS: DIRS,
    mulberry32: mulberry32, cleanName: cleanName, generateMaze: generateMaze, newMaze: newMaze, newBlank: newBlank,
    createState: createState, resetRun: resetRun, beginStroke: beginStroke, endStroke: endStroke,
    moveTractor: moveTractor, carveTo: carveTo, moveRunner: moveRunner, runTo: runTo, undo: undo,
    regenerate: regenerate, replant: replant, findPath: findPath, isSolvable: isSolvable, counts: counts,
    serialize: serialize, stringify: stringify, parse: parse, inBounds: inBounds
  };
  root.CornfieldCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;

  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  /* ===================================================================
   * PART 2 - RENDERING + CONTROLLER (browser)
   * =================================================================== */
  var TAU = Math.PI * 2;

  var PAL = {
    spring: { sky: ['#dcefe4', '#f8f0da'], hill: ['#bddaa9', '#a6cb94'], soil: '#7b5b45', path: '#ead6ab',
      tray: '#e6d5ae', trayDark: '#b9a37a', corn: ['#e2f2a8', '#aed26f', '#6f9f47'], leaf: '#78ad55', kernel: '#f7e98f', flower: '#f4a8bd' },
    summer: { sky: ['#fde6b4', '#fbf3e4'], hill: ['#e8d390', '#d8bf6e'], soil: '#704f3a', path: '#ebd2a1',
      tray: '#ead6a8', trayDark: '#bca06f', corn: ['#fbe795', '#ebbc4d', '#b88525'], leaf: '#8cb04f', kernel: '#fff0a8' },
    autumn: { sky: ['#f6d4ac', '#f8eadb'], hill: ['#e1aa6c', '#cd8c4e'], soil: '#6b4533', path: '#deba8a',
      tray: '#e4cba1', trayDark: '#b08e62', corn: ['#f6bb69', '#dc8439', '#a45522'], leaf: '#b9772f', kernel: '#fbd78c' },
    winter: { sky: ['#d8e6f1', '#f5f8fb'], hill: ['#ebf0f6', '#d3dfea'], soil: '#7c6a66', path: '#f2f6fa',
      tray: '#e9e2d6', trayDark: '#b3a894', corn: ['#f0f3da', '#c8d4a8', '#90a782'], leaf: '#9db599', kernel: '#ffffff' }
  };
  var ORG = 0.8; // tile origin inside the layer, in tiles

  function mix(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  function hash(x, y, s) {
    var h = (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663) ^ Math.imul((s | 0) + 7, 83492791)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return h;
  }
  function rr(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function flat(g, x, y, rx, ry, c, rot) {
    g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(rx, ry);
    g.fillStyle = c; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
  }
  function ball(g, x, y, rx, ry, c, rot) {
    g.save(); g.translate(x, y); if (rot) g.rotate(rot); g.scale(rx, ry);
    var gr = g.createRadialGradient(-0.3, -0.35, 0.05, 0, 0, 1.05);
    gr.addColorStop(0, mix(c, 0.28)); gr.addColorStop(0.6, c); gr.addColorStop(1, mix(c, -0.2));
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
  }
  function poly(g, pts, c) {
    g.fillStyle = c; g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath(); g.fill();
  }

  /* ---- corn: scalloped, bulbous matte toy cluster ---- */
  function drawCornSprite(g, pal, t, rnd, season) {
    var c = t * 0.6, i;
    var sh = g.createRadialGradient(c, c + 0.3 * t, 0, c, c + 0.3 * t, 0.5 * t);
    sh.addColorStop(0, 'rgba(40,25,10,0.34)'); sh.addColorStop(1, 'rgba(40,25,10,0)');
    g.save(); g.translate(c, c + 0.3 * t); g.scale(1, 0.38); g.translate(-c, -(c + 0.3 * t));
    g.fillStyle = sh; g.beginPath(); g.arc(c, c + 0.3 * t, 0.5 * t, 0, TAU); g.fill(); g.restore();
    // back leaves
    for (i = -1; i <= 1; i += 2) {
      flat(g, c + i * 0.3 * t, c - 0.04 * t, 0.07 * t, 0.26 * t, mix(pal.leaf, -0.12), i * 0.5);
      flat(g, c + i * 0.17 * t, c - 0.2 * t, 0.06 * t, 0.2 * t, pal.leaf, i * 0.25);
    }
    var base = [[-0.2, -0.13], [0.2, -0.13], [0, -0.04], [-0.2, 0.14], [0.2, 0.14], [0, 0.2]], blobs = [];
    for (i = 0; i < base.length; i++) {
      blobs.push({ x: c + (base[i][0] + (rnd() - 0.5) * 0.08) * t, y: c + (base[i][1] + (rnd() - 0.5) * 0.07) * t,
        r: (0.26 + rnd() * 0.04) * t });
    }
    blobs.sort(function (a, b) { return a.y - b.y; });
    for (i = 0; i < blobs.length; i++) {
      var b = blobs[i];
      var gr = g.createRadialGradient(b.x - 0.3 * b.r, b.y - 0.38 * b.r, 0.05 * b.r, b.x, b.y, b.r * 1.05);
      gr.addColorStop(0, pal.corn[0]); gr.addColorStop(0.55, pal.corn[1]); gr.addColorStop(1, pal.corn[2]);
      g.fillStyle = gr; g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill();
      g.fillStyle = pal.kernel; g.globalAlpha = 0.45;
      for (var k = 0; k < 4; k++) {
        g.beginPath();
        g.arc(b.x + (rnd() - 0.5) * b.r * 0.9, b.y - b.r * 0.15 + (rnd() - 0.5) * b.r * 0.7, 0.035 * t, 0, TAU);
        g.fill();
      }
      g.globalAlpha = 1;
      if (season === 'winter') {
        g.save(); g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.clip();
        var fg = g.createRadialGradient(b.x - 0.1 * b.r, b.y - 0.55 * b.r, 0, b.x, b.y - 0.35 * b.r, 0.8 * b.r);
        fg.addColorStop(0, 'rgba(255,255,255,0.95)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = fg; g.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); g.restore();
      } else if (season === 'spring' && rnd() < 0.5) {
        flat(g, b.x + (rnd() - 0.5) * b.r, b.y - 0.1 * b.r, 0.05 * t, 0.05 * t, pal.flower);
      }
    }
  }

  var spriteCache = {};
  function getSprites(season, t, dpr) {
    var key = season + '|' + t + '|' + dpr;
    if (spriteCache[key]) return spriteCache[key];
    var list = [], size = Math.ceil(t * 1.2 * dpr);
    for (var v = 0; v < 6; v++) {
      var cv = document.createElement('canvas'); cv.width = cv.height = size;
      var g = cv.getContext('2d'); g.scale(dpr, dpr);
      drawCornSprite(g, PAL[season], t, mulberry32(v * 977 + 13), season);
      list.push(cv);
    }
    spriteCache = {}; // keep a single entry
    spriteCache[key] = list;
    return list;
  }

  /** Static diorama layer: tray, soil, paths, corn. Returns {canvas, w, h} in css px. */
  function buildLayer(s, season, t, dpr) {
    var pal = PAL[season], LW = (s.w + 2 * ORG) * t, LH = (s.h + 2 * ORG + 0.4) * t;
    var cv = document.createElement('canvas');
    cv.width = Math.ceil(LW * dpr); cv.height = Math.ceil(LH * dpr);
    var g = cv.getContext('2d'); g.scale(dpr, dpr);
    var x0 = 0.3 * t, y0 = 0.3 * t, pw = LW - 0.6 * t, ph = (s.h + 2 * ORG - 0.6) * t, depth = 0.4 * t, rad = 0.5 * t;
    // tray: side + drop shadow, then top
    g.save(); g.shadowColor = 'rgba(70,45,20,0.35)'; g.shadowBlur = 0.45 * t; g.shadowOffsetY = 0.22 * t;
    rr(g, x0, y0 + depth, pw, ph, rad); g.fillStyle = pal.trayDark; g.fill(); g.restore();
    rr(g, x0, y0 + depth * 0.5, pw, ph, rad); g.fillStyle = mix(pal.trayDark, -0.08); g.fill();
    var tg = g.createLinearGradient(0, y0, 0, y0 + ph);
    tg.addColorStop(0, mix(pal.tray, 0.25)); tg.addColorStop(1, pal.tray);
    rr(g, x0, y0, pw, ph, rad); g.fillStyle = tg; g.fill();
    // soil bed
    var fx = ORG * t, fy = ORG * t, fw = s.w * t, fh = s.h * t;
    g.save(); rr(g, fx - 0.06 * t, fy - 0.06 * t, fw + 0.12 * t, fh + 0.12 * t, 0.22 * t);
    g.fillStyle = mix(pal.soil, -0.25); g.fill(); g.restore();
    rr(g, fx, fy, fw, fh, 0.16 * t); g.fillStyle = pal.soil; g.fill();
    g.save(); rr(g, fx, fy, fw, fh, 0.16 * t); g.clip();
    var x, y, i;
    // paths
    for (y = 0; y < s.h; y++) {
      for (x = 0; x < s.w; x++) {
        if (s.grid[y * s.w + x]) continue;
        var px = fx + x * t, py = fy + y * t;
        g.fillStyle = pal.path; g.fillRect(px - 0.5, py - 0.5, t + 1, t + 1);
        var hh = hash(x, y, 5);
        g.fillStyle = 'rgba(120,85,50,0.12)';
        g.beginPath(); g.arc(px + ((hh & 255) / 255) * t, py + (((hh >> 8) & 255) / 255) * t, 0.04 * t, 0, TAU); g.fill();
        g.beginPath(); g.arc(px + (((hh >> 16) & 255) / 255) * t, py + (((hh >> 24) & 255) / 255) * t, 0.03 * t, 0, TAU); g.fill();
      }
    }
    // soft edge shadows where paths meet corn
    var ew = 0.22 * t;
    for (y = 0; y < s.h; y++) {
      for (x = 0; x < s.w; x++) {
        if (s.grid[y * s.w + x]) continue;
        var qx = fx + x * t, qy = fy + y * t, side;
        for (i = 0; i < 4; i++) {
          var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
          if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h || !s.grid[ny * s.w + nx]) continue;
          var ax = qx + (DIRS[i][0] > 0 ? t : DIRS[i][0] < 0 ? 0 : t / 2), ay = qy + (DIRS[i][1] > 0 ? t : DIRS[i][1] < 0 ? 0 : t / 2);
          var lg = g.createLinearGradient(ax, ay, ax - DIRS[i][0] * ew, ay - DIRS[i][1] * ew);
          lg.addColorStop(0, 'rgba(70,40,20,0.28)'); lg.addColorStop(1, 'rgba(70,40,20,0)');
          g.fillStyle = lg;
          if (i === 0) g.fillRect(qx + t - ew, qy, ew, t);
          else if (i === 2) g.fillRect(qx, qy, ew, t);
          else if (i === 1) g.fillRect(qx, qy + t - ew, t, ew);
          else g.fillRect(qx, qy, t, ew);
        }
      }
    }
    g.restore();
    // corn
    var sprites = getSprites(season, t, dpr), pad = 0.1 * t, sz = t * 1.2;
    for (y = 0; y < s.h; y++) {
      for (x = 0; x < s.w; x++) {
        if (!s.grid[y * s.w + x]) continue;
        g.drawImage(sprites[hash(x, y, s.seed) % 6], fx + x * t - pad, fy + y * t - pad, sz, sz);
      }
    }
    return { canvas: cv, w: LW, h: LH };
  }

  /* ---- toy tractor (top-down, faces right, rotated by caller) ---- */
  function drawTractor(g, cx, cy, t, dir, phase) {
    g.save(); g.translate(cx, cy); g.rotate(dir * Math.PI / 2); g.scale(t, t);
    g.fillStyle = 'rgba(40,25,10,0.2)'; rr(g, -0.4, -0.3, 0.88, 0.7, 0.14); g.fill();
    function wheel(x, y, w, h) {
      g.fillStyle = '#4c403a'; rr(g, x, y, w, h, 0.05); g.fill();
      g.strokeStyle = '#6d5e55'; g.lineWidth = 0.02;
      for (var k = 0; k < 4; k++) {
        var tx = x + ((k + phase * 4) % 4) / 4 * w;
        g.beginPath(); g.moveTo(tx, y + 0.01); g.lineTo(tx, y + h - 0.01); g.stroke();
      }
    }
    wheel(-0.4, -0.47, 0.3, 0.17); wheel(-0.4, 0.3, 0.3, 0.17);
    wheel(0.2, -0.38, 0.19, 0.11); wheel(0.2, 0.27, 0.19, 0.11);
    var bg = g.createLinearGradient(0, -0.25, 0, 0.25);
    bg.addColorStop(0, '#f08b72'); bg.addColorStop(1, '#d4573f');
    g.fillStyle = bg; rr(g, -0.36, -0.25, 0.42, 0.5, 0.09); g.fill();
    var hg = g.createLinearGradient(0, -0.17, 0, 0.17);
    hg.addColorStop(0, '#f6a58f'); hg.addColorStop(1, '#e06a50');
    g.fillStyle = hg; rr(g, 0.0, -0.17, 0.42, 0.34, 0.09); g.fill();
    g.fillStyle = '#fbf1de'; rr(g, -0.31, -0.18, 0.28, 0.36, 0.07); g.fill();
    g.fillStyle = '#c9d8d3'; rr(g, -0.12, -0.14, 0.07, 0.28, 0.03); g.fill();
    g.fillStyle = '#fbe58a';
    g.beginPath(); g.arc(0.42, -0.1, 0.035, 0, TAU); g.arc(0.42, 0.1, 0.035, 0, TAU); g.fill();
    g.fillStyle = '#4c403a'; g.beginPath(); g.arc(0.2, 0, 0.035, 0, TAU); g.fill();
    g.restore();
  }

  /* ---- six toy animals (front-facing, upright) ---- */
  var ANI_BODY = { dog: '#d9a86c', cat: '#e8a259', cow: '#fbf7ee', horse: '#a8683c', pig: '#f6aebb', chicken: '#fffaf0' };
  var ANI_FOOT = { dog: '#8a5a35', cat: '#c47a36', cow: '#f3b3b3', horse: '#4b2f20', pig: '#ee93a6', chicken: '#f0a030' };

  function drawAnimal(g, kind, cx, cy, r) {
    g.save(); g.translate(cx, cy);
    var H = 0.62 * r, hy = -0.14 * r, body = ANI_BODY[kind];
    flat(g, 0, 0.93 * r, 0.62 * r, 0.14 * r, 'rgba(40,25,10,0.25)');
    flat(g, -0.28 * r, 0.86 * r, 0.16 * r, 0.1 * r, ANI_FOOT[kind]);
    flat(g, 0.28 * r, 0.86 * r, 0.16 * r, 0.1 * r, ANI_FOOT[kind]);
    ball(g, 0, 0.5 * r, (kind === 'chicken' ? 0.62 : 0.56) * r, 0.42 * r, body);
    function X(v) { return v * H; }
    function Y(v) { return hy + v * H; }
    function eyes(ex, ey, s) {
      for (var i = -1; i <= 1; i += 2) {
        flat(g, X(i * ex), Y(ey), 0.1 * H * s, 0.12 * H * s, '#2b211c');
        flat(g, X(i * ex) - 0.03 * H, Y(ey) - 0.04 * H, 0.035 * H, 0.04 * H, '#ffffff');
      }
    }
    var i;
    if (kind === 'dog') {
      for (i = -1; i <= 1; i += 2) ball(g, X(i * 0.85), Y(-0.05), 0.3 * H, 0.55 * H, '#8a5a35', -i * 0.25);
      ball(g, 0, hy, H, H * 0.96, body);
      flat(g, X(0.4), Y(-0.2), 0.3 * H, 0.3 * H, '#9a6a3e');
      ball(g, 0, Y(0.34), 0.5 * H, 0.36 * H, '#f6e6c8');
      flat(g, 0, Y(0.62), 0.12 * H, 0.14 * H, '#e8708a');
      ball(g, 0, Y(0.2), 0.17 * H, 0.12 * H, '#3b2a22');
      eyes(0.36, -0.12, 1);
    } else if (kind === 'cat') {
      for (i = -1; i <= 1; i += 2) {
        poly(g, [X(i * 0.97), Y(-0.2), X(i * 0.72), Y(-1.15), X(i * 0.22), Y(-0.82)], body);
        poly(g, [X(i * 0.82), Y(-0.38), X(i * 0.7), Y(-0.94), X(i * 0.42), Y(-0.78)], '#f3b3b3');
      }
      ball(g, 0, hy, H, H * 0.92, body);
      g.strokeStyle = '#b86d2a'; g.lineWidth = 0.06 * H; g.lineCap = 'round';
      for (i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(X(i * 0.22), Y(-0.9)); g.lineTo(X(i * 0.22), Y(-0.58)); g.stroke(); }
      ball(g, 0, Y(0.32), 0.34 * H, 0.25 * H, '#fbe6cc');
      poly(g, [X(-0.1), Y(0.18), X(0.1), Y(0.18), 0, Y(0.3)], '#e57f93');
      g.strokeStyle = 'rgba(60,40,30,0.55)'; g.lineWidth = 0.025 * H;
      for (i = -1; i <= 1; i += 2) {
        g.beginPath(); g.moveTo(X(i * 0.3), Y(0.34)); g.lineTo(X(i * 1.0), Y(0.2));
        g.moveTo(X(i * 0.3), Y(0.4)); g.lineTo(X(i * 1.0), Y(0.46)); g.stroke();
      }
      eyes(0.4, -0.12, 1);
    } else if (kind === 'cow') {
      for (i = -1; i <= 1; i += 2) {
        ball(g, X(i * 0.55), Y(-0.98), 0.14 * H, 0.2 * H, '#efe0b8', i * 0.4);
        ball(g, X(i * 1.0), Y(-0.45), 0.34 * H, 0.18 * H, '#fbf7ee', i * 0.3);
        flat(g, X(i * 1.03), Y(-0.45), 0.2 * H, 0.09 * H, '#f3b3b3', i * 0.3);
      }
      flat(g, -0.22 * r, 0.45 * r, 0.2 * r, 0.14 * r, '#3a3532', 0.4);
      ball(g, 0, hy, H, H * 0.98, '#fbf7ee');
      flat(g, X(-0.52), Y(-0.38), 0.36 * H, 0.32 * H, '#3a3532', 0.4);
      ball(g, 0, Y(0.42), 0.62 * H, 0.4 * H, '#f3b3b3');
      for (i = -1; i <= 1; i += 2) flat(g, X(i * 0.22), Y(0.44), 0.06 * H, 0.09 * H, '#b5686c');
      eyes(0.42, -0.14, 1);
    } else if (kind === 'horse') {
      ball(g, 0, Y(-0.7), 0.36 * H, 0.5 * H, '#4b2f20');
      for (i = -1; i <= 1; i += 2) {
        poly(g, [X(i * 0.82), Y(-0.45), X(i * 0.62), Y(-1.28), X(i * 0.28), Y(-0.75)], '#a8683c');
        poly(g, [X(i * 0.66), Y(-0.6), X(i * 0.6), Y(-1.0), X(i * 0.4), Y(-0.75)], '#d9a07a');
      }
      ball(g, 0, hy + 0.02 * r, 0.86 * H, 1.04 * H, '#a8683c');
      flat(g, 0, Y(0.0), 0.13 * H, 0.58 * H, '#f7ead6');
      ball(g, 0, Y(0.64), 0.5 * H, 0.34 * H, '#c99468');
      for (i = -1; i <= 1; i += 2) flat(g, X(i * 0.2), Y(0.68), 0.06 * H, 0.09 * H, '#5a3a28');
      ball(g, 0, Y(-0.66), 0.3 * H, 0.2 * H, '#4b2f20');
      eyes(0.42, -0.12, 0.95);
    } else if (kind === 'pig') {
      for (i = -1; i <= 1; i += 2) poly(g, [X(i * 0.95), Y(-0.1), X(i * 0.4), Y(-0.9), X(i * 1.12), Y(-0.78)], '#ee93a6');
      ball(g, 0, hy, H, H * 0.94, body);
      for (i = -1; i <= 1; i += 2) flat(g, X(i * 0.66), Y(0.22), 0.17 * H, 0.1 * H, 'rgba(240,120,140,0.5)');
      ball(g, 0, Y(0.32), 0.48 * H, 0.34 * H, '#f08ea5');
      for (i = -1; i <= 1; i += 2) flat(g, X(i * 0.17), Y(0.33), 0.07 * H, 0.1 * H, '#a8465f');
      eyes(0.45, -0.12, 0.9);
    } else { // chicken
      for (i = -1; i <= 1; i++) ball(g, X(i * 0.3), Y(-1.0 - (i === 0 ? 0.12 : 0)), 0.22 * H, 0.24 * H, '#e2453c');
      ball(g, 0, hy, H, H * 0.96, body);
      for (i = -1; i <= 1; i += 2) ball(g, i * 0.45 * r, 0.5 * r, 0.18 * r, 0.3 * r, '#efe7d6', -i * 0.3);
      ball(g, 0, Y(0.58), 0.12 * H, 0.17 * H, '#e2453c');
      poly(g, [X(-0.22), Y(0.1), X(0.22), Y(0.1), 0, Y(0.5)], '#f0a030');
      eyes(0.44, -0.18, 1);
    }
    g.restore();
  }

  function drawFlag(g, cx, cy, t, time) {
    g.save(); g.translate(cx, cy);
    flat(g, 0, 0.36 * t, 0.2 * t, 0.07 * t, 'rgba(40,25,10,0.25)');
    g.strokeStyle = '#7b5b45'; g.lineWidth = 0.06 * t; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-0.12 * t, 0.36 * t); g.lineTo(-0.12 * t, -0.42 * t); g.stroke();
    var w = Math.sin(time * 5) * 0.05 * t;
    g.fillStyle = '#e8735a'; g.beginPath();
    g.moveTo(-0.1 * t, -0.42 * t); g.quadraticCurveTo(0.15 * t, -0.42 * t + w, 0.4 * t, -0.3 * t + w * 1.4);
    g.quadraticCurveTo(0.15 * t, -0.2 * t + w, -0.1 * t, -0.14 * t); g.closePath(); g.fill();
    g.restore();
  }

  /* ---- backgrounds ---- */
  function drawBackdrop(g, W, H, pal, time) {
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, pal.sky[0]); bg.addColorStop(1, pal.sky[1]);
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (var k = 0; k < 2; k++) {
      g.fillStyle = pal.hill[k]; g.beginPath(); g.moveTo(0, H);
      for (var x = 0; x <= W; x += 20) g.lineTo(x, H * (0.82 + k * 0.08) - Math.sin(x / (110 + k * 60) + k * 2) * H * 0.04);
      g.lineTo(W, H); g.closePath(); g.fill();
    }
  }

  /* ---------------------------------------------------------------
   * Controller
   * --------------------------------------------------------------- */
  var KEY = 'cornfield-carver:v1', BEST_KEY = 'cornfield-carver:best:v1';
  function $(id) { return document.getElementById(id); }

  function boot() {
    var canvas = $('field'), ctx = canvas.getContext('2d');
    var S = null;
    var ui = {
      mode: 'carve', view: 'auto', dpr: 1, cw: 0, ch: 0, t: 24, close: false, layer: null, layerDirty: true,
      ox: 0, oy: 0, vt: { x: 0, y: 0 }, vr: { x: 0, y: 0 }, particles: [], ambient: [], hint: null,
      startedAt: null, elapsed: 0, running: false, held: null, nextStep: 0, pointer: null, strokeTimer: 0,
      lastHud: '', saveTimer: 0, phase: 0, modal: null, lastFocus: null, confirmResolve: null, winShown: false
    };

    /* ---- storage ---- */
    function store(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function bests() {
      try { var b = JSON.parse(load(BEST_KEY) || '{}'); return b && typeof b === 'object' ? b : {}; } catch (e) { return {}; }
    }
    function scheduleSave() {
      $('save-status').textContent = 'Saving...';
      clearTimeout(ui.saveTimer);
      ui.saveTimer = setTimeout(function () {
        var ok = store(KEY, core.stringify(S, { tractor: true }));
        $('save-status').textContent = ok ? 'Autosaved on this device' : 'Autosave unavailable in this browser';
      }, 350);
    }

    /* ---- helpers ---- */
    function say(msg) {
      var el = $('toast'); el.textContent = msg; el.classList.add('show');
      clearTimeout(say.t); say.t = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }
    function fmt(ms) {
      var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
      return m + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }
    function randSeed() { return Math.floor(Math.random() * 4294967296) >>> 0; }
    function randomAnimal() { return core.ANIMALS[Math.floor(Math.random() * 6)]; }

    function syncActors() {
      ui.vt.x = S.tractor.x; ui.vt.y = S.tractor.y; ui.vr.x = S.run.x; ui.vr.y = S.run.y;
    }
    function resetTimer() { ui.startedAt = null; ui.elapsed = 0; ui.running = false; ui.winShown = false; $('win').hidden = true; }
    function changed() { ui.layerDirty = true; ui.hint = null; scheduleSave(); updatePanel(); }
    function useState(ns, keepRun) {
      S = ns; resetTimer(); syncActors(); ui.layerDirty = true; ui.hint = null; computeLayout(true); updatePanel();
    }

    /* ---- layout ---- */
    function computeLayout(snap) {
      var r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      ui.dpr = dpr; ui.cw = Math.max(100, r.width); ui.ch = Math.max(100, r.height);
      canvas.width = Math.round(ui.cw * dpr); canvas.height = Math.round(ui.ch * dpr);
      var fit = Math.floor(Math.min(ui.cw / (S.w + 2 * ORG), ui.ch / (S.h + 2 * ORG + 0.4)));
      ui.close = ui.view === 'close' || (ui.view === 'auto' && fit < 22);
      ui.t = ui.close ? Math.max(fit, 38) : Math.max(8, fit);
      ui.layerDirty = true;
      if (snap) ui.snapCam = true;
    }
    function updateViewButton() {
      var fit = ui.close ? 'Close-up view' : 'Whole field';
      $('btn-view').textContent = 'View: ' + fit;
    }

    /* ---- panel ---- */
    function mark(group, attr, val) {
      var bs = $(group).querySelectorAll('button');
      for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', bs[i].getAttribute(attr) === val ? 'true' : 'false');
    }
    function updatePanel() {
      document.body.setAttribute('data-season', S.season);
      mark('size-group', 'data-size', S.size); mark('season-group', 'data-season', S.season);
      mark('animal-group', 'data-animal', S.animal);
      if ($('creation-name') !== document.activeElement) $('creation-name').value = S.name;
      $('btn-undo').disabled = S.history.length === 0;
      $('btn-undo2').disabled = S.history.length === 0;
      mark('mode-group', 'data-mode', ui.mode);
      document.body.setAttribute('data-mode', ui.mode);
      updateViewButton();
    }
    function updateHud(now) {
      var el = ui.running ? now - ui.startedAt : ui.elapsed, c = core.counts(S);
      var route = core.isSolvable(S) ? 'Open' : 'Not yet';
      var sig = Math.floor(el / 1000) + '|' + S.run.moves + '|' + c.corn + '|' + route;
      if (sig === ui.lastHud) return;
      ui.lastHud = sig;
      $('hud-time').textContent = fmt(el);
      $('hud-moves').textContent = S.run.moves;
      $('hud-corn').textContent = c.corn;
      $('hud-route').textContent = route;
      $('hud-route').parentNode.setAttribute('data-ok', route === 'Open' ? '1' : '0');
    }

    /* ---- particles ---- */
    function burst(x, y, kind, n) {
      var pal = PAL[S.season];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * TAU, sp = 0.8 + Math.random() * 2;
        ui.particles.push({ x: x + 0.5, y: y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (kind === 'confetti' ? 2.5 : 0.6),
          life: 0.6 + Math.random() * 0.6, max: 1.2, kind: kind, rot: Math.random() * TAU,
          c: kind === 'confetti' ? ['#e8735a', '#f6c453', '#8fb28a', '#6aa6c7', '#f4a8bd'][i % 5] : (i % 2 ? pal.corn[1] : pal.leaf) });
      }
    }
    function seedAmbient() {
      ui.ambient = [];
      for (var i = 0; i < 26; i++) ui.ambient.push({ x: Math.random(), y: Math.random(), s: 0.5 + Math.random(), p: Math.random() * TAU });
    }

    /* ---- audio (optional; see audio.js) ---- */
    var audio = window.CornfieldAudio;
    function sound(name) { if (audio && audio[name]) audio[name](); }
    function syncAudioButtons() {
      if (!audio) return;
      [['btn-music', 'Music', audio.music()], ['btn-sfx', 'Sounds', audio.sfx()]].forEach(function (b) {
        var el = $(b[0]);
        el.setAttribute('aria-pressed', b[2] ? 'true' : 'false');
        el.textContent = b[1] + ': ' + (b[2] ? 'On' : 'Off');
      });
    }
    function wireAudio() {
      if (!audio || !audio.supported) {
        $('btn-music').disabled = true; $('btn-sfx').disabled = true;
        $('audio-note').hidden = false;
        return;
      }
      $('btn-music').addEventListener('click', function () { audio.setMusic(!audio.music()); });
      $('btn-sfx').addEventListener('click', function () { audio.setSfx(!audio.sfx()); });
      audio.onChange(syncAudioButtons);
      syncAudioButtons();
    }
    wireAudio();

    /* ---- actions ---- */
    function startTimer() {
      if (ui.running) return;
      ui.startedAt = performance.now() - ui.elapsed; ui.running = true;
    }
    function victory() {
      ui.elapsed = performance.now() - ui.startedAt; ui.running = false;
      var b = bests(), key = S.size, prev = b[key], newBest = !prev || ui.elapsed < prev;
      if (newBest) { b[key] = Math.round(ui.elapsed); store(BEST_KEY, JSON.stringify(b)); }
      $('win-title').textContent = 'Harvest home!';
      $('win-time').textContent = fmt(ui.elapsed);
      $('win-moves').textContent = S.run.moves;
      $('win-best').textContent = fmt(b[key]) + (newBest ? ' (new!)' : '');
      $('win-text').textContent = 'Your ' + S.animal + ' made it through "' + S.name + '".';
      $('win').hidden = false; ui.winShown = true;
      burst(S.exit.x, S.exit.y, 'confetti', 60);
      sound('victory');
      say('Your ' + S.animal + ' reached the flag in ' + fmt(ui.elapsed) + '!');
      setTimeout(function () { var b2 = $('win-again'); if (b2 && !$('win').hidden) b2.focus(); }, 50);
    }
    function act(dx, dy) {
      if (ui.modal || ui.winShown) return;
      if (ui.mode === 'carve') {
        if (!S.strokeOpen) core.beginStroke(S);
        clearTimeout(ui.strokeTimer);
        ui.strokeTimer = setTimeout(function () { core.endStroke(S); }, 450);
        var r = core.moveTractor(S, dx, dy);
        if (r.carved) { burst(r.x, r.y, 'chaff', 5); changed(); sound('carve'); }
        else if (!r.moved) say('That is the edge of the field.');
      } else {
        var m = core.moveRunner(S, dx, dy);
        if (m.moved) {
          startTimer(); ui.hint = null;
          if (m.won) victory(); else sound('step');
        } else if (m.blocked) { ui.bump = 0.25; sound('bump'); }
      }
    }
    function setMode(m) {
      if (m === ui.mode) return;
      ui.mode = m;
      if (m === 'run' && S.run.won) { core.resetRun(S); resetTimer(); syncActors(); }
      ui.snapCam = false; updatePanel();
      say(m === 'run' ? 'Run mode: guide your ' + S.animal + ' to the flag.' : 'Carve mode: drive the tractor through the corn.');
    }
    function doUndo() {
      if (ui.winShown) { $('win').hidden = true; ui.winShown = false; }
      if (core.undo(S)) {
        syncActors(); resetTimer(); changed(); say('Undone.');
      } else say('Nothing to undo.');
    }
    function doReset() {
      core.resetRun(S); resetTimer(); syncActors(); ui.hint = null; updatePanel(); say('Runner back at the start.');
    }
    function doHint() {
      var p = core.findPath(S, S.run.x, S.run.y);
      if (S.run.won) { say('You already reached the flag!'); return; }
      if (!p) { say('No route yet. Carve a path from the start to the flag.'); return; }
      ui.hint = { path: p, until: performance.now() + 5000 };
      say(p.length + ' steps to the flag.');
    }
    function doGenerate() {
      confirmIf(S.dirty, 'Grow a new maze?', 'Your carved changes will be replaced by a freshly generated maze. You can still use Undo to bring them back.', 'Grow new maze', function () {
        core.regenerate(S, randSeed()); resetTimer(); syncActors(); changed(); say('A new maze has sprouted.');
      });
    }
    function doReplant() {
      confirmIf(core.counts(S).cleared > 2, 'Replant the whole field?', 'Every carved path will be filled with corn so you can design your own. You can still use Undo to bring it back.', 'Replant field', function () {
        core.replant(S); resetTimer(); syncActors(); changed(); say('Fresh corn everywhere. Drive the tractor to carve!');
        if (ui.mode !== 'carve') setMode('carve');
      });
    }
    function newField(size) {
      var ns = core.newMaze({ size: size, season: S.season, animal: S.animal, seed: randSeed(), name: S.name });
      useState(ns); scheduleSave(); say(core.SIZES[size].label + ': a new maze is ready.');
    }
    function confirmIf(cond, title, body, okLabel, fn) {
      if (!cond) { fn(); return; }
      ask(title, body, okLabel).then(function (yes) { if (yes) fn(); });
    }

    /* ---- modals ---- */
    function showModal(id) {
      hideModal(true);
      var m = $(id); m.hidden = false; ui.modal = m; ui.lastFocus = document.activeElement;
      var f = m.querySelector('[data-autofocus]') || m.querySelector('button, textarea, input');
      if (f) f.focus();
    }
    function hideModal(keepFocus) {
      if (!ui.modal) return;
      ui.modal.hidden = true; ui.modal = null;
      if (ui.confirmResolve) { var r = ui.confirmResolve; ui.confirmResolve = null; r(false); }
      if (!keepFocus && ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus();
    }
    function ask(title, body, okLabel) {
      $('confirm-title').textContent = title; $('confirm-body').textContent = body; $('confirm-ok').textContent = okLabel;
      return new Promise(function (resolve) { showModal('modal-confirm'); ui.confirmResolve = resolve; });
    }
    $('confirm-ok').addEventListener('click', function () {
      var r = ui.confirmResolve; ui.confirmResolve = null; hideModal(); if (r) r(true);
    });
    var closers = document.querySelectorAll('[data-close]');
    for (var ci = 0; ci < closers.length; ci++) closers[ci].addEventListener('click', function () { hideModal(); });

    /* ---- share / import ---- */
    function slug() { return (S.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cornfield'); }
    function download(blob, name) {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }
    function openShare() {
      var txt = JSON.stringify(core.serialize(S), null, 1);
      $('share-text').value = txt;
      $('share-note').textContent = core.isSolvable(S) ? 'This field is solvable. Send the file or paste the text to a friend.'
        : 'Heads up: this field has no route from start to flag yet.';
      showModal('modal-share');
    }
    $('share-download').addEventListener('click', function () {
      download(new Blob([$('share-text').value], { type: 'application/json' }), slug() + '.cornfield.json');
    });
    $('share-copy').addEventListener('click', function () {
      var ta = $('share-text');
      function fallback() { ta.focus(); ta.select(); try { document.execCommand('copy'); say('Copied.'); } catch (e) { say('Press Ctrl+C to copy.'); } }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(function () { say('Copied to clipboard.'); }, fallback);
      else fallback();
    });
    function openImport() {
      $('import-text').value = ''; $('import-error').textContent = ''; $('import-file').value = '';
      showModal('modal-import');
    }
    $('import-file').addEventListener('change', function () {
      var f = this.files && this.files[0];
      if (!f) return;
      if (f.size > core.MAX_JSON) { $('import-error').textContent = 'That file is too large to be a cornfield.'; return; }
      var rd = new FileReader();
      rd.onload = function () { $('import-text').value = String(rd.result); $('import-error').textContent = ''; };
      rd.onerror = function () { $('import-error').textContent = 'Could not read that file.'; };
      rd.readAsText(f);
    });
    $('import-load').addEventListener('click', function () {
      var res = core.parse($('import-text').value);
      if (!res.ok) { $('import-error').textContent = res.error; return; }
      hideModal(true);
      var apply = function () { useState(res.state); S.dirty = false; scheduleSave(); say('Loaded "' + S.name + '".'); };
      if (S.dirty) ask('Replace your current field?', 'Importing "' + res.state.name + '" replaces the field you are working on. Export it first if you want to keep it. This cannot be undone.', 'Replace field').then(function (y) { if (y) apply(); });
      else apply();
    });
    function exportPng() {
      var cv = document.createElement('canvas'), t = Math.max(14, Math.min(40, Math.floor(1040 / (S.w + 2 * ORG))));
      var layer = buildLayer(S, S.season, t, 1), pal = PAL[S.season];
      var W = Math.ceil(layer.w) + 120, hd = 120, H = Math.ceil(layer.h) + hd + 70;
      cv.width = W; cv.height = H;
      var g = cv.getContext('2d');
      drawBackdrop(g, W, H, pal, 0);
      g.fillStyle = '#3b3a33'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.font = 'bold 40px Georgia, "Times New Roman", serif'; g.fillText(S.name, W / 2, 60, W - 80);
      g.fillStyle = '#6d6b5f'; g.font = '20px system-ui, sans-serif';
      g.fillText(core.SIZES[S.size].label + ' · ' + S.season + ' · runner: ' + S.animal, W / 2, 94);
      var lx = 60, ly = hd;
      g.drawImage(layer.canvas, lx, ly, layer.w, layer.h);
      var o = ORG * t;
      drawFlag(g, lx + o + (S.exit.x + 0.5) * t, ly + o + (S.exit.y + 0.5) * t, t, 0);
      drawAnimal(g, S.animal, lx + o + (S.start.x + 0.5) * t, ly + o + (S.start.y + 0.5) * t, t * 0.45);
      g.fillStyle = '#6d6b5f'; g.font = '18px system-ui, sans-serif';
      g.fillText('Cornfield Carver · find the way to the flag', W / 2, H - 26);
      cv.toBlob(function (b) {
        if (b) { download(b, slug() + '.png'); say('Picture saved.'); } else say('Could not create the picture.');
      }, 'image/png');
    }

    /* ---- input ---- */
    var KEYS = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1],
      d: [1, 0], a: [-1, 0], s: [0, 1], w: [0, -1], D: [1, 0], A: [-1, 0], S: [0, 1], W: [0, -1] };
    function isTyping(e) {
      var n = e.target && e.target.tagName;
      return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT';
    }
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { if (ui.modal) { hideModal(); e.preventDefault(); } return; }
      if (ui.modal && e.key === 'Tab') {
        var f = ui.modal.querySelectorAll('button:not([disabled]), textarea, input'), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
        return;
      }
      if (ui.modal || isTyping(e) || e.altKey) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { doUndo(); e.preventDefault(); return; }
      if (e.ctrlKey || e.metaKey) return;
      var d = KEYS[e.key];
      if (d) {
        e.preventDefault();
        if (!e.repeat) { act(d[0], d[1]); ui.held = d; ui.nextStep = performance.now() + 190; }
        return;
      }
      var k = e.key.toLowerCase();
      if (e.repeat) return;
      if (k === 'u') doUndo();
      else if (k === 'h') doHint();
      else if (k === 'm') setMode(ui.mode === 'carve' ? 'run' : 'carve');
      else if (k === 'r') doReset();
    });
    window.addEventListener('keyup', function (e) {
      var d = KEYS[e.key];
      if (d && ui.held === d) ui.held = null;
    });
    window.addEventListener('blur', function () { ui.held = null; });

    var dp = document.querySelectorAll('.dpad-btn');
    dp.forEach(function (b) {
      var d = [parseInt(b.getAttribute('data-dx'), 10), parseInt(b.getAttribute('data-dy'), 10)];
      b.addEventListener('pointerdown', function (e) {
        e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
        act(d[0], d[1]); ui.held = d; ui.nextStep = performance.now() + 220;
      });
      var up = function () { if (ui.held === d) ui.held = null; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
      b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(d[0], d[1]); } });
    });

    function tileAt(e) {
      var r = canvas.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      return { x: Math.floor((px - ui.ox - ORG * ui.t) / ui.t), y: Math.floor((py - ui.oy - ORG * ui.t) / ui.t) };
    }
    function pointerAct(e) {
      var p = tileAt(e);
      if (!core.inBounds(S, p.x, p.y)) return;
      var a = ui.mode === 'carve' ? S.tractor : S.run, dist = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
      if (!ui.pointer.engaged) { if (dist <= (ui.pointer.fresh ? 3 : 2)) ui.pointer.engaged = true; else return; }
      if (ui.mode === 'carve') {
        var r = core.carveTo(S, p.x, p.y, 12);
        if (r.carved) { burst(S.tractor.x, S.tractor.y, 'chaff', 4); changed(); sound('carve'); }
      } else {
        var before = S.run.moves, n = core.runTo(S, p.x, p.y, 6);
        if (n) {
          startTimer(); ui.hint = null;
          if (S.run.won && S.run.moves !== before) victory(); else sound('step');
        }
      }
    }
    canvas.addEventListener('pointerdown', function (e) {
      if (ui.modal || ui.winShown) return;
      e.preventDefault(); canvas.focus();
      try { canvas.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      ui.pointer = { id: e.pointerId, engaged: false, fresh: true };
      if (ui.mode === 'carve') { clearTimeout(ui.strokeTimer); core.beginStroke(S); }
      pointerAct(e); ui.pointer.fresh = false;
    });
    canvas.addEventListener('pointermove', function (e) {
      if (ui.pointer && ui.pointer.id === e.pointerId) pointerAct(e);
    });
    function pointerEnd() {
      if (!ui.pointer) return;
      ui.pointer = null; core.endStroke(S); updatePanel();
    }
    canvas.addEventListener('pointerup', pointerEnd);
    canvas.addEventListener('pointercancel', pointerEnd);

    /* ---- panel wiring ---- */
    $('mode-carve').addEventListener('click', function () { setMode('carve'); });
    $('mode-run').addEventListener('click', function () { setMode('run'); });
    $('btn-undo').addEventListener('click', doUndo);
    $('btn-undo2').addEventListener('click', doUndo);
    $('btn-reset').addEventListener('click', doReset);
    $('btn-hint').addEventListener('click', doHint);
    $('btn-generate').addEventListener('click', doGenerate);
    $('btn-replant').addEventListener('click', doReplant);
    $('btn-view').addEventListener('click', function () {
      ui.view = ui.close ? 'fit' : 'close'; computeLayout(true); updateViewButton();
    });
    $('btn-export-json').addEventListener('click', openShare);
    $('btn-import').addEventListener('click', openImport);
    $('btn-png').addEventListener('click', exportPng);
    $('btn-help').addEventListener('click', function () { showModal('modal-help'); });
    $('win-again').addEventListener('click', function () { $('win').hidden = true; doReset(); setMode('run'); });
    $('win-new').addEventListener('click', function () {
      $('win').hidden = true; ui.winShown = false;
      core.regenerate(S, randSeed()); resetTimer(); syncActors(); changed(); setMode('run');
    });
    $('win-share').addEventListener('click', openShare);
    $('creation-name').addEventListener('input', function () { S.name = core.cleanName(this.value); scheduleSave(); });
    $('creation-name').addEventListener('blur', function () { this.value = S.name; });
    $('size-group').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var size = b.getAttribute('data-size');
      if (size === S.size) return;
      confirmIf(S.dirty, 'Switch field size?', 'A different size starts a new field and replaces your carved design. Export it first if you want to keep it. This cannot be undone.', 'Switch size', function () { newField(size); });
    });
    $('season-group').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.season = b.getAttribute('data-season'); ui.layerDirty = true; seedAmbient(); scheduleSave(); updatePanel();
      say(S.season.charAt(0).toUpperCase() + S.season.slice(1) + ' has arrived.');
    });
    $('animal-group').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.animal = b.getAttribute('data-animal'); scheduleSave(); updatePanel(); say('Your runner is now a ' + S.animal + '.');
    });
    // animal icons
    core.ANIMALS.forEach(function (a) {
      var b = document.querySelector('#animal-group [data-animal="' + a + '"]'), cv = b && b.querySelector('canvas');
      if (!cv) return;
      var d = Math.min(2, window.devicePixelRatio || 1), sz = 44;
      cv.width = cv.height = sz * d; var g = cv.getContext('2d'); g.scale(d, d);
      drawAnimal(g, a, sz / 2, sz / 2 - 1, sz * 0.4);
    });

    window.addEventListener('resize', function () { computeLayout(true); });
    if (window.ResizeObserver) new ResizeObserver(function () { computeLayout(true); }).observe(canvas.parentNode);

    /* ---- loop ---- */
    function spawnAmbient(g, pal, now) {
      var W = ui.cw, H = ui.ch, s = S.season, a, x, y;
      for (var i = 0; i < ui.ambient.length; i++) {
        a = ui.ambient[i];
        var tt = now / 1000;
        if (s === 'winter') { x = (a.x + Math.sin(tt * 0.5 + a.p) * 0.02) * W; y = ((a.y + tt * 0.03 * a.s) % 1) * H; flat(g, x, y, 2 + a.s * 1.5, 2 + a.s * 1.5, 'rgba(255,255,255,0.85)'); }
        else if (s === 'autumn') { x = ((a.x + tt * 0.015 * a.s + Math.sin(tt + a.p) * 0.02) % 1) * W; y = ((a.y + tt * 0.04 * a.s) % 1) * H; flat(g, x, y, 5 * a.s, 2.5 * a.s, i % 2 ? '#d98036' : '#c25d2e', tt + a.p); }
        else if (s === 'spring') { x = ((a.x + tt * 0.012 * a.s) % 1) * W; y = ((a.y + tt * 0.025 * a.s) % 1) * H; flat(g, x, y, 4 * a.s, 2.6 * a.s, 'rgba(244,168,189,0.9)', tt * 0.8 + a.p); }
        else { x = (a.x + Math.sin(tt * 0.3 + a.p) * 0.03) * W; y = (a.y + Math.cos(tt * 0.25 + a.p) * 0.03) * H; flat(g, x, y, 3 * a.s, 3 * a.s, 'rgba(255,240,170,' + (0.35 + 0.35 * Math.sin(tt * 2 + a.p)) + ')'); }
      }
    }

    var last = performance.now();
    function frame(now) {
      var dt = Math.min(0.05, (now - last) / 1000); last = now; ui.phase += dt;
      // held movement
      if (ui.held && now >= ui.nextStep && !ui.pointer) { act(ui.held[0], ui.held[1]); ui.nextStep = now + (ui.mode === 'carve' ? 125 : 105); }
      // smoothing
      var k = Math.min(1, dt * 16);
      ui.vt.x += (S.tractor.x - ui.vt.x) * k; ui.vt.y += (S.tractor.y - ui.vt.y) * k;
      ui.vr.x += (S.run.x - ui.vr.x) * k; ui.vr.y += (S.run.y - ui.vr.y) * k;
      if (ui.bump) ui.bump = Math.max(0, ui.bump - dt);
      var i, p;
      for (i = ui.particles.length - 1; i >= 0; i--) {
        p = ui.particles[i]; p.life -= dt; if (p.life <= 0) { ui.particles.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.kind === 'confetti' ? 4 : 3) * dt; p.rot += dt * 5;
      }
      if (ui.hint && now > ui.hint.until) ui.hint = null;
      draw(now, dt);
      updateHud(now);
      requestAnimationFrame(frame);
    }

    function draw(now, dt) {
      var g = ctx, dpr = ui.dpr, t = ui.t, pal = PAL[S.season], i, p;
      if (ui.layerDirty || !ui.layer) { ui.layer = buildLayer(S, S.season, t, dpr); ui.layerDirty = false; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBackdrop(g, ui.cw, ui.ch, pal, now);
      spawnAmbient(g, pal, now);
      var L = ui.layer, a = ui.mode === 'carve' ? ui.vt : ui.vr, tx, ty;
      if (L.w <= ui.cw) tx = (ui.cw - L.w) / 2; else tx = Math.min(0, Math.max(ui.cw - L.w, ui.cw / 2 - (ORG + a.x + 0.5) * t));
      if (L.h <= ui.ch) ty = (ui.ch - L.h) / 2; else ty = Math.min(0, Math.max(ui.ch - L.h, ui.ch / 2 - (ORG + a.y + 0.5) * t));
      if (ui.snapCam) { ui.ox = tx; ui.oy = ty; ui.snapCam = false; }
      else { var kk = Math.min(1, dt * 8); ui.ox += (tx - ui.ox) * kk; ui.oy += (ty - ui.oy) * kk; }
      g.drawImage(L.canvas, ui.ox, ui.oy, L.w, L.h);
      var o = ORG * t, bx = ui.ox + o, by = ui.oy + o;
      function cx(x) { return bx + (x + 0.5) * t; }
      function cy(y) { return by + (y + 0.5) * t; }
      // start gate ring + exit flag
      g.save(); g.strokeStyle = 'rgba(232,115,90,0.55)'; g.lineWidth = Math.max(1.5, t * 0.06); g.setLineDash([t * 0.12, t * 0.1]);
      g.beginPath(); g.arc(cx(S.start.x), cy(S.start.y), t * 0.42, 0, TAU); g.stroke(); g.restore();
      drawFlag(g, cx(S.exit.x), cy(S.exit.y), t, now / 1000);
      // hint
      if (ui.hint) {
        var left = ui.hint.until - now, n = Math.min(ui.hint.path.length, 12);
        for (i = 0; i < n; i++) {
          var hp = ui.hint.path[i], pulse = 0.5 + 0.5 * Math.sin(now / 160 - i * 0.6);
          g.fillStyle = 'rgba(255,255,255,' + Math.min(0.9, left / 600) * (0.45 + 0.4 * pulse) + ')';
          g.beginPath(); g.arc(cx(hp[0]), cy(hp[1]), t * (0.1 + 0.06 * pulse), 0, TAU); g.fill();
          g.strokeStyle = 'rgba(232,115,90,' + Math.min(0.9, left / 600) * 0.8 + ')'; g.lineWidth = 1.5; g.stroke();
        }
      }
      // actors, back to front
      var i2, bob = Math.sin(now / 140) * 0.03 * t;
      var movingR = Math.abs(S.run.x - ui.vr.x) + Math.abs(S.run.y - ui.vr.y) > 0.05;
      var jig = ui.bump ? Math.sin(ui.bump * 60) * 0.06 * t : 0;
      var list = [
        { y: ui.vt.y, f: function () { drawTractor(g, cx(ui.vt.x), cy(ui.vt.y), t, S.tractor.dir, (ui.vt.x + ui.vt.y) % 1); } },
        { y: ui.vr.y, f: function () { drawAnimal(g, S.animal, cx(ui.vr.x) + jig, cy(ui.vr.y) - 0.05 * t + (movingR ? bob : 0), t * 0.43); } }
      ];
      if (list[0].y > list[1].y) list.reverse();
      for (i2 = 0; i2 < list.length; i2++) list[i2].f();
      // particles
      for (i = 0; i < ui.particles.length; i++) {
        p = ui.particles[i];
        g.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
        if (p.kind === 'confetti') {
          g.save(); g.translate(bx + p.x * t, by + p.y * t); g.rotate(p.rot); g.fillStyle = p.c; g.fillRect(-4, -2, 8, 4); g.restore();
        } else flat(g, bx + p.x * t, by + p.y * t, t * 0.07, t * 0.05, p.c, p.rot);
      }
      g.globalAlpha = 1;
    }

    /* ---- start ---- */
    var saved = load(KEY), res = saved ? core.parse(saved) : null, st;
    if (res && res.ok) { st = res.state; st.dirty = true; }
    else st = core.newMaze({ size: 'medium', season: 'summer', animal: 'dog', seed: randSeed(), name: DEFAULT_NAME });
    S = st;
    seedAmbient();
    computeLayout(true);
    syncActors();
    updatePanel();
    $('save-status').textContent = res && res.ok ? 'Restored your last field' : 'Autosave on';
    if (!res || !res.ok) scheduleSave();
    if (!load('cornfield-carver:seen')) { store('cornfield-carver:seen', '1'); showModal('modal-help'); }
    requestAnimationFrame(frame);
    // test hook for smoke checks
    window.__cornfield = { state: function () { return S; }, core: core };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
