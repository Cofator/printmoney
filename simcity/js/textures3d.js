/* ============================================================
 * Micropolis 2000 — textures3d.js
 * Procedurally generated PBR-ish textures for the 3D renderer.
 * Everything is drawn on canvases at load time — no assets.
 * ============================================================ */
'use strict';

const TexCache = new Map();

function makeTex(key, size, painter, opts) {
  let t = TexCache.get(key);
  if (t) return t;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  painter(cv.getContext('2d'), size);
  t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.encoding = (opts && opts.linear) ? THREE.LinearEncoding : THREE.sRGBEncoding;
  if (opts && opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  TexCache.set(key, t);
  return t;
}

function noiseFill(ctx, size, base, amp, seed) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (hash2(i % 1024, (i / 1024) | 0, seed) - 0.5) * amp;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/* ---- facade: brick ---- */
function texBrick() {
  return makeTex('brick', 256, (ctx, S) => {
    noiseFill(ctx, S, '#9c6b50', 18, 3);
    const bw = 32, bh = 16;
    ctx.strokeStyle = 'rgba(225,215,205,0.85)';
    ctx.lineWidth = 2;
    for (let y = 0; y <= S; y += bh) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
      const off = ((y / bh) % 2) * (bw / 2);
      for (let x = off; x <= S; x += bw) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke();
      }
    }
    // per-brick tint variation
    for (let y = 0; y < S; y += bh) {
      const off = ((y / bh) % 2) * (bw / 2) - bw;
      for (let x = off; x < S; x += bw) {
        const v = hash2(x, y, 5);
        if (v < 0.3) {
          ctx.fillStyle = `rgba(60,30,20,${0.10 + v * 0.2})`;
          ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        } else if (v > 0.8) {
          ctx.fillStyle = 'rgba(255,235,220,0.10)';
          ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
        }
      }
    }
  });
}

/* ---- facade: window grid over concrete (residential mid) ---- */
function texApartments() {
  return makeTex('apart', 256, (ctx, S) => {
    noiseFill(ctx, S, '#b3a08c', 14, 7);
    const cols = 6, rows = 8;
    const cw = S / cols, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.22, y = r * rh + rh * 0.2;
        const w = cw * 0.56, h = rh * 0.55;
        const lit = hash2(r, c, 11) < 0.35;
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        if (lit) { g.addColorStop(0, '#ffe2a0'); g.addColorStop(1, '#e8b45e'); }
        else { g.addColorStop(0, '#31414f'); g.addColorStop(1, '#1d2a35'); }
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y, w, h * 0.28);
        ctx.strokeStyle = 'rgba(70,55,40,0.9)'; ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);
      }
      // floor band
      ctx.fillStyle = 'rgba(90,70,55,0.35)';
      ctx.fillRect(0, r * rh - 1, S, 2);
    }
  });
}
// emissive companion: only the lit windows glow at night
function texApartmentsEmissive() {
  return makeTex('apartE', 256, (ctx, S) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const cols = 6, rows = 8;
    const cw = S / cols, rh = S / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (hash2(r, c, 11) < 0.35) {
        ctx.fillStyle = '#ffca6a';
        ctx.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.2, cw * 0.56, rh * 0.55);
      }
    }
  });
}

/* ---- facade: glass curtain wall (offices / towers) ---- */
function texGlass() {
  return makeTex('glass', 256, (ctx, S) => {
    const g = ctx.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#7db3d8'); g.addColorStop(0.5, '#4a7fa8'); g.addColorStop(1, '#68a3cc');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
    const cols = 8, rows = 12;
    const cw = S / cols, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = hash2(r, c, 21);
        if (v < 0.18) ctx.fillStyle = 'rgba(255,225,160,0.75)';        // lit office
        else if (v < 0.45) ctx.fillStyle = 'rgba(20,40,60,0.45)';       // dark pane
        else ctx.fillStyle = `rgba(220,240,255,${0.1 + v * 0.22})`;     // sky reflection
        ctx.fillRect(c * cw + 1.5, r * rh + 1.5, cw - 3, rh - 3);
      }
    }
    // mullions
    ctx.strokeStyle = 'rgba(25,45,65,0.9)'; ctx.lineWidth = 2.5;
    for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, S); ctx.stroke(); }
    for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * rh); ctx.lineTo(S, r * rh); ctx.stroke(); }
    // diagonal sheen
    const sh = ctx.createLinearGradient(0, 0, S, S * 0.6);
    sh.addColorStop(0, 'rgba(255,255,255,0)');
    sh.addColorStop(0.5, 'rgba(255,255,255,0.16)');
    sh.addColorStop(0.62, 'rgba(255,255,255,0)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, S, S);
  });
}
function texGlassEmissive() {
  return makeTex('glassE', 256, (ctx, S) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    const cols = 8, rows = 12;
    const cw = S / cols, rh = S / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const v = hash2(r, c, 21);
      if (v < 0.18) { ctx.fillStyle = '#ffd98a'; ctx.fillRect(c * cw + 1.5, r * rh + 1.5, cw - 3, rh - 3); }
      else if (hash2(c, r, 23) < 0.12) { ctx.fillStyle = '#9fc4e8'; ctx.fillRect(c * cw + 1.5, r * rh + 1.5, cw - 3, rh - 3); }
    }
  });
}

/* ---- concrete panels (civic) ---- */
function texConcrete() {
  return makeTex('conc', 256, (ctx, S) => {
    noiseFill(ctx, S, '#b8b4ac', 12, 31);
    ctx.strokeStyle = 'rgba(70,68,64,0.35)'; ctx.lineWidth = 2;
    for (let y = 0; y <= S; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke(); }
    for (let x = 0; x <= S; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke(); }
    // weathering streaks
    for (let k = 0; k < 12; k++) {
      const x = hash2(k, 1, 33) * S;
      const g = ctx.createLinearGradient(0, 0, 0, S);
      g.addColorStop(0, 'rgba(60,58,54,0.12)'); g.addColorStop(1, 'rgba(60,58,54,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 3 + hash2(k, 2, 35) * 6, S);
    }
  });
}

/* ---- corrugated metal (industry) ---- */
function texMetal() {
  return makeTex('metal', 256, (ctx, S) => {
    noiseFill(ctx, S, '#8f948f', 10, 41);
    for (let x = 0; x < S; x += 10) {
      const g = ctx.createLinearGradient(x, 0, x + 10, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 10, S);
    }
    // rust patches
    for (let k = 0; k < 10; k++) {
      const x = hash2(k, 5, 43) * S, y = hash2(5, k, 47) * S;
      const r = 6 + hash2(k, k, 49) * 18;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      g.addColorStop(0, 'rgba(140,80,40,0.30)');
      g.addColorStop(1, 'rgba(140,80,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
  });
}

/* ---- roof shingles ---- */
function texShingle() {
  return makeTex('shingle', 128, (ctx, S) => {
    noiseFill(ctx, S, '#7d4038', 16, 51);
    ctx.strokeStyle = 'rgba(30,12,10,0.5)'; ctx.lineWidth = 1.5;
    for (let y = 0; y < S; y += 12) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
      const off = ((y / 12) % 2) * 10;
      for (let x = off; x < S; x += 20) {
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 12); ctx.stroke();
      }
    }
  });
}

/* ---- water normal map (animated by offsetting) ---- */
function texWaterNormal() {
  return makeTex('waterN', 256, (ctx, S) => {
    // build a height field, then derive normals
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = 0;
      // a few octaves of smooth trig noise (tileable)
      v += Math.sin((x * 2 + y) / S * Math.PI * 6 + hash2(1, 1, 61) * 7) * 0.5;
      v += Math.sin((y * 2 - x) / S * Math.PI * 8 + hash2(2, 2, 63) * 7) * 0.3;
      v += Math.sin((x + y * 3) / S * Math.PI * 12 + hash2(3, 3, 65) * 7) * 0.2;
      hgt[y * S + x] = v;
    }
    const img = ctx.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const dx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
      const dy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
      const p = i * 4;
      d[p] = clamp(128 + dx * 120, 0, 255);
      d[p + 1] = clamp(128 + dy * 120, 0, 255);
      d[p + 2] = 255;
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, { linear: true });
}
