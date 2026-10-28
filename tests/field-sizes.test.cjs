'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game.js');

test('three larger presets triple tile area while retaining existing fields', () => {
  assert.deepEqual(['small', 'medium', 'large'].map(k => [C.SIZES[k].w, C.SIZES[k].h]), [[15, 11], [25, 17], [35, 23]]);
  const sizes = Object.values(C.SIZES);
  assert.equal(sizes.length, 6);
  for (let i = 3; i < sizes.length; i++) {
    assert.equal(sizes[i].w * sizes[i].h, sizes[i - 1].w * sizes[i - 1].h * 3);
    assert.equal(sizes[i].w % 2, 1);
    assert.equal(sizes[i].h % 2, 1);
  }
});

test('largest fully planted art and generated maze fit share limits and round trip', () => {
  const size = Object.keys(C.SIZES).at(-1);
  for (const make of [C.newBlank, C.newMaze]) {
    const state = make({ size, season: 'summer', animal: 'horse', seed: 42, name: 'A'.repeat(C.MAX_NAME) });
    const data = C.stringify(state, { tractor: true });
    assert.ok(Buffer.byteLength(data, 'utf8') < C.MAX_JSON);
    const loaded = C.parse(data);
    assert.equal(loaded.ok, true, loaded.error);
    assert.deepEqual(loaded.state.grid, state.grid);
    assert.equal(loaded.state.size, size);
    if (make === C.newMaze) assert.ok(C.isSolvable(loaded.state));
    else assert.equal(C.counts(state).corn, state.w * state.h - 1);
  }
});
