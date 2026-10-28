'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../game.js');

test('individual stalks mostly rest, sway in sparse bursts and stay deterministic', () => {
  for (const time of [0, 2, 5, 9, 15, 30, 60]) {
    let active = 0, count = 0;
    for (let y = 0; y < 17; y++) for (let x = 0; x < 25; x++) for (let plant = 0; plant < 3; plant++) {
      const pose = C.cornPose(x, y, plant, 42, time);
      assert.ok(Number.isFinite(pose.angle));
      assert.ok(Math.abs(pose.angle) <= 0.16, 'gentle lean should stay below about nine degrees');
      assert.equal(typeof pose.active, 'boolean');
      if (pose.active) active++; else assert.equal(pose.angle, 0, 'resting stalks should be genuinely still');
      count++;
    }
    assert.ok(active / count >= 0.04 && active / count <= 0.3, `most corn should rest at time ${time}, active fraction was ${active / count}`);
  }
  const sequence = (plant, seed) => Array.from({ length: 160 }, (_, i) => C.cornPose(7, 5, plant, seed, i / 4));
  const masks = [0, 1, 2].map(i => JSON.stringify(sequence(i, 42).map(p => p.active)));
  assert.equal(new Set(masks).size, 3, 'three stalks in one cell should take different turns swaying');
  assert.equal(JSON.stringify(sequence(1, 42)), JSON.stringify(sequence(1, 42)));
  assert.notEqual(JSON.stringify(sequence(1, 42)), JSON.stringify(sequence(1, 99)), 'seed should influence each stalk personality');
});

test('stalk bursts start and stop smoothly without angle discontinuities', () => {
  for (let plant = 0; plant < 3; plant++) for (let i = 0; i < 2000; i++) {
    const t = i / 50;
    const a = C.cornPose(3, 4, plant, 17, t), b = C.cornPose(3, 4, plant, 17, t + 0.0001);
    assert.ok(Math.abs(a.angle - b.angle) < 0.0002, 'burst boundaries must not pop between poses');
  }
});

test('runner facing follows actual screen-relative movement and stays put against walls', () => {
  const s = C.newMaze({ size: 'small', season: 'summer', animal: 'dog', seed: 42, name: 'Directions' });
  s.grid.fill(0); s.start = { x: 4, y: 4 }; s.exit = { x: 13, y: 9 }; C.resetRun(s);
  for (const [dx, dy, facing] of [[1, 0, 0], [0, 1, 1], [-1, 0, 2], [0, -1, 3]]) {
    assert.equal(C.moveRunner(s, dx, dy).moved, true);
    assert.equal(s.run.dir, facing);
  }
  s.grid[s.run.y * s.w + s.run.x + 1] = 1;
  assert.equal(C.moveRunner(s, 1, 0).blocked, true);
  assert.equal(s.run.dir, 3, 'blocked input must not produce phantom movement or a running turn');
  s.grid.fill(0);
  C.runTo(s, s.run.x + 2, s.run.y, 2);
  assert.equal(s.run.dir, 0, 'pointer-target walking should update facing too');
});
