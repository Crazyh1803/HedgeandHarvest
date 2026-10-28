'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness() {
  const voices = [], intervals = new Map(), timeouts = [], listeners = {}, storage = new Map();
  let context, nextId = 1;
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const node = () => ({ connect(target) { if (target.frequency) this.filterFrequency = target.frequency.value; return target; }, disconnect() { this.disconnected = true; } });
  class AudioContext {
    constructor() { context = this; this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); }
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), frequency: param(), Q: param(), gain: param() }; }
    createOscillator() { return this.source(false); }
    createBufferSource() { return this.source(true); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    source(noise) {
      const voice = { ...node(), frequency: param(), playbackRate: param(), noise, type: 'sine', onended: null, ended: false, start(t) { this.startAt = t; voices.push(this); }, stop(t) { this.stopAt = t; } };
      return voice;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const document = { hidden: false, addEventListener(type, fn) { listeners[type] = fn; } };
  const window = { AudioContext, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }, addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../audio.js'), 'utf8'), {
    window, document, Math, Float32Array,
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; }, clearInterval(id) { intervals.delete(id); },
    setTimeout(fn) { timeouts.push(fn); return timeouts.length; }, clearTimeout() {}
  });
  return { audio: window.CornfieldAudio, voices, document, listeners, intervals, timeouts,
    advance(seconds) {
      context.currentTime += seconds;
      for (const v of voices) if (!v.ended && v.stopAt <= context.currentTime) { v.ended = true; if (v.onended) v.onended(); }
      for (const fn of [...intervals.values()]) fn();
    }, get ctx() { return context; } };
}

test('music has a frequent rhythmic arrangement with short voices and bounded lookahead', () => {
  const h = harness();
  assert.equal(h.audio.music(), false); assert.equal(h.audio.sfx(), false);
  h.audio.setMusic(true);
  for (let i = 0; i < 80; i++) {
    h.advance(0.1);
    assert.ok(h.voices.filter(v => !v.ended).length <= 32, 'live music sources must remain bounded after cleanup');
  }
  assert.ok(h.voices.length >= 40, 'eight seconds should contain a regular beat, bass and melody, rather than sparse ambience');
  assert.ok(h.voices.every(v => Number.isFinite(v.stopAt) && v.stopAt >= v.startAt), 'all scheduled voices must have a finite end');
  assert.ok(h.voices.every(v => v.stopAt - v.startAt < 2.5), 'short articulation should replace long ambient pads');
  const times = h.voices.filter(v => v.noise && v.filterFrequency >= 5000).map(v => v.startAt).sort((a, b) => a - b);
  assert.ok(times.length >= 28, 'hats should provide a regular eighth-note pulse');
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - 60 / 118 / 2) < 0.01, 'every hat interval should follow the steady 118 BPM grid');
  assert.ok(h.voices.filter(v => v.ended).every(v => v.disconnected), 'ended sources must disconnect');
  const before = h.voices.length;
  h.advance(30);
  assert.ok(h.voices.length - before < 25, 'resuming after a gap must not schedule a backlog burst');
  assert.ok(h.voices.slice(before).every(v => v.startAt >= h.ctx.currentTime && v.startAt < h.ctx.currentTime + 0.2), 'scheduling must follow the advanced audio clock');
});

test('rapid music off/on does not double-schedule percussion within the lookahead', () => {
  const h = harness(); h.audio.setMusic(true); h.advance(0.04);
  const count = h.voices.length;
  h.audio.setMusic(false); h.audio.setMusic(true);
  assert.equal(h.voices.length, count, 'rapid toggle must retain the rhythmic grid without scheduling a second onset');
  h.advance(0.3);
  const hats = h.voices.filter(v => v.noise && v.filterFrequency >= 5000 && v.stopAt > v.startAt).map(v => v.startAt.toFixed(4));
  assert.equal(new Set(hats).size, hats.length);
});

test('music and effects stay independent and hidden tabs stop the scheduler', () => {
  const h = harness();
  h.audio.setMusic(true); assert.equal(h.audio.sfx(), false);
  h.audio.setSfx(true); h.audio.setMusic(false);
  assert.equal(h.audio.sfx(), true); assert.equal(h.intervals.size, 0);
  h.audio.setMusic(true);
  h.document.hidden = true; h.listeners.visibilitychange();
  assert.equal(h.intervals.size, 0); assert.equal(h.ctx.state, 'suspended');
  h.document.hidden = false; h.listeners.visibilitychange();
  assert.equal(h.ctx.state, 'running'); assert.ok(h.intervals.size > 0);
  h.audio.setMusic(false); h.audio.setSfx(false);
  for (const fn of h.timeouts) fn();
  assert.equal(h.ctx.state, 'suspended');
});
