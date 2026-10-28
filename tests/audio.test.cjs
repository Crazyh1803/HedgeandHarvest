'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function harness(savedPrefs) {
  const voices = [], intervals = new Map(), timeouts = [], listeners = {}, storage = new Map(savedPrefs || []);
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
    setTimeout(fn, ms) { fn.at = (context ? context.currentTime : 0) + (ms || 0) / 1000; fn.id = nextId++; timeouts.push(fn); return fn.id; },
    clearTimeout(id) { const fn = timeouts.find(f => f.id === id); if (fn) fn.canceled = true; }
  });
  return { audio: window.CornfieldAudio, voices, document, listeners, intervals, timeouts, storage,
    advance(seconds) {
      context.currentTime += seconds;
      for (const v of voices) if (!v.ended && v.stopAt <= context.currentTime) { v.ended = true; if (v.onended) v.onended(); }
      for (const fn of [...intervals.values()]) fn();
      for (const fn of timeouts) if (!fn.ran && !fn.canceled && fn.at <= context.currentTime) { fn.ran = true; fn(); }
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
  for (const { delay, expectQueued } of [{ delay: 0.04, expectQueued: false }, { delay: 0.2, expectQueued: true }]) {
    const h = harness(); h.audio.setMusic(true); h.advance(delay);
    const count = h.voices.length;
    const queued = h.voices.filter(v => v.noise && v.filterFrequency >= 5000 && v.startAt > h.ctx.currentTime).map(v => v.startAt);
    if (expectQueued) assert.ok(queued.length > 0, 'exercise a genuinely queued future beat');
    h.audio.setMusic(false); h.audio.setMusic(true);
    if (!queued.length) assert.equal(h.voices.length, count, 'rapid toggle without a queued beat must not add an onset');
    for (const time of queued) assert.equal(h.voices.filter(v => v.noise && v.filterFrequency >= 5000 && v.startAt === time && v.stopAt > v.startAt).length, 1, 'the canceled beat must be restored exactly once');
    h.advance(0.15);
    const hats = h.voices.filter(v => v.noise && v.filterFrequency >= 5000 && v.stopAt > v.startAt).map(v => v.startAt.toFixed(4));
    assert.equal(new Set(hats).size, hats.length);
  }
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
  h.advance(0.6);
  assert.equal(h.ctx.state, 'suspended');
});

test('five distinct songs include the unchanged original arrangement', () => {
  const h = harness(), A = h.audio, crypto = require('node:crypto');
  const ids = Array.from(A.tracks, t => t.id);
  assert.equal(ids.length, 5); assert.equal(new Set(ids).size, 5);
  assert.ok(Array.from(A.tracks).every(t => typeof t.title === 'string' && t.title.length && t.bpm > 0));
  const hash = patterns => crypto.createHash('sha256').update(JSON.stringify(patterns)).digest('hex');
  const original = Array.from({ length: 32 }, (_, i) => A.patternAt(i));
  assert.equal(hash(original), '7847573ffd7c7332db8598b8595990639d50d465a5b903436258952aaad4d954', 'keep the current tune exactly as requested');
  assert.equal(hash(Array.from({ length: 32 }, (_, i) => A.patternAt(i, ids[0]))), hash(original));
  const arrangements = ids.map(id => Array.from({ length: 32 }, (_, i) => A.patternAt(i, id)));
  assert.equal(new Set(arrangements.map(hash)).size, 5, 'every song needs its own arrangement');
  const contours = arrangements.map(pattern => {
    const lead = pattern.map(events => events.find(e => e.voice === 'lead')?.freq || 0);
    const base = lead.find(f => f > 0);
    return JSON.stringify(lead.map(f => f ? Math.round(1200 * Math.log2(f / base)) : null));
  });
  assert.equal(new Set(contours).size, 5, 'songs must have distinct melodic contours, not merely pitch-shift the same melody');
});

test('playlist selection while muted persists without starting audio and rotation wraps', () => {
  const h = harness(), A = h.audio, ids = Array.from(A.tracks, t => t.id);
  assert.equal(A.autoRotate(), true);
  assert.equal(A.rotationSteps, 256);
  for (let i = 0; i < 6; i++) assert.equal(A.trackAt(i * A.rotationSteps), ids[i % 5]);
  A.setTrack(ids[2]);
  assert.equal(A.track(), ids[2]); assert.equal(A.music(), false); assert.equal(h.ctx, undefined);
  assert.equal(A.trackAt(0), ids[2]); assert.equal(A.trackAt(A.rotationSteps), ids[3]);
  A.setAutoRotate(false);
  for (const step of [0, 256, 9999]) assert.equal(A.trackAt(step), ids[2]);
  const restored = harness([...h.storage.entries()]);
  assert.equal(restored.audio.track(), ids[2]); assert.equal(restored.audio.autoRotate(), false);
  assert.equal(restored.ctx, undefined);
  const previous = A.track(); A.setTrack('not-a-song'); assert.equal(A.track(), previous);
});

test('rotation advances on the audio timeline and manual changes clean queued voices', () => {
  const h = harness(), A = h.audio, ids = Array.from(A.tracks, t => t.id);
  A.setMusic(true);
  for (let i = 0; i < 660; i++) {
    h.advance(0.1);
    assert.ok(h.voices.filter(v => !v.ended).length <= 40, 'playlist rotation must not leak voices');
  }
  assert.equal(A.nowPlaying(), ids[1], 'second song should be audible after the 32-bar boundary');
  const old = h.voices.filter(v => !v.ended && v.startAt > h.ctx.currentTime);
  A.setTrack(ids[4]); for (let i = 0; i < 6; i++) h.advance(0.05);
  assert.equal(A.nowPlaying(), ids[4]);
  assert.ok(old.every(v => v.stopAt <= v.startAt || v.ended), 'queued old-track voices must be canceled when selecting a different song');
  assert.equal(A.sfx(), false);
});
