// Procedural audio. Every sound is synthesised with the WebAudio API — the
// project ships no audio files, so nothing to download and nothing to license.
// These are deliberately placeholder-quality: warm, short, and easy to swap for
// recorded assets later by replacing the body of `play()`.

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880 };

export function createAudio(state) {
  let ctx = null;
  let master = null, musicGain = null, sfxGain = null;
  let started = false;
  let ambienceNodes = null;
  let currentAmbience = null;
  let musicTimer = 0, musicStep = 0, musicKey = null;

  function ensure() {
    if (ctx) return ctx;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      musicGain = ctx.createGain();
      sfxGain = ctx.createGain();
      musicGain.connect(master);
      sfxGain.connect(master);
      master.connect(ctx.destination);
      applySettings(state ? state.settings : null);
    } catch (err) {
      console.warn('[audio] unavailable', err);
      ctx = null;
    }
    return ctx;
  }

  /** Browsers block audio until a gesture — main.js calls this from the start click. */
  function unlock() {
    ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    started = true;
  }

  function applySettings(s) {
    if (!ctx) return;
    const set = s || (state ? state.settings : null) || { master: 0.8, music: 0.55, sfx: 0.9 };
    master.gain.value = clamp(set.master, 0, 1);
    musicGain.gain.value = clamp(set.music, 0, 1) * 0.5;
    sfxGain.gain.value = clamp(set.sfx, 0, 1) * 0.6;
  }

  const clamp = (v, a, b) => (v == null ? b : Math.max(a, Math.min(b, v)));

  function tone(freq, { dur = 0.16, type = 'sine', gain = 0.3, attack = 0.008, decay = null, detune = 0, dest = null, delay = 0 } = {}) {
    if (!ensure() || !started) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (decay || dur));
    osc.connect(g); g.connect(dest || sfxGain);
    osc.start(t0);
    osc.stop(t0 + (decay || dur) + 0.05);
  }

  function noise({ dur = 0.2, gain = 0.15, filter = 1200, q = 1, type = 'bandpass', dest = null, delay = 0 } = {}) {
    if (!ensure() || !started) return;
    const t0 = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bq = ctx.createBiquadFilter();
    bq.type = type; bq.frequency.value = filter; bq.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq); bq.connect(g); g.connect(dest || sfxGain);
    src.start(t0);
  }

  // --------------------------------------------------------------- sfx table
  const SFX = {
    step:      () => noise({ dur: 0.06, gain: 0.05, filter: 900, q: 1.6 }),
    jump:      () => tone(420, { dur: 0.14, type: 'triangle', gain: 0.18 }),
    land:      () => noise({ dur: 0.1, gain: 0.1, filter: 500 }),
    meow:      () => { tone(680, { dur: 0.22, type: 'sawtooth', gain: 0.1 }); tone(520, { dur: 0.3, type: 'sine', gain: 0.12, delay: 0.07 }); },
    purr:      () => noise({ dur: 0.5, gain: 0.05, filter: 140, q: 3, type: 'lowpass' }),
    ui_open:   () => { tone(NOTE.E5, { dur: 0.09, gain: 0.16 }); tone(NOTE.G5, { dur: 0.11, gain: 0.13, delay: 0.05 }); },
    ui_close:  () => { tone(NOTE.G5, { dur: 0.08, gain: 0.13 }); tone(NOTE.E5, { dur: 0.1, gain: 0.11, delay: 0.04 }); },
    click:     () => tone(NOTE.C5, { dur: 0.05, type: 'square', gain: 0.08 }),
    coin:      () => { tone(NOTE.E5, { dur: 0.08, gain: 0.2 }); tone(NOTE.G5, { dur: 0.14, gain: 0.18, delay: 0.06 }); tone(NOTE.C5 * 2, { dur: 0.18, gain: 0.13, delay: 0.12 }); },
    chop:      () => noise({ dur: 0.07, gain: 0.24, filter: 2600, q: 2.2 }),
    rice:      () => noise({ dur: 0.28, gain: 0.1, filter: 4200, q: 0.7, type: 'highpass' }),
    sizzle:    () => noise({ dur: 0.55, gain: 0.08, filter: 3400, q: 0.5, type: 'highpass' }),
    water:     () => noise({ dur: 0.35, gain: 0.09, filter: 700, q: 0.8 }),
    splash:    () => { noise({ dur: 0.25, gain: 0.18, filter: 900 }); noise({ dur: 0.4, gain: 0.08, filter: 2200, delay: 0.05 }); },
    reel:      () => noise({ dur: 0.12, gain: 0.07, filter: 1800, q: 3 }),
    bite:      () => tone(300, { dur: 0.1, type: 'triangle', gain: 0.2 }),
    good:      () => { tone(NOTE.C5, { dur: 0.1, gain: 0.18 }); tone(NOTE.E5, { dur: 0.12, gain: 0.16, delay: 0.07 }); },
    perfect:   () => { [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C5 * 2].forEach((f, i) => tone(f, { dur: 0.18, gain: 0.17, delay: i * 0.07 })); },
    fail:      () => { tone(220, { dur: 0.18, type: 'sawtooth', gain: 0.13 }); tone(165, { dur: 0.26, type: 'sawtooth', gain: 0.12, delay: 0.1 }); },
    bell:      () => { tone(NOTE.A5, { dur: 0.5, type: 'sine', gain: 0.14 }); tone(NOTE.E5, { dur: 0.7, type: 'sine', gain: 0.09, delay: 0.02 }); },
    bicycle:   () => { tone(1760, { dur: 0.18, gain: 0.1 }); tone(2340, { dur: 0.22, gain: 0.07, delay: 0.05 }); },
    train:     () => noise({ dur: 1.2, gain: 0.06, filter: 260, q: 0.6, type: 'lowpass' }),
    gull:      () => { tone(1200, { dur: 0.1, type: 'sawtooth', gain: 0.06 }); tone(1500, { dur: 0.12, type: 'sawtooth', gain: 0.05, delay: 0.09 }); },
    levelup:   () => { [NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.C5 * 2].forEach((f, i) => tone(f, { dur: 0.22, gain: 0.18, delay: i * 0.09, type: 'triangle' })); },
    quest:     () => { tone(NOTE.G4, { dur: 0.14, gain: 0.16, type: 'triangle' }); tone(NOTE.C5, { dur: 0.2, gain: 0.15, type: 'triangle', delay: 0.1 }); },
    error:     () => tone(160, { dur: 0.16, type: 'square', gain: 0.1 }),
  };

  function play(name, opts) {
    const fn = SFX[name];
    if (!fn) return;
    if (!ensure() || !started) return;
    try { fn(opts); } catch (err) { /* audio must never break gameplay */ }
  }

  // ------------------------------------------------------------- ambience
  // A quiet filtered-noise bed per district, cross-faded on district change.
  const AMBIENCE = {
    market:   { filter: 620,  q: 0.8, gain: 0.030 },
    harbor:   { filter: 380,  q: 0.6, gain: 0.036 },
    downtown: { filter: 900,  q: 0.5, gain: 0.026 },
    suburb:   { filter: 520,  q: 0.7, gain: 0.020 },
    festival: { filter: 760,  q: 0.9, gain: 0.034 },
    indoor:   { filter: 300,  q: 1.2, gain: 0.018 },
  };

  function setAmbience(key) {
    if (!ensure() || !started) return;
    if (key === currentAmbience) return;
    currentAmbience = key;
    const cfg = AMBIENCE[key] || AMBIENCE.market;
    if (ambienceNodes) {
      const old = ambienceNodes;
      old.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5);
      setTimeout(() => { try { old.src.stop(); } catch { /* already stopped */ } }, 1600);
    }
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = last * 0.985 + (Math.random() * 2 - 1) * 0.015; d[i] = last; }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bq = ctx.createBiquadFilter();
    bq.type = 'bandpass'; bq.frequency.value = cfg.filter; bq.Q.value = cfg.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.setTargetAtTime(cfg.gain, ctx.currentTime, 0.8);
    src.connect(bq); bq.connect(g); g.connect(musicGain);
    src.start();
    ambienceNodes = { src, gain: g };
  }

  // ---------------------------------------------------------------- music
  // A slow pentatonic arpeggio per district + a soft bass drone for "backsound".
  // Neon track leans minor for the purplish city vibe.
  const SCALES = {
    market:   [NOTE.C4, NOTE.D4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5],
    harbor:   [NOTE.D4, NOTE.F4, NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5],
    downtown: [NOTE.E4, NOTE.G4, NOTE.A4, NOTE.B4, NOTE.D5, NOTE.E5],
    home:     [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.A4, NOTE.C5, NOTE.E5],
    neon:     [NOTE.A4, NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5, NOTE.A5],
    festival: [NOTE.G4, NOTE.A4, NOTE.C5, NOTE.D5, NOTE.E5, NOTE.G5],
  };

  let bassTimer = 0;

  function setMusicTrack(key) { musicKey = key; }

  function updateMusic(dt) {
    if (!ctx || !started || !musicKey) return;
    musicTimer -= dt;
    bassTimer -= dt;
    // Soft low drone pulse so the city always has a "backsound" bed.
    if (bassTimer <= 0) {
      bassTimer = 2.4 + Math.random() * 0.8;
      const scale = SCALES[musicKey] || SCALES.market;
      const root = scale[0] * 0.5;
      tone(root, { dur: 2.2, type: 'sine', gain: 0.028, dest: musicGain });
      tone(root * 1.5, { dur: 2.0, type: 'triangle', gain: 0.012, dest: musicGain, delay: 0.05 });
    }
    if (musicTimer > 0) return;
    musicTimer = 0.55 + Math.random() * 0.45;
    const scale = SCALES[musicKey] || SCALES.market;
    musicStep = (musicStep + 1 + (Math.random() < 0.3 ? 1 : 0)) % scale.length;
    const f = scale[musicStep];
    tone(f, { dur: 0.95, type: 'sine', gain: 0.06, dest: musicGain });
    if (Math.random() < 0.4) tone(f * 0.5, { dur: 1.4, type: 'sine', gain: 0.032, dest: musicGain, delay: 0.12 });
    if (musicKey === 'neon' && Math.random() < 0.25) {
      tone(f * 2, { dur: 0.35, type: 'triangle', gain: 0.02, dest: musicGain, delay: 0.2 });
    }
  }

  function update(dt) { updateMusic(dt); }

  function setMaster(v) { if (ctx) master.gain.value = clamp(v, 0, 1); }
  function setMusicVolume(v) { if (ctx) musicGain.gain.value = clamp(v, 0, 1) * 0.5; }
  function setSfx(v) { if (ctx) sfxGain.gain.value = clamp(v, 0, 1) * 0.6; }

  return {
    unlock, play, update, applySettings,
    setAmbience, setMusicTrack,
    setMaster, setMusic: setMusicVolume, setSfx,
    get ready() { return !!ctx && started; },
  };
}
