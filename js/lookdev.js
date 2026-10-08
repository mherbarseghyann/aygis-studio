// Look development: physically scaled procedural materials for the environments.
// Every recipe is baked once on the GPU (texbake.js) as a tile of known size in millimetres; meshes carry UVs in
// millimetres (uvBox / uvPlanar below), so a texture never drifts in scale between objects: oak pores are 0.3 mm,
// a linen thread 0.5 mm, a travertine block 600 mm, wherever they appear.
// Material values follow measured references: glazed porcelain is a white diffuse body (albedo ~0.85) under a clear
// glaze (clearcoat 1, roughness ~0.03); polished stainless steel F0 ~0.56, gold F0 (1.0, 0.77, 0.34), copper
// (0.95, 0.64, 0.54), brass (0.91, 0.78, 0.42); polished marble roughness ~0.08, honed stone ~0.4, travertine ~0.55,
// porous tuff ~0.85; oiled oak ~0.45; linen ~0.8 with sheen; glass IOR 1.52; water IOR 1.33.
import * as THREE from 'three';
import { bake } from './texbake.js';

const hex = (h) => `hexc(${h >>> 0}.)`;

// ------------------------------------------------------------------ recipes (GLSL)
function travCore(honed, scale, cols, rows, joint) {
  const k = (n) => (Math.max(1, Math.round(n * scale / 300))).toFixed(1);          // cells per tile for a 300 mm frequency
  const blocks = cols > 0;
  // cross-cut ("fleuri") travertine: cloudy ivory matrix, slight bedding, many small irregular pits (1 - 8 mm)
  // with a darker floor; honed surface.  Lattice-rotated noise (integer matrix) avoids grid artefacts and still tiles.
  return `
    ${blocks ? `const vec2 GRID = vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
    vec3 blk(vec2 uv){ vec2 g = uv * GRID; float row = floor(g.y); g.x += mod(row, 2.0) * 0.5; vec2 id = floor(g); id.x = mod(id.x, GRID.x); return vec3(fract(g), hash12(id + row * 7.0)); }
    float jnt(vec2 uv){ vec3 b = blk(uv); vec2 d = min(b.xy, 1.0 - b.xy) / GRID; return 1.0 - smoothstep(0.0, ${joint.toFixed(4)}, min(d.x, d.y)); }
    float bid(vec2 uv){ return blk(uv).z; }` : `float jnt(vec2 uv){ return 0.0; } float bid(vec2 uv){ return 0.0; }`}
    vec2 rot(vec2 uv){ return vec2(uv.x + 2.0 * uv.y, -2.0 * uv.x + uv.y); }
    float pitField(vec2 uv){ vec2 p = uv + bid(uv) * 3.1;
      vec4 v = voronoi(p * vec2(${k(26)}, ${k(64)}), vec2(${k(26)}, ${k(64)}), 1.0);      // cells ~11 x 5 mm: pits elongated along the bedding
      float sz = hash12(vec2(v.z, 3.7)); float r = mix(0.1, 0.34, sz * sz * sz) * step(0.72, hash12(vec2(v.z, 9.1)));
      float warp = 0.06 * gnoise(rot(p) * vec2(${k(200)}), vec2(${k(200)}));
      return 1.0 - smoothstep(r - 0.06, r + 0.02, v.x + warp); }
    float cloud(vec2 uv){ vec2 p = uv + bid(uv) * 5.3; return fbm(rot(p), vec2(${k(3)}), 5, 0.58) * 0.5 + 0.5; }
    vec3 albedo(vec2 uv){
      float c1 = cloud(uv), bed = fbm(vec2(uv.x * 0.25, uv.y), vec2(${k(1)}, ${k(10)}), 4, 0.55) * 0.5 + 0.5;
      vec3 c = mix(${hex(0xd8ccb8)}, ${hex(0xece5d8)}, smoothstep(0.3, 0.75, c1 * 0.75 + bed * 0.25));
      c = mix(c, ${hex(0xcbb99c)}, smoothstep(0.6, 0.9, bed) * 0.25);
      c *= 0.97 + 0.06 * bid(uv);
      float pit = pitField(uv);
      c = mix(c, ${hex(0xa29077)}, pit * 0.7);
      c = mix(c, ${hex(0x8f826c)}, jnt(uv) * 0.8);
      return c; }
    float rough(vec2 uv){ return ${honed.toFixed(2)} + 0.4 * pitField(uv) + 0.3 * jnt(uv); }
    float height(vec2 uv){ return -0.7 * pitField(uv) - 1.5 * jnt(uv); }`;
}

export const R = {
  oak: (tone = 'oak') => {
    const pal = { oak: [0xc0925e, 0x9c6b3e, 0xd8b384, 0x6e4a2a], walnut: [0x6b4529, 0x4a2c19, 0x8a6040, 0x2e1a0e], ash: [0xd8c4a0, 0xbaa078, 0xe9dcc0, 0x8d7656] }[tone];
    return `
    const float BOARDS = 4.0;
    float bid(vec2 uv){ return floor(uv.y * BOARDS); }
    float bv(vec2 uv){ return fract(uv.y * BOARDS); }
    float ringField(vec2 uv){ float b = bid(uv); float o = hash12(vec2(b, 3.1));
      float w = fbm(uv + vec2(o * 3.0, 0.0), vec2(2., 8.), 4, 0.55);
      return fract((bv(uv) * (3.0 + 4.0 * o) + w * 1.6 + 0.35 * sin(6.2831853 * (uv.x * 2.0 + o * 4.0)) + o * 9.0) * 2.0); }
    float pores(vec2 uv){ return smoothstep(0.62, 0.9, gnoise(uv * vec2(6., 700.), vec2(6., 700.)) * 0.5 + 0.5 + 0.25 * gnoise(uv * vec2(3., 180.), vec2(3., 180.))); }
    float joint(vec2 uv){ float v = bv(uv); return 1.0 - smoothstep(0.0, 0.0035, min(v, 1.0 - v)); }
    vec3 albedo(vec2 uv){
      float b = bid(uv); float o = hash12(vec2(b, 7.7));
      float r = ringField(uv); float late = smoothstep(0.55, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
      vec3 c = mix(${hex(pal[0])}, ${hex(pal[1])}, late * 0.85);
      c = mix(c, ${hex(pal[2])}, 0.25 * (fbm(uv, vec2(4., 20.), 3, 0.5) * 0.5 + 0.5));
      c *= 0.84 + 0.3 * o;
      c = mix(c, ${hex(pal[3])}, pores(uv) * 0.55);
      c = mix(c, ${hex(pal[3])} * 0.5, joint(uv));
      return c; }
    float rough(vec2 uv){ return 0.42 + 0.12 * pores(uv) + 0.06 * fbm(uv, vec2(3., 30.), 3, 0.5) + 0.3 * joint(uv); }
    float height(vec2 uv){ return -0.04 * pores(uv) - 0.6 * joint(uv) + 0.03 * fbm(uv, vec2(3., 40.), 3, 0.5); }`;
  },
  marble: (kind = 'carrara') => kind === 'nero' ? `
    vec2 warp(vec2 uv){ return uv + 0.22 * vec2(fbm(uv, vec2(2.), 5, 0.55), fbm(uv + 3.7, vec2(2.), 5, 0.55)); }
    float vein(vec2 q, vec2 per, float w){ float r = 1.0 - abs(gnoise(q * per, per)); return smoothstep(1.0 - w, 1.0, r); }
    vec3 albedo(vec2 uv){ vec2 q = warp(uv);
      vec3 base = mix(${hex(0x121214)}, ${hex(0x1d1d20)}, fbm(uv, vec2(5.), 4, 0.5) * 0.5 + 0.5);
      float main = vein(q, vec2(2.), 0.006) * step(0.35, fbm(uv + 7.0, vec2(2.), 3, 0.5) * 0.5 + 0.5);
      float fine = vein(q + 1.9, vec2(6.), 0.004) * step(0.6, fbm(uv + 2.0, vec2(3.), 3, 0.5) * 0.5 + 0.5);
      float v = main * 0.85 + fine * 0.4;
      return mix(base, ${hex(0xbdb8ae)}, clamp(v, 0., 1.)); }
    float rough(vec2 uv){ return 0.1; }
    float height(vec2 uv){ return 0.0; }` : (() => {
    const p = { carrara: [0xf1f0ec, 0xe1e0db, 0x80868c, 0xc6c8c8], nero: [0x1a1a1c, 0x232325, 0xd8d6d0, 0x3a3a3c], calacatta: [0xf3efe6, 0xe8e2d6, 0x9a8a72, 0xd6cbb8] }[kind];
    return `
    vec2 warp(vec2 uv){ return uv + 0.3 * vec2(fbm(uv, vec2(2.), 5, 0.55), fbm(uv + 3.7, vec2(2.), 5, 0.55)); }
    vec3 albedo(vec2 uv){ vec2 q = warp(uv);
      float v1 = pow(ridged(q, vec2(2.), 6), 7.0), v2 = pow(ridged(q + 1.3, vec2(5.), 5), 12.0);
      vec3 base = mix(${hex(p[0])}, ${hex(p[1])}, fbm(uv, vec2(6.), 4, 0.5) * 0.5 + 0.5);
      base = mix(base, ${hex(p[3])}, smoothstep(0.35, 0.95, pow(ridged(q, vec2(2.), 3), 2.0)) * 0.3);
      return mix(base, ${hex(p[2])}, clamp(v1 * 1.1 + v2 * 0.7, 0., 1.)); }
    float rough(vec2 uv){ return 0.09; }
    float height(vec2 uv){ return 0.0; }`;
  })(),
  // Travertine (the Cascade is clad in it): cream / ivory calcite with bedding bands and elongated vugs along the
  // bedding.  Real scale: pits 1 - 20 mm long, 0.5 - 5 mm wide; bands every 5 - 40 mm.  `scale` = tile size in mm.
  travertineSolid: (honed = 0.45, scale = 300) => travCore(honed, scale, 0, 0, 0),
  travertine: (honed = 0.55, cols = 2, rows = 3, joint = 0.0025, scale = 1200) => travCore(honed, scale, cols, rows, joint),
  // Armenian volcanic tuff (Artik pink / Yerevan orange / Ani black), ashlar blocks
  tuff: (tone = 'pink', cols = 3, rows = 4, tooled = 1) => {
    const p = { pink: [0xc49283, 0xb17b6c, 0xd6ab9b, 0x8f6a6a], orange: [0xc8875f, 0xb6704b, 0xd9a07a, 0x8d5c45], black: [0x4b4446, 0x3a3436, 0x5e5658, 0x2a2526], cream: [0xd8c6ad, 0xc8b394, 0xe6d8c2, 0xa8957c] }[tone];
    return `
    const vec2 GRID = vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
    vec3 blk(vec2 uv){ vec2 g = uv * GRID; float row = floor(g.y); g.x += mod(row, 2.0) * 0.5; vec2 id = floor(g); id.x = mod(id.x, GRID.x); return vec3(fract(g), hash12(id + row * 13.0)); }
    float jnt(vec2 uv){ vec3 b = blk(uv); vec2 d = min(b.xy, 1.0 - b.xy) / GRID; return 1.0 - smoothstep(0.0, 0.0028, min(d.x, d.y)); }
    float specks(vec2 uv){ return smoothstep(0.72, 0.86, vnoise(uv * vec2(380.), vec2(380.))); }
    float lith(vec2 uv){ return smoothstep(0.8, 0.9, vnoise(uv * vec2(140.) + 3.3, vec2(140.))); }
    vec3 albedo(vec2 uv){ vec3 b = blk(uv);
      vec3 c = mix(${hex(p[0])}, b.z > 0.5 ? ${hex(p[2])} : ${hex(p[1])}, abs(b.z - 0.5) * 1.4);
      c *= 0.9 + 0.2 * (fbm(uv + b.z, vec2(4.), 4, 0.55) * 0.5 + 0.5);
      c = mix(c, vec3(0.92, 0.88, 0.84), specks(uv) * 0.45);
      c = mix(c, ${hex(p[3])} * 0.6, lith(uv) * 0.6);
      c = mix(c, ${hex(p[3])} * 0.7, jnt(uv) * 0.7);
      return c; }
    float rough(vec2 uv){ return 0.84 + 0.08 * fbm(uv, vec2(20.), 3, 0.5); }
    float height(vec2 uv){ vec3 b = blk(uv);
      float tool = ${tooled.toFixed(1)} * 0.25 * gnoise(uv * vec2(GRID.x * 9., GRID.y * 30.), vec2(GRID.x * 9., GRID.y * 30.));
      return tool + 0.3 * fbm(uv, vec2(30.), 4, 0.5) - 0.25 * specks(uv) - 3.0 * jnt(uv); }`;
  },
  basalt: (cols = 2, rows = 2) => `
    const vec2 GRID = vec2(${cols.toFixed(1)}, ${rows.toFixed(1)});
    vec3 blk(vec2 uv){ vec2 g = uv * GRID; float row = floor(g.y); g.x += mod(row, 2.0) * 0.5; vec2 id = floor(g); id.x = mod(id.x, GRID.x); return vec3(fract(g), hash12(id + row * 5.0)); }
    float jnt(vec2 uv){ vec3 b = blk(uv); vec2 d = min(b.xy, 1.0 - b.xy) / GRID; return 1.0 - smoothstep(0.0, 0.004, min(d.x, d.y)); }
    vec3 albedo(vec2 uv){ vec3 b = blk(uv); float s = vnoise(uv * vec2(500.), vec2(500.));
      vec3 c = mix(hexc(4802891.), hexc(6119514.), s) * (0.9 + 0.2 * b.z);
      return mix(c, hexc(2631720.), jnt(uv) * 0.8); }
    float rough(vec2 uv){ return 0.72 + 0.1 * vnoise(uv * vec2(200.), vec2(200.)); }
    float height(vec2 uv){ return 0.15 * gnoise(uv * vec2(160.), vec2(160.)) - 2.0 * jnt(uv); }`,
  plaster: (base = 0xece6dc, mottle = 0.06) => `
    vec3 albedo(vec2 uv){ float n = fbm(uv, vec2(3.), 6, 0.6) * 0.5 + 0.5; return ${hex(base)} * (1.0 - ${mottle.toFixed(3)} + ${(2 * mottle).toFixed(3)} * n); }
    float rough(vec2 uv){ return 0.88 + 0.06 * fbm(uv, vec2(9.), 3, 0.5); }
    float height(vec2 uv){ return 0.25 * fbm(uv, vec2(5.), 6, 0.6); }`,
  paper: (base = 0xcfc9c0) => `
    vec3 albedo(vec2 uv){ return ${hex(base)} * (0.985 + 0.03 * vnoise(uv * vec2(64.), vec2(64.))); }
    float rough(vec2 uv){ return 0.92; }
    float height(vec2 uv){ return 0.01 * gnoise(uv * vec2(90.), vec2(90.)); }`,
  linen: (base = 0xe9e2d4, threads = 20) => `
    const float T = ${threads.toFixed(1)};
    float weave(vec2 uv){ vec2 p = uv * T; vec2 f = fract(p), i = floor(p); float o = mod(i.x + i.y, 2.0);
      float wa = sin(f.y * 3.14159) * (0.75 + 0.25 * cos(f.x * 6.2832)), we = sin(f.x * 3.14159) * (0.75 + 0.25 * cos(f.y * 6.2832));
      return mix(wa, we, o); }
    float slub(vec2 uv){ return gnoise(uv * vec2(2., T * 0.5), vec2(2., T * 0.5)) * 0.6 + gnoise(uv * vec2(T * 0.5, 2.), vec2(T * 0.5, 2.)) * 0.4; }
    vec3 albedo(vec2 uv){ return ${hex(base)} * (0.9 + 0.08 * weave(uv) + 0.05 * slub(uv)); }
    float rough(vec2 uv){ return 0.78 + 0.1 * weave(uv); }
    float height(vec2 uv){ return 0.08 * weave(uv) + 0.03 * slub(uv); }`,
  // woven check / stripe textile (picnic blanket): tile = one repeat of the pattern
  textile: (a = 0xefe6d2, b = 0x7a1f2b, c = 0x2f4a3a) => `
    const float T = 420.0;                                   // threads per tile (1 mm wool yarn)
    float weave(vec2 uv){ vec2 p = uv * T; vec2 f = fract(p), i = floor(p); float o = mod(i.x + i.y, 2.0);
      return mix(sin(f.y * 3.14159), sin(f.x * 3.14159), o); }
    vec3 stripe(float t){ float s = fract(t);
      if (s < 0.08) return ${hex(b)}; if (s < 0.1) return ${hex(a)}; if (s < 0.115) return ${hex(c)}; if (s < 0.13) return ${hex(a)}; if (s < 0.21) return ${hex(b)}; return ${hex(a)}; }
    vec3 albedo(vec2 uv){ vec2 p = uv * T; float o = mod(floor(p.x) + floor(p.y), 2.0);
      vec3 warp = stripe(uv.x), weft = stripe(uv.y);
      vec3 col = mix(warp, weft, 0.5 + (o - 0.5) * 0.5);
      return col * (0.86 + 0.14 * weave(uv)) * (0.96 + 0.06 * gnoise(uv * vec2(12.), vec2(12.))); }
    float rough(vec2 uv){ return 0.86; }
    float height(vec2 uv){ return 0.18 * weave(uv) + 0.06 * fbm(uv, vec2(6.), 3, 0.5); }`,
  rattan: (a = 0xe8dcc0, b = 0x1f3550) => `
    const float N = 10.0;      // strands per tile, each direction
    vec3 albedo(vec2 uv){ vec2 p = uv * N; vec2 i = floor(p), f = fract(p);
      float diag = mod(i.x + i.y, 4.0) < 2.0 ? 1.0 : 0.0;
      float over = mod(i.x + floor(i.y / 2.0), 2.0);
      vec3 col = mix(${hex(a)}, ${hex(b)}, diag);
      float edge = smoothstep(0.0, 0.12, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      return col * (0.55 + 0.45 * edge); }
    float rough(vec2 uv){ return 0.42; }
    float height(vec2 uv){ vec2 f = fract(uv * N); return 0.5 * sin(f.x * 3.14159) * sin(f.y * 3.14159); }`,
  wicker: () => `
    const vec2 N = vec2(14.0, 26.0);   // stakes x weavers per tile
    float h(vec2 uv){ vec2 p = uv * N; vec2 i = floor(p), f = fract(p); float o = mod(i.x + i.y, 2.0);
      float weaver = sin(f.y * 3.14159); float bulge = mix(0.4 + 0.6 * sin(f.x * 3.14159), 0.3, o);
      return weaver * bulge; }
    vec3 albedo(vec2 uv){ vec2 p = uv * N; float id = hash12(floor(p) + 3.0);
      vec3 c = mix(hexc(12493160.), hexc(10319932.), id * 0.7); return c * (0.45 + 0.6 * h(uv)); }
    float rough(vec2 uv){ return 0.58 + 0.2 * (1.0 - h(uv)); }
    float height(vec2 uv){ return 1.6 * h(uv); }`,
  hammered: () => `
    vec3 albedo(vec2 uv){ return vec3(1.0); }
    float rough(vec2 uv){ vec4 v = voronoi(uv * 9.0, vec2(9.), 0.9); return 0.2 + 0.12 * smoothstep(0.0, 0.25, v.y - v.x); }
    float height(vec2 uv){ vec4 v = voronoi(uv * 9.0, vec2(9.), 0.9); return -0.35 * (1.0 - v.x * v.x * 1.8); }`,
  brushed: () => `
    vec3 albedo(vec2 uv){ return vec3(1.0); }
    float rough(vec2 uv){ return 0.22 + 0.1 * (gnoise(uv * vec2(3., 600.), vec2(3., 600.)) * 0.5 + 0.5); }
    float height(vec2 uv){ return 0.004 * gnoise(uv * vec2(2., 900.), vec2(2., 900.)); }`,
  soil: () => `
    vec3 albedo(vec2 uv){ float n = fbm(uv, vec2(6.), 5, 0.55) * 0.5 + 0.5; float d = smoothstep(0.55, 0.8, vnoise(uv * vec2(90.), vec2(90.)));
      vec3 c = mix(hexc(4867881.), hexc(7695924.), n); return mix(c, hexc(9083725.), d * 0.6); }
    float rough(vec2 uv){ return 0.95; }
    float height(vec2 uv){ return 2.0 * fbm(uv, vec2(8.), 5, 0.55); }`,
  asphalt: () => `
    vec3 albedo(vec2 uv){ float s = vnoise(uv * vec2(420.), vec2(420.)); float m = fbm(uv, vec2(4.), 4, 0.5) * 0.5 + 0.5;
      return mix(hexc(4210752.), hexc(7039851.), s * 0.6 + m * 0.3); }
    float rough(vec2 uv){ return 0.86; }
    float height(vec2 uv){ return 0.4 * vnoise(uv * vec2(420.), vec2(420.)); }`,
  // a sprig of leaves on transparent ground: albedo.a via alpha()
  leaves: (g1 = 0x4f6b2a, g2 = 0x7d943c) => `
    #define HAS_ALPHA 1
    vec4 leafAt(vec2 uv){ vec4 best = vec4(0.0);
      for (int k = 0; k < 9; k++){ vec2 c = vec2(mod(float(k), 3.0), floor(float(k) / 3.0)) / 3.0 + 1.0 / 6.0;
        c += (hash22(vec2(float(k), 1.7)) - 0.5) * 0.12; float a = hash12(vec2(float(k), 9.1)) * 6.283;
        vec2 d = uv - c; d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d; d.x /= 0.16; d.y /= 0.07;
        float r = dot(d, d); if (r < 1.0){ float rib = 1.0 - smoothstep(0.0, 0.06, abs(d.y)); best = vec4(hash12(vec2(float(k), 4.4)), r, rib, 1.0); } }
      return best; }
    vec3 albedo(vec2 uv){ vec4 l = leafAt(uv); vec3 c = mix(${hex(g1)}, ${hex(g2)}, l.x); c *= 0.8 + 0.25 * (1.0 - l.y); return mix(c, c * 1.25, l.z * 0.5); }
    float alpha(vec2 uv){ return leafAt(uv).w; }
    float rough(vec2 uv){ return 0.55; }
    float height(vec2 uv){ vec4 l = leafAt(uv); return 0.4 * (1.0 - l.y) * l.w - 0.1 * l.z; }`,
};

/** bake a recipe (cached) */
export function texSet(key, glsl, opts) { return bake(key, glsl, opts); }

// ------------------------------------------------------------------ UV helpers (UVs in millimetres)
/** box projection: every face gets planar UVs (mm) from its dominant normal axis */
export function uvBox(geo, rot = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const p = geo.attributes.position, n = geo.attributes.normal || (geo.computeVertexNormals(), geo.attributes.normal);
  const uv = new Float32Array(p.count * 2);
  const c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < p.count; i += 3) {
    // per-face axis from the face normal (avoid stretched seams inside a face)
    const nx = Math.abs(n.getX(i) + n.getX(i + 1) + n.getX(i + 2)), ny = Math.abs(n.getY(i) + n.getY(i + 1) + n.getY(i + 2)), nz = Math.abs(n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
    for (let k = i; k < i + 3; k++) {
      let u, v;
      if (ny >= nx && ny >= nz) { u = p.getX(k); v = p.getZ(k); }
      else if (nx >= nz) { u = p.getZ(k); v = p.getY(k); }
      else { u = p.getX(k); v = p.getY(k); }
      uv[k * 2] = u * c - v * s; uv[k * 2 + 1] = u * s + v * c;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
/** planar UVs (mm) on the XZ plane */
export function uvPlanar(geo, axis = 'y') {
  const p = geo.attributes.position; const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    if (axis === 'y') { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getZ(i); }
    else if (axis === 'z') { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getY(i); }
    else { uv[i * 2] = p.getZ(i); uv[i * 2 + 1] = p.getY(i); }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** after the (single, shared) GPU upload the CPU copy of a baked texture is dead weight: every clone of a bake has the
 *  same sampler state, so three keeps one GL texture per bake and never re-uploads it */
function dropCpuCopy(t) { if (t.image && t.image.data) t.image.data = null; }
/** standard / physical material from a baked set, UVs in mm */
export function texMat(set, { physical = false, tile = set.tile, rotation = 0, normalScale = 1, roughness = 1, color = 0xffffff, ...rest } = {}) {
  // Standard unless physically required: MeshPhysicalMaterial programs are several times more expensive to compile
  // (seconds each on ANGLE / Metal) and to shade; clearcoat / sheen on props are below what the camera resolves.
  const M = physical === 'force' ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  for (const k of ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenRoughness', 'sheenColor', 'specularIntensity', 'ior', 'transmission', 'thickness']) if (M === THREE.MeshStandardMaterial) delete rest[k];
  const m = new M({ color, roughness, metalness: 0, ...rest });
  const rep = 1 / tile;
  for (const [k, dst] of [['map', 'map'], ['roughnessMap', 'roughnessMap'], ['normalMap', 'normalMap']]) {
    if (!set[k]) continue;
    let t;
    if (set[k].userData.rt) { t = set[k]; t.repeat.set(rep, rep); t.rotation = rotation; }     // GPU bake: shared texture object
    else { t = set[k].clone(); t.repeat.set(rep, rep); t.rotation = rotation; t.needsUpdate = true; t.userData.shared = false; t.onUpdate = dropCpuCopy; }
    m[dst] = t;
  }
  if (set.roughnessMap && rest.metalness === undefined) { m.metalnessMap = null; }
  if (m.normalMap) m.normalScale = new THREE.Vector2(normalScale, normalScale);
  return m;
}

// ------------------------------------------------------------------ calibrated material presets
const S = (o) => new THREE.MeshStandardMaterial(o);
/** the ONE transmissive program: glass, water, wine and coloured bottle glass share it (only uniforms differ) */
const T = (o) => new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 0.02, transmission: 1, ior: 1.52, specularIntensity: 1, ...o });
export const MAT = {
  porcelain: (tint = 0xf3f0e9) => S({ color: tint, roughness: 0.07 }),                    // glazed: white body under a smooth glaze
  stoneware: (tint = 0x2b2826) => S({ color: tint, roughness: 0.4 }),
  steel: () => { const s = texSet('brushed_60', R.brushed(), { size: 512, tile: 60, maps: ['rough', 'normal'] }); return texMat(s, { physical: true, color: new THREE.Color().setRGB(0.56, 0.56, 0.55), metalness: 1, roughness: 0.55, tile: 60 }); },
  silver: () => S({ color: new THREE.Color().setRGB(0.95, 0.93, 0.88), metalness: 1, roughness: 0.12 }),
  gold: () => S({ color: new THREE.Color().setRGB(1.0, 0.77, 0.34), metalness: 1, roughness: 0.18 }),
  brass: (rough = 0.3) => S({ color: new THREE.Color().setRGB(0.91, 0.76, 0.42), metalness: 1, roughness: rough }),
  copperHammered: () => { const s = texSet('hammered_40', R.hammered(), { size: 512, tile: 40, maps: ['rough', 'normal'] }); return texMat(s, { physical: true, color: new THREE.Color().setRGB(0.95, 0.62, 0.5), metalness: 1, roughness: 1, tile: 40, normalScale: 1 }); },
  castIron: () => S({ color: 0x1d1c1b, metalness: 0.6, roughness: 0.55 }),
  paintedMetal: (c = 0x1f2a24) => S({ color: c, metalness: 0.0, roughness: 0.3 }),
  glass: (tint = 0xffffff, att = 0xeef5f0, dist = 400) => T({ color: tint, thickness: 2.0, attenuationColor: new THREE.Color(att), attenuationDistance: dist }),
  water: () => T({ color: 0xffffff, roughness: 0.01, thickness: 40, ior: 1.33, attenuationColor: new THREE.Color(0xe4f0ee), attenuationDistance: 300 }),
  wine: () => T({ color: 0xffffff, thickness: 60, ior: 1.35, attenuationColor: new THREE.Color(0x6a0c1a), attenuationDistance: 22 }),
  espresso: () => {
    // crema: tan with darker tiger-flecks and a darker rim
    const m = S({ color: 0x9a5a2a, roughness: 0.18 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vP = position;');
      sh.fragmentShader = 'varying vec3 vP;\nfloat eh(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }\nfloat en(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return mix(mix(eh(i), eh(i+vec2(1,0)), f.x), mix(eh(i+vec2(0,1)), eh(i+vec2(1,1)), f.x), f.y); }\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float rr = length(vP.xz); float a = atan(vP.z, vP.x);
        float sw = en(vec2(a * 3.0 + rr * 0.25, rr * 0.35)) * 0.6 + en(vP.xz * 0.6) * 0.4;
        vec3 crema = mix(vec3(0.42, 0.2, 0.07), vec3(0.62, 0.36, 0.15), sw);
        crema = mix(crema, vec3(0.16, 0.06, 0.02), smoothstep(0.8, 1.0, rr / 26.0));
        diffuseColor.rgb = crema;`);
    };
    return m;
  },
  linen: (c = 0xe9e2d4) => texMat(texSet('linen_' + c + '_10', R.linen(c), { size: 512, tile: 10, maps: ['albedo', 'rough', 'normal'] }), { physical: true, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), tile: 10, side: THREE.DoubleSide }),
  oak: (tone = 'oak', tile = 600) => texMat(texSet(`oak_${tone}_${tile}`, R.oak(tone), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { physical: true, tile, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
  marble: (kind = 'carrara', tile = 700, honed = 0) => { const m = texMat(texSet(`marble3_${kind}_${tile}`, R.marble(kind), { size: 2048, tile, maps: ['albedo', 'rough', 'normal'] }), { physical: true, tile, clearcoat: 0.0, specularIntensity: 1, ior: 1.55 }); if (honed) { m.roughnessMap = null; m.roughness = honed; } return m; },
  travertineSolid: (tile = 300, honed = 0.45) => texMat(texSet(`travsolid4_${honed}_${tile}`, R.travertineSolid(honed, tile), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  travertine: (tile = 1200, honed = 0.55, cols = 2, rows = 3) => texMat(texSet(`trav4_${honed}_${cols}_${rows}_${tile}`, R.travertine(honed, cols, rows, 0.0025, tile), { size: 2048, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  tuff: (tone = 'pink', tile = 1500, cols = 3, rows = 4) => texMat(texSet(`tuff_${tone}_${cols}_${rows}_${tile}`, R.tuff(tone, cols, rows), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  basalt: (tile = 1200) => texMat(texSet(`basalt_${tile}`, R.basalt(), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  plaster: (c = 0xece6dc, tile = 1500) => texMat(texSet(`plaster_${c}_${tile}`, R.plaster(c), { size: 512, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  paper: (c = 0xcfc9c0, tile = 400) => texMat(texSet(`paper_${c}_${tile}`, R.paper(c), { size: 512, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  textile: (tile = 420) => texMat(texSet(`textile_${tile}`, R.textile(), { size: 2048, tile, maps: ['albedo', 'rough', 'normal'] }), { physical: true, tile, sheen: 0.8, sheenRoughness: 0.7, sheenColor: new THREE.Color(0xfff8ec), side: THREE.DoubleSide }),
  rattan: (tile = 60) => texMat(texSet(`rattan_${tile}`, R.rattan(), { size: 512, tile, maps: ['albedo', 'rough', 'normal'] }), { physical: true, tile, clearcoat: 0.3, clearcoatRoughness: 0.4, side: THREE.DoubleSide }),
  wicker: (tile = 140) => texMat(texSet(`wicker_${tile}`, R.wicker(), { size: 512, tile, maps: ['albedo', 'rough', 'normal'] }), { tile, side: THREE.DoubleSide }),
  soil: (tile = 900) => texMat(texSet(`soil_${tile}`, R.soil(), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  asphalt: (tile = 1400) => texMat(texSet(`asphalt_${tile}`, R.asphalt(), { size: 1024, tile, maps: ['albedo', 'rough', 'normal'] }), { tile }),
  leaves: (g1, g2, tile = 400) => { const s = texSet(`leaves_${g1}_${g2}_${tile}`, R.leaves(g1, g2), { size: 512, tile, maps: ['albedo', 'rough', 'normal'], defines: {} }); const m = texMat(s, { tile, side: THREE.DoubleSide, alphaTest: 0.5 }); return m; },
  velvet: (c = 0x2a1416) => S({ color: c, roughness: 0.95 }),
  matte: (c, rough = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 }),
  emissive: (c, intensity = 1) => { const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(intensity) }); m.userData.emitter = true; return m; },
};

// Presets are memoised per environment build: every plate uses the same porcelain material instance, every chair the
// same oak, ... -> fewer material switches and, with mergeStatic() in the viewer, far fewer draw calls.
// (Materials that a set needs to modify are .clone()d at the call site.)
const MAT_CACHE = new Map();
for (const k of ['porcelain', 'stoneware', 'steel', 'silver', 'gold', 'brass', 'copperHammered', 'castIron', 'paintedMetal', 'glass', 'water', 'wine',
  'linen', 'oak', 'marble', 'travertine', 'travertineSolid', 'tuff', 'basalt', 'plaster', 'paper', 'textile', 'rattan', 'wicker', 'soil', 'asphalt', 'leaves', 'velvet']) {
  const f = MAT[k];
  MAT[k] = (...a) => { const key = k + JSON.stringify(a); let m = MAT_CACHE.get(key); if (!m) { m = f(...a); MAT_CACHE.set(key, m); } return m; };
}
export function clearMaterialCache() { MAT_CACHE.clear(); }
