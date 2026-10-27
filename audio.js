/* Cornfield Carver - optional cozy procedural audio (Web Audio, no assets).
   Facade: window.CornfieldAudio
     supported            boolean, false when Web Audio is unavailable
     music(), sfx()       current on/off state
     setMusic(on), setSfx(on)   call from a user gesture; starts/stops audio
     carve(), step(), bump(), victory()   soft one-shot effects (no-ops when off)
     onChange(fn)         fn() called when a setting changes
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

  var BPM = 66, SPB = 60 / BPM;
  // Original gentle loop: four chords, two beats of pulse per half-bar.
  var CHORDS = [
    { pad: [87.31, 130.81, 164.81], notes: [261.63, 329.63, 392.0, 440.0, 523.25] },   // F  / C E G A C
    { pad: [110.0, 164.81, 196.0], notes: [261.63, 329.63, 392.0, 523.25, 659.25] },   // Am
    { pad: [73.42, 146.83, 174.61], notes: [293.66, 349.23, 440.0, 523.25, 587.33] },  // Dm
    { pad: [98.0, 146.83, 196.0], notes: [293.66, 392.0, 440.0, 493.88, 587.33] }      // G
  ];

  function ensure() {
    if (!AC) return false;
    if (ctx) return true;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.5;
      var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.Q.value = 0.3;
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
  }

  function scheduleBeat(b, t) {
    var c = CHORDS[Math.floor(b / 8) % CHORDS.length], pos = b % 8;
    if (pos === 0) {
      for (var i = 0; i < c.pad.length; i++) voice(musicBus, 'triangle', c.pad[i], t, 2.2, 3.0, 3.2, 0.05);
    }
    if (pos % 4 === 0) voice(musicBus, 'sine', 62, t, 0.02, 0.04, 0.35, 0.09, 45);   // very soft slow pulse
    if (Math.random() < (pos % 2 === 0 ? 0.55 : 0.3)) {
      var n = c.notes[Math.floor(Math.random() * c.notes.length)];
      voice(musicBus, Math.random() < 0.5 ? 'sine' : 'triangle', n, t + 0.02, 0.015, 0.05, 1.6, 0.06);
    }
  }

  function tick() {
    if (!ctx || ctx.state !== 'running') return;
    var now = ctx.currentTime;
    if (nextBeat < now) nextBeat = now + 0.05;
    while (nextBeat < now + 0.6) { scheduleBeat(beat, nextBeat); beat++; nextBeat += SPB; }
  }
  function startLoop() { if (!timer) { nextBeat = 0; timer = setInterval(tick, 200); tick(); } }
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
    if (prefs.music && !document.hidden) startLoop(); else stopLoop();
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
