// Confections and paper cups.
//  * Shape: the dome meshes from the concept GLB (assets/models/confections.glb), already scaled to the production
//    product envelope (Ø 22 mm, from box_models.json -> product.D_conf).  The same meshes are used in the box and on
//    every prop plate, so a confection is the same 22 mm object everywhere.
//  * Surface: AYGIS confections are rolled in crushed nuts / seeds / candied fruit.  A per-flavour procedural
//    coating shader builds that mosaic in object space: 3D Voronoi pieces of the real fragment size (1.3 - 1.9 mm),
//    each piece slightly domed and of its own height, a darker glossy binder (honey / syrup) in the crevices,
//    per-piece colour from the flavour palette with cream pieces mixed in, and different gloss for candied fruit,
//    nuts and seeds.  The relief is an analytic height-field normal, so it holds up in macro shots.
//  * Cups: pleated dark-brown glassine baking cups generated at the production size (25 base x 34 top x 16 mm,
//    42 pleats), semi-gloss.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { REF } from './units.js';

export const FLAVOURS = [
  { name: 'sesame', cell: 1.3, amp: 0.34, cream: 0.82, accent: 0.0, palette: [0xeee2c8, 0xe2cfa6, 0xcfae76], creamCol: 0xf4ecdc, accentCol: 0xb08850, binder: 0x8a6034, fruitRough: 0.5, creamRough: 0.46 },
  { name: 'cranberry', cell: 1.7, amp: 0.46, cream: 0.3, accent: 0.0, palette: [0x8f1626, 0xab2232, 0x6c0e1e], creamCol: 0xeee3cf, accentCol: 0x5a0c16, binder: 0x4e1210, fruitRough: 0.3, creamRough: 0.5 },
  { name: 'pistachio', cell: 1.9, amp: 0.5, cream: 0.14, accent: 0.1, palette: [0x95ae46, 0x7a9831, 0xb7c76c], creamCol: 0xebe0c6, accentCol: 0x7a4652, binder: 0x6a5726, fruitRough: 0.56, creamRough: 0.5 },
  { name: 'apricot', cell: 1.8, amp: 0.44, cream: 0.32, accent: 0.0, palette: [0xe28629, 0xf0a446, 0xcc711d], creamCol: 0xf2e6d0, accentCol: 0xa8521a, binder: 0x864516, fruitRough: 0.32, creamRough: 0.5 },
  { name: 'honey-walnut', cell: 1.35, amp: 0.36, cream: 0.08, accent: 0.14, palette: [0xe6b240, 0xd5992a, 0xf1cd68], creamCol: 0xf2dea4, accentCol: 0x8a5a2e, binder: 0x93601a, fruitRough: 0.38, creamRough: 0.45 },
];
const NAMES = FLAVOURS.map(f => f.name);

const COAT_PARS = /* glsl */`
varying vec3 vObjP; varying mat3 vNM;
uniform float uCell, uAmp, uCream, uAccent, uFruitR, uCreamR;
uniform vec3 uP0, uP1, uP2, uCreamC, uAccentC, uBinder;
vec3 c_h33(vec3 p){ p = fract(p * vec3(.1031, .1030, .0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
float c_h13(vec3 p){ p = fract(p * .1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float c_vn(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(mix(c_h13(i), c_h13(i + vec3(1,0,0)), f.x), mix(c_h13(i + vec3(0,1,0)), c_h13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(c_h13(i + vec3(0,0,1)), c_h13(i + vec3(1,0,1)), f.x), mix(c_h13(i + vec3(0,1,1)), c_h13(i + vec3(1,1,1)), f.x), f.y), f.z); }
// height of the coating (mm) at object-space point p; returns the piece id and its edge distance
float coatH(vec3 p, out vec3 id, out float edge){
  vec3 x = p / uCell + c_vn(p * 0.35) * 0.6;            // slight warp: irregular, not honeycomb-regular pieces
  vec3 i = floor(x), f = fract(x); float F1 = 8., F2 = 8.; id = vec3(0.);
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int l = -1; l <= 1; l++){
    vec3 g = vec3(float(l), float(j), float(k)); vec3 o = 0.15 + 0.7 * c_h33(i + g); vec3 r = g + o - f; float d = dot(r, r);
    if (d < F1){ F2 = F1; F1 = d; id = i + g; } else if (d < F2) F2 = d;
  }
  edge = sqrt(F2) - sqrt(F1);
  float hp = c_h13(id + 7.1);
  float dome = smoothstep(0.0, 0.42, edge);
  dome = dome * (0.82 + 0.18 * smoothstep(0.2, 0.9, edge));
  return uAmp * (0.5 + 0.5 * hp) * dome + uAmp * 0.12 * c_vn(p * 3.2);
}
`;

function coatingMaterial(fl, idx) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0 });
  const C = (h) => new THREE.Color(h);
  const U = {
    uCell: { value: fl.cell }, uAmp: { value: fl.amp }, uCream: { value: fl.cream }, uAccent: { value: fl.accent },
    uFruitR: { value: fl.fruitRough }, uCreamR: { value: fl.creamRough },
    uP0: { value: C(fl.palette[0]) }, uP1: { value: C(fl.palette[1]) }, uP2: { value: C(fl.palette[2]) },
    uCreamC: { value: C(fl.creamCol) }, uAccentC: { value: C(fl.accentCol) }, uBinder: { value: C(fl.binder) },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec3 vObjP; varying mat3 vNM;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObjP = position; vNM = normalMatrix;');
    sh.fragmentShader = COAT_PARS + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cId; float cEdge; float cH = coatH(vObjP, cId, cEdge);
        float r1 = c_h13(cId), r2 = c_h13(cId + 3.7), r3 = c_h13(cId + 11.3);
        vec3 pc = r2 < 0.5 ? mix(uP0, uP1, r2 * 2.0) : mix(uP1, uP2, r2 * 2.0 - 1.0);
        float isCream = step(r1, uCream), isAcc = (1.0 - isCream) * step(r3, uAccent);
        vec3 col = mix(mix(pc, uAccentC, isAcc), uCreamC, isCream);
        col *= 0.9 + 0.2 * r3;                                       // piece-to-piece value variation
        col *= 0.92 + 0.16 * c_vn(vObjP * 4.0);                       // within-piece mottling
        float crev = 1.0 - smoothstep(0.0, 0.16, cEdge);              // binder visible between pieces
        col = mix(col, uBinder, crev * 0.85);
        diffuseColor.rgb = col;
        float cRough = mix(mix(uFruitR, uFruitR + 0.12, isAcc), uCreamR, isCream);
        cRough = mix(cRough, 0.22, crev);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = cRough;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float e = 0.05; vec3 tid; float te;
          vec3 gObj = vec3(coatH(vObjP + vec3(e, 0., 0.), tid, te) - cH, coatH(vObjP + vec3(0., e, 0.), tid, te) - cH, coatH(vObjP + vec3(0., 0., e), tid, te) - cH) / e;
          vec3 gV = vNM * gObj; gV -= dot(gV, normal) * normal;
          normal = normalize(normal - gV);
        }`)
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= mix(0.55, 1.0, smoothstep(0.0, 0.3, cEdge)); reflectedLight.indirectSpecular *= mix(0.6, 1.0, smoothstep(0.0, 0.3, cEdge));');
  };
  m.customProgramCacheKey = () => 'aygis-coat-v1';                // identical code for every flavour: one program
  m.name = 'confection_' + fl.name;
  return m;
}

/** pleated glassine baking cup (wall + base), mm, Y up, base on y = 0 */
export function cupGeometry({ base = REF.cup.base, top = REF.cup.top, h = REF.cup.h, pleats = 42 } = {}) {
  const A = pleats * 8, V = 10;
  const pos = [], nrm = [], idx = [];
  const rb = base / 2, rt = top / 2;
  for (let j = 0; j <= V; j++) {
    const v = j / V, y = v * h;
    const r0 = rb + (rt - rb) * Math.pow(v, 0.9);
    const amp = 0.25 + 0.75 * v;                                      // pleats fan out towards the rim
    for (let i = 0; i <= A; i++) {
      const th = (i / A) * Math.PI * 2;
      const s = Math.sin(th * pleats);
      const pl = Math.sign(s) * Math.pow(Math.abs(s), 0.6);           // rounded-crest pleat profile
      const r = r0 + amp * 0.42 * pl;
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
    }
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < A; i++) {
    const a = j * (A + 1) + i, b = a + 1, c = a + (A + 1), d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // inner surface (reversed winding, flipped normals, 0.08 mm inside) so the material can be single-sided
  const inner = g.clone(); { const ip = inner.attributes.position, inn = inner.attributes.normal;
    for (let i = 0; i < ip.count; i++) { ip.setXYZ(i, ip.getX(i) - inn.getX(i) * 0.08, ip.getY(i), ip.getZ(i) - inn.getZ(i) * 0.08); inn.setXYZ(i, -inn.getX(i), -inn.getY(i), -inn.getZ(i)); }
    const ix = inner.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
  const disc = new THREE.CircleGeometry(rb + 0.1, 48).rotateX(-Math.PI / 2); disc.translate(0, 0.05, 0);
  return mergeTwo(mergeTwo(g, inner), disc);
}
function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array, pb = b.attributes.position.array, na = a.attributes.normal.array, nb = b.attributes.normal.array;
  const pos = new Float32Array(pa.length + pb.length); pos.set(pa); pos.set(pb, pa.length);
  const nrm = new Float32Array(na.length + nb.length); nrm.set(na); nrm.set(nb, na.length);
  const ia = Array.from(a.index.array), ib = Array.from(b.index.array).map(i => i + pa.length / 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(ia.concat(ib));
  const uv = new Float32Array(pos.length / 3 * 2); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

export class Confections {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'confections';
    this.proto = []; this.cupGeo = null; this.coat = []; this.plain = []; this.coated = false;
    this.items = []; this.meshes = [];
    this.visible = true;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const found = [];
    gltf.scene.traverse(o => { if (o.isMesh) found.push(o); });
    found.sort((a, b) => a.name.localeCompare(b.name));
    for (const o of found) {
      if (!o.name.startsWith('confection_')) continue;
      const k = this.proto.length;
      o.geometry.deleteAttribute('color');
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.geometry.userData.shared = true;
      const fl = FLAVOURS[k % FLAVOURS.length];
      const coat = coatingMaterial(fl, k); coat.userData.shared = true;
      const plain = new THREE.MeshStandardMaterial({ color: fl.palette[0], roughness: 0.55 }); plain.userData.shared = true;
      this.coat.push(coat); this.plain.push(plain);
      o.material = plain; o.userData.flavour = k;
      this.proto.push(o);
    }
    this.cupGeo = cupGeometry(); this.cupGeo.userData.shared = true;
    this.cupMat = new THREE.MeshStandardMaterial({ color: 0x3a2214, roughness: 0.36, metalness: 0 });
    this.cupMat.userData.shared = true;
    this.meta = (gltf.parser.json.extras && gltf.parser.json.extras.confections) || [];
    return this;
  }

  /** compile the coating shader off the critical path, then swap it in everywhere (box and props) */
  async upgrade(viewer, extraRoots = []) {
    if (this.coated || !this.coat.length) return;
    const sc = new THREE.Scene(); sc.add(new THREE.Mesh(this.proto[0].geometry, this.coat[0]));
    await viewer._compileParallel(sc);
    this.coated = true;
    for (const p of this.proto) p.material = this.coat[p.userData.flavour];
    for (const r of [this.group, ...extraRoots]) r.traverse(o => { if (o.isMesh && o.userData.flavour !== undefined) o.material = this.coat[o.userData.flavour]; });
    viewer.invalidate();
  }
  _cup() { const w = new THREE.Mesh(this.cupGeo, this.cupMat); w.castShadow = true; w.receiveShadow = true; w.name = 'cup'; return w; }

  /** Build cups + confections for a SKU; positions follow the insert's UPPER DECK panel. */
  populate(skuData, foldedInsert) {
    this.clear();
    this.sku = skuData; this.insert = foldedInsert;
    const cav = skuData.cavities;
    cav.flat_U.forEach(([x, y], k) => {
      const g = new THREE.Group();
      g.userData.flat = [x, y];
      g.rotation.x = Math.PI / 2;                       // meshes are Y-up, the component frame is Z-up
      const rnd = seeded(k);
      g.add(this._cup());
      const type = k % this.proto.length;
      const c = this.proto[type].clone();
      c.position.y = skuData.product.cup_thk + 0.1;
      c.rotation.y = rnd() * Math.PI * 2;
      c.rotation.z = (rnd() - 0.5) * 0.08;
      c.castShadow = true; c.receiveShadow = true;
      c.userData = { index: k, type, flavour: type, name: NAMES[type] || ('type ' + (type + 1)) };
      g.add(c);
      this.group.add(g);
      this.items.push(g); this.meshes.push(c);
    });
    this.updatePositions();
  }

  /** drop: 0..1 settle factor (1 = seated); staggered per cavity for the fold studio */
  updatePositions(drop = 1) {
    if (!this.insert || !this.sku) return;
    const dz = this.sku.cavities.cup_seat_dz;
    this.items.forEach((g, k) => {
      const [x, y] = g.userData.flat;
      const p = this.insert.mapPoint('U', x, y, dz);
      if (drop < 1) { const d = Math.max(0, Math.min(1, (drop * 1.4) - k * 0.4 / this.items.length)); const e = 1 - Math.pow(1 - d, 3); p.z += (1 - e) * 90; g.visible = d > 0; }
      else g.visible = true;
      g.position.copy(p);
    });
  }

  /** a cup + confection group in the Y-up world frame (for scene props); real size, same meshes as in the box */
  makeOne(i, { cup = true } = {}) {
    if (!this.proto.length) return null;
    const g = new THREE.Group(); g.name = 'confection_prop';
    if (cup) g.add(this._cup());
    const c = this.proto[i % this.proto.length].clone(); c.position.y = cup ? 0.25 : 0; c.rotation.y = i * 1.7; c.castShadow = true; c.receiveShadow = true; g.add(c);
    g.userData.ref = { size: REF.cup.top, axis: 'max' };
    return g;
  }

  clear() {
    for (const g of this.items) this.group.remove(g);
    this.items = []; this.meshes = [];
  }

  setVisible(v) { this.visible = v; this.group.visible = v; }
}
function seeded(k) { let s = (k + 1) * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
