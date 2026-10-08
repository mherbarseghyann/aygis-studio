// GPU texture baker: procedural material maps (albedo / roughness / height -> normal) rendered once in a fragment
// shader, read back and uploaded as ordinary mip-mapped, anisotropic DataTextures.  Baking on the GPU takes a few
// milliseconds per 1024² map (the old per-pixel canvas loops took seconds), so every surface can have physically
// scaled detail: one texture tile always represents a known size in millimetres.
//
// A recipe is GLSL that defines
//   vec3  albedo(vec2 uv)   linear albedo 0..1          (baked as sRGB)
//   float rough(vec2 uv)    perceptual roughness 0..1   (baked into G, AO = R = 1, metalness = B)
//   float height(vec2 uv)   height in millimetres       (baked as a tangent-space normal map)
//   float metal(vec2 uv)    optional metalness          (define HAS_METAL)
// uv covers exactly one tile (0..1); `uTile` is the tile size in mm so slopes are physically correct.
// All noise functions below are periodic, so the tile repeats seamlessly.
import * as THREE from 'three';

export const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
// periodic gradient noise, period per cells, ~[-1, 1]
float gnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 ga = hash22(mod(i, per)) * 2. - 1., gb = hash22(mod(i + vec2(1., 0.), per)) * 2. - 1.;
  vec2 gc = hash22(mod(i + vec2(0., 1.), per)) * 2. - 1., gd = hash22(mod(i + vec2(1., 1.), per)) * 2. - 1.;
  float va = dot(ga, f), vb = dot(gb, f - vec2(1., 0.)), vc = dot(gc, f - vec2(0., 1.)), vd = dot(gd, f - vec2(1., 1.));
  return mix(mix(va, vb, u.x), mix(vc, vd, u.x), u.y) * 1.6;
}
float vnoise(vec2 p, vec2 per){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(mod(i, per)), hash12(mod(i + vec2(1., 0.), per)), u.x), mix(hash12(mod(i + vec2(0., 1.), per)), hash12(mod(i + vec2(1., 1.), per)), u.x), u.y);
}
// fractal sum; uv in tile space, base = cells across the tile on the first octave (integer per axis)
float fbm(vec2 uv, vec2 base, int oct, float gain){
  float s = 0., a = 1., n = 0.; vec2 per = base;
  // per-octave offset (in cells, so the tile still repeats): octaves no longer share lattice zeros -> no grid pattern
  for (int i = 0; i < 10; i++){ if (i >= oct) break; s += a * gnoise(uv * per + vec2(0.37, 0.71) * float(i + 1), per); n += a; per *= 2.; a *= gain; }
  return s / n;
}
float ridged(vec2 uv, vec2 base, int oct){
  float s = 0., a = 0.5, n = 0.; vec2 per = base;
  for (int i = 0; i < 10; i++){ if (i >= oct) break; float r = 1. - abs(gnoise(uv * per + vec2(0.61, 0.29) * float(i + 1), per)); s += a * r * r; n += a; per *= 2.; a *= 0.5; }
  return s / n;
}
// periodic voronoi: x = F1, y = F2, z = cell id hash, w = second id
vec4 voronoi(vec2 p, vec2 per, float jitter){
  vec2 i = floor(p), f = fract(p); float F1 = 8., F2 = 8., id = 0., id2 = 0.;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y)); vec2 c = mod(i + g, per);
    vec2 o = 0.5 + (hash22(c) - 0.5) * jitter; vec2 r = g + o - f; float d = dot(r, r);
    if (d < F1){ F2 = F1; id2 = id; F1 = d; id = hash12(c * 1.37 + 0.5); } else if (d < F2){ F2 = d; id2 = hash12(c * 1.37 + 0.5); }
  }
  return vec4(sqrt(F1), sqrt(F2), id, id2);
}
float sat(float x){ return clamp(x, 0., 1.); }
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }   // author colours in sRGB-ish hex, convert to linear
vec3 hexc(float h){ return srgb(vec3(floor(h / 65536.), mod(floor(h / 256.), 256.), mod(h, 256.)) / 255.); }
`;

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

function fragFor(recipe, mode) {
  return /* glsl */`precision highp float;
varying vec2 vUv; uniform float uTile; uniform float uRes; uniform float uStrength;
${NOISE_GLSL}
${recipe}
vec3 lin2srgb(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main(){
  vec2 uv = vUv;
#if MODE == 0
  float al = 1.0;
  #ifdef HAS_ALPHA
  al = alpha(uv);
  #endif
  #ifdef READBACK
  gl_FragColor = vec4(lin2srgb(clamp(albedo(uv), 0., 1.)), al);   // RGBA8 read back, uploaded as sRGB
  #else
  gl_FragColor = vec4(clamp(albedo(uv), 0., 1.), al);            // sRGB render target: the GPU encodes on write
  #endif
#elif MODE == 1
  float m = 0.0;
  #ifdef HAS_METAL
  m = metal(uv);
  #endif
  gl_FragColor = vec4(1.0, clamp(rough(uv), 0.02, 1.0), clamp(m, 0., 1.), 1.0);
#else
  float e = 1.0 / uRes; float mm = uTile / uRes;                 // texel size in uv and in mm
  float hl = height(uv - vec2(e, 0.)), hr = height(uv + vec2(e, 0.));
  float hd = height(uv - vec2(0., e)), hu = height(uv + vec2(0., e));
  vec3 n = normalize(vec3(-(hr - hl) / (2. * mm) * uStrength, -(hu - hd) / (2. * mm) * uStrength, 1.0));
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
#endif
}`;
}

let _renderer = null, _quad = null, _cam = null;
export function initBaker(renderer) {
  _renderer = renderer;
  _quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  _quad.frustumCulled = false;
  _cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
}

const MODES = { albedo: 0, rough: 1, normal: 2 };

function bakeOne(recipe, mode, size, tileMM, strength, defines, readback) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: fragFor(recipe, mode), defines: { MODE: MODES[mode], ...defines, ...(readback ? { READBACK: 1 } : {}) },
    uniforms: { uTile: { value: tileMM }, uRes: { value: size }, uStrength: { value: strength } }, depthTest: false, depthWrite: false,
  });
  _quad.material = mat;
  if (!readback) {
    // GPU-resident result: render straight into a mip-mapped, repeating, anisotropic texture. No readPixels stall and
    // no CPU copy. (Render-target textures cannot be cloned in three, so users share this texture object.)
    const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, anisotropy: Math.min(8, _renderer.capabilities.getMaxAnisotropy()), colorSpace: mode === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    const prevRT = _renderer.getRenderTarget(); const prevAuto = _renderer.autoClear;
    _renderer.autoClear = true; _renderer.setRenderTarget(rt); _renderer.render(_quad, _cam); _renderer.setRenderTarget(prevRT); _renderer.autoClear = prevAuto;
    mat.dispose();
    const t = rt.texture; t.userData.rt = rt; t.userData.shared = true; t.userData.tileMM = tileMM;
    return t;
  }
  const rt = new THREE.WebGLRenderTarget(size, size, { type: THREE.UnsignedByteType, depthBuffer: false });
  const prevRT = _renderer.getRenderTarget(); const prevXR = _renderer.xr.enabled; const prevAuto = _renderer.autoClear;
  _renderer.xr.enabled = false; _renderer.autoClear = true;
  _renderer.setRenderTarget(rt); _renderer.render(_quad, _cam);
  const data = new Uint8Array(size * size * 4);
  _renderer.readRenderTargetPixels(rt, 0, 0, size, size, data);
  _renderer.setRenderTarget(prevRT); _renderer.xr.enabled = prevXR; _renderer.autoClear = prevAuto;
  rt.dispose(); mat.dispose();
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = Math.min(8, _renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = mode === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.userData.tileMM = tileMM;
  return tex;
}

const cache = new Map();
let sizeScale = 1;
/** quality tier -> bake resolution (Medium / Performance bake at half size: a quarter of the texture memory) */
export function setBakeScale(k) { sizeScale = k; }
/**
 * Bake a material recipe.
 * @param key     cache key (recipes are deterministic)
 * @param recipe  GLSL source (see header)
 * @param opts    {size=1024, tile (mm per tile), maps: ['albedo','rough','normal'], normalStrength=1, defines}
 * @returns {map, roughnessMap, normalMap, tile}
 */
export const bakeStats = { n: 0, ms: 0 };
export function bake(key, recipe, opts = {}) {
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now();
  const { size = 1024, tile = 100, maps = ['albedo', 'rough', 'normal'], normalStrength = 1, defines = {}, persistent = false, readback = false } = opts;
  const out = { tile, persistent };
  const sz = Math.max(256, Math.round(size * sizeScale));
  if (maps.includes('albedo')) out.map = bakeOne(recipe, 'albedo', sz, tile, 1, defines, readback);
  if (maps.includes('rough')) out.roughnessMap = bakeOne(recipe, 'rough', sz, tile, 1, defines, readback);
  if (maps.includes('normal')) out.normalMap = bakeOne(recipe, 'normal', sz, tile, normalStrength, defines, readback);
  cache.set(key, out);
  bakeStats.n++; bakeStats.ms += performance.now() - t0;
  return out;
}

/** drop cached bakes (their GPU copies belong to the materials that cloned them); `persistent` sets survive */
export function purgeBakeCache() { for (const [k, s] of cache) { if (s.persistent) continue; for (const t of ['map', 'roughnessMap', 'normalMap']) if (s[t]) { if (s[t].userData.rt) s[t].userData.rt.dispose(); else s[t].dispose(); } cache.delete(k); } }
