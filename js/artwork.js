// Artwork texture sets and board materials.  A "page" is a rasterised template page (outside, or inside = mirrored
// reverse side).  The page -> panel mapping is one affine texture matrix: panel UVs are flat millimetres, so
//   u = (x - X0) * ppmm / W + ox / W,   v = 1 - ((Y1 - y) * ppmm + oy) / H      (outside)
//   u = (X1 - x) * ppmm / W + ox / W                                              (inside, mirrored in X)
// where (ox, oy) is the pixel position of the trim (die) box inside the page image.
import * as THREE from 'three';
import { paperDetail } from './procgen.js';

export const BOARD_EDGE = 0xcdc3b2;
export const BOARD_WHITE = 0xf5f2ec;
const PAPER_TILE = 46;      // mm per repeat of the paper detail textures

function setMapping(tex, page, bbox, mirrored, maxAniso) {
  const [X0, , X1, Y1] = bbox;
  const sx = page.ppmm / page.width, sy = page.ppmm / page.height;
  if (mirrored) tex.repeat.set(-sx, sy); else tex.repeat.set(sx, sy);
  const offX = mirrored ? (X1 * page.ppmm + page.ox) / page.width : (page.ox - X0 * page.ppmm) / page.width;
  const offY = 1 - (Y1 * page.ppmm + page.oy) / page.height;
  tex.offset.set(offX, offY);
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAniso;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** page: {source: HTMLImageElement|HTMLCanvasElement, width, height, ppmm, ox, oy, gold?: ImageLike} */
export function makePageTexture(page, bbox, mirrored, renderer) {
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const tex = new THREE.Texture(page.source);
  setMapping(tex, page, bbox, mirrored, maxAniso);
  let orm = null;
  if (page.gold) {
    // metalness (B) + roughness (G) map from the gold mask: foil = metallic and smoother; paper elsewhere
    const c = document.createElement('canvas'); c.width = page.gold.width; c.height = page.gold.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(page.gold, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height); const px = d.data;
    for (let i = 0; i < px.length; i += 4) { const g = px[i]; px[i] = 0; px[i + 1] = 150 - Math.round(g * 0.42); px[i + 2] = g; px[i + 3] = 255; }
    ctx.putImageData(d, 0, 0);
    orm = new THREE.CanvasTexture(c);
    setMapping(orm, page, bbox, mirrored, maxAniso);
    orm.colorSpace = THREE.NoColorSpace;
  }
  return { map: tex, orm };
}

function detailTex(src) {
  const t = src.clone(); t.repeat.set(1 / PAPER_TILE, 1 / PAPER_TILE); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}

/** Coated folding-board material: printed surface with satin varnish, subtle fibre bump and roughness variation. */
export function paperMaterial(pageTex, opts = {}) {
  const pd = paperDetail();
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 1.0, metalness: 0.0,
    clearcoat: 0.22, clearcoatRoughness: 0.48,
    specularIntensity: 0.75, ior: 1.46,
    sheen: 0.08, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff),
    envMapIntensity: 1.0,
    side: THREE.FrontSide,
  });
  m.bumpMap = detailTex(pd.bump); m.bumpScale = 0.028;
  if (pageTex) {
    m.map = pageTex.map;
    if (pageTex.orm) { m.metalnessMap = pageTex.orm; m.roughnessMap = pageTex.orm; m.metalness = 1.0; m.roughness = 1.0; }
    else { m.roughnessMap = detailTex(pd.rough); m.roughness = 1.0; }
  } else {
    m.color.set(opts.color || BOARD_WHITE);
    m.roughnessMap = detailTex(pd.rough); m.roughness = 1.05;
  }
  return m;
}

/** raw board core at knife-cut edges */
export function edgeMaterial() {
  const pd = paperDetail();
  const m = new THREE.MeshStandardMaterial({ color: BOARD_EDGE, roughness: 1.0, metalness: 0 });
  m.bumpMap = detailTex(pd.bump); m.bumpScale = 0.08;
  return m;
}

/**
 * A complete artwork set for one SKU: {case: {outside, inside}, insert: {outside}} of page textures (or null).
 * materialsFor(component) returns the materials interface used by FoldedComponent.
 */
export class ArtworkSet {
  constructor(renderer) { this.renderer = renderer; this.pages = { case: { outside: null, inside: null }, insert: { outside: null } }; this.label = 'none'; this._mats = {}; }
  setPage(comp, side, page, bbox) {
    const key = comp.toLowerCase();
    const old = this.pages[key][side];
    if (old) { old.map.dispose(); if (old.orm) old.orm.dispose(); }
    this.pages[key][side] = page ? makePageTexture(page, bbox, side === 'inside', this.renderer) : null;
    delete this._mats[key];
  }
  materialsFor(comp) {
    const key = comp.toLowerCase();
    if (!this._mats[key]) {
      const outside = paperMaterial(this.pages[key].outside);
      const inside = paperMaterial(this.pages[key].inside);
      const edge = edgeMaterial();
      this._mats[key] = { front: () => outside, back: () => inside, edge, all: [outside, inside, edge] };
    }
    return this._mats[key];
  }
  /** apply a global material tweak (e.g. envMapIntensity) to every material of the set */
  forEachMaterial(fn) { for (const k in this._mats) this._mats[k].all.forEach(fn); }
  dispose() { for (const k in this.pages) for (const s in this.pages[k]) { const p = this.pages[k][s]; if (p) { p.map.dispose(); if (p.orm) p.orm.dispose(); } } for (const k in this._mats) this._mats[k].all.forEach(m => m.dispose()); }
}

export function loadImage(url) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('image failed: ' + url)); im.src = url; });
}

/** Default (brand) artwork from assets/artwork/manifest.json */
export async function loadDefaultArtwork(sku, models, manifest, renderer) {
  const set = new ArtworkSet(renderer);
  set.label = 'AYGIS production artwork (PDF/X-4 masters)';
  const m = models.skus[sku];
  const jobs = [];
  for (const [comp, sides] of [['CASE', ['outside', 'inside']], ['INSERT', ['outside']]]) {
    for (const side of sides) {
      const f = manifest.files[`${sku}_${comp}_${side}`];
      if (!f) continue;
      jobs.push((async () => {
        const [im, gold] = await Promise.all([loadImage(`assets/artwork/${f.image}`), f.gold ? loadImage(`assets/artwork/${f.gold}`) : null]);
        const page = { source: im, width: f.width_px, height: f.height_px, ppmm: manifest.ppmm, ox: f.trim_x0_px, oy: f.trim_y0_px, gold };
        set.setPage(comp, side, page, (comp === 'CASE' ? m.case : m.insert).bbox);
      })());
    }
  }
  await Promise.all(jobs);
  return set;
}
