/* ============================================================
 * Micropolis 2000 — util.js
 * Helpers: seeded RNG, RLE codec, misc math.
 * ============================================================ */
'use strict';

// --- Seeded RNG (mulberry32) ---------------------------------
function RNG(seed) {
  let a = seed >>> 0;
  const f = function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n) => Math.floor(f() * n);
  f.chance = (p) => f() < p;
  f.pick = (arr) => arr[f.int(arr.length)];
  f.state = () => a;
  f.setState = (s) => { a = s >>> 0; };
  return f;
}

function hash2(x, y, seed) { // deterministic per-tile hash 0..1
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const clamp = (v, lo, hi) => v < lo ? lo : (v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

// --- RLE codec for typed arrays (network / save) --------------
// Encodes Uint8/Uint16 array as [val,count,val,count,...] regular array.
function rleEncode(arr) {
  const out = [];
  let i = 0;
  const n = arr.length;
  while (i < n) {
    const v = arr[i];
    let c = 1;
    while (i + c < n && arr[i + c] === v && c < 0xFFFF) c++;
    out.push(v, c);
    i += c;
  }
  return out;
}
function rleDecode(pairs, out) {
  let idx = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const v = pairs[i], c = pairs[i + 1];
    out.fill(v, idx, idx + c);
    idx += c;
  }
  return out;
}

// base64 helpers for save files
function b64FromArr(arr) {
  const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
  return btoa(s);
}
function arrFromB64(b64, Type) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Type(u8.buffer);
}

function fmtMoney(n) {
  const neg = n < 0; n = Math.abs(Math.round(n));
  const s = n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-$' : '$') + s;
}
function fmtNum(n) {
  n = Math.round(n);
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
