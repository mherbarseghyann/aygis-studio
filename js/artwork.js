// Artwork texture sets and board materials.  A "page" is a rasterised template page (outside, or inside = mirrored
// reverse side).  The page -> panel mapping is one affine texture matrix: panel UVs are flat millimetres, so
//   u = (x - X0) * ppmm / W + ox / W,   v = 1 - ((Y1 - y) * ppmm + oy) / H      (outside)
//   u = (X1 - x) * ppmm / W + ox / W                                              (inside, mirrored in X)
// where (ox, oy) is the pixel position of the trim (die) box inside the page image.
//
// Look development (what the real carton is made of):
//  * CASE outside: printed coated board with a soft-touch matte lamination -> low, broad specular (roughness
//    ~0.6), a faint velvet sheen at grazing angles, fine fibre relief.
//  * Hot-foil stamping (gold) from the production foil mask: real metal response (F0 of yellow-lacquered aluminium
//    foil, not the flat tan of the printed preview), roughness ~0.25 with a fine foil grain, and a 0.06 mm
//    DEBOSS: the die presses the foil into the board, so letter edges catch a thin highlight line.
//  * CASE inside / INSERT: printed reverse / uncoated side -> more matte (ink sinks into the fibres).
//  * Knife-cut edges: edge-inked (as on dark luxury cartons) - the cut sample takes the print colour, darkened and
//    rough, instead of a bright raw-board core line.
import * as THREE from 'three';
import { bake } from './texbake.js';

export const BOARD_EDGE = 0xcdc3b2;
export const BOARD_WHITE = 0xf5f2ec;
const PAPER_TILE = 40;      // mm per repeat of the paper detail textures
export const FINISH = {
  outside: { rough: 0.6, sheen: 0.22, label: 'soft-touch laminate' },
  inside: { rough: 0.8, sheen: 0.02, label: 'printed reverse, uncoated' },
  insert: { rough: 0.74, sheen: 0.02, label: 'printed board, aqueous coating' },
  foil: { rough: 0.24, label: 'hot-foil gold, debossed' },
};
const FOIL_F0 = new THREE.Color().setRGB(0.86, 0.64, 0.30);   // linear F0 of gold-lacquered aluminium foil
// 1x1 neutral textures: every board material has the same map set -> one shader program for all printed board
function tex1(v, srgb) { const t = new THREE.DataTexture(new Uint8Array([v, v, v, 255]), 1, 1); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; t.userData.shared = true; return t; }
const WHITE_SRGB = tex1(255, true), WHITE_LIN = tex1(255, false);

function setMapping(tex, page, bbox, mirrored, maxAniso, srgb = true) {
  const [X0, , X1, Y1] = bbox;
  const sx = page.ppmm / page.width, sy = page.ppmm / page.height;
  if (mirrored) tex.repeat.set(-sx, sy); else tex.repeat.set(sx, sy);
  const offX = mirrored ? (X1 * page.ppmm + page.ox) / page.width : (page.ox - X0 * page.ppmm) / page.width;
  const offY = 1 - (Y1 * page.ppmm + page.oy) / page.height;
  tex.offset.set(offX, offY);
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- GPU composites for foil pages
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const COMMON = `
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f); return mix(mix(h12(i), h12(i + vec2(1, 0)), u.x), mix(h12(i + vec2(0, 1)), h12(i + vec2(1, 1)), u.x), u.y); }
float fib(vec2 mm){ return vn(mm * 6.0) * 0.5 + vn(mm * 14.0) * 0.3 + vn(mm * 31.0) * 0.2; }      // paper fibre field
uniform sampler2D tMask; uniform vec2 uTexel; uniform float uPPMM;
float mask(vec2 uv){ return texture2D(tMask, uv).r; }
float maskBlur(vec2 uv){ float s = 0.; for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) s += mask(uv + vec2(float(x), float(y)) * uTexel * 0.75); return s / 25.; }
`;
const FRAG = {
  copy: `uniform sampler2D tArt; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tArt, vUv).rgb, 1.0); }`,
  albedo: `uniform sampler2D tArt; uniform vec3 uFoil; varying vec2 vUv;
    void main(){ vec3 a = texture2D(tArt, vUv).rgb; float m = smoothstep(0.25, 0.75, mask(vUv));
      vec2 mm = vUv / uTexel / uPPMM; float grain = 0.9 + 0.2 * vn(mm * 22.0);
      gl_FragColor = vec4(mix(a, uFoil * grain, m), 1.0); }`,
  orm: `uniform float uPaper, uFoilR; uniform sampler2D tArt; varying vec2 vUv;
    void main(){ float m = smoothstep(0.25, 0.75, mask(vUv)); vec2 mm = vUv / uTexel / uPPMM;
      float ink = 1.0 - dot(texture2D(tArt, vUv).rgb, vec3(0.333));            // heavy ink films are slightly smoother
      float pr = uPaper + 0.05 * (fib(mm) - 0.5) - 0.04 * ink;
      float fr = uFoilR + 0.06 * (vn(mm * 9.0) - 0.5);
      gl_FragColor = vec4(1.0, mix(pr, fr, m), m, 1.0); }`,
  normal: `uniform float uDepth; varying vec2 vUv;
    float H(vec2 uv){ vec2 mm = uv / uTexel / uPPMM; return -uDepth * maskBlur(uv) + 0.006 * fib(mm); }   // mm
    void main(){ vec2 e = uTexel; float mmPerTexel = 1.0 / uPPMM;
      float hx = (H(vUv + vec2(e.x, 0.)) - H(vUv - vec2(e.x, 0.))) / (2. * mmPerTexel);
      float hy = (H(vUv + vec2(0., e.y)) - H(vUv - vec2(0., e.y))) / (2. * mmPerTexel);
      gl_FragColor = vec4(normalize(vec3(-hx, -hy, 1.0)) * 0.5 + 0.5, 1.0); }`,
};
function gpuComposite(renderer, kind, w, h, uniforms, srgbOut) {
  const mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: COMMON + FRAG[kind], uniforms, depthTest: false, depthWrite: false });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // sampler state of a render-target texture is fixed when it is allocated: set filtering / anisotropy here
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: renderer.capabilities.getMaxAnisotropy(), colorSpace: srgbOut ? THREE.SRGBColorSpace : THREE.NoColorSpace });
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(quad, cam); renderer.setRenderTarget(prev);
  quad.geometry.dispose(); mat.dispose();
  return rt;
}

function releaseSource(img) {
  if (!img) return;
  if (img.close) img.close();                                              // ImageBitmap
  else if (img.getContext && img.width) { img.width = 0; img.height = 0; }   // canvas from the PDF rasteriser
}
/**
 * page: {source: ImageBitmap|HTMLImageElement|HTMLCanvasElement, width, height, ppmm, ox, oy, gold?: ImageLike}
 * The page is resampled on the GPU to `texPPMM` texels per mm (quality tier; a PDF rasterised at 8 px/mm is not
 * kept at that size on a medium GPU), mip-mapped, and the decoded source is released immediately afterwards.
 */
export function makePageTexture(page, bbox, mirrored, renderer, finish = 'outside', texPPMM = 8) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const bmp = typeof ImageBitmap !== 'undefined' && page.source instanceof ImageBitmap;
  const src = new THREE.Texture(page.source); src.colorSpace = THREE.SRGBColorSpace; src.flipY = !bmp; src.generateMipmaps = false; src.minFilter = THREE.LinearFilter; src.needsUpdate = true;
  const maxTex = Math.min(4096, renderer.capabilities.maxTextureSize);
  const k = Math.min(1, texPPMM / page.ppmm, maxTex / Math.max(page.width, page.height));
  const Wt = Math.max(16, Math.round(page.width * k)), Ht = Math.max(16, Math.round(page.height * k));
  if (!page.gold) {
    const rt = gpuComposite(renderer, 'copy', Wt, Ht, { tArt: { value: src }, tMask: { value: null }, uTexel: { value: new THREE.Vector2(1 / page.width, 1 / page.height) }, uPPMM: { value: page.ppmm } }, true);
    src.dispose(); releaseSource(page.source); page.source = null; if (page.canvas) page.canvas = null;
    const map = setMapping(rt.texture, page, bbox, mirrored, maxAniso, true);
    return { map, orm: null, normal: null, rts: [rt], mirrored };
  }
  const maskTex = new THREE.Texture(page.gold); maskTex.flipY = !(typeof ImageBitmap !== 'undefined' && page.gold instanceof ImageBitmap); maskTex.colorSpace = THREE.NoColorSpace; maskTex.generateMipmaps = false; maskTex.minFilter = THREE.LinearFilter; maskTex.needsUpdate = true;
  src.generateMipmaps = false; src.minFilter = THREE.LinearFilter;
  const W = page.width, H = page.height, texel = new THREE.Vector2(1 / W, 1 / H);
  const base = { tMask: { value: maskTex }, uTexel: { value: texel }, uPPMM: { value: page.ppmm } };
  const fin = FINISH[finish] || FINISH.outside;
  const rtA = gpuComposite(renderer, 'albedo', Wt, Ht, { ...base, tArt: { value: src }, uFoil: { value: FOIL_F0 } }, true);
  // roughness/metal and normal at half the albedo resolution (0.25 mm at High: finer than the foil die detail)
  const w2 = Math.round(Wt / 2), h2 = Math.round(Ht / 2);
  const rtO = gpuComposite(renderer, 'orm', w2, h2, { ...base, tArt: { value: src }, uPaper: { value: fin.rough }, uFoilR: { value: FINISH.foil.rough } }, false);
  const rtN = gpuComposite(renderer, 'normal', w2, h2, { ...base, uDepth: { value: 0.06 } }, false);
  src.dispose(); maskTex.dispose();
  releaseSource(page.source); releaseSource(page.gold); page.source = page.gold = null;   // free the decoded images
  const map = setMapping(rtA.texture, page, bbox, mirrored, maxAniso, true);
  const orm = setMapping(rtO.texture, page, bbox, mirrored, maxAniso, false);
  const normal = setMapping(rtN.texture, page, bbox, mirrored, maxAniso, false);
  return { map, orm, normal, rts: [rtA, rtO, rtN], mirrored };
}

// ---------------------------------------------------------------- tiled paper detail (pages without a foil mask)
const PAPER_GLSL = `
vec3 albedo(vec2 uv){ return vec3(1.0); }
float fibre(vec2 uv){ return fbm(uv, vec2(18.), 5, 0.55) * 0.6 + gnoise(uv * vec2(160.), vec2(160.)) * 0.25 + gnoise(uv * vec2(420., 140.), vec2(420., 140.)) * 0.15; }
float rough(vec2 uv){ return 0.5 + 0.12 * fbm(uv, vec2(6.), 3, 0.5) + 0.05 * fibre(uv); }
float height(vec2 uv){ return 0.01 * fibre(uv); }
`;
export function paperDetail() { return bake('paper_v2', PAPER_GLSL, { size: 1024, tile: PAPER_TILE, maps: ['rough', 'normal'], normalStrength: 1.0, persistent: true, readback: true }); }   // cloned per material -> CPU-backed
function detailTex(src) { const t = src.clone(); t.repeat.set(1 / PAPER_TILE, 1 / PAPER_TILE); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; }

/** coated folding-board material for one printed side */
export function paperMaterial(pageTex, opts = {}) {
  const fin = FINISH[opts.finish || 'outside'] || FINISH.outside;
  const pd = paperDetail();
  // MeshStandardMaterial (F0 0.04 = IOR 1.5 lamination): it shares one shader program with every other surface;
  // the soft-touch sheen of a Physical material is below what the camera resolves and costs a separate program.
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0, side: THREE.FrontSide });
  if (pageTex && pageTex.orm) {
    m.map = pageTex.map; m.roughnessMap = pageTex.orm; m.metalnessMap = pageTex.orm; m.metalness = 1.0; m.roughness = 1.0;
    m.normalMap = pageTex.normal; m.normalScale = new THREE.Vector2(1, 1);      // tangent frame follows the (mirrored) uv
  } else {
    if (pageTex) m.map = pageTex.map; else { m.color.set(opts.color || BOARD_WHITE); m.map = WHITE_SRGB; }
    m.roughnessMap = detailTex(pd.roughnessMap); m.roughness = fin.rough / 0.5;
    m.metalnessMap = WHITE_LIN; m.metalness = 0;
    m.normalMap = detailTex(pd.normalMap); m.normalScale = new THREE.Vector2(1, 1);
  }
  m.userData.finish = fin.label;
  return m;
}

/** knife-cut edges: edge-inked board (print colour, darkened, very rough); unprinted board shows its core */
export function edgeMaterial(pageTex) {
  const m = new THREE.MeshStandardMaterial({ color: pageTex ? 0x8c8680 : BOARD_EDGE, roughness: 0.95, metalness: 0 });
  if (pageTex) m.map = pageTex.map;
  return m;
}

/**
 * A complete artwork set for one SKU: {case: {outside, inside}, insert: {outside}} of page textures (or null).
 * materialsFor(component) returns the materials interface used by FoldedComponent.
 */
export class ArtworkSet {
  constructor(renderer, texPPMM = 8) { this.renderer = renderer; this.texPPMM = texPPMM; this.pages = { case: { outside: null, inside: null }, insert: { outside: null } }; this.label = 'none'; this._mats = {}; }
  setPage(comp, side, page, bbox) {
    const key = comp.toLowerCase();
    const old = this.pages[key][side];
    if (old) this._disposePage(old);
    const finish = key === 'insert' ? 'insert' : side;
    this.pages[key][side] = page ? makePageTexture(page, bbox, side === 'inside', this.renderer, finish, this.texPPMM) : null;
    if (this._mats[key]) this._mats[key].all.forEach(m => m.dispose());           // materials of the replaced page
    delete this._mats[key];
  }
  _disposePage(p) { if (p.rts && p.rts.length) p.rts.forEach(r => r.dispose()); else { p.map.dispose(); if (p.orm) p.orm.dispose(); } }
  materialsFor(comp) {
    const key = comp.toLowerCase();
    if (!this._mats[key]) {
      const outside = paperMaterial(this.pages[key].outside, { finish: key === 'insert' ? 'insert' : 'outside' });
      const inside = paperMaterial(this.pages[key].inside, { finish: 'inside' });
      const edge = edgeMaterial(this.pages[key].outside);
      this._mats[key] = { front: () => outside, back: () => inside, edge, all: [outside, inside, edge] };
    }
    return this._mats[key];
  }
  /** apply a global material tweak (e.g. envMapIntensity) to every material of the set */
  forEachMaterial(fn) { for (const k in this._mats) this._mats[k].all.forEach(fn); }
  dispose() { for (const k in this.pages) for (const s in this.pages[k]) { const p = this.pages[k][s]; if (p) this._disposePage(p); } for (const k in this._mats) this._mats[k].all.forEach(m => m.dispose()); }
}

export function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + url)); im.src = url; });
}
/** fetch + decode off the main thread (createImageBitmap); flipped for WebGL so the texture needs no flipY */
export async function loadBitmap(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('image failed: ' + url);
  const blob = await r.blob();
  if (typeof createImageBitmap === 'function') { try { return await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { } }
  return loadImage(URL.createObjectURL(blob));
}

/** Default (brand) artwork from assets/artwork/manifest.json */
export async function loadDefaultArtwork(sku, models, manifest, renderer, texPPMM = 8) {
  const set = new ArtworkSet(renderer, texPPMM);
  set.label = 'AYGIS production artwork (PDF/X-4 masters)';
  const m = models.skus[sku];
  const jobs = [];
  for (const [comp, sides] of [['CASE', ['outside', 'inside']], ['INSERT', ['outside']]]) {
    for (const side of sides) {
      const f = manifest.files[`${sku}_${comp}_${side}`];
      if (!f) continue;
      jobs.push((async () => {
        const [im, gold] = await Promise.all([loadBitmap(`assets/artwork/${f.image}`), f.gold ? loadBitmap(`assets/artwork/${f.gold}`) : null]);
        const page = { source: im, width: f.width_px, height: f.height_px, ppmm: manifest.ppmm, ox: f.trim_x0_px, oy: f.trim_y0_px, gold };
        return { comp, side, page, bbox: (comp === 'CASE' ? m.case : m.insert).bbox };
      })());
    }
  }
  // GPU work in a deterministic order after all images arrived
  for (const r of await Promise.all(jobs)) set.setPage(r.comp, r.side, r.page, r.bbox);
  return set;
}
