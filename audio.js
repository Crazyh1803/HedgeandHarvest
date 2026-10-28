/* Cornfield Carver - optional upbeat procedural audio (Web Audio, no assets).
   Facade: window.CornfieldAudio
     supported            boolean, false when Web Audio is unavailable
     music(), sfx()       current on/off state
     setMusic(on), setSfx(on)   call from a user gesture; starts/stops audio
     carve(), step(), bump(), victory()   soft one-shot effects (no-ops when off)
     onChange(fn)         fn() called when a setting changes
     patternAt(step), bpm   pure loop description (events per eighth-note step) for tests
   Both channels are off by default; settings persist in localStorage. */
(function (root) {
  'use strict';
  var KEY = 'cornfield-carver:audio:v1';
  var AC = root.AudioContext || root.webkitAudioContext;
  var listeners = [];
  var prefs = { music: false, sfx: false };
  var ctx = null, master = null, musicBus = null, sfxBus = null, timer = 0;
  var nextBeat = 0, beat = 0, lastSfx = 0;
  var wantRestore = false;

  try {
    var raw = root.localStorage.getItem(KEY);
    if (raw) { var p = JSON.parse(raw); prefs.music = p.music === true; prefs.sfx = p.sfx === true; }
  } catch (e) { /* ignore */ }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }
  function notify() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) { /* ignore */ } } }

  var BPM = 118, SPS = 60 / BPM / 2;          // SPS: one eighth-note step in seconds
  var STEPS_PER_BAR = 8, BARS = 4, LOOP_STEPS = STEPS_PER_BAR * BARS;
  var LOOKAHEAD = 0.15, TICK_MS = 30;
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // Original loop in C major: I - V - vi - IV, each chord coloured with an added 9th.
  var BASS = [36, 43, 33, 41];                                   // C2 G2 A1 F2 (MIDI)
  var BASS_RHYTHM = [1, 0, 2, 1, 0, 1, 2, 1.5];                  // 0 = rest, else frequency multiplier
  var STAB = [[64, 67, 74], [62, 69, 71], [64, 71, 72], [65, 69, 72]];
  var LEAD = [
    [76, 0, 79, 81, 79, 0, 76, 74],
    [74, 0, 79, 83, 81, 0, 79, 74],
    [76, 0, 81, 0, 84, 81, 79, 76],
    [77, 0, 81, 79, 77, 0, 74, 72]
  ];

  // Pure and deterministic: the events that start on eighth-note `step` of the loop.
  function patternAt(step) {
    var s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
    var bar = Math.floor(s / STEPS_PER_BAR), pos = s % STEPS_PER_BAR, ev = [], i;
    if (pos === 0 || pos === 4 || (pos === 3 && bar % 2 === 1)) ev.push({ voice: 'kick', freq: 150, dur: 0.16, gain: 0.34 });
    if (pos === 2 || pos === 6) ev.push({ voice: 'snare', freq: 190, dur: 0.12, gain: 0.16 });
    ev.push({ voice: 'hat', freq: 7000, dur: 0.04, gain: pos % 2 ? 0.05 : 0.03 });
    var bm = BASS_RHYTHM[pos];
    if (bm) ev.push({ voice: 'bass', freq: mtof(BASS[bar]) * bm, dur: 0.17, gain: 0.2 });
    var lm = LEAD[bar][pos];
    if (lm) ev.push({ voice: 'lead', freq: mtof(lm), dur: 0.2, gain: 0.1 });
    if (pos === 3 || pos === 6) {
      for (i = 0; i < STAB[bar].length; i++) ev.push({ voice: 'stab', freq: mtof(STAB[bar][i]), dur: 0.12, gain: 0.03 });
    }
    return ev;
  }

  function ensure() {
    if (!AC) return false;
    if (ctx) return true;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000; lp.Q.value = 0.3;
      musicBus = ctx.createGain(); musicBus.gain.value = 0;
      sfxBus = ctx.createGain(); sfxBus.gain.value = 0;
      musicBus.connect(lp); sfxBus.connect(lp); lp.connect(master); master.connect(ctx.destination);
    } catch (e) { ctx = null; return false; }
    return true;
  }

  // One enveloped voice; always stops itself so no oscillator leaks.
  function voice(bus, type, freq, t, attack, hold, release, peak, glideTo) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + attack + hold + release);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    o.connect(g); g.connect(bus);
    var end = t + attack + hold + release + 0.05;
    o.onended = function () { try { o.disconnect(); g.disconnect(); } catch (e) { /* ignore */ } };
    o.start(t); o.stop(end);
    return { src: o, start: t, end: end };
  }

  // Music voices are tracked so turning music off can cancel queued and ringing notes.
  var noiseBuf = null, live = [];
  function track(rec, extra) {
    live.push(rec);
    var prev = rec.src.onended;
    rec.src.onended = function () {
      var i = live.indexOf(rec); if (i >= 0) live.splice(i, 1);
      if (prev) prev();
      try { for (var k = 0; k < extra.length; k++) extra[k].disconnect(); rec.src.disconnect(); } catch (e) { /* ignore */ }
    };
  }
  function tone(type, freq, t, hold, release, peak, glideTo) {
    track(voice(musicBus, type, freq, t, 0.006, hold, release, peak, glideTo), []);
  }
  function noise(ftype, fq, t, dur, peak) {
    if (!noiseBuf) {   // one shared buffer for every snare and hat
      var len = Math.floor(ctx.sampleRate * 0.5), d;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = ftype; f.frequency.value = fq; f.Q.value = 0.7;
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(musicBus);
    var end = t + dur + 0.03;
    track({ src: s, start: t, end: end }, [f, g]);
    s.start(t); s.stop(end);
  }
  function hushMusic() {
    if (!ctx) return;
    var now = ctx.currentTime, cut = now + 0.45;
    for (var i = 0; i < live.length; i++) {
      var r = live[i];
      try {
        if (r.start > now) { r.src.stop(r.start); r.end = r.start; }
        else if (r.end > cut) { r.src.stop(cut); r.end = cut; }
      } catch (e) { /* ignore */ }
    }
  }

  function scheduleStep(step, t) {
    var ev = patternAt(step);
    for (var i = 0; i < ev.length; i++) {
      var e = ev[i];
      if (e.voice === 'kick') tone('sine', e.freq, t, 0.01, e.dur, e.gain, 45);
      else if (e.voice === 'snare') { noise('highpass', 1800, t, e.dur, e.gain); tone('triangle', e.freq, t, 0.01, 0.07, e.gain * 0.6, 140); }
      else if (e.voice === 'hat') noise('highpass', e.freq, t, e.dur, e.gain);
      else if (e.voice === 'bass') tone('triangle', e.freq, t, 0.06, e.dur, e.gain);
      else if (e.voice === 'lead') { tone('square', e.freq, t, 0.04, e.dur, e.gain); tone('triangle', e.freq * 2, t, 0.02, 0.1, e.gain * 0.35); }
      else tone('triangle', e.freq, t, 0.03, e.dur, e.gain);
    }
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    if (nextBeat < now) nextBeat = now + 0.05;
    while (nextBeat < now + LOOKAHEAD) { scheduleStep(beat, nextBeat); beat++; nextBeat += SPS; }
  }
  function startLoop() {
    if (timer) return;
    // keep a still-queued grid so quick off/on toggles don't double notes; otherwise restart at the bar line
    if (nextBeat < ctx.currentTime) { nextBeat = ctx.currentTime + 0.06; beat = 0; }
    timer = setInterval(tick, TICK_MS); tick();
  }
  function stopLoop() { if (timer) { clearInterval(timer); timer = 0; } }

  function ramp(g, v) {
    var t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(v, t + 0.4);
  }

  function apply() {
    if (!ctx) return;
    ramp(musicBus, prefs.music ? 1 : 0);
    ramp(sfxBus, prefs.sfx ? 1 : 0);
    if (prefs.music && !document.hidden) startLoop();
    else { stopLoop(); if (!prefs.music) hushMusic(); }
    if ((prefs.music || prefs.sfx) && !document.hidden) { if (ctx.state === 'suspended') ctx.resume(); }
    else if (ctx.state === 'running') {
      // let the fade-out finish before suspending
      setTimeout(function () { if (ctx && !prefs.music && !prefs.sfx && ctx.state === 'running') ctx.suspend(); }, 500);
      if (document.hidden) ctx.suspend();
    }
  }

  function set(which, on) {
    on = !!on;
    if (on && !ensure()) { notify(); return false; }
    prefs[which] = on; save(); apply(); notify();
    return on;
  }

  // Settings restored from storage only start sound after a real gesture.
  function restoreOnGesture() {
    if (wantRestore || !AC || !(prefs.music || prefs.sfx)) return;
    wantRestore = true;
    var go = function () {
      root.removeEventListener('pointerdown', go, true); root.removeEventListener('keydown', go, true);
      if ((prefs.music || prefs.sfx) && ensure()) apply();
    };
    root.addEventListener('pointerdown', go, true); root.addEventListener('keydown', go, true);
  }

  document.addEventListener('visibilitychange', function () {
    if (!ctx) return;
    if (document.hidden) { stopLoop(); if (ctx.state === 'running') ctx.suspend(); }
    else apply();
  });

  function sfxOk(gap) {
    if (!ctx || !prefs.sfx || ctx.state !== 'running') return false;
    var n = ctx.currentTime;
    if (n - lastSfx < gap) return false;
    lastSfx = n; return true;
  }

  root.CornfieldAudio = {
    supported: !!AC,
    bpm: BPM,
    patternAt: patternAt,
    music: function () { return prefs.music; },
    sfx: function () { return prefs.sfx; },
    setMusic: function (on) { return set('music', on); },
    setSfx: function (on) { return set('sfx', on); },
    onChange: function (fn) { listeners.push(fn); },
    carve: function () {
      if (!sfxOk(0.09)) return;
      var t = ctx.currentTime + 0.01;
      voice(sfxBus, 'sine', 196, t, 0.01, 0.02, 0.14, 0.09, 150);
      voice(sfxBus, 'triangle', 392, t, 0.01, 0.01, 0.08, 0.025);
    },
    step: function () {
      if (!sfxOk(0.07)) return;
      voice(sfxBus, 'sine', 523.25, ctx.currentTime + 0.01, 0.008, 0.01, 0.07, 0.035);
    },
    bump: function () {
      if (!sfxOk(0.15)) return;
      voice(sfxBus, 'sine', 130, ctx.currentTime + 0.01, 0.01, 0.01, 0.12, 0.06, 100);
    },
    victory: function () {
      if (!ctx || !prefs.sfx || ctx.state !== 'running') return;
      var t = ctx.currentTime + 0.05, f = [523.25, 659.25, 783.99, 1046.5], i;
      for (i = 0; i < f.length; i++) {
        voice(sfxBus, 'sine', f[i], t + i * 0.16, 0.02, 0.06, 0.9, 0.07);
        voice(sfxBus, 'triangle', f[i] / 2, t + i * 0.16, 0.02, 0.06, 0.9, 0.03);
      }
    }
  };
  restoreOnGesture();
})(typeof window !== 'undefined' ? window : this);
