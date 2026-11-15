// Cabin sound, all synthesised: engine, RCS, switches, alarms and the radio beep.
export function createAudio() {
  let ctx = null, master, engineGain, engineFilter, rumble, alarmTimer = null, noise;
  const tone = (freq, dur, { type = 'sine', gain = 0.12, at = 0, to } = {}) => {
    const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  const burst = (dur, { freq = 2500, q = 1.2, gain = 0.2, at = 0, type = 'bandpass', to } = {}) => {
    const t = ctx.currentTime + at, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = noise; src.loop = true; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(master); src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.02);
  };
  const SOUNDS = {
    switch: () => { burst(0.03, { freq: 3200, gain: 0.25 }); tone(190, 0.05, { gain: 0.1 }); },
    breaker: () => { burst(0.05, { freq: 1500, gain: 0.3 }); tone(120, 0.08, { gain: 0.16 }); },
    button: () => { tone(920, 0.07, { gain: 0.07 }); burst(0.02, { freq: 4000, gain: 0.1 }); },
    knob: () => burst(0.025, { freq: 1800, gain: 0.2 }),
    cover: () => { burst(0.03, { freq: 2400, gain: 0.2 }); burst(0.04, { freq: 900, gain: 0.25, at: 0.09 }); },
    lever: () => burst(0.09, { freq: 600, gain: 0.12, q: 0.6 }),
    denied: () => tone(150, 0.2, { type: 'square', gain: 0.05 }),
    radio: () => tone(2525, 0.22, { gain: 0.035 }),
    rcs: () => burst(0.16, { freq: 900, q: 0.4, gain: 0.07, type: 'highpass' }),
    can: () => { burst(0.5, { freq: 5000, to: 9000, gain: 0.12, type: 'highpass' }); tone(1400, 0.05, { gain: 0.05 }); },
    seat: () => burst(0.18, { freq: 300, gain: 0.14, q: 0.5 }),
    contact: () => { tone(60, 0.5, { gain: 0.5, to: 30 }); burst(0.35, { freq: 220, gain: 0.4, q: 0.5 }); },
    // A dull, heavy thud, the hull groaning and debris rattling around the cabin.
    crash: () => {
      tone(70, 2.2, { gain: 0.9, to: 20 }); tone(34, 2.8, { gain: 0.7, to: 17 });
      burst(2.6, { freq: 650, gain: 0.95, q: 0.4, type: 'lowpass', to: 45 });
      burst(0.45, { freq: 2400, gain: 0.35, q: 0.7 });
      tone(210, 1.7, { type: 'sawtooth', gain: 0.045, at: 0.18, to: 85 });
      [0.22, 0.4, 0.63, 0.9, 1.25, 1.7].forEach((at, i) => burst(0.06 + (i % 2) * 0.04, { freq: 3200 + i * 450, gain: 0.16, at, type: 'highpass' }));
    },
    success: () => [523, 659, 784].forEach((f, i) => tone(f, 0.5, { gain: 0.06, at: 0.4 + i * 0.14 })),
  };
  return {
    start() {
      if (ctx) { ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.8; master.connect(ctx.destination);
      // Brown noise: the base of the engine roar and of every click.
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = noise.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = last * 6 + (Math.random() * 2 - 1) * 0.25; }
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 80;
      engineGain = ctx.createGain(); engineGain.gain.value = 0;
      src.connect(engineFilter).connect(engineGain).connect(master); src.start();
      rumble = ctx.createOscillator(); rumble.type = 'sawtooth'; rumble.frequency.value = 34;
      const rg = ctx.createGain(); rg.gain.value = 0.25; rumble.connect(rg).connect(engineGain); rumble.start();
      // Fans: the cabin is never silent.
      const fan = ctx.createBufferSource(); fan.buffer = noise; fan.loop = true;
      const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 420; ff.Q.value = 0.4;
      const fg = ctx.createGain(); fg.gain.value = 0.035; fan.connect(ff).connect(fg).connect(master); fan.start();
    },
    play(name) { if (ctx && ctx.state === 'running') SOUNDS[name]?.(); },
    setEngine(throttle) {
      if (!ctx) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(throttle > 0.01 ? 0.12 + throttle * 0.5 : 0, t, 0.08);
      engineFilter.frequency.setTargetAtTime(70 + throttle * 320, t, 0.1);
      rumble.frequency.setTargetAtTime(30 + throttle * 16, t, 0.1);
    },
    setAlarm(on) {
      if (!ctx || on === !!alarmTimer) return;
      if (on) { const beep = () => { if (ctx.state === 'running') { tone(880, 0.16, { type: 'square', gain: 0.045 }); tone(660, 0.16, { type: 'square', gain: 0.045, at: 0.2 }); } }; beep(); alarmTimer = setInterval(beep, 800); }
      else { clearInterval(alarmTimer); alarmTimer = null; }
    },
    suspend() { ctx?.suspend(); },
  };
}
