// Ambient office sound, synthesised with Web Audio (no audio files):
// a quiet room tone, keyboard clicks while agents type, a soft chime when an
// agent finishes and a whoosh when a document is handed over. Off by default.

export function createSound() {
  let ctx = null, master = null, clickBuf = null, noiseBuf = null, enabled = false;

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const sr = ctx.sampleRate;
    // brown noise for the room tone and the whoosh
    noiseBuf = ctx.createBuffer(1, sr * 2, sr);
    const n = noiseBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; n[i] = last * 3.5; }
    const room = ctx.createBufferSource();
    room.buffer = noiseBuf;
    room.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.22;
    room.connect(lp).connect(roomGain).connect(master);
    room.start();
    // one short decaying click
    clickBuf = ctx.createBuffer(1, Math.floor(sr * 0.03), sr);
    const c = clickBuf.getChannelData(0);
    for (let i = 0; i < c.length; i++) c[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sr * 0.004));
  }

  function setEnabled(on) {
    enabled = on;
    if (on && !ctx) init();
    if (!ctx) return;
    if (on) ctx.resume();
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setTargetAtTime(on ? 0.55 : 0, now, 0.15);
  }

  function voice(pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan || 0));
    p.connect(master);
    return p;
  }

  function click(pan) {
    if (!enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = clickBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800 + Math.random() * 1800;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0.18 + Math.random() * 0.12;
    src.connect(bp).connect(g).connect(voice(pan));
    src.start();
  }

  function chime(pan) {
    if (!enabled) return;
    const out = voice(pan);
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 1);
    });
  }

  function whoosh(pan) {
    if (!enabled) return;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    const t0 = ctx.currentTime;
    bp.frequency.setValueAtTime(350, t0);
    bp.frequency.exponentialRampToValueAtTime(2200, t0 + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.35, t0 + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);
    src.connect(bp).connect(g).connect(voice(pan));
    src.start(t0, Math.random());
    src.stop(t0 + 0.8);
  }

  // called every frame with the typists' stereo positions
  function typing(dt, pans) {
    if (!enabled) return;
    for (const pan of pans) if (Math.random() < dt * 7) click(pan);
  }

  return { setEnabled, typing, chime, whoosh, get enabled() { return enabled; } };
}
