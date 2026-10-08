// Set dressing built from real dimensions (units.js REF, millimetres, Y up, support surface at y = 0).
// Tableware uses lathe profiles traced from catalogue sections (wall thickness, foot rings, rim rolls), cutlery is
// extruded from its plan outline with rounded (bevelled) edges and then bent to its side profile, so highlights run
// along the edges the way they do on real polished steel.  Furniture follows EN seat / table heights.
import * as THREE from 'three';
import { REF, ref } from './units.js';
import { MAT, uvBox, uvPlanar } from './lookdev.js';

const V2 = (x, y) => new THREE.Vector2(x, y);
let seed = 7;
export const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
export const reseed = (s) => { seed = s; };

export function mesh(geo, mat, { cast = true, receive = true, name } = {}) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = receive; if (name) m.name = name; return m; }
export function group(name, ...objs) { const g = new THREE.Group(); g.name = name; objs.forEach(o => o && g.add(o)); return g; }
export function at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; }
function lathe(pts, mat, segs = 64, opts) { return mesh(new THREE.LatheGeometry(pts.map(p => V2(p[0], p[1])), segs), mat, opts); }
/** smooth a polyline profile with a centripetal Catmull-Rom (keeps lathe silhouettes round) */
function smoothProfile(pts, n = 6) {
  const c = new THREE.SplineCurve(pts.map(p => V2(p[0], p[1])));
  return c.getSpacedPoints(Math.max(8, pts.length * n)).map(v => [Math.max(0, v.x), v.y]);
}
/** a soft circular occlusion decal under small objects (ambient contact shadow, as from a large sky / softbox) */
export function contactDecal(radius, opacity = 0.45) {
  if (!contactDecal.tex) {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(0.45, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128); contactDecal.tex = new THREE.CanvasTexture(c); contactDecal.tex.userData.shared = true;
  }
  const m = new THREE.MeshBasicMaterial({ map: contactDecal.tex, transparent: true, opacity, depthWrite: false, color: 0x000000, toneMapped: false });
  m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'diffuseColor = vec4(0.0, 0.0, 0.0, texture2D(map, vMapUv).a * opacity);'); };
  const d = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2).rotateX(-Math.PI / 2), m);
  d.position.y = 0.06; d.renderOrder = 2; d.userData.noAO = true; d.name = 'contact'; return d;
}

// ------------------------------------------------------------------ coffee services
function cupBody(r, h, foot, wall, mat, tulip = 0.0) {
  // outer: foot ring, belly, rim roll; inner: back down to a thick base
  const R = r / 2, F = foot / 2;
  const outer = smoothProfile([[0, 0], [F - 2, 0], [F, 0.9], [F + 0.6, 3.2], [F + 2.5, 4.6], [R * (0.82 - tulip * 0.1), h * 0.22], [R * (0.95 - tulip * 0.05), h * 0.5], [R * (0.99 + tulip * 0.02), h * 0.8], [R, h - 0.9]], 5);
  const inner = smoothProfile([[R - wall * 0.55, h - 0.4], [R - wall, h * 0.8], [R * 0.95 - wall, h * 0.5], [R * 0.8 - wall, h * 0.22], [F * 0.7, 7.2], [0, 7.0]], 5);
  const rim = []; for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI; rim.push([R - wall * 0.5 + Math.cos(a) * wall * 0.5, h - 0.9 + Math.sin(a) * 0.9]); }
  return lathe(outer.concat(rim, inner), mat, 72);
}
function handle(r, h, size, mat) {
  const R = r / 2;
  const c = new THREE.CatmullRomCurve3([
    new THREE.Vector3(R - 1.2, h * 0.78, 0), new THREE.Vector3(R + size * 0.55, h * 0.84, 0), new THREE.Vector3(R + size * 0.95, h * 0.62, 0),
    new THREE.Vector3(R + size * 0.8, h * 0.36, 0), new THREE.Vector3(R + size * 0.3, h * 0.28, 0), new THREE.Vector3(R * 0.93 - 1, h * 0.3, 0)]);
  const g = new THREE.TubeGeometry(c, 40, size * 0.16, 12, false);
  g.scale(1, 1, 1.25);                                                   // flattened oval section
  return mesh(g, mat);
}
function saucer(d, well, h, mat) {
  const R = d / 2, W = well / 2;
  const p = smoothProfile([[0, 0.6], [W - 2, 0.6], [W, 0], [W + 3, 0], [W + 5, 1.6], [R * 0.75, h * 0.5], [R * 0.95, h * 0.88], [R, h], [R - 1.8, h + 0.5], [R * 0.94, h * 0.9 + 2.2], [R * 0.74, h * 0.5 + 2.6], [W + 3, 4.6], [W, 4.2], [W - 1, 4.9], [0, 4.9]], 5);
  const s = lathe(p, mat, 72); s.userData.top = 4.9; return s;
}
/** espresso / cappuccino / Armenian coffee service. kind: 'espresso' | 'cappuccino' | 'surch' */
export function coffeeCup(kind = 'espresso', { fill = 0.62, gold = kind === 'surch', tint } = {}) {
  const C = { espresso: REF.espressoCup, cappuccino: REF.cappuccinoCup, surch: REF.surchCup }[kind];
  const S = { espresso: REF.espressoSaucer, cappuccino: REF.cappuccinoSaucer, surch: REF.surchSaucer }[kind];
  const por = MAT.porcelain(tint);
  const sc = saucer(S.d, S.well, S.h, por);
  const cup = group('cup', cupBody(C.rim, C.h, C.foot, C.wall, por, kind === 'surch' ? 0.6 : 0), handle(C.rim, C.h, kind === 'cappuccino' ? 26 : 19, por));
  if (gold) {
    const R = C.rim / 2, band = [];
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI; band.push([R - C.wall * 0.5 + Math.cos(a) * (C.wall * 0.5 + 0.08), C.h - 0.9 + Math.sin(a) * 0.98]); }
    band.push([R + 0.06, C.h - 3.2]); band.unshift([R - C.wall - 0.05, C.h - 2.0]);
    cup.add(lathe(band, MAT.gold(), 72, { cast: false }));
    const sr = S.d / 2; sc.add(mesh(new THREE.TorusGeometry(sr - 0.7, 0.45, 6, 96).rotateX(Math.PI / 2).translate(0, S.h + 0.25, 0), MAT.gold(), { cast: false }));
  }
  // liquid: crema (espresso / surch) or milk foam (cappuccino)
  const level = 7 + (C.h - 9) * fill, rr = (C.rim / 2) * (0.8 + 0.18 * fill) - C.wall;
  const liq = mesh(new THREE.CircleGeometry(rr, 48).rotateX(-Math.PI / 2), kind === 'cappuccino' ? new THREE.MeshStandardMaterial({ color: 0xefe3cf, roughness: 0.75 }) : MAT.espresso(), { cast: false });
  liq.position.y = level; cup.add(liq);
  cup.position.y = sc.userData.top - 0.3;
  const g = group('prop_' + kind, sc, cup, contactDecal(S.d * 0.55, 0.5));
  ref(g, S.d); g.userData.cup = cup; return g;
}

// ------------------------------------------------------------------ plates
export function plate(kind = 'dessert', mat = MAT.porcelain()) {
  const P = { dessert: REF.dessertPlate, side: REF.sidePlate }[kind] || REF.dessertPlate;
  const R = P.d / 2, W = P.well / 2, H = P.h;
  const p = smoothProfile([[0, 1.6], [W * 0.78, 1.4], [W * 0.84, 0], [W * 0.9, 0], [W * 0.94, 1.6], [W * 1.1, 4.2], [R * 0.9, H * 0.66], [R * 0.99, H * 0.92], [R, H], [R - 2.2, H + 0.4], [R * 0.9, H * 0.66 + 3.6], [W * 1.02, 6.2], [W * 0.9, 5.7], [0, 5.6]], 5);
  const m = lathe(p, mat, 96); m.name = 'plate';
  const g = group('prop_plate_' + kind, m, contactDecal(R * 0.95, 0.42)); g.userData.top = 5.6; ref(g, P.d); return g;
}
/** plate with real confections (factory from confections.js: (i, opts) -> Object3D) */
export function confectionPlate(factory, items, kind = 'dessert') {
  const pl = plate(kind);
  if (factory) for (const it of items) { const c = factory(it.i, { cup: it.cup !== false }); if (!c) continue; c.position.set(it.x, pl.userData.top, it.z); c.rotation.y = it.ry || 0; if (it.tilt) c.rotation.z = it.tilt; pl.add(c); }
  return pl;
}

// ------------------------------------------------------------------ cutlery
function bendGeometry(geo, profile) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + profile(p.getZ(i), p.getX(i)));
  geo.computeVertexNormals(); return geo;
}
function splineFn(pts) { const c = new THREE.SplineCurve(pts.map(q => V2(q[0], q[1]))); const s = c.getSpacedPoints(200); return (z) => { let best = s[0]; for (const q of s) if (Math.abs(q.x - z) < Math.abs(best.x - z)) best = q; return best.y; }; }
export function fork({ len = REF.dessertFork.len } = {}) {
  const k = len / 178;
  const sh = new THREE.Shape();
  const side = [[7, 171], [6.4, 150], [4.6, 115], [3.0, 84], [2.6, 72], [6.2, 60], [11, 49], [12, 40]];
  sh.moveTo(-7 * k, 171 * k);
  for (let i = 1; i < side.length; i++) sh.lineTo(-side[i][0] * k, side[i][1] * k);
  // tines: 4 tines 3.4 wide, 3 gaps
  const edges = [-12, -8.6, -5.3, -1.7, 1.7, 5.3, 8.6, 12];
  for (let t = 0; t < 4; t++) {
    const xa = edges[t * 2], xb = edges[t * 2 + 1];
    sh.lineTo(xa * k, 3 * k); sh.lineTo((xa + 0.9) * k, 0.4 * k); sh.lineTo((xb - 0.9) * k, 0.4 * k); sh.lineTo(xb * k, 3 * k);
    if (t < 3) { const xc = edges[t * 2 + 2]; sh.lineTo(xb * k, 35 * k); sh.quadraticCurveTo(((xb + xc) / 2) * k, 38.5 * k, xc * k, 35 * k); }
  }
  for (let i = side.length - 1; i >= 1; i--) sh.lineTo(side[i][0] * k, side[i][1] * k);
  sh.absarc(0, 171 * k, 7 * k, 0, Math.PI, false);
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: true, bevelThickness: 0.45, bevelSize: 0.5, bevelSegments: 3, curveSegments: 12 });
  g.rotateX(Math.PI / 2);                                                  // plan in XZ, thickness in -Y
  g.translate(0, 2.05, 0);
  const prof = splineFn([[0, 4.5], [18, 1.2], [40, 0.2], [70, 6.5], [110, 9.5], [150, 6.5], [178, 1.0]].map(q => [q[0] * k, q[1]]));
  bendGeometry(g, (z, x) => prof(z) + (z < 58 * k ? 0.012 * x * x : 0));
  const m = mesh(g, MAT.silver()); const grp = group('prop_fork', m); ref(grp, len, 'z'); return grp;
}
export function spoon({ kind = 'tea' } = {}) {
  const S = kind === 'espresso' ? REF.espressoSpoon : REF.teaspoon;
  const k = S.len / 138, bw = S.bowl[0], bl = S.bowl[1];
  // bowl: shallow shell, elliptical
  const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push([t * 0.5, 0.38 * (t * t)]); }
  const outer = prof.map(p => [p[0], p[1]]), inner = prof.slice().reverse().map(p => [Math.max(0, p[0] - 0.02), p[1] + 0.035]);
  const bg = new THREE.LatheGeometry(outer.concat(inner).map(p => V2(p[0], p[1])), 48);
  bg.scale(bw, 14 * k, bl); bg.translate(0, 0.6, bl / 2);
  const sh = new THREE.Shape();
  const hz0 = bl * 0.92, side = [[2.2, hz0], [1.8, hz0 + 14 * k], [2.4, hz0 + 40 * k], [4.2, hz0 + 76 * k], [5.0, S.len - 6 * k]];
  sh.moveTo(-side[0][0], side[0][1]); for (const p of side.slice(1)) sh.lineTo(-p[0], p[1]);
  sh.absarc(0, S.len - 6 * k, 5.0, Math.PI, 0, true);
  for (const p of side.slice().reverse()) sh.lineTo(p[0], p[1]);
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 1.4, bevelEnabled: true, bevelThickness: 0.4, bevelSize: 0.45, bevelSegments: 3, curveSegments: 10 });
  hg.rotateX(Math.PI / 2); hg.translate(0, 1.8, 0);
  const hp = splineFn([[hz0, 4.8], [hz0 + 20 * k, 7.5], [hz0 + 60 * k, 8.5], [S.len - 10 * k, 4.5], [S.len, 2.0]]);
  bendGeometry(hg, (z) => hp(z) - 3.5);
  const mat = MAT.silver();
  const g = group('prop_spoon', mesh(bg, mat), mesh(hg, mat)); ref(g, S.len, 'z'); return g;
}

// ------------------------------------------------------------------ glassware
export function tumbler({ water = true } = {}) {
  const T = REF.tumbler, R = T.rim / 2, B = T.base / 2;
  const p = smoothProfile([[0, 0.5], [B - 3, 0.4], [B, 1.5], [B + 0.2, 6], [R, T.h - 0.6], [R - 0.9, T.h], [R - 1.9, T.h - 1.0], [B - 1.8, 7.5], [B - 4, 6.2], [0, 6.0]], 5);
  const gl = lathe(p, MAT.glass(), 72, { cast: true }); gl.userData.noAO = true;
  const g = group('prop_tumbler', gl, contactDecal(B * 1.2, 0.3));
  if (water) {
    const lv = T.h * 0.66; const rw = B - 1.9 + (R - 1.9 - (B - 1.9)) * ((lv - 7) / (T.h - 8));
    const w = lathe([[0, 6.2], [B - 2.1, 7.6], [rw - 0.15, lv - 0.6], [rw - 0.4, lv], [0, lv]], MAT.water(), 64, { cast: false }); w.userData.noAO = true; g.add(w);
  }
  ref(g, T.h, 'y'); return g;
}
export function wineGlass({ wine = false } = {}) {
  const W = REF.wineGlass;
  const p = smoothProfile([[0, 0], [36, 0], [37, 1.2], [3.5, 6], [3.2, 80], [8, 92], [30, 110], [W.bowl / 2, 150], [W.rim / 2 + 2, W.h - 8], [W.rim / 2, W.h], [W.rim / 2 - 1.2, W.h - 0.5], [W.bowl / 2 - 1.2, 150], [29, 111], [7, 94], [0, 92]], 5);
  const gl = lathe(p, MAT.glass(), 72); gl.userData.noAO = true;
  const g = group('prop_wineglass', gl, contactDecal(30, 0.25));
  if (wine) { const w = lathe([[0, 93], [7, 94.2], [28, 111], [38, 132], [0, 132]], MAT.wine(), 48, { cast: false }); w.userData.noAO = true; g.add(w); }
  ref(g, W.h, 'y'); return g;
}
export function bottle({ kind = 'wine', glassTint = 0x2e4a30 } = {}) {
  const B = REF.wineBottle, R = B.d / 2;
  const p = smoothProfile([[0, 3], [R - 4, 2], [R, 6], [R, 190], [R - 6, 225], [14, 250], [14, 290], [15, 294], [15, B.h], [0, B.h]], 5);
  const m = MAT.glass(0xffffff, glassTint, 18);
  const g = group('prop_bottle', lathe(p, m, 64), contactDecal(R * 1.3, 0.35));
  // paper label
  const lab = mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.3, 90, 64, 1, true, -1.2, 2.4), new THREE.MeshStandardMaterial({ color: 0xefe7d6, roughness: 0.8, side: THREE.DoubleSide }));
  lab.position.y = 110; g.add(lab); ref(g, B.h, 'y'); return g;
}

// ------------------------------------------------------------------ jezve (Armenian coffee pot)
export function jezve() {
  const J = REF.jezve;
  const outer = smoothProfile([[0, 0], [J.base / 2 - 2, 0], [J.base / 2, 1.8], [J.base / 2 - 0.2, 8], [J.base / 2 - 1.5, 32], [J.waist / 2 + 4, 58], [J.waist / 2, 74], [J.waist / 2 + 0.2, 84], [J.waist / 2 + 2.6, J.h - 1], [J.waist / 2 + 3, J.h]], 5);
  const inner = smoothProfile([[J.waist / 2 + 2.2, J.h], [J.waist / 2 - 0.9, 84], [J.waist / 2 - 1.1, 74], [J.waist / 2 + 3, 58], [J.base / 2 - 2.6, 32], [J.base / 2 - 1.5, 8], [J.base / 2 - 3, 2.2], [0, 2.2]], 5);
  const cu = lathe(outer, MAT.copperHammered(), 80);
  // hammered-copper UVs in mm (around x height)
  const tin = lathe(inner, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.62, 0.62, 0.6), metalness: 1, roughness: 0.32, side: THREE.DoubleSide }), 80);
  const uvs = cu.geometry.attributes.uv; for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * Math.PI * J.base, uvs.getY(i) * J.h * 1.2);
  // handle: brass socket + walnut handle rising at ~22 deg
  const ang = 0.38;
  const sock = mesh(new THREE.CylinderGeometry(6.5, 7.5, 34, 20).rotateZ(Math.PI / 2 - ang), MAT.brass(0.35));
  sock.position.set(J.waist / 2 + 18, 70, 0);
  const wood = MAT.oak('walnut', 200);
  const hgeo = new THREE.CylinderGeometry(5.5, 7.2, J.handle - 30, 20).rotateZ(Math.PI / 2 - ang); uvBox(hgeo);
  const hdl = mesh(hgeo, wood); hdl.position.set(J.waist / 2 + 18 + Math.cos(ang) * (J.handle / 2 + 2), 70 + Math.sin(ang) * (J.handle / 2 + 2), 0);
  const g = group('prop_jezve', cu, tin, sock, hdl, contactDecal(J.base * 0.62, 0.5)); ref(g, J.h, 'y'); return g;
}

// ------------------------------------------------------------------ textiles
/** folded linen napkin: soft top with fold rolls, slight drape noise */
export function napkin({ w = REF.napkin.folded[0], d = REF.napkin.folded[1], layers = 4, color = 0xece5d6 } = {}) {
  const th = REF.napkin.thick * layers;
  const geo = new THREE.BoxGeometry(w, th, d, 40, 1, 40);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > 0) {
      const ex = Math.min(Math.abs(Math.abs(x) - w / 2), 8) / 8, ez = Math.min(Math.abs(Math.abs(z) - d / 2), 8) / 8;
      const roll = 1 - (1 - Math.min(ex, ez)) * (1 - Math.min(ex, ez));
      p.setY(i, y * (0.55 + 0.45 * roll) + 0.35 * Math.sin(x * 0.045 + z * 0.02) * Math.sin(z * 0.06) * roll);
    }
  }
  geo.computeVertexNormals(); geo.translate(0, th / 2, 0); uvPlanar(geo);
  const g = group('prop_napkin', mesh(geo, MAT.linen(color))); ref(g, Math.max(w, d)); return g;
}
/** cloth spread on uneven ground (picnic blanket): grid displaced by a gentle fold field, fringe ignored */
export function blanket({ w = REF.picnicBlanket.w, d = REF.picnicBlanket.d, ground = () => 0 } = {}) {
  const geo = new THREE.PlaneGeometry(w, d, 90, 110).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const ex = 1 - Math.min(1, (w / 2 - Math.abs(x)) / 120), ez = 1 - Math.min(1, (d / 2 - Math.abs(z)) / 120);
    const fold = 6 * Math.max(0, Math.sin(x * 0.0065 + 0.8) * Math.sin(z * 0.004 + 0.3)) + 2.5 * Math.sin(x * 0.021 + z * 0.013) * Math.sin(z * 0.017);
    const lift = 9 * Math.pow(Math.max(ex, ez), 2) * (0.5 + 0.5 * Math.sin(x * 0.01 + z * 0.012));
    p.setY(i, ground(x, z) + 2 + fold * (0.6 + 0.4 * Math.max(ex, ez)) + lift);
  }
  geo.computeVertexNormals(); uvPlanar(geo);
  const m = mesh(geo, MAT.textile(420), { cast: false }); m.name = 'prop_blanket'; return m;
}

// ------------------------------------------------------------------ fruit & food
function fruitMat(c, rough = 0.45, clear = 0.4) { return new THREE.MeshStandardMaterial({ color: c, roughness: rough * (1 - 0.5 * clear) }); }   // waxy skins: gloss folded into roughness
function blob(r, sx = 1, sy = 1, sz = 1, wob = 0.04, segs = 32) {
  const g = new THREE.SphereGeometry(r, segs, Math.round(segs * 0.75)); const p = g.attributes.position; const s = rnd() * 10;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = 1 + wob * Math.sin(x * 0.3 + s) * Math.sin(y * 0.27 + s * 2) * Math.sin(z * 0.31 + s); p.setXYZ(i, x * sx * n, y * sy * n, z * sz * n); }
  g.computeVertexNormals(); return g;
}
export function apricot(d = REF.apricot) {
  const m = fruitMat(0xe69444, 0.6, 0.0, 0.7); m.color.offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.06);
  const b = mesh(blob(d / 2, 1, 0.94, 0.98, 0.03), m); b.position.y = d * 0.46;
  // suture groove hint: slight darker blush
  const g = group('prop_apricot', b); ref(g, d); return g;
}
export function driedApricot() {
  const [a, b, c] = REF.driedApricot;
  const g = blob(a / 2, 1, c / a, b / a, 0.12, 24); const m = fruitMat(0xd5761f, 0.38, 0.5); m.color.offsetHSL(0, 0, (rnd() - 0.5) * 0.08);
  const o = mesh(g, m); o.position.y = c / 2; o.rotation.y = rnd() * 6; return group('prop_dried_apricot', o);
}
export function walnut(d = REF.walnut) {
  const g = blob(d / 2, 1, 0.92, 1.05, 0.09, 28); const o = mesh(g, fruitMat(0xa47a4c, 0.8, 0.0)); o.position.y = d * 0.45; return group('prop_walnut', o);
}
export function pomegranate(d = REF.pomegranate, half = false) {
  const skin = fruitMat(0x8e1c22, 0.42, 0.5);
  const g = group('prop_pomegranate');
  if (!half) {
    const b = mesh(blob(d / 2, 1, 0.92, 1, 0.03), skin); b.position.y = d * 0.45; g.add(b);
    const crown = mesh(new THREE.CylinderGeometry(6, 4, 12, 7, 1, true), skin); crown.position.y = d * 0.9; g.add(crown);
  } else {
    // cut half lying face up: skin cup + aril face (instanced arils)
    const cupg = new THREE.SphereGeometry(d / 2, 40, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2); const cup = mesh(cupg, skin); cup.position.y = d / 2 - 2; g.add(cup);
    const pith = mesh(new THREE.CircleGeometry(d / 2 - 1.5, 48).rotateX(-Math.PI / 2), fruitMat(0xead9b0, 0.7, 0)); pith.position.y = d / 2 - 2; g.add(pith);
    const arilG = new THREE.SphereGeometry(2.6, 10, 8); arilG.scale(1, 0.8, 1.2);
    const arilM = new THREE.MeshStandardMaterial({ color: 0xa8102a, roughness: 0.06 });
    const n = 260; const im = new THREE.InstancedMesh(arilG, arilM, n); const o = new THREE.Object3D(); let k = 0;
    for (let i = 0; i < n * 3 && k < n; i++) { const r = Math.sqrt(rnd()) * (d / 2 - 5), a = rnd() * 6.283; if (Math.sin(a * 6) * Math.cos(a * 4) > 0.85 && r > 8) continue; o.position.set(Math.cos(a) * r, d / 2 - 1, Math.sin(a) * r); o.rotation.set(rnd(), rnd() * 6, rnd()); o.updateMatrix(); im.setMatrixAt(k++, o.matrix); }
    im.count = k; im.castShadow = false; im.receiveShadow = true; g.add(im);
  }
  ref(g, d); return g;
}
export function cherry() {
  const b = mesh(blob(11, 1, 0.92, 1, 0.02, 24), fruitMat(0x6a0a12, 0.2, 0.9)); b.position.y = 10;
  const st = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 19, 0), new THREE.Vector3(4, 32, 2), new THREE.Vector3(10, 44, 3)]), 10, 0.7, 5), new THREE.MeshStandardMaterial({ color: 0x5c6b2a, roughness: 0.7 }));
  return group('prop_cherry', b, st);
}
export function fig() {
  const g = new THREE.SphereGeometry(REF.fig / 2, 32, 24); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / (REF.fig / 2); const s = y > 0 ? 1 - 0.45 * y * y : 1; p.setXYZ(i, p.getX(i) * s, p.getY(i) * 1.15, p.getZ(i) * s); }
  g.computeVertexNormals();
  const o = mesh(g, fruitMat(0x4a2440, 0.55, 0.2, 0.4)); o.position.y = REF.fig * 0.5; return group('prop_fig', o);
}
export function bowl(d = 140, h = 52, mat = MAT.stoneware(0xe9e1d2)) {
  const R = d / 2; const p = smoothProfile([[0, 1], [R * 0.36, 0.8], [R * 0.4, 0], [R * 0.46, 0], [R * 0.5, 1.5], [R * 0.8, h * 0.45], [R, h], [R - 2.5, h + 0.2], [R * 0.78, h * 0.45 + 2.5], [R * 0.4, 5.5], [0, 5.2]], 5);
  const g = group('prop_bowl', lathe(p, mat, 64), contactDecal(R * 0.8, 0.4)); g.userData.top = 5.2; g.userData.r = R; ref(g, d); return g;
}

// ------------------------------------------------------------------ furniture
/** round bistro table, top surface at y = 0. top: 'marble' | 'walnut' | 'zinc' */
export function bistroTable({ d = REF.bistroTable.top, h = REF.bistroTable.h, top = 'marble', rim = 'brass' } = {}) {
  const R = d / 2, T = REF.bistroTable.thick;
  const tg = new THREE.CylinderGeometry(R, R, T, 128, 1); tg.translate(0, -T / 2, 0); uvBox(tg);
  const topMat = top === 'marble' ? MAT.marble('carrara', 800) : top === 'calacatta' ? MAT.marble('calacatta', 800) : top === 'walnut' ? MAT.oak('walnut', 700) : new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.55, 0.56, 0.57), metalness: 1, roughness: 0.38 });
  const g = group('prop_bistro_table', mesh(tg, topMat));
  if (rim) { const band = mesh(new THREE.CylinderGeometry(R + 1.2, R + 1.2, T + 1.0, 128, 1, true), rim === 'brass' ? MAT.brass(0.26) : MAT.steel()); band.position.y = -T / 2 + 0.4; g.add(band);
    g.add(mesh(new THREE.TorusGeometry(R + 0.6, 0.7, 8, 128).rotateX(Math.PI / 2).translate(0, 0.35, 0), rim === 'brass' ? MAT.brass(0.26) : MAT.steel(), { cast: false })); }
  const iron = MAT.castIron();
  const col = smoothProfile([[0, -h], [215, -h], [218, -h + 8], [210, -h + 22], [120, -h + 40], [46, -h + 70], [34, -h + 110], [30, -h + 160], [26, -h * 0.55], [24, -T - 120], [32, -T - 90], [34, -T - 60], [70, -T - 40], [70, -T - 30], [0, -T - 30]], 4);
  g.add(lathe(col, iron, 48));
  for (let i = 0; i < 4; i++) { const arm = mesh(new THREE.BoxGeometry(R * 1.5, 6, 22), iron); arm.position.y = -T - 6; arm.rotation.y = i * Math.PI / 4 + Math.PI / 8; if (i < 2) g.add(arm); }
  g.userData.floorY = -h; ref(g, d); return g;
}
export function squareTable({ w = 700, d = 700, h = REF.diningTable.h, top = 'walnut', thick = 32 } = {}) {
  const tg = new THREE.BoxGeometry(w, thick, d, 1, 1, 1); tg.translate(0, -thick / 2, 0);
  // eased edges: 3 mm radius visual via slight bevel geometry substitute (box) - fine at viewing distance
  uvBox(tg);
  const topMat = top === 'walnut' ? MAT.oak('walnut', 900) : top === 'oak' ? MAT.oak('oak', 900) : MAT.marble(top, 900);
  const g = group('prop_square_table', mesh(tg, topMat));
  const legM = MAT.paintedMetal(0x1c1c1c);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const l = mesh(new THREE.BoxGeometry(36, h - thick, 36), legM); l.position.set(x * (w / 2 - 50), -thick - (h - thick) / 2, z * (d / 2 - 50)); g.add(l); }
  const apron = mesh(new THREE.BoxGeometry(w - 100, 60, d - 100), legM); apron.position.y = -thick - 30; g.add(apron);
  g.userData.floorY = -h; return g;
}
function tube(points, r, mat, closed = false, segs = 64) { const c = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', 0.5); return mesh(new THREE.TubeGeometry(c, segs, r, 12, closed), mat); }
/** Parisian woven bistro chair (rattan frame, woven seat / back). y = 0 at the floor. */
export function rattanChair({ weave = true } = {}) {
  const C = REF.bistroChair, sh = C.seat, w = C.w / 2, d = C.d;
  const frame = new THREE.MeshStandardMaterial({ color: 0xb98c55, roughness: 0.38 });
  const r = 12.5;
  const g = group('prop_rattan_chair');
  // seat ring (rounded square) and woven panel
  const ring = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const sx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.55), sz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.55); ring.push([sx * (w - 10), sh, sz * (d / 2 - 20) + 10]); }
  g.add(tube(ring, r, frame, true, 96));
  const seat = new THREE.CircleGeometry(1, 48); const sp = seat.attributes.position;
  for (let i = 0; i < sp.count; i++) { const x = sp.getX(i), y = sp.getY(i); const a = Math.atan2(y, x), rr = Math.hypot(x, y); const sx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.55) * rr, sz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.55) * rr; sp.setXYZ(i, sx * (w - 14), sh - 6 * (1 - rr * rr), -sz * (d / 2 - 24) + 10); }
  seat.computeVertexNormals(); uvPlanar(seat);
  const seatM = weave ? MAT.rattan(54) : frame; g.add(mesh(seat, seatM));
  // legs: front legs straight, rear legs sweep up into the back
  for (const s of [-1, 1]) {
    g.add(tube([[s * (w - 30), 0, d / 2 - 40], [s * (w - 22), sh * 0.5, d / 2 - 30], [s * (w - 14), sh - 10, d / 2 - 14]], r, frame, false, 24));
    g.add(tube([[s * (w - 40), 0, -d / 2 + 30], [s * (w - 26), sh * 0.6, -d / 2 + 50], [s * (w - 18), sh, -d / 2 + 70], [s * (w - 14), sh + 220, -d / 2 + 40], [s * (w - 30), C.h - 20, -d / 2 + 10]], r, frame, false, 40));
    g.add(tube([[s * (w - 28), 160, d / 2 - 36], [s * (w - 32), 160, -d / 2 + 44]], 9, frame, false, 8));
  }
  // back: curved top rail and woven band
  const rail = []; for (let i = 0; i <= 16; i++) { const t = i / 16, a = (t - 0.5) * 2.2; rail.push([Math.sin(a) * (w - 22) / Math.sin(1.1), C.h - 20 - 10 * Math.cos(a), -d / 2 + 10 + (1 - Math.cos(a)) * 60]); }
  g.add(tube(rail, r, frame, false, 48));
  const back = new THREE.PlaneGeometry(1, 1, 24, 2); const bp = back.attributes.position;
  for (let i = 0; i < bp.count; i++) { const u = bp.getX(i) + 0.5, v = bp.getY(i) + 0.5; const a = (u - 0.5) * 2.2; bp.setXYZ(i, Math.sin(a) * (w - 26) / Math.sin(1.1), C.h - 40 - v * 200, -d / 2 + 14 + (1 - Math.cos(a)) * 60); }
  back.computeVertexNormals(); uvBox(back);
  g.add(mesh(back, weave ? MAT.rattan(54) : frame));
  ref(g, C.h, 'y'); return g;
}
/** bentwood Thonet No. 14 style chair */
export function thonetChair({ finish = 'dark' } = {}) {
  const C = REF.thonetChair, sh = C.seat, R = C.seatD / 2;
  const wood = finish === 'dark' ? new THREE.MeshStandardMaterial({ color: 0x2a1a12, roughness: 0.32 }) : MAT.oak('oak', 300);
  const g = group('prop_thonet_chair');
  const seatG = new THREE.CylinderGeometry(R, R, 18, 64); seatG.translate(0, sh - 9, 0);
  g.add(mesh(seatG, wood));
  g.add(mesh(new THREE.TorusGeometry(R * 0.86, 10, 10, 64).rotateX(Math.PI / 2).translate(0, sh - 30, 0), wood));
  g.add(mesh(new THREE.TorusGeometry(R * 0.78, 8, 10, 64).rotateX(Math.PI / 2).translate(0, 190, 0), wood));
  for (const s of [-1, 1]) {
    g.add(tube([[s * R * 0.75, 0, R * 0.7], [s * R * 0.72, sh - 20, R * 0.62]], 13, wood, false, 8));
    g.add(tube([[s * R * 0.62, 0, -R * 0.9], [s * R * 0.66, sh * 0.5, -R * 0.72], [s * R * 0.7, sh, -R * 0.62], [s * R * 0.66, sh + 220, -R * 0.8], [s * R * 0.4, C.h - 10, -R * 0.9], [0, C.h, -R * 0.92]], 12, wood, false, 40));
  }
  g.add(tube([[-R * 0.55, sh + 30, -R * 0.66], [-R * 0.62, sh + 200, -R * 0.78], [0, sh + 310, -R * 0.86], [R * 0.62, sh + 200, -R * 0.78], [R * 0.55, sh + 30, -R * 0.66]], 9, wood, false, 40));
  ref(g, C.h, 'y'); return g;
}

// ------------------------------------------------------------------ vegetation
/** deciduous tree: tapered trunk + branches + instanced leaf cards in an ellipsoidal canopy */
export function tree({ h = REF.tree.h, canopy = REF.tree.canopy, leaf = [0x3f5a24, 0x6f8a36], cards = 520, cardSize = 900, trunkColor = 0x6b6258, seedv = 3 } = {}) {
  reseed(seedv);
  const g = group('prop_tree'); g.userData.noAO = true;
  const bark = new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 0.95 });
  const trunkH = h * 0.42;
  g.add(mesh(new THREE.CylinderGeometry(h * 0.012, h * 0.02, trunkH, 12).translate(0, trunkH / 2, 0), bark, { receive: false }));
  for (let i = 0; i < 6; i++) {
    const a = rnd() * 6.28, el = 0.5 + rnd() * 0.5, L = h * (0.22 + rnd() * 0.15);
    const s = new THREE.Vector3(0, trunkH * (0.85 + rnd() * 0.2), 0), e = s.clone().add(new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).multiplyScalar(L));
    g.add(mesh(new THREE.TubeGeometry(new THREE.LineCurve3(s, e), 2, h * 0.007, 6), bark, { receive: false }));
  }
  const m = MAT.leaves(leaf[0], leaf[1], cardSize);
  const geo = new THREE.PlaneGeometry(cardSize, cardSize); uvPlanar(geo, 'z'); geo.translate(0, 0, 0);
  const im = new THREE.InstancedMesh(geo, m, cards); const o = new THREE.Object3D(); const col = new THREE.Color();
  const cy = trunkH + (h - trunkH) * 0.5, ry = (h - trunkH) * 0.55, rr = canopy / 2;
  for (let i = 0; i < cards; i++) {
    let x, y, z; do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; } while (x * x + y * y + z * z > 1);
    const k = Math.pow(x * x + y * y + z * z, 0.25);                     // denser shell
    o.position.set(x / k * rr * 0.95, cy + y / k * ry, z / k * rr * 0.95);
    o.rotation.set(rnd() * 3, rnd() * 6.28, rnd() * 3); o.scale.setScalar(0.7 + rnd() * 0.6); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
    col.setHSL(0.22 + rnd() * 0.06, 0.4 + rnd() * 0.2, 0.75 + rnd() * 0.3); im.setColorAt(i, col);
  }
  im.castShadow = false; im.receiveShadow = false; im.userData.noAO = true; g.add(im);
  return g;
}
/** instanced grass blades over an area (ground fn gives height), density per m² */
export function grassField({ w = 8000, d = 8000, count = 40000, h = [60, 160], exclude = null, ground = () => 0, colors = [0x4f6e2a, 0x9aac58] } = {}) {
  const blade = new THREE.BufferGeometry();
  const P = [], C = [], segs = 4;
  for (let s = 0; s <= segs; s++) { const t = s / segs, wdt = 2.4 * (1 - t * 0.92); P.push(-wdt, t, 0, wdt, t, 0); }
  const idx = []; for (let s = 0; s < segs; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); blade.setIndex(idx); blade.computeVertexNormals();
  const ca = new THREE.Color(colors[0]), cb = new THREE.Color(colors[1]);
  for (let s = 0; s <= segs; s++) { const t = s / segs; const c = ca.clone().lerp(cb, t); C.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  blade.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n float t = position.y; transformed.z += t * t * 0.35; transformed.y = t;'); };
  const im = new THREE.InstancedMesh(blade, mat, count); const o = new THREE.Object3D(); const col = new THREE.Color(); let k = 0;
  reseed(11);
  for (let i = 0; i < count * 2 && k < count; i++) {
    const x = (rnd() - 0.5) * w, z = (rnd() - 0.5) * d;
    if (exclude && exclude(x, z)) continue;
    const hh = h[0] + rnd() * (h[1] - h[0]);
    o.position.set(x, ground(x, z) - 4, z); o.rotation.set((rnd() - 0.5) * 0.4, rnd() * 6.28, (rnd() - 0.5) * 0.4); o.scale.set(0.8 + rnd() * 0.6, hh, hh * 0.9); o.updateMatrix();
    im.setMatrixAt(k, o.matrix); col.setHSL(0.2 + rnd() * 0.07, 0.35 + rnd() * 0.25, 0.75 + rnd() * 0.4); im.setColorAt(k, col); k++;
  }
  im.count = k; im.castShadow = false; im.receiveShadow = true; im.userData.noAO = true; im.name = 'prop_grass'; return im;
}
/** clipped hedge / boxwood: a lumpy box with leaf texture */
export function hedge(w, h, d, color = 0x41582a) {
  const geo = new THREE.BoxGeometry(w, h, d, Math.max(2, Math.round(w / 120)), Math.max(2, Math.round(h / 120)), Math.max(2, Math.round(d / 120)));
  const p = geo.attributes.position; geo.computeVertexNormals(); const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const s = 18 * (Math.sin(x * 0.031 + z * 0.017) * Math.sin(y * 0.027 + x * 0.011) + 0.5 * Math.sin(z * 0.05 + y * 0.04)); p.setXYZ(i, x + n.getX(i) * s, y + n.getY(i) * s, z + n.getZ(i) * s); }
  geo.computeVertexNormals(); geo.translate(0, h / 2, 0); uvBox(geo);
  const m = MAT.leaves(color, 0x6a8a3a, 260).clone(); m.alphaTest = 0; m.transparent = false;
  const o = mesh(geo, m, { cast: false }); o.name = 'prop_hedge'; return o;
}
/** potted plant: terracotta / stone pot + leafy ball */
export function pottedPlant({ potD = 360, potH = 380, plantD = 520, pot = 'terracotta', leaf = 0x3f5a28 } = {}) {
  const R = potD / 2;
  const potM = pot === 'terracotta' ? new THREE.MeshStandardMaterial({ color: 0xa65a3a, roughness: 0.85 }) : pot === 'zinc' ? MAT.steel() : new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.6 });
  const p = smoothProfile([[0, 0], [R * 0.72, 0], [R * 0.74, 6], [R * 0.95, potH * 0.92], [R, potH * 0.94], [R, potH], [R - 12, potH], [R * 0.9, potH * 0.9], [0, potH * 0.88]], 4);
  const g = group('prop_planter', lathe(p, potM, 40));
  const ball = mesh(new THREE.IcosahedronGeometry(plantD / 2, 3), MAT.leaves(leaf, 0x6c8a3c, 300).clone(), { cast: false });
  const bp = ball.geometry.attributes.position; for (let i = 0; i < bp.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(bp, i); v.multiplyScalar(1 + 0.08 * Math.sin(v.x * 0.05) * Math.sin(v.y * 0.04 + v.z * 0.03)); bp.setXYZ(i, v.x, v.y, v.z); }
  ball.geometry.computeVertexNormals(); uvBox(ball.geometry); ball.material.alphaTest = 0;
  ball.geometry = uvBox(ball.geometry);
  ball.position.y = potH + plantD * 0.42; ball.userData.noAO = true; g.add(ball);
  return g;
}

// ------------------------------------------------------------------ misc
export function candle({ d = REF.candlePillar.d, h = REF.candlePillar.h, lit = true, kelvin = 1850 } = {}) {
  const wax = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.55 });
  const body = lathe([[0, 0], [d / 2 - 1, 0], [d / 2, 1.5], [d / 2, h - 3], [d / 2 - 4, h], [3, h - 5], [0, h - 5]], wax, 48);
  const g = group('prop_candle', body, contactDecal(d * 0.8, 0.5));
  const wick = mesh(new THREE.CylinderGeometry(0.6, 0.6, 9, 6).translate(0, h - 1, 0), new THREE.MeshStandardMaterial({ color: 0x111111 }), { cast: false }); g.add(wick);
  if (lit) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 12).scale(1, 2.6, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.25).multiplyScalar(40) }));
    fl.position.y = h + 9; fl.userData.noAO = true; fl.castShadow = false; g.add(fl);
    g.userData.flame = new THREE.Vector3(0, h + 12, 0);       // practical light position (viewer's fixed light pool)
  }
  ref(g, h, 'y'); return g;
}
export function book({ w = REF.book.w, h = REF.book.h, t = REF.book.t, color = 0x30443a } = {}) {
  const cover = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const pages = new THREE.MeshStandardMaterial({ color: 0xeee6d4, roughness: 0.9 });
  const g = group('prop_book', at(mesh(new THREE.BoxGeometry(w, t - 2, h - 4), pages), 2, t / 2, 0), at(mesh(new THREE.BoxGeometry(w + 2, 1.2, h), cover), 0, t - 0.6, 0), at(mesh(new THREE.BoxGeometry(w + 2, 1.2, h), cover), 0, 0.6, 0), at(mesh(new THREE.BoxGeometry(2.4, t, h), cover), -w / 2 - 0.2, t / 2, 0));
  g.add(contactDecal(w * 0.7, 0.35)); return g;
}
/** wicker picnic basket (rectangular, rounded corners, lid partly open) */
export function picnicBasket({ open = 0.0 } = {}) {
  const B = REF.picnicBasket; const wck = MAT.wicker(120);
  const shape = new THREE.Shape(); const w = B.w / 2, d = B.d / 2, r = 50;
  shape.moveTo(-w + r, -d); shape.lineTo(w - r, -d); shape.quadraticCurveTo(w, -d, w, -d + r); shape.lineTo(w, d - r); shape.quadraticCurveTo(w, d, w - r, d); shape.lineTo(-w + r, d); shape.quadraticCurveTo(-w, d, -w, d - r); shape.lineTo(-w, -d + r); shape.quadraticCurveTo(-w, -d, -w + r, -d);
  const hole = new THREE.Path(); const ti = 9; hole.moveTo(-w + r, -d + ti); hole.lineTo(w - r, -d + ti); hole.quadraticCurveTo(w - ti, -d + ti, w - ti, -d + r); hole.lineTo(w - ti, d - r); hole.quadraticCurveTo(w - ti, d - ti, w - r, d - ti); hole.lineTo(-w + r, d - ti); hole.quadraticCurveTo(-w + ti, d - ti, -w + ti, d - r); hole.lineTo(-w + ti, -d + r); hole.quadraticCurveTo(-w + ti, -d + ti, -w + r, -d + ti);
  shape.holes.push(hole);
  const walls = new THREE.ExtrudeGeometry(shape, { depth: B.h, bevelEnabled: false, curveSegments: 10 }); walls.rotateX(-Math.PI / 2); uvBox(walls);
  const floor = new THREE.BoxGeometry(B.w - 10, 8, B.d - 10); floor.translate(0, 4, 0); uvBox(floor);
  const g = group('prop_basket', mesh(walls, wck), mesh(floor, wck));
  const lidG = new THREE.BoxGeometry(B.w + 6, 14, B.d / 2 + 4); lidG.translate(0, 7, (B.d / 2 + 4) / 2); uvBox(lidG);
  for (const s of [-1, 1]) {
    const lid = mesh(lidG, wck); lid.position.set(0, B.h, 0); lid.rotation.y = s > 0 ? 0 : Math.PI; lid.rotateX(-open * (s > 0 ? 1.2 : 0)); g.add(lid);
  }
  const leather = new THREE.MeshStandardMaterial({ color: 0x5a3320, roughness: 0.5 });
  for (const s of [-1, 1]) g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(s * w * 0.45, B.h + 14, -12), new THREE.Vector3(s * w * 0.35, B.h + 14 + B.handle, -8), new THREE.Vector3(s * w * 0.1, B.h + 14 + B.handle * 1.05, -6), new THREE.Vector3(-s * w * 0.15, B.h + 14 + B.handle * 0.9, -8)]), 30, 8, 10), leather));
  g.add(contactDecal(B.w * 0.62, 0.55)); ref(g, B.w); return g;
}
