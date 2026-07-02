// Efeitos sonoros 100% procedurais via WebAudio (sem assets externos).
let ctx = null, master = null;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

function noiseBuf(dur) {
  const b = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function burst(dur, freq, gain, decay, type = 'lowpass') {
  if (!ctx) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf(dur);
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + decay);
  src.connect(f); f.connect(g); g.connect(master);
  src.start();
}

function tone(freq, dur, gain, type = 'square', slideTo = null) {
  if (!ctx) return;
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(ctx.currentTime + dur);
}

export const sfx = {
  shot(kind = 'ar', far = false) {
    if (!ctx) return;
    const v = far ? 0.25 : 1;
    if (kind === 'sniper')      { burst(0.3, 900, 1.1 * v, 0.28); tone(140, 0.22, 0.5 * v, 'sawtooth', 40); }
    else if (kind === 'shotgun'){ burst(0.25, 700, 1.2 * v, 0.22); tone(90, 0.18, 0.5 * v, 'square', 35); }
    else if (kind === 'smg')    { burst(0.1, 1600, 0.7 * v, 0.07); tone(220, 0.05, 0.28 * v, 'square', 90); }
    else if (kind === 'pistol') { burst(0.12, 1300, 0.8 * v, 0.09); tone(190, 0.07, 0.3 * v, 'square', 70); }
    else                        { burst(0.13, 1200, 0.85 * v, 0.1); tone(180, 0.08, 0.35 * v, 'square', 60); }
  },
  hit()      { tone(1200, 0.06, 0.35, 'square', 900); },
  headshot() { tone(1500, 0.07, 0.4, 'square', 1100); tone(750, 0.09, 0.3, 'square', 500); },
  kill()     { tone(600, 0.1, 0.3, 'triangle', 900); setTimeout(() => tone(900, 0.14, 0.3, 'triangle', 1300), 80); },
  hurt()     { burst(0.18, 350, 0.6, 0.16); },
  death()    { tone(300, 0.5, 0.4, 'sawtooth', 60); },
  reload()   { tone(500, 0.05, 0.25, 'square'); setTimeout(() => tone(700, 0.05, 0.25, 'square'), 140); },
  reloadEnd(){ tone(900, 0.06, 0.3, 'square'); },
  step()     { burst(0.05, 250, 0.16, 0.045); },
  jump()     { burst(0.08, 400, 0.2, 0.07); },
  nadeThrow(){ burst(0.08, 800, 0.3, 0.07); },
  nadeBounce(){ tone(320, 0.05, 0.2, 'square'); },
  explosion(far = false) {
    const v = far ? 0.4 : 1;
    burst(0.7, 220, 1.4 * v, 0.6); tone(60, 0.55, 0.7 * v, 'sawtooth', 25);
  },
  uav()      { tone(880, 0.12, 0.3, 'sine'); setTimeout(() => tone(1100, 0.12, 0.3, 'sine'), 150); setTimeout(() => tone(1320, 0.16, 0.3, 'sine'), 300); },
  streakReady(){ tone(700, 0.09, 0.3, 'sine'); setTimeout(() => tone(1050, 0.12, 0.3, 'sine'), 100); },
  knife()    { burst(0.09, 2500, 0.5, 0.08, 'highpass'); },
  win()      { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.35, 'triangle'), i * 160)); },
  lose()     { [400, 350, 300, 200].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.35, 'sawtooth'), i * 180)); },
};
