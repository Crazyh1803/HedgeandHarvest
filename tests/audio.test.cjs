'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness() {
  const voices = [], intervals = new Map(), timeouts = [], listeners = {}, storage = new Map();
  let context, nextId = 1;
  const param = () => ({ value: 0, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; }, exponentialRampToValueAtTime(v) { this.value = v; }, setTargetAtTime(v) { this.value = v; }, cancelScheduledValues() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    constructor() { context = this; this.currentTime = 0; this.sampleRate = 44100; this.state = 'running'; this.destination = node(); }
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), frequency: param(), Q: param(), gain: param() }; }
    createOscillator() { return this.source(false); }
    createBufferSource() { return this.source(true); }
    createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }
    source(noise) {
      const voice = { ...node(), frequency: param(), playbackRate: param(), noise, type: 'sine', start(t) { this.startAt = t; voices.push(this); }, stop(t) { this.stopAt = t; } };
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
    advance(seconds) { context.currentTime += seconds; for (const fn of [...intervals.values()]) fn(); }, get ctx() { return context; } };
}

test('music has a frequent rhythmic arrangement with short voices and bounded lookahead', () => {
  const h = harness();
  assert.equal(h.audio.music(), false); assert.equal(h.audio.sfx(), false);
  h.audio.setMusic(true);
  for (let i = 0; i < 80; i++) h.advance(0.1);
  assert.ok(h.voices.length >= 40, 'eight seconds should contain a regular beat, bass and melody, rather than sparse ambience');
  assert.ok(h.voices.every(v => Number.isFinite(v.stopAt) && v.stopAt >= v.startAt), 'all scheduled voices must have a finite end');
  assert.ok(h.voices.every(v => v.stopAt - v.startAt < 2.5), 'short articulation should replace long ambient pads');
  const times = [...new Set(h.voices.map(v => Number(v.startAt.toFixed(3))))].sort((a, b) => a - b);
  assert.ok(times.some((t, i) => i > 0 && t - times[i - 1] >= 0.2 && t - times[i - 1] <= 0.29), 'eighth-note pulse should be near 116–120 BPM');
  const before = h.voices.length;
  h.advance(30);
  assert.ok(h.voices.length - before < 25, 'resuming after a gap must not schedule a backlog burst');
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
