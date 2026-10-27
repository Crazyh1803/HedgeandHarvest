'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game.js');

const sizes = Object.keys(C.SIZES);
const mk = (size, season, seed) => C.newMaze({ size, season, animal: 'dog', seed, name: 't' });

test('generated mazes are solvable for every size, season and many seeds', () => {
  for (const size of sizes) {
    const d = C.SIZES[size];
    for (const season of C.SEASONS) {
      for (let seed = 1; seed <= 12; seed++) {
        const s = mk(size, season, seed * 7919);
        assert.equal(s.w, d.w); assert.equal(s.h, d.h);
        assert.equal(s.grid.length, d.w * d.h);
        assert.ok(C.isSolvable(s), `${size}/${season}/${seed} unsolvable`);
        const path = C.findPath(s, s.start.x, s.start.y);
        assert.ok(path.length >= d.w - 1, 'route should cross the field');
        assert.deepEqual(path[path.length - 1], [s.exit.x, s.exit.y]);
        assert.equal(s.grid[s.start.y * d.w + s.start.x], 0);
        assert.equal(s.grid[s.exit.y * d.w + s.exit.x], 0);
        assert.equal(s.start.x, 0); assert.equal(s.exit.x, d.w - 1);
        assert.ok(C.counts(s).corn > C.counts(s).cleared * 0.8 - d.w, 'mostly corn');
      }
    }
  }
});

test('maze generation is deterministic per seed and differs across seeds', () => {
  const a = mk('medium', 'autumn', 42), b = mk('medium', 'autumn', 42), c = mk('medium', 'autumn', 43);
  assert.deepEqual(Array.from(a.grid), Array.from(b.grid));
  assert.notDeepEqual(Array.from(a.grid), Array.from(c.grid));
});

test('JSON round trip preserves the full creation', () => {
  for (const size of sizes) {
    const s = mk(size, 'winter', 99);
    s.name = 'Grandma\'s "farm"'; s.animal = 'chicken';
    C.moveTractor(s, 0, 1);
    const r = C.parse(C.stringify(s, { tractor: true }));
    assert.ok(r.ok, r.error);
    const t = r.state;
    assert.deepEqual(Array.from(t.grid), Array.from(s.grid));
    assert.equal(t.name, s.name); assert.equal(t.animal, 'chicken'); assert.equal(t.season, 'winter');
    assert.equal(t.size, size); assert.equal(t.seed, 99);
    assert.deepEqual(t.start, s.start); assert.deepEqual(t.exit, s.exit);
    assert.deepEqual([t.tractor.x, t.tractor.y], [s.tractor.x, s.tractor.y]);
    assert.ok(C.isSolvable(t));
  }
});

test('import rejects malformed, hostile and out-of-range data', () => {
  const good = C.serialize(mk('small', 'spring', 5));
  const bad = (mut, label) => {
    const o = JSON.parse(JSON.stringify(good)); mut(o);
    const r = C.parse(JSON.stringify(o));
    assert.equal(r.ok, false, label);
    assert.equal(typeof r.error, 'string');
  };
  assert.equal(C.parse(undefined).ok, false);
  assert.equal(C.parse('').ok, false);
  assert.equal(C.parse('{nope').ok, false);
  assert.equal(C.parse('null').ok, false);
  assert.equal(C.parse('[]').ok, false);
  assert.equal(C.parse('"x"').ok, false);
  assert.equal(C.parse(' '.repeat(C.MAX_JSON + 1)).ok, false);
  bad(o => { o.format = 'other'; }, 'format');
  bad(o => { delete o.version; }, 'version missing');
  bad(o => { o.version = 99; }, 'future version');
  bad(o => { o.version = 1.5; }, 'fractional version');
  bad(o => { o.size = 'huge'; }, 'size');
  bad(o => { o.size = '__proto__'; }, 'proto size');
  bad(o => { o.season = 'monsoon'; }, 'season');
  bad(o => { o.animal = 'dragon'; }, 'animal');
  bad(o => { o.width = 16; }, 'width');
  bad(o => { o.height = 1000000; }, 'height');
  bad(o => { o.rows.pop(); }, 'row count');
  bad(o => { o.rows[0] = o.rows[0].slice(1); }, 'row length');
  bad(o => { o.rows[2] = 'x'.repeat(o.width); }, 'row chars');
  bad(o => { o.rows = 'abc'; }, 'rows type');
  bad(o => { o.rows[1] = 5; }, 'row type');
  bad(o => { o.start = [-1, 0]; }, 'start oob');
  bad(o => { o.start = [0.5, 1]; }, 'start fractional');
  bad(o => { o.start = [1, 1, 1]; }, 'start arity');
  bad(o => { o.exit = [999, 0]; }, 'exit oob');
  bad(o => { o.start = [1, 0]; o.rows[0] = '#'.repeat(o.width); }, 'start in corn');
  bad(o => { o.exit = o.start.slice(); }, 'same start/exit');
  bad(o => { o.seed = -1; }, 'seed negative');
  bad(o => { o.seed = 2 ** 40; }, 'seed too big');
  bad(o => { o.tractor = [500, 500]; }, 'tractor oob');
});

test('import never copies unknown fields and sanitises names', () => {
  const o = C.serialize(mk('small', 'summer', 3));
  o.name = '<img src=x onerror=alert(1)>\u0000' + 'z'.repeat(500);
  o.evil = { __proto__: { polluted: true } };
  const text = JSON.stringify(o).replace('"evil"', '"__proto__"');
  const r = C.parse(text);
  assert.ok(r.ok, r.error);
  assert.ok(!/[<>\u0000]/.test(r.state.name));
  assert.ok(r.state.name.length <= C.MAX_NAME);
  assert.equal(r.state.evil, undefined);
  assert.equal({}.polluted, undefined);
  assert.equal(C.parse(JSON.stringify(Object.assign(C.serialize(mk('small', 'summer', 3)), { name: 42 }))).state.name, 'My cornfield');
});

test('runner collides with corn and board edge, and wins at the exit', () => {
  const s = C.newBlank({ purpose: 'maze', size: 'small', season: 'summer', animal: 'pig', seed: 0, name: 'x' });
  // fully planted: start has corn on every side but the edge
  assert.deepEqual(C.moveRunner(s, 1, 0), { moved: false, blocked: true, won: false });
  assert.deepEqual(C.moveRunner(s, -1, 0), { moved: false, blocked: true, won: false });
  assert.equal(s.run.moves, 0);
  // carve a straight corridor to the exit
  for (let x = 0; x < s.w - 1; x++) C.moveTractor(s, 1, 0);
  assert.ok(C.isSolvable(s));
  let last;
  for (let x = 0; x < s.w - 1; x++) {
    assert.equal(s.run.won, false);
    last = C.moveRunner(s, 1, 0);
    assert.ok(last.moved);
  }
  assert.ok(last.won); assert.ok(s.run.won);
  assert.equal(s.run.moves, s.w - 1);
  assert.equal(C.moveRunner(s, -1, 0).moved, false, 'no moves after winning');
  C.resetRun(s);
  assert.deepEqual([s.run.x, s.run.y, s.run.moves, s.run.won], [0, s.start.y, 0, false]);
  assert.equal(C.moveRunner(s, 0, 1).blocked, true);
});

test('runTo slides toward a target and stops at corn', () => {
  const s = mk('small', 'summer', 11);
  const path = C.findPath(s, s.start.x, s.start.y);
  const n = C.runTo(s, path[2][0], path[2][1], 20);
  assert.ok(n >= 1);
  for (const [x, y] of [[s.run.x, s.run.y]]) assert.equal(s.grid[y * s.w + x], 0);
});

test('tractor carves corn, stays inside the field and undo restores everything', () => {
  const s = C.newBlank({ purpose: 'maze', size: 'small', season: 'autumn', animal: 'cow', seed: 0, name: 'x' });
  const before = Array.from(s.grid);
  assert.equal(C.moveTractor(s, -1, 0).moved, false);
  assert.equal(s.tractor.dir, 2);
  let r = C.moveTractor(s, 1, 0);
  assert.ok(r.moved && r.carved);
  r = C.moveTractor(s, 1, 0); assert.ok(r.carved);
  C.moveTractor(s, -1, 0); // revisit: nothing to carve
  assert.equal(C.counts(s).cleared, 2 + 2);
  assert.equal(s.history.length, 2, 'each carving keystroke is one step; revisits record nothing');
  assert.ok(s.dirty);
  assert.ok(C.undo(s));
  assert.equal(s.grid[s.start.y * s.w + 2], 1);
  assert.ok(C.undo(s));
  assert.deepEqual(Array.from(s.grid), before);
  assert.deepEqual([s.tractor.x, s.tractor.y], [s.start.x, s.start.y]);
});

test('undo of a carve under the runner returns the runner to the start', () => {
  const s = C.newBlank({ purpose: 'maze', size: 'small', season: 'autumn', animal: 'cow', seed: 0, name: 'x' });
  C.moveTractor(s, 1, 0);
  assert.ok(C.moveRunner(s, 1, 0).moved);
  C.undo(s);
  assert.deepEqual([s.run.x, s.run.y], [s.start.x, s.start.y]);
});

test('strokes coalesce into one undo step and carveTo drives the tractor', () => {
  const s = C.newBlank({ purpose: 'maze', size: 'medium', season: 'summer', animal: 'dog', seed: 0, name: 'x' });
  C.beginStroke(s);
  const r = C.carveTo(s, 5, s.start.y + 3);
  C.endStroke(s);
  assert.equal(r.steps, 8); assert.equal(r.carved, 8);
  assert.deepEqual([s.tractor.x, s.tractor.y], [5, s.start.y + 3]);
  assert.equal(s.history.length, 1);
  C.undo(s);
  assert.equal(C.counts(s).cleared, 2);
  assert.deepEqual([s.tractor.x, s.tractor.y], [0, s.start.y]);
  assert.equal(C.undo(s), false);
});

test('undo history is bounded', () => {
  const s = C.newBlank({ purpose: 'maze', size: 'large', season: 'summer', animal: 'dog', seed: 0, name: 'x' });
  for (let i = 0; i < C.MAX_UNDO + 60; i++) {
    C.regenerate(s, i);
  }
  assert.equal(s.history.length, C.MAX_UNDO);
  for (let i = 0; i < C.MAX_UNDO; i++) assert.equal(C.undo(s), true);
  assert.equal(s.seed, 59);
  assert.equal(C.undo(s), false);
});

test('undo after a completed run resets the runner even when its exit stays open', () => {
  const s = mk('small', 'summer', 21);
  C.regenerate(s, 21);
  for (const [x, y] of C.findPath(s, s.run.x, s.run.y)) C.moveRunner(s, x - s.run.x, y - s.run.y);
  assert.equal(s.run.won, true);
  assert.equal(C.undo(s), true);
  assert.equal(s.run.won, false);
  assert.deepEqual([s.run.x, s.run.y], [s.start.x, s.start.y]);
});

test('regenerate and replant are undoable, including start and exit', () => {
  const s = mk('medium', 'spring', 21);
  const grid = Array.from(s.grid), start = { ...s.start }, exit = { ...s.exit }, seed = s.seed;
  C.regenerate(s, 777);
  assert.notDeepEqual(Array.from(s.grid), grid);
  assert.ok(C.isSolvable(s));
  assert.equal(s.dirty, false);
  assert.ok(C.undo(s));
  assert.deepEqual(Array.from(s.grid), grid);
  assert.deepEqual(s.start, start); assert.deepEqual(s.exit, exit); assert.equal(s.seed, seed);
  C.replant(s);
  assert.equal(C.counts(s).cleared, 2);
  assert.equal(C.isSolvable(s), false);
  assert.ok(C.undo(s));
  assert.deepEqual(Array.from(s.grid), grid);
  assert.ok(C.isSolvable(s));
});

test('hint path leads from the runner to the exit and is null when blocked', () => {
  const s = mk('small', 'winter', 8);
  const p = C.findPath(s, s.run.x, s.run.y);
  assert.deepEqual(p[p.length - 1], [s.exit.x, s.exit.y]);
  let cur = [s.run.x, s.run.y];
  for (const step of p) {
    assert.equal(Math.abs(step[0] - cur[0]) + Math.abs(step[1] - cur[1]), 1);
    assert.equal(s.grid[step[1] * s.w + step[0]], 0);
    cur = step;
  }
  C.replant(s);
  assert.equal(C.findPath(s, s.run.x, s.run.y), null);
});

test('all animals and seasons are accepted by the import validator', () => {
  for (const season of C.SEASONS) for (const animal of C.ANIMALS) {
    const s = C.newMaze({ size: 'small', season, animal, seed: 1, name: 'ok' });
    assert.ok(C.parse(C.stringify(s)).ok);
  }
  assert.equal(C.ANIMALS.length, 6);
});

const art = (size = 'small') => C.newBlank({ size, season: 'summer', animal: 'dog', seed: 0, name: 'art' });

test('art is the default: fully planted but the tractor footprint, no gates, no runner', () => {
  const s = art();
  assert.equal(s.purpose, 'art');
  assert.equal(s.start, null); assert.equal(s.exit, null);
  assert.equal(C.counts(s).cleared, 1);
  assert.equal(s.grid[s.tractor.y * s.w + s.tractor.x], 0);
  assert.equal(C.isConfigured(s), false);
  assert.equal(C.isSolvable(s), false);
  assert.equal(C.findPath(s, s.tractor.x, s.tractor.y), null);
  assert.equal(C.runTo(s, 3, 3, 5), 0);
  assert.equal(C.moveRunner(s, 1, 0).moved, false);
  assert.equal(C.regenerate(s, 5), false, 'generation is maze-only');
  assert.equal(C.counts(s).cleared, 1);
});

test('toggling art and maze never touches the grid or history', () => {
  const s = art();
  C.moveTractor(s, 1, 0); C.moveTractor(s, 0, 1);
  const grid = Array.from(s.grid), hist = s.history.length, tr = { ...s.tractor };
  assert.ok(C.setPurpose(s, 'maze'));
  assert.equal(s.purpose, 'maze');
  assert.deepEqual(Array.from(s.grid), grid);
  assert.equal(s.history.length, hist);
  assert.equal(C.setPurpose(s, 'maze'), false);
  assert.equal(C.setPurpose(s, 'bogus'), false);
  assert.ok(C.setPurpose(s, 'art'));
  assert.deepEqual(Array.from(s.grid), grid);
  assert.deepEqual({ ...s.tractor }, tr);
  C.undo(s); C.undo(s);
  assert.equal(s.purpose, 'art', 'undo never flips the purpose');
});

test('gate placement validates, carves, is undoable and never moves the tractor', () => {
  const s = art(); C.setPurpose(s, 'maze');
  const tr = { ...s.tractor };
  assert.equal(C.placeGate(s, 'start', -1, 0).ok, false);
  assert.equal(C.placeGate(s, 'start', s.w, 0).ok, false);
  assert.equal(C.placeGate(s, 'start', 1.5, 0).ok, false);
  assert.equal(C.placeGate(s, 'middle', 2, 2).ok, false);
  assert.equal(s.history.length, 0);
  assert.equal(C.placeGate(s, 'start', 4, 3).ok, true);
  assert.equal(s.grid[3 * s.w + 4], 0, 'gate cell is cleared');
  assert.equal(C.isConfigured(s), false, 'one gate is not enough');
  assert.equal(C.placeGate(s, 'exit', 4, 3).ok, false, 'distinct cells');
  assert.equal(C.placeGate(s, 'exit', 9, 8).ok, true);
  assert.ok(C.isConfigured(s));
  assert.equal(s.history.length, 2);
  assert.deepEqual({ ...s.tractor }, tr, 'moving gates does not teleport the tractor');
  assert.equal(C.placeGate(s, 'start', 4, 4).ok, true);
  assert.deepEqual({ ...s.tractor }, tr);
  C.undo(s);
  assert.deepEqual(s.start, { x: 4, y: 3 });
  assert.equal(s.grid[4 * s.w + 4], 1, 'undo re-plants the carved gate cell');
  C.undo(s); C.undo(s);
  assert.equal(s.start, null); assert.equal(s.exit, null);
  assert.equal(s.grid[3 * s.w + 4], 1);
  assert.equal(C.counts(s).cleared, 1);
  assert.equal(C.placeGate(art(), 'start', 2, 2).ok, false, 'art purpose cannot place gates');
});

test('a configured run works end to end; incomplete gates block it', () => {
  const s = art(); C.setPurpose(s, 'maze');
  C.placeGate(s, 'start', 2, 5);
  assert.equal(C.moveRunner(s, 1, 0).moved, false, 'no runner with one gate');
  C.placeGate(s, 'exit', 6, 5);
  assert.equal(C.isSolvable(s), false, 'corn between the gates');
  assert.equal(C.moveRunner(s, 1, 0).blocked, true);
  for (let x = 3; x <= 5; x++) s.grid[5 * s.w + x] = 0;
  assert.ok(C.isSolvable(s));
  assert.equal(C.runTo(s, 6, 5, 10), 4);
  assert.ok(s.run.won);
});

test('v2 round trip keeps purpose, partial gates and art', () => {
  const s = art('medium'); C.moveTractor(s, 1, 0); C.moveTractor(s, 1, 0);
  let r = C.parse(C.stringify(s, { tractor: true }));
  assert.ok(r.ok, r.error);
  assert.equal(r.state.purpose, 'art'); assert.equal(r.state.start, null); assert.equal(r.state.exit, null);
  assert.deepEqual(Array.from(r.state.grid), Array.from(s.grid));
  assert.deepEqual([r.state.tractor.x, r.state.tractor.y], [2, s.tractor.y]);
  assert.equal(JSON.parse(C.stringify(s)).version, 2);
  assert.equal('start' in JSON.parse(C.stringify(s)), false);
  r = C.parse(C.stringify(s));
  assert.ok(r.ok);
  assert.equal(r.state.grid[r.state.tractor.y * r.state.w + r.state.tractor.x], 0, 'tractor parked on a cleared cell');
  C.setPurpose(s, 'maze'); C.placeGate(s, 'start', 5, 5);
  r = C.parse(C.stringify(s, { tractor: true }));
  assert.ok(r.ok, r.error);
  assert.equal(r.state.purpose, 'maze');
  assert.deepEqual(r.state.start, { x: 5, y: 5 }); assert.equal(r.state.exit, null);
  assert.equal(C.isConfigured(r.state), false);
  const o = JSON.parse(C.stringify(s)); o.start = [0, 0];
  assert.equal(C.parse(JSON.stringify(o)).ok, false, 'start in corn');
  o.start = [5, 5]; o.exit = [5, 5];
  assert.equal(C.parse(JSON.stringify(o)).ok, false, 'same gates');
  o.exit = [999, 1];
  assert.equal(C.parse(JSON.stringify(o)).ok, false, 'exit out of bounds');
  const p = JSON.parse(C.stringify(s)); p.purpose = 'zoo';
  assert.equal(C.parse(JSON.stringify(p)).ok, false, 'unknown purpose');
});

test('version 1 saves migrate as mazes and need both gates', () => {
  const m = mk('small', 'spring', 9);
  const o = C.serialize(m); o.version = 1; delete o.purpose;
  const r = C.parse(JSON.stringify(o));
  assert.ok(r.ok, r.error);
  assert.equal(r.state.purpose, 'maze');
  assert.deepEqual(r.state.start, m.start); assert.deepEqual(r.state.exit, m.exit);
  assert.deepEqual([r.state.tractor.x, r.state.tractor.y], [m.start.x, m.start.y]);
  assert.deepEqual(Array.from(r.state.grid), Array.from(m.grid));
  assert.ok(C.isSolvable(r.state));
  const noGate = JSON.parse(JSON.stringify(o)); delete noGate.start;
  assert.equal(C.parse(JSON.stringify(noGate)).ok, false, 'v1 requires gates');
});

test('replant keeps the tractor in place and is undoable', () => {
  const s = art(); C.moveTractor(s, 1, 0); C.moveTractor(s, 1, 0);
  C.replant(s);
  assert.deepEqual([s.tractor.x, s.tractor.y], [2, s.tractor.y]);
  assert.equal(C.counts(s).cleared, 1);
  C.undo(s);
  assert.equal(C.counts(s).cleared, 3);
});
