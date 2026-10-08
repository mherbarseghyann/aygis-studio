// Procedural textures and backdrops for the environment system (no external image assets):
// simplex-noise based fbm, material textures (wood, marble, linen, gingham, tuff stone, paper) and
// equirectangular backdrops (sky gradient, bokeh lights, soft windows, mountain silhouette) that are used
// both as the visible background and as the image-based lighting (PMREM).
import * as THREE from 'three';

// ---------------------------------------------------------------- noise
const PERM = new Uint8Array(512);
(function seed() { let s = 1337; const p = []; for (let i = 0; i < 256; i++) p[i] = i; for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]; })();
const G2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), GG2 = (3 - Math.sqrt(3)) / 6;
export function snoise(x, y) {
  const s = (x + y) * F2; const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * GG2; const X0 = i - t, Y0 = j - t; const x0 = x - X0, y0 = y - Y0;
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + GG2, y1 = y0 - j1 + GG2, x2 = x0 - 1 + 2 * GG2, y2 = y0 - 1 + 2 * GG2;
  const ii = i & 255, jj = j & 255;
  let n = 0;
  const c = [[x0, y0, PERM[ii + PERM[jj]] % 8], [x1, y1, PERM[ii + i1 + PERM[jj + j1]] % 8], [x2, y2, PERM[ii + 1 + PERM[jj + 1]] % 8]];
  for (const [px, py, gi] of c) { let tt = 0.5 - px * px - py * py; if (tt > 0) { tt *= tt; n += tt * tt * (G2[gi][0] * px + G2[gi][1] * py); } }
  return 70 * n;
}
export function fbm(x, y, oct = 5, lac = 2.0, gain = 0.5) { let a = 1, f = 1, s = 0, norm = 0; for (let o = 0; o < oct; o++) { s += a * snoise(x * f, y * f); norm += a; a *= gain; f *= lac; } return s / norm; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, k) => a + (b - a) * k;
function rgb(r, g, b) { return [clamp01(r), clamp01(g), clamp01(b)]; }
function lerpRGB(a, b, k) { return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)]; }
function hex(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }

function canvasTexture(size, fn, opts = {}) {
  const c = document.createElement('canvas'); c.width = size; c.height = opts.height || size;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(c.width, c.height); const d = img.data;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const [r, g, b] = fn(x / c.width, y / c.height, x, y); const o = (y * c.width + x) * 4;
    d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy || 8; t.needsUpdate = true;
  return t;
}
/** height field (0..1 grey) -> tangent-space normal map texture */
function normalFromHeight(size, hfn, strength = 1.0) {
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = hfn(x / size, y / size);
  return canvasTexture(size, (u, v, x, y) => {
    const l = H[y * size + ((x - 1 + size) % size)], r = H[y * size + ((x + 1) % size)];
    const t = H[((y - 1 + size) % size) * size + x], b = H[((y + 1) % size) * size + x];
    const nx = -(r - l) * strength * size * 0.5, ny = -(b - t) * strength * size * 0.5;
    const len = Math.hypot(nx, ny, 1);
    return [nx / len * 0.5 + 0.5, ny / len * 0.5 + 0.5, 1 / len * 0.5 + 0.5];
  }, { linear: true });
}

export function canvasTextureFn(size, fn, opts) { return canvasTexture(size, fn, opts); }

const cache = {};
function memo(key, fn) { if (!cache[key]) cache[key] = fn(); return cache[key]; }

// ---------------------------------------------------------------- material textures (tileable, 1 tile = `tile` mm)
export function paperDetail() {
  // subtle fibre / coating roughness variation for coated board (linear data)
  return memo('paper', () => ({
    bump: canvasTexture(512, (u, v) => { const n = 0.5 + 0.5 * fbm(u * 60, v * 60, 4) * 0.35 + 0.03 * snoise(u * 400, v * 400); return [n, n, n]; }, { linear: true }),
    rough: canvasTexture(512, (u, v) => { const n = 0.58 + 0.12 * fbm(u * 24, v * 24, 3) + 0.05 * snoise(u * 300, v * 300); return [n, n, n]; }, { linear: true }),
  }));
}

export function woodTexture(tone = 'oak') {
  const pal = { oak: [hex(0xb98a56), hex(0x8a5f35), hex(0xd5b082)], walnut: [hex(0x4b2f1d), hex(0x2e1a10), hex(0x6b4631)], ash: [hex(0xd9c7a6), hex(0xb49a76), hex(0xe9dcc3)] }[tone];
  return memo('wood_' + tone, () => {
    const map = canvasTexture(512, (u, v) => {
      const plank = Math.floor(v * 4); const pv = (v * 4) % 1; const off = plank * 13.7;
      const grain = fbm(u * 3 + off, v * 40 + off * 0.3, 5, 2.1, 0.55);
      const rings = Math.sin((u * 2 + grain * 0.8 + off) * 12) * 0.5 + 0.5;
      let col = lerpRGB(pal[0], pal[1], Math.pow(rings, 2.2) * 0.8 + 0.1 * Math.abs(snoise(u * 500, v * 20)));
      col = lerpRGB(col, pal[2], 0.15 * clamp01(fbm(u * 8 + off, v * 2, 3) + 0.3));
      const edge = Math.min(pv, 1 - pv) < 0.012 ? 0.55 : 1.0;      // plank joints
      return [col[0] * edge, col[1] * edge, col[2] * edge];
    });
    const normal = normalFromHeight(512, (u, v) => { const off = Math.floor(v * 4) * 13.7; return 0.5 + 0.08 * fbm(u * 3 + off, v * 40, 4) + (Math.min((v * 4) % 1, 1 - (v * 4) % 1) < 0.012 ? -0.4 : 0); }, 0.25);
    const rough = canvasTexture(512, (u, v) => { const n = 0.45 + 0.15 * fbm(u * 6, v * 30, 3); return [n, n, n]; }, { linear: true });
    return { map, normal, rough };
  });
}

export function marbleTexture(tone = 'white') {
  const pal = { white: [hex(0xf2efe9), hex(0x9a9792), hex(0xd8d4cc)], black: [hex(0x1b1b1d), hex(0x6a6760), hex(0x3a3a3c)], cream: [hex(0xefe6d6), hex(0xa89a84), hex(0xd9cdb8)] }[tone];
  return memo('marble_' + tone, () => {
    const map = canvasTexture(512, (u, v) => {
      const w = fbm(u * 4, v * 4, 6, 2.2, 0.55);
      const vein = Math.pow(1 - Math.abs(Math.sin((u * 3 + v * 1.5 + w * 1.4) * 3.1416)), 14);
      const vein2 = Math.pow(1 - Math.abs(Math.sin((u * 1.2 - v * 2.3 + w * 2.2) * 3.1416 + 1.3)), 24) * 0.7;
      const cloud = 0.5 + 0.5 * fbm(u * 10, v * 10, 4);
      let col = lerpRGB(pal[0], pal[2], cloud * 0.5);
      col = lerpRGB(col, pal[1], clamp01(vein * 0.9 + vein2));
      return col;
    });
    const rough = canvasTexture(512, (u, v) => { const n = 0.22 + 0.08 * fbm(u * 8, v * 8, 3); return [n, n, n]; }, { linear: true });
    return { map, rough, normal: null };
  });
}

export function linenTexture(base = 0xe8e2d6) {
  const b = hex(base);
  return memo('linen_' + base, () => ({
    map: canvasTexture(512, (u, v) => { const weave = 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 90) * Math.sin(v * 2 * Math.PI * 90); const n = 0.92 + 0.08 * weave + 0.04 * fbm(u * 20, v * 20, 3); return [b[0] * n, b[1] * n, b[2] * n]; }),
    normal: normalFromHeight(256, (u, v) => 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 45) * Math.sin(v * 2 * Math.PI * 45) * 0.5, 0.12),
    rough: canvasTexture(256, (u, v) => { const n = 0.85 + 0.1 * fbm(u * 10, v * 10, 2); return [n, n, n]; }, { linear: true }),
  }));
}

export function ginghamTexture(colA = 0xc9433f, colB = 0xf4efe6) {
  const a = hex(colA), b = hex(colB);
  return memo('gingham_' + colA, () => ({
    map: canvasTexture(512, (u, v) => {
      const sx = Math.floor(u * 8) % 2, sy = Math.floor(v * 8) % 2;
      const k = sx && sy ? 1 : (sx || sy ? 0.55 : 0);
      const weave = 0.96 + 0.04 * Math.sin(u * 2 * Math.PI * 160) * Math.sin(v * 2 * Math.PI * 160);
      const c = lerpRGB(b, a, k);
      return [c[0] * weave, c[1] * weave, c[2] * weave];
    }),
    normal: normalFromHeight(256, (u, v) => 0.5 + 0.3 * Math.sin(u * 2 * Math.PI * 80) * Math.sin(v * 2 * Math.PI * 80), 0.1),
    rough: canvasTexture(128, () => [0.9, 0.9, 0.9], { linear: true }),
  }));
}

export function tuffTexture(tone = 'pink') {
  const pal = { pink: [hex(0xc49a8c), hex(0xa07a6e), hex(0xd4b3a4)], black: [hex(0x4a4446), hex(0x2d2a2b), hex(0x6a6264)], ochre: [hex(0xc9a583), hex(0x9c7b5c), hex(0xdcc1a3)] }[tone];
  return memo('tuff_' + tone, () => ({
    map: canvasTexture(512, (u, v) => {
      const pores = clamp01(Math.pow(0.5 + 0.5 * snoise(u * 260, v * 260), 9));
      const cloud = 0.5 + 0.5 * fbm(u * 5, v * 5, 4);
      let col = lerpRGB(pal[0], pal[2], cloud * 0.5);
      col = lerpRGB(col, pal[1], pores * 0.38 + 0.08 * clamp01(fbm(u * 30, v * 30, 3)));
      return col;
    }),
    normal: normalFromHeight(512, (u, v) => 0.5 - 0.25 * clamp01(Math.pow(0.5 + 0.5 * snoise(u * 260, v * 260), 9)) + 0.06 * fbm(u * 30, v * 30, 3), 0.25),
    rough: canvasTexture(256, (u, v) => { const n = 0.9 + 0.08 * fbm(u * 10, v * 10, 2); return [n, n, n]; }, { linear: true }),
  }));
}

export function grassTexture() {
  return memo('grass', () => ({
    map: canvasTexture(512, (u, v) => { const n = 0.5 + 0.5 * fbm(u * 14, v * 14, 4); const b = 0.5 + 0.5 * snoise(u * 220, v * 220); const k = 0.55 + 0.45 * n * b; return [0.22 * k + 0.08, 0.42 * k + 0.1, 0.12 * k + 0.04]; }),
    normal: normalFromHeight(256, (u, v) => 0.5 + 0.3 * snoise(u * 220, v * 220) + 0.1 * fbm(u * 20, v * 20, 3), 0.35),
    rough: canvasTexture(128, () => [0.95, 0.95, 0.95], { linear: true }),
  }));
}

export function lacquerTexture() {
  return memo('lacquer', () => ({
    map: canvasTexture(256, (u, v) => { const n = 0.09 + 0.02 * fbm(u * 6, v * 6, 3); return [n * 1.05, n * 0.95, n]; }),
    normal: null,
    rough: canvasTexture(256, (u, v) => { const n = 0.18 + 0.06 * fbm(u * 30, v * 30, 3); return [n, n, n]; }, { linear: true }),
  }));
}

export function plasterTexture(base = 0xd9d2c7) {
  const b = hex(base);
  return memo('plaster_' + base, () => ({
    map: canvasTexture(512, (u, v) => { const n = 0.94 + 0.06 * fbm(u * 12, v * 12, 4); return [b[0] * n, b[1] * n, b[2] * n]; }),
    normal: normalFromHeight(256, (u, v) => 0.5 + 0.2 * fbm(u * 14, v * 14, 4), 0.15),
    rough: canvasTexture(128, () => [0.92, 0.92, 0.92], { linear: true }),
  }));
}

// ---------------------------------------------------------------- equirect backdrops
/**
 * opts: top, horizon, ground (RGB hex), haze (0..1), bokeh: [{u, v, r, color, a}], windows: [{u,v,w,h,color,a}],
 *       mountains: {color, base, peaks:[{u, h, w}]}, stripes (shop shelves), vignette
 */
export function equirectBackdrop(opts, size = 1024) {
  const top = hex(opts.top), hor = hex(opts.horizon), gnd = hex(opts.ground);
  const W = size, H = size / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H); const d = img.data;
  const horizonV = opts.horizonV !== undefined ? opts.horizonV : 0.5;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    let col;
    if (v < horizonV) { const k = Math.pow(v / horizonV, opts.skyCurve || 1.6); col = lerpRGB(top, hor, k); }
    else { const k = Math.pow((v - horizonV) / (1 - horizonV), 0.7); col = lerpRGB(hor, gnd, k); }
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let [r, g, b] = col;
      // slow horizontal variation (room / street light balance)
      const var1 = 1 + (opts.variation || 0.08) * snoise(u * 4, v * 2);
      r *= var1; g *= var1; b *= var1;
      if (opts.mountains && v < horizonV) {
        const m = opts.mountains; let hgt = 0;
        for (const p of m.peaks) { const du = Math.min(Math.abs(u - p.u), 1 - Math.abs(u - p.u)) / p.w; hgt = Math.max(hgt, p.h * Math.max(0, 1 - du * du)); }
        hgt += 0.004 * fbm(u * 60, 0, 3);
        if (v > horizonV - hgt) { const mc = hex(m.color); const k = clamp01((v - (horizonV - hgt)) / 0.02); const haze = clamp01(1 - hgt * 6); const mcol = lerpRGB(mc, hor, haze * 0.6); r = mix(r, mcol[0], k); g = mix(g, mcol[1], k); b = mix(b, mcol[2], k); }
      }
      if (opts.stripes && v < horizonV) {          // shelf bands (confectionery / library)
        const s = opts.stripes; const band = Math.sin(v * Math.PI * s.count * 2);
        if (band > 0.75 && u > s.u0 && u < s.u1) { const sc = hex(s.color); const k = (band - 0.75) * 4 * s.a; r = mix(r, sc[0], k); g = mix(g, sc[1], k); b = mix(b, sc[2], k); }
      }
      const o = (y * W + x) * 4; d[o] = clamp01(r) * 255; d[o + 1] = clamp01(g) * 255; d[o + 2] = clamp01(b) * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // soft windows / softboxes (large bright rectangles -> the main reflections)
  for (const w of (opts.windows || [])) {
    const g = ctx.createLinearGradient(0, (w.v - w.h / 2) * H, 0, (w.v + w.h / 2) * H);
    ctx.save(); ctx.globalAlpha = w.a; ctx.fillStyle = '#' + w.color.toString(16).padStart(6, '0');
    ctx.filter = `blur(${(w.blur || 6) * size / 1024}px)`;
    ctx.fillRect((w.u - w.w / 2) * W, (w.v - w.h / 2) * H, w.w * W, w.h * H); ctx.restore();
  }
  // bokeh lights
  for (const bk of (opts.bokeh || [])) {
    const rad = bk.r * W;
    const g = ctx.createRadialGradient(bk.u * W, bk.v * H, 0, bk.u * W, bk.v * H, rad);
    const colr = '#' + bk.color.toString(16).padStart(6, '0');
    g.addColorStop(0, colr); g.addColorStop(0.7, colr); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalAlpha = bk.a; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bk.u * W, bk.v * H, rad, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (opts.vignette) { const g = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.3, W / 2, H * 0.55, H * 1.1); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${opts.vignette})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.SRGBColorSpace; tex.needsUpdate = true;
  tex.userData.canvas = c;
  return tex;
}

/** random-but-deterministic bokeh set */
export function bokehSet(n, seed, { vMin = 0.2, vMax = 0.48, rMin = 0.012, rMax = 0.03, colors = [0xffd9a0, 0xffc070, 0xfff1d6], aMin = 0.35, aMax = 0.8 } = {}) {
  let s = seed; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out = [];
  for (let i = 0; i < n; i++) out.push({ u: rnd(), v: vMin + rnd() * (vMax - vMin), r: rMin + rnd() * (rMax - rMin), color: colors[Math.floor(rnd() * colors.length)], a: aMin + rnd() * (aMax - aMin) });
  return out;
}
