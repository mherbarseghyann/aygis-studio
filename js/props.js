// Procedural set dressing for the environments: tableware, chairs, baskets, fruit, planters, stairs, grass…
// Everything is built from primitives and lathe profiles at runtime (mm units, Y up, table top at y = 0).
import * as THREE from 'three';
import { woodTexture, marbleTexture, linenTexture, ginghamTexture, tuffTexture, canvasTextureFn, fbm, snoise } from './procgen.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
let seedState = 7;
const rnd = () => { seedState = (seedState * 16807) % 2147483647; return seedState / 2147483647; };

// ---------------------------------------------------------------- materials
const M = {
  porcelain: () => new THREE.MeshPhysicalMaterial({ color: 0xf6f3ec, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.2, specularIntensity: 0.8 }),
  cream: () => new THREE.MeshPhysicalMaterial({ color: 0xefe6d2, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
  steel: () => new THREE.MeshPhysicalMaterial({ color: 0xcfd2d6, metalness: 1, roughness: 0.28 }),
  brass: () => new THREE.MeshPhysicalMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.32 }),
  copper: () => new THREE.MeshPhysicalMaterial({ color: 0xb7673b, metalness: 1, roughness: 0.36 }),
  black: () => new THREE.MeshPhysicalMaterial({ color: 0x1c1a19, metalness: 0.6, roughness: 0.45 }),
  darkWood: () => { const t = woodTexture('walnut'); const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, clearcoat: 0.3 }); m.map.repeat.set(0.4, 0.4); return m; },
  oak: () => { const t = woodTexture('oak'); const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1, clearcoat: 0.2 }); m.map.repeat.set(0.4, 0.4); return m; },
  glass: () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, transmission: 0.95, thickness: 3, ior: 1.5, transparent: true, opacity: 1, clearcoat: 1 }),
  water: () => new THREE.MeshPhysicalMaterial({ color: 0xdfeefa, metalness: 0, roughness: 0.02, transmission: 0.9, thickness: 20, ior: 1.33, transparent: true }),
  coffee: () => new THREE.MeshPhysicalMaterial({ color: 0x2a1408, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
  linen: (c = 0xece6d8) => { const t = linenTexture(c); const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1 }); m.map.repeat.set(1.5, 1.5); return m; },
  apple: () => new THREE.MeshPhysicalMaterial({ color: 0xb6322b, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
  appleGreen: () => new THREE.MeshPhysicalMaterial({ color: 0x9fb545, roughness: 0.4, clearcoat: 0.5 }),
  apricot: () => new THREE.MeshPhysicalMaterial({ color: 0xe8963f, roughness: 0.7, sheen: 0.6, sheenColor: new THREE.Color(0xffd9a0) }),
  stone: (tone = 'ochre') => { const t = tuffTexture(tone); const m = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.rough, roughness: 1 }); m.map.repeat.set(2, 1); return m; },
  hedge: () => new THREE.MeshStandardMaterial({ map: canvasTextureFn(256, (u, v) => { const n = 0.5 + 0.5 * fbm(u * 18, v * 18, 4); const c = [0.16 + 0.22 * n, 0.32 + 0.3 * n, 0.12 + 0.12 * n]; return c; }), roughness: 1 }),
  wicker: () => new THREE.MeshStandardMaterial({ map: canvasTextureFn(256, (u, v) => { const w = 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 18) * Math.sin(v * 2 * Math.PI * 9); const n = 0.55 + 0.35 * w + 0.06 * fbm(u * 30, v * 30, 3); return [0.78 * n, 0.58 * n, 0.33 * n]; }), roughness: 0.9 }),
  candle: () => new THREE.MeshPhysicalMaterial({ color: 0xf3ead6, roughness: 0.5, transmission: 0.25, thickness: 10 }),
  flame: () => new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.95 }),
  cardboard: (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.6, clearcoat: 0.15 }),
};

function lathe(points, mat, segs = 48) { const g = new THREE.LatheGeometry(points.map(p => V2(p[0], p[1])), segs); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.receiveShadow = true; return m; }
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }
function group(...objs) { const g = new THREE.Group(); objs.forEach(o => o && g.add(o)); return g; }
function at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }

// ---------------------------------------------------------------- tableware
export function cup({ small = false, coffee = true, mat = M.porcelain } = {}) {
  const s = small ? 0.7 : 1;
  const body = lathe([[0, 0.5], [22, 0.5], [25, 0], [31, 48], [33, 56], [34, 58], [30.5, 58], [29.5, 52], [22, 6], [0, 6]].map(p => [p[0] * s, p[1] * s]), mat());
  const handle = mesh(new THREE.TorusGeometry(13 * s, 3.2 * s, 10, 24, Math.PI * 1.1), mat());
  handle.position.set(32 * s, 32 * s, 0); handle.rotation.z = -Math.PI / 2 + 0.55; handle.rotation.y = 0;
  const saucer = lathe([[0, 0], [28, 0], [31, 2.5], [60 * s + 10, 7], [63 * s + 10, 9], [61 * s + 10, 10], [31, 5], [0, 4.5]], mat());
  const g = group(saucer, at(body, 0, 4.5, 0), at(handle, 0, 4.5, 0));
  if (coffee) g.add(at(mesh(new THREE.CircleGeometry(27.5 * s, 40).rotateX(-Math.PI / 2), M.coffee()), 0, 4.5 + 46 * s, 0));
  g.name = 'prop_cup'; return g;
}
export function spoon() {
  const bowl = mesh(new THREE.SphereGeometry(11, 24, 16), M.steel()); bowl.scale.set(1, 0.25, 1.5);
  const handle = mesh(new THREE.BoxGeometry(7, 2.2, 78), M.steel()); handle.position.z = -52;
  const g = group(at(bowl, 0, 2.8, 0), at(handle, 0, 1.6, 0)); g.name = 'prop_spoon'; return g;
}
export function plate(r = 95, mat = M.porcelain) {
  const p = lathe([[0, 0], [r * 0.6, 0], [r * 0.68, 1.5], [r * 0.9, 6], [r, 9.5], [r - 2, 10.5], [r * 0.66, 4], [0, 3]], mat(), 64); p.name = 'prop_plate'; return p;
}
export function glass({ water = true } = {}) {
  const g = group(lathe([[0, 0], [28, 0], [30, 2], [33, 90], [34, 92], [32, 92], [31, 90], [27, 5], [0, 5]], M.glass()));
  if (water) g.add(at(lathe([[0, 0], [27.5, 0], [30.5, 55], [0, 55]], M.water()), 0, 5, 0));
  g.name = 'prop_glass'; return g;
}
export function napkin(c = 0xece6d8, w = 200, d = 150) {
  const m = M.linen(c);
  const g = group(mesh(new THREE.BoxGeometry(w, 2.2, d), m), at(mesh(new THREE.BoxGeometry(w * 0.52, 2.2, d), m), -w * 0.24, 2.2, 0));
  g.name = 'prop_napkin'; return g;
}
export function candle() {
  const holder = lathe([[0, 0], [34, 0], [36, 2], [36, 70], [33, 70], [31, 4], [0, 4]], M.glass());
  const wax = lathe([[0, 0], [27, 0], [28, 60], [0, 60]], M.candle());
  const flame = mesh(new THREE.SphereGeometry(5, 12, 12), M.flame()); flame.scale.set(1, 2.2, 1); flame.castShadow = false;
  const light = new THREE.PointLight(0xffb060, 1400, 500, 2); light.position.set(0, 90, 0);
  const g = group(holder, at(wax, 0, 4, 0), at(flame, 0, 76, 0), light); g.name = 'prop_candle'; return g;
}
export function jezve() {
  const pot = lathe([[0, 0], [36, 0], [39, 3], [45, 32], [37, 72], [34, 78], [31, 78], [32, 72], [40, 32], [34, 5], [0, 5]], M.copper());
  const handle = mesh(new THREE.CylinderGeometry(6, 7, 150, 16), M.darkWood()); handle.rotation.z = Math.PI / 2 - 0.35; handle.position.set(95, 92, 0);
  const g = group(pot, handle); g.name = 'prop_jezve'; return g;
}
export function apple(green = false, r = 34) {
  const body = mesh(new THREE.SphereGeometry(r, 32, 24), green ? M.appleGreen() : M.apple()); body.scale.set(1, 0.9, 1); body.position.y = r * 0.9;
  const stem = mesh(new THREE.CylinderGeometry(1.6, 2.2, 22, 8), M.darkWood()); stem.position.set(2, r * 1.75, 0); stem.rotation.z = 0.25;
  const g = group(body, stem); g.name = 'prop_apple'; return g;
}
export function apricot(r = 20) { const b = mesh(new THREE.SphereGeometry(r, 24, 18), M.apricot()); b.scale.set(1, 0.92, 0.95); b.position.y = r * 0.92; b.name = 'prop_apricot'; return b; }

export function basket() {
  const body = lathe([[0, 0], [120, 0], [128, 4], [165, 150], [170, 160], [160, 160], [155, 150], [122, 10], [0, 8]], M.wicker(), 40);
  const rim = mesh(new THREE.TorusGeometry(166, 6, 10, 48), M.wicker()); rim.rotation.x = Math.PI / 2; rim.position.y = 160;
  const handle = mesh(new THREE.TorusGeometry(150, 7, 10, 48, Math.PI), M.wicker()); handle.position.y = 160;
  const cloth = mesh(new THREE.CircleGeometry(150, 32).rotateX(-Math.PI / 2), M.linen(0xf1eadb)); cloth.position.y = 140;
  const g = group(body, rim, handle, cloth); g.name = 'prop_basket'; return g;
}
/** Thonet-style bistro chair; seat at y = -280 (table top at 0, floor at -740) */
export function chair({ dark = true } = {}) {
  const mat = dark ? M.black() : M.oak();
  const seatY = -280;
  const seat = mesh(new THREE.CylinderGeometry(200, 200, 22, 40), mat); seat.position.y = seatY - 11;
  const g = group(seat);
  for (const [x, z] of [[-150, -150], [150, -150], [-150, 150], [150, 150]]) {
    const leg = mesh(new THREE.CylinderGeometry(9, 11, 460, 12), mat); leg.position.set(x * 1.06, seatY - 22 - 230, z * 1.06); leg.rotation.x = -z / 150 * 0.05; leg.rotation.z = x / 150 * 0.05; g.add(leg);
  }
  const back = mesh(new THREE.TorusGeometry(185, 9, 10, 40, Math.PI), mat); back.position.set(0, seatY + 20, -175); back.rotation.z = 0; back.rotation.x = -0.1;
  back.scale.set(1, 1.9, 1);
  const inner = mesh(new THREE.TorusGeometry(110, 7, 10, 32, Math.PI), mat); inner.position.set(0, seatY + 10, -170); inner.scale.set(1, 1.6, 1);
  g.add(back, inner); g.name = 'prop_chair'; return g;
}
export function cakeStand() {
  const foot = lathe([[0, 0], [70, 0], [72, 4], [20, 12], [16, 110], [40, 118], [0, 120]], M.porcelain());
  const top = lathe([[0, 0], [120, 0], [128, 4], [130, 7], [122, 8], [0, 4]], M.porcelain()); top.position.y = 118;
  const g = group(foot, top); g.name = 'prop_cakestand'; g.userData.topY = 126; return g;
}
export function planter(w, d, h = 90, stone = 'ochre') {
  const box = mesh(new THREE.BoxGeometry(w, h, d), M.stone(stone)); box.position.y = h / 2;
  const hedge = mesh(new THREE.BoxGeometry(w - 20, 90, d - 20), M.hedge()); hedge.position.y = h + 40;
  const g = group(box, hedge); g.name = 'prop_planter'; return g;
}
export function stairs({ steps = 10, width = 700, rise = 30, run = 60, stone = 'ochre' } = {}) {
  const g = new THREE.Group(); const m = M.stone(stone);
  for (let i = 0; i < steps; i++) { const b = mesh(new THREE.BoxGeometry(width, rise, run * (steps - i)), m); b.position.set(0, rise * i + rise / 2, -run * i - run * (steps - i) / 2); g.add(b); }
  g.name = 'prop_stairs'; return g;
}
export function fountain(r = 260) {
  const basin = lathe([[r - 40, 0], [r + 20, 0], [r + 30, 10], [r + 30, 90], [r + 10, 100], [r - 40, 100], [r - 50, 90], [r - 50, 10]], M.stone('ochre'), 64);
  const water = mesh(new THREE.CircleGeometry(r - 48, 64).rotateX(-Math.PI / 2), M.water()); water.position.y = 80;
  const column = lathe([[0, 0], [40, 0], [34, 150], [60, 160], [58, 170], [0, 170]], M.stone('ochre')); column.position.y = 10;
  const g = group(basin, water, column); g.name = 'prop_fountain'; return g;
}
export function picnicCloth(w = 1500, d = 1200) {
  const t = ginghamTexture(0xb7433d, 0xf4efe6);
  const m = new THREE.MeshPhysicalMaterial({ map: t.map.clone(), normalMap: t.normal, roughness: 0.95 }); m.map.repeat.set(w / 260, d / 260); m.map.needsUpdate = true;
  const c = mesh(new THREE.BoxGeometry(w, 3, d, 1, 1, 1), m); c.position.y = -1.5; c.rotation.y = 0.04; c.name = 'prop_cloth';
  return c;
}
/** grass tufts around a centre, instanced */
export function grass({ count = 2400, inner = 0, outer = 1900, exclude = null } = {}) {
  const geo = new THREE.ConeGeometry(6, 70, 5, 1, true); geo.translate(0, 35, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x5f8a3b, roughness: 1, side: THREE.DoubleSide });
  const im = new THREE.InstancedMesh(geo, mat, count); im.castShadow = true; im.receiveShadow = true;
  const d = new THREE.Object3D(); const col = new THREE.Color(); let k = 0; seedState = 11;
  for (let i = 0; i < count * 3 && k < count; i++) {
    const a = rnd() * Math.PI * 2, r = inner + Math.sqrt(rnd()) * (outer - inner);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (exclude && Math.abs(x) < exclude[0] && Math.abs(z) < exclude[1]) continue;
    d.position.set(x, 0, z); d.rotation.set((rnd() - 0.5) * 0.5, rnd() * Math.PI, (rnd() - 0.5) * 0.5); d.scale.setScalar(0.6 + rnd() * 0.9); d.updateMatrix();
    im.setMatrixAt(k, d.matrix); col.setHSL(0.24 + rnd() * 0.06, 0.45 + rnd() * 0.25, 0.28 + rnd() * 0.16); im.setColorAt(k, col); k++;
  }
  im.count = k; im.name = 'prop_grass'; return im;
}
export function shelves({ width = 2400, levels = 3, z = -700, baseY = 0 } = {}) {
  const g = new THREE.Group(); const wood = M.darkWood();
  const back = mesh(new THREE.BoxGeometry(width, 1100, 20), wood); back.position.set(0, baseY + 550, z - 10); g.add(back);
  const palette = [0x5a1016, 0x2b1a16, 0x8c6b3f, 0x1f2a36, 0x6b2f2a, 0x3d2b22];
  seedState = 23;
  for (let l = 0; l < levels; l++) {
    const y = baseY + 40 + l * 340;
    const shelf = mesh(new THREE.BoxGeometry(width, 24, 300), wood); shelf.position.set(0, y, z + 150); g.add(shelf);
    let x = -width / 2 + 80;
    while (x < width / 2 - 120) {
      const w = 70 + rnd() * 90, h = 40 + rnd() * 110, dd = 90 + rnd() * 80;
      const b = mesh(new THREE.BoxGeometry(w, h, dd), M.cardboard(palette[Math.floor(rnd() * palette.length)])); b.position.set(x + w / 2, y + 12 + h / 2, z + 150); g.add(b);
      if (rnd() < 0.3) { const j = lathe([[0, 0], [40, 0], [44, 4], [44, 120], [38, 130], [0, 130]], M.glass()); j.position.set(x + w + 60, y + 12, z + 150); g.add(j); x += 110; }
      x += w + 30 + rnd() * 50;
    }
  }
  g.name = 'prop_shelves'; return g;
}

/** a ring of real confections (clone factory supplied by the app) on a surface */
export function confectionRing(factory, n, radius, y = 0, start = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) { const c = factory(i + start); if (!c) break; const a = (i / n) * Math.PI * 2 + 0.3; c.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius); c.rotation.y = a; g.add(c); }
  g.name = 'prop_confections'; return g;
}
