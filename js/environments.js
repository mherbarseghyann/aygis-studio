// Photographic environments.  Each one is a dressed set built around the product at real scale (mm), with
// foreground / midground / background, one coherent light logic (sun + sky, window daylight, or studio softboxes),
// a white balance, an exposure, and camera shots chosen the way a product photographer would choose them.
//
// Light logic per set
//  * Outdoors: the sun is the shadow-casting key (angular radius 0.27 deg, hazier = larger); the sky dome is the
//    fill and is captured into the IBL; the sun disc is NOT in the IBL (it is the key), so there is no double light.
//  * Window / studio: the window or softbox is visible as an emitter in the set (reflections), but captured into the
//    IBL at a reduced radiance because the directional key (with the source's angular size, so the progressive
//    renderer produces a real soft area shadow) carries the rest of its energy.
//  * Practicals (candle flames, festoon bulbs, café interior lamps) are emitters and/or point lights at their real
//    colour temperature; the camera white balance is per set (units.lightColor).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { REF } from './units.js';
import { MAT, R, texSet, texMat, uvBox, uvPlanar } from './lookdev.js';
import * as P from './props.js';
import { skyDome, araratCard } from './sky.js';

const D2R = Math.PI / 180;
export const dirFrom = (az, el) => new THREE.Vector3(-Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), Math.cos(az * D2R) * Math.cos(el * D2R));
const { mesh, group, at, contactDecal } = P;

// ------------------------------------------------------------------ helpers
/** slab with eased edges, top face at y = 0 */
function slab(w, h, d, mat, r = 2, corner = 4) {
  const s = new THREE.Shape(), x = w / 2 - corner, z = d / 2 - corner;
  s.moveTo(-x, -d / 2); s.lineTo(x, -d / 2); s.quadraticCurveTo(w / 2, -d / 2, w / 2, -z); s.lineTo(w / 2, z); s.quadraticCurveTo(w / 2, d / 2, x, d / 2);
  s.lineTo(-x, d / 2); s.quadraticCurveTo(-w / 2, d / 2, -w / 2, z); s.lineTo(-w / 2, -z); s.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 4, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); g.translate(0, -(h - r), 0);
  return mesh(uvBox(g), mat);
}
function box(w, h, d, mat, { uv = true, cast = true, receive = true } = {}) { const g = new THREE.BoxGeometry(w, h, d); return mesh(uv ? uvBox(g) : g, mat, { cast, receive }); }
function plane(w, d, mat, { receive = true } = {}) { const g = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2); uvPlanar(g); return mesh(g, mat, { cast: false, receive }); }
/** merge meshes sharing one material into a single draw */
function merged(list, mat, opts) {
  const geos = list.map(m => { m.updateMatrix(); const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()); g.applyMatrix4(m.matrix); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; });
  const g = mergeGeometries(geos, false); return mesh(g, mat, opts);
}
/** emitter panel (softbox / window): radiance in scene units; captured into the IBL at `capture` x radiance */
function emitter(state, w, h, radiance, color = [1, 1, 1], capture = 0.15) {
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(...color).multiplyScalar(radiance), side: THREE.DoubleSide, fog: false });
  const e = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); e.castShadow = false; e.receiveShadow = false; e.userData.noAO = true;
  state.emitters.push({ m, full: m.color.clone(), capture });
  return e;
}
function aim(obj, dir, dist, target = new THREE.Vector3(0, 30, 0)) { obj.position.copy(dir).multiplyScalar(dist).add(target); obj.lookAt(target); return obj; }
function newState() {
  const st = { root: new THREE.Group(), emitters: [], skies: [], wb: 5600, exposure: 1, contact: 0.55 };
  st.onCapture = (on) => {
    for (const e of st.emitters) e.m.color.copy(e.full).multiplyScalar(on ? e.capture : 1);
    for (const s of st.skies) s.userData.setCapture(on);
  };
  return st;
}
/** a confection (with or without its paper cup) on any surface */
function conf(ctx, i, x, z, { cup = true, y = 0, ry = 0 } = {}) { const c = ctx.confection(i, { cup }); if (!c) return null; c.position.set(x, y, z); c.rotation.y = ry; return c; }

// ------------------------------------------------------------------ facade texture (window grid), tile = 4 bays x 3 storeys
function facadeRecipe({ wall = 0xd8c6aa, glass = 0x1d2329, frame = 0x30302e, winW = 0.44, winH = 0.56, sill = 0.24, arch = 0, groove = 0, lit = 0.12, curtain = 0x9d8f7c, band = 0 }) {
  const hx = (h) => `hexc(${h >>> 0}.)`;
  return `
  const vec2 G = vec2(4.0, 3.0);
  vec4 cellOf(vec2 uv){ vec2 g = uv * G; return vec4(fract(g), floor(g)); }
  float winD(vec2 f){ vec2 c = f - vec2(0.5, ${sill.toFixed(3)} + ${(winH / 2).toFixed(3)}); vec2 hs = vec2(${(winW / 2).toFixed(3)}, ${(winH / 2).toFixed(3)});
    float d = max(abs(c.x) / hs.x, abs(c.y) / hs.y);
    ${arch ? `if (c.y > hs.y - hs.x * 1.0) d = max(abs(c.x) / hs.x, length(vec2(c.x / hs.x, (c.y - (hs.y - hs.x)) / hs.x)));` : ''}
    return d; }
  vec3 albedo(vec2 uv){ vec4 c = cellOf(uv); float d = winD(c.xy); float h = hash12(c.zw + 2.0);
    vec3 w = ${hx(wall)} * (0.92 + 0.12 * (fbm(uv, vec2(6.), 4, 0.5) * 0.5 + 0.5));
    ${groove ? 'w *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.012, abs(fract(c.y * 6.0) - 0.5) - 0.48));' : ''}
    ${band ? 'w *= 1.0 - 0.25 * step(0.94, c.y);' : ''}
    vec3 g = mix(${hx(glass)}, ${hx(curtain)}, step(0.62, h) * 0.6);
    g = mix(g, vec3(1.0, 0.82, 0.55), step(1.0 - ${lit.toFixed(2)}, hash12(c.zw + 9.0)) * 0.7);
    float fr = smoothstep(0.86, 0.9, d) * (1.0 - smoothstep(1.0, 1.04, d)) + (1.0 - smoothstep(0.0, 0.012, abs(c.x - 0.5))) * step(d, 1.0);
    vec3 col = d < 1.0 ? g : w; col = mix(col, ${hx(frame)}, clamp(fr, 0., 1.) * step(d, 1.04));
    float sillM = step(abs(c.x - 0.5), ${(winW / 2 + 0.03).toFixed(3)}) * step(abs(c.y - ${(sill - 0.012).toFixed(3)}), 0.012);
    return mix(col, w * 1.12, sillM); }
  float rough(vec2 uv){ vec4 c = cellOf(uv); return winD(c.xy) < 1.0 ? 0.06 : 0.86; }
  float height(vec2 uv){ vec4 c = cellOf(uv); float d = winD(c.xy); return -60.0 * (1.0 - smoothstep(0.98, 1.02, d)); }`;
}
function facadeMat(key, opts, tileW, tileH) {
  const set = texSet(`facade_${key}_${tileW}x${tileH}`, facadeRecipe(opts), { size: 1024, tile: tileW, maps: ['albedo', 'rough', 'normal'], normalStrength: 1 });
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  for (const k of ['map', 'roughnessMap', 'normalMap']) { const t = set[k]; t.repeat.set(1 / tileW, 1 / tileH); m[k] = t; }   // GPU-resident bake, shared
  return m;
}
/** building block with a window-grid facade on all sides (UVs in mm, uvBox) */
function building(w, h, d, mat, roofMat) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0);
  const b = mesh(uvBox(g), mat, { cast: false, receive: false });
  return b;
}

// ======================================================================== the sets
export const ENVIRONMENTS = [
  // ---------------------------------------------------------------- 1. product studio
  {
    id: 'studio', name: 'Product Studio', group: 'Studio', swatch: 0xd4cec5,
    blurb: 'Seamless warm-grey sweep, honed travertine plinth, 1.4 m softbox key at 45°, strip-box rim, white bounce. Controlled, catalogue-grade light.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5500; st.exposure = 0.62; st.contact = 0.62; st.contactBlur = 2.6;
      const plinthH = 70;
      // sweep: floor -> 700 mm cove -> wall
      const W = 5200, prof = [];
      for (let i = 0; i <= 40; i++) { const t = i / 40; if (t < 0.4) prof.push([2400 - t / 0.4 * 3100, 0]); else if (t < 0.8) { const a = (t - 0.4) / 0.4 * Math.PI / 2; prof.push([-700 - Math.sin(a) * 700, 700 - Math.cos(a) * 700]); } else prof.push([-1400, 700 + (t - 0.8) / 0.2 * 2600]); }
      const pos = [], uv = [], idx = []; let acc = 0;
      prof.forEach((p, i) => { if (i) acc += Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]); for (const x of [-W / 2, W / 2]) { pos.push(x, p[1] - plinthH, p[0]); uv.push(x, acc); } });
      for (let i = 0; i < prof.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(idx); sg.computeVertexNormals();
      r.add(mesh(sg, MAT.paper(0xc9c2b8, 400), { cast: false }));
      // studio room (dark, so reflections show the light sources, not a grey void)
      const room = new THREE.Mesh(new THREE.BoxGeometry(14000, 7000, 14000), new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.95, side: THREE.BackSide }));
      room.position.y = 3500 - plinthH - 1; room.userData.noAO = true; r.add(room);
      // plinth (honed travertine) + low Nero Marquina riser
      const pl = slab(400, plinthH, 270, MAT.travertineSolid(300, 0.42), 1.6, 3); r.add(pl);
      const nero = slab(240, 32, 170, MAT.marble('nero', 500, 0.22), 1.2, 3); nero.position.set(330, -plinthH + 32, -140); r.add(nero);
      // set dressing: two confections in cups on the plinth, one bare on the riser
      r.add(conf(ctx, 1, 152, 88), conf(ctx, 3, 176, 50, { ry: 1.1 }), conf(ctx, 2, 318, -138, { cup: false, y: -plinthH + 32 }));
      // softboxes (visible emitters for reflections) + V-flat bounce
      const keyDir = dirFrom(46, 38), rimDir = dirFrom(-142, 26);
      r.add(aim(emitter(st, 1400, 1000, 14, [1, 1, 1], 0.15), keyDir, 1900));
      r.add(aim(emitter(st, 360, 1600, 10, [1, 1, 1], 0.2), rimDir, 1700));
      const vflat = new THREE.Mesh(new THREE.PlaneGeometry(1200, 2000), new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.95, side: THREE.DoubleSide }));
      aim(vflat, dirFrom(-62, 4), 1500, new THREE.Vector3(0, 300, 0)); vflat.userData.noAO = true; r.add(vflat);
      st.key = { az: 46, el: 38, kelvin: 5500, intensity: 6.5, angle: 17, extent: 700, pcf: 2 };
      st.rim = { az: -142, el: 26, kelvin: 5500, intensity: 2.2 };
      st.cams = { lifestyle: { az: 24, el: 12, focal: 70, fill: 0.5, fstop: 5.6, ty: 0.4, shiftY: -0.12 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 2. noir
  {
    id: 'noir', name: 'Noir Table', group: 'Studio', swatch: 0x17161a,
    blurb: 'Polished Nero Marquina, charcoal velvet, one raking strip light from behind-left and two beeswax candles. Low-key luxury; the foil comes alive.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 4300; st.exposure = 1.25; st.contact = 0.7; st.contactBlur = 2.0;
      const top = slab(1800, 30, 1000, MAT.marble('nero', 900).clone(), 2, 6); top.material.roughness = 0.6; r.add(top);
      // velvet drape with folds
      const dg = new THREE.PlaneGeometry(5000, 3200, 160, 4); const dp = dg.attributes.position;
      for (let i = 0; i < dp.count; i++) { const x = dp.getX(i); dp.setZ(i, 60 * Math.sin(x * 0.012) + 25 * Math.sin(x * 0.031 + 1.3)); }
      dg.computeVertexNormals(); const drape = mesh(dg, MAT.velvet(0x1c1a1d), { cast: false }); drape.position.set(0, 1100, -1300); r.add(drape);
      const room = new THREE.Mesh(new THREE.BoxGeometry(12000, 6000, 12000), new THREE.MeshStandardMaterial({ color: 0x0b0a0b, roughness: 1, side: THREE.BackSide }));
      room.position.y = 2200; room.userData.noAO = true; r.add(room);
      const floor = plane(12000, 12000, new THREE.MeshStandardMaterial({ color: 0x0e0d0d, roughness: 0.9 })); floor.position.y = -760; r.add(floor);
      // props: candle pair back-left, black stoneware plate with confections right, a bare confection on the stone
      const ca = at(P.candle({ h: 150 }), -330, 0, -250), cb = at(P.candle({ h: 95, d: 60 }), -250, 0, -330); r.add(ca, cb);
      st.practicals = [ca, cb].map(c => ({ pos: c.position.clone().add(c.userData.flame), kelvin: 1850, intensity: 5200, distance: 0 }));
      const plt = P.plate('side', MAT.stoneware(0x1c1b1a)); plt.position.set(255, 0, 95);
      for (const [i, x, z] of [[1, -32, 20], [4, 28, 26], [0, 0, -30]]) { const c = conf(ctx, i, x, z, { y: plt.userData.top }); if (c) plt.add(c); }
      r.add(plt, conf(ctx, 3, 150, 175, { cup: false, ry: 0.4 }));
      r.add(aim(emitter(st, 300, 1500, 5, [1, 1, 1], 0.2), dirFrom(-150, 30), 1900));      // strip box: foil glints
      r.add(aim(emitter(st, 900, 600, 1.2, [1, 1, 1], 0.5), dirFrom(24, 30), 1800));
      st.key = { az: -100, el: 44, kelvin: 5000, intensity: 4.0, angle: 9, extent: 650, pcf: 2 };   // side-back: out of the lid's specular path
      st.fill = { az: 24, el: 28, kelvin: 4800, intensity: 0.55 };
      st.cams = { lifestyle: { az: 14, el: 11, focal: 70, fill: 0.48, fstop: 2.8, ty: 0.4, shiftY: -0.1 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 3. coffee table, morning window
  {
    id: 'coffee', name: 'Morning Coffee', group: 'Tables', swatch: 0xe7e3dc,
    blurb: 'Carrara marble table by a north-facing window: cappuccino, a dessert plate with the confections, cake fork on linen. Soft daylight from the left.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5600; st.exposure = 0.85; st.contact = 0.55; st.contactBlur = 3.0;
      const tH = REF.diningTable.h;
      const top = slab(1500, 30, 850, MAT.marble('carrara', 1100), 2, 8); top.position.x = 120; r.add(top);
      for (const [x, z] of [[-560, -340], [800, -340], [-560, 340], [800, 340]]) { const l = box(50, tH - 30, 50, MAT.oak('oak', 500)); l.position.set(x, -30 - (tH - 30) / 2, z); r.add(l); }
      // room: oak floor, plaster walls, window on the left wall
      const floor = plane(9000, 9000, MAT.oak('oak', 1200)); floor.position.y = -tH; r.add(floor);
      const wallM = MAT.plaster(0xeae4da, 1500);
      const back = box(9000, 3200, 120, wallM, { cast: false }); back.position.set(0, -tH + 1600, -1700); r.add(back);
      const right = box(120, 3200, 9000, wallM, { cast: false }); right.position.set(2600, -tH + 1600, 0); r.add(right);
      const front = box(9000, 3200, 120, wallM, { cast: false }); front.position.set(0, -tH + 1600, 3400); r.add(front);
      const ceil = box(9000, 100, 9000, MAT.plaster(0xf2eee8, 1500), { cast: false }); ceil.position.set(0, -tH + 3150, 0); r.add(ceil);
      // left wall with a tall window opening (x = -1500)
      const wx = -1500, wy0 = -tH + 850, wy1 = -tH + 2700, wz0 = -900, wz1 = 900;
      const lw = new THREE.Group(); lw.name = 'left_wall';
      lw.add(at(box(140, wy0 + tH, 9000, wallM, { cast: false }), wx, -tH + (wy0 + tH) / 2, 0));
      lw.add(at(box(140, -tH + 3200 - wy1, 9000, wallM, { cast: false }), wx, wy1 + (-tH + 3200 - wy1) / 2, 0));
      lw.add(at(box(140, wy1 - wy0, 4500 - wz1, wallM, { cast: false }), wx, (wy0 + wy1) / 2, wz1 + (4500 - wz1) / 2));
      lw.add(at(box(140, wy1 - wy0, 4500 + wz0, wallM, { cast: false }), wx, (wy0 + wy1) / 2, wz0 - (4500 + wz0) / 2));
      r.add(lw);
      // window frame + mullions (white painted wood), sky emitter behind the glass
      const paint = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.35 });
      const fr = [];
      for (const z of [wz0, 0, wz1]) fr.push(at(box(90, wy1 - wy0, 60, paint), wx + 20, (wy0 + wy1) / 2, z));
      for (const y of [wy0, (wy0 + wy1) / 2 + 200, wy1]) fr.push(at(box(90, 60, wz1 - wz0, paint), wx + 20, y, 0));
      r.add(merged(fr, paint));
      const win = emitter(st, wz1 - wz0, wy1 - wy0, 2.4, [0.92, 0.96, 1.05], 0.35); win.rotation.y = Math.PI / 2; win.position.set(wx - 400, (wy0 + wy1) / 2, 0); r.add(win);
      // sheer linen curtain, half drawn
      const cg = new THREE.PlaneGeometry(700, wy1 - wy0 + 300, 60, 4); const cp = cg.attributes.position;
      for (let i = 0; i < cp.count; i++) { const x = cp.getX(i); cp.setZ(i, 35 * Math.sin(x * 0.04) + 12 * Math.sin(x * 0.11)); }
      cg.computeVertexNormals();
      const curtain = mesh(cg, new THREE.MeshStandardMaterial({ color: 0xf6f2ea, roughness: 0.9, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false }), { cast: false });
      curtain.rotation.y = Math.PI / 2; curtain.position.set(wx + 120, (wy0 + wy1) / 2 + 100, wz1 - 330); curtain.userData.noAO = true; r.add(curtain);
      // background: olive tree in a stone pot, a low sideboard with ceramics, framed print
      r.add(at(P.pottedPlant({ potD: 420, potH: 460, plantD: 900, pot: 'stone', leaf: 0x56663a }), -900, -tH, -1250));
      // walnut sideboard on slim legs (door joints as dark reveals), ceramics, framed print, pendant lamp, chair
      const walnut = MAT.oak('walnut', 900), black = MAT.paintedMetal(0x161616);
      const sbx = 900, sbz = -1480, sbH = 620, legH = 170;
      const sb = box(1400, sbH, 420, walnut); sb.position.set(sbx, -tH + legH + sbH / 2, sbz); r.add(sb);
      const legs = []; for (const [x, z] of [[-640, -170], [640, -170], [-640, 170], [640, 170]]) legs.push(at(box(22, legH, 22, black, { uv: false }), sbx + x, -tH + legH / 2, sbz + z));
      for (const x of [-233, 233]) legs.push(at(box(3, sbH - 40, 4, black, { uv: false }), sbx + x, -tH + legH + sbH / 2, sbz + 211));
      r.add(merged(legs, black));
      r.add(at(P.bowl(260, 90, MAT.stoneware(0xd9d0c0)), sbx - 260, -tH + legH + sbH, sbz + 20), at(P.bottle({ glassTint: 0x8aa08a }), sbx + 330, -tH + legH + sbH, sbz - 30));
      const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640; const cx = cv.getContext('2d');
      cx.fillStyle = '#efe9df'; cx.fillRect(0, 0, 512, 640);
      for (const [x, y, rr, c] of [[180, 260, 150, '#c98f6a'], [330, 380, 120, '#7d8f86'], [250, 470, 90, '#d9b98c'], [140, 420, 60, '#5e3a32']]) { cx.globalAlpha = 0.85; cx.fillStyle = c; cx.beginPath(); cx.arc(x, y, rr, 0, Math.PI * 2); cx.fill(); }
      const ptex = new THREE.CanvasTexture(cv); ptex.colorSpace = THREE.SRGBColorSpace;
      const frameM = black;
      r.add(at(box(640, 800, 26, frameM, { uv: false }), sbx, -tH + 1650, -1626));
      const print = mesh(new THREE.PlaneGeometry(560, 720), new THREE.MeshStandardMaterial({ map: ptex, roughness: 0.85 }), { cast: false }); print.position.set(sbx, -tH + 1650, -1612); r.add(print);
      const pend = new THREE.Group(); pend.name = 'pendant';
      pend.add(at(mesh(new THREE.CylinderGeometry(1.2, 1.2, 1700, 6), black, { cast: false }), 0, 850 + 260, 0));
      const dome = mesh(new THREE.LatheGeometry([[0, 0], [8, 0], [60, 40], [150, 160], [152, 165], [146, 165], [55, 46], [0, 6]].map(p => new THREE.Vector2(p[0], 210 - p[1])), 48), MAT.brass(0.35)); dome.position.y = 50; pend.add(dome);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(32, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.8, 0.55).multiplyScalar(6) })); bulb.position.y = 80; bulb.userData.noAO = true; pend.add(bulb);
      pend.position.set(120, 900, -60); r.add(pend);
      r.add(at(P.thonetChair({ finish: 'oak' }), 100, -tH, -640, 0));
      // tabletop: cappuccino, dessert plate with confections + cake fork on a napkin, water glass
      const cap = P.coffeeCup('cappuccino'); cap.position.set(-60, 0, -265); cap.rotation.y = -0.6; r.add(cap);
      const sp = P.spoon({ kind: 'tea' }); sp.position.set(-2, 2 + REF.cappuccinoSaucer.h - 9, -250); sp.rotation.y = 2.2; r.add(sp);
      const nap = P.napkin({ w: 200, d: 200 }); nap.position.set(280, 0, 140); nap.rotation.y = 0.12; r.add(nap);
      const pl = P.confectionPlate(ctx.confection, [{ i: 2, x: -18, z: 10 }, { i: 1, x: 30, z: -30, cup: false, ry: 0.6 }], 'dessert');
      pl.position.set(285, 2.4, 140); r.add(pl);
      const fk = P.fork({ len: REF.cakeFork.len }); fk.rotation.y = -Math.PI / 2 + 0.22; fk.position.set(368, 2.4 + 5.2, 105); r.add(fk);
      r.add(at(P.tumbler(), -250, 0, -170));
      // light: window daylight from the left, slightly behind
      st.key = { az: 98, el: 32, kelvin: 6200, intensity: 4.6, angle: 14, extent: 900, pcf: 2 };
      st.cams = { lifestyle: { az: 22, el: 15, focal: 50, fill: 0.36, fstop: 2.8, ty: 0.4, shiftY: -0.2 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 4. Parisian café terrace
  {
    id: 'paris', name: 'Parisian Café', group: 'Cafés', swatch: 0x2f4a3c,
    blurb: 'A marble-and-brass guéridon on a Paris café terrace: espresso, a glass of water, woven rattan chairs, the green shopfront and Haussmann stone behind. Soft morning sun.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5600; st.exposure = 0.24; st.contact = 0.5; st.contactBlur = 2.6;
      const tH = REF.bistroTable.h, F = -tH;
      const sun = dirFrom(64, 30);
      const sky = skyDome({ zenith: [0.32, 0.47, 0.82], horizon: [0.95, 0.96, 0.98], ground: [0.25, 0.24, 0.23], sunDir: sun, sunColor: [1.0, 0.92, 0.8], glow: 2.5, haze: 0.8, cloud: 0.42, cloudScale: 1.4, intensity: 1.15 });
      st.skies.push(sky); r.add(sky);
      st.fog = { color: new THREE.Color(0.95, 0.96, 0.98).multiplyScalar(1.1), density: 2.2e-6 };
      // street & sidewalk
      const sidewalk = plane(26000, 9000, MAT.asphalt(1600)); sidewalk.position.set(0, F, -1400); r.add(sidewalk);
      const road = plane(26000, 12000, MAT.asphalt(2400).clone()); road.position.set(0, F - 140, 9000); road.material.color.set(0x8a8a8a); r.add(road);
      const curb = box(26000, 160, 260, MAT.basalt(900)); curb.position.set(0, F - 70, 3000); r.add(curb);
      // the café: green shopfront, fascia, glass, warm interior; stone facade above; awning
      const fz = -2900;
      const green = new THREE.MeshStandardMaterial({ color: 0x1d3a2d, roughness: 0.28 });
      const gold = MAT.gold();
      const shop = new THREE.Group(); shop.name = 'shopfront';
      const shopW = 9000, shopH = 3900;
      // interior: warm room seen through the glass
      const inner = new THREE.Group();
      inner.add(at(box(shopW, shopH, 60, MAT.plaster(0x8a6a4c, 1500), { cast: false }), 0, F + shopH / 2, fz - 4200));
      inner.add(at(plane(shopW, 4200, MAT.oak('walnut', 900)), 0, F + 2, fz - 2100));
      inner.add(at(box(shopW, 60, 4200, MAT.plaster(0x6e5a48, 1500), { cast: false }), 0, F + shopH - 30, fz - 2100));
      const bar = box(4200, 1100, 600, MAT.oak('walnut', 900)); bar.position.set(-800, F + 550, fz - 2600); inner.add(bar);
      const zinc = box(4300, 40, 680, new THREE.MeshStandardMaterial({ color: 0x9a9b9c, metalness: 1, roughness: 0.3 })); zinc.position.set(-800, F + 1120, fz - 2600); inner.add(zinc);
      for (let i = 0; i < 7; i++) { const b = emitter(st, 120, 120, 26, [1.0, 0.72, 0.42], 0.6); b.position.set(-3600 + i * 1200, F + shopH - 420, fz - 1800 - (i % 2) * 900); b.rotation.x = Math.PI / 2; inner.add(b); }
      for (let i = 0; i < 18; i++) { const bt = P.bottle({ glassTint: [0x2e4a30, 0x5a3a1a, 0x8a9a7a][i % 3] }); bt.position.set(-2600 + i * 220, F + 1600, fz - 4100); bt.scale.setScalar(0.9); inner.add(bt); }
      const mirror = box(3800, 1400, 30, new THREE.MeshStandardMaterial({ color: 0xd8d0c0, metalness: 1, roughness: 0.08 }), { cast: false }); mirror.position.set(-800, F + 2400, fz - 4140); inner.add(mirror);
      for (let i = 0; i < 4; i++) { const t = P.bistroTable({ d: 600, top: 'marble' }); t.position.set(-3000 + i * 1700, 0, fz - 1200 - (i % 2) * 700); t.position.y = 0; inner.add(t); }
      inner.traverse(o => { o.castShadow = false; });
      shop.add(inner);
      // frontage: pilasters, transom, fascia with gilded letters, glazing
      const fr = [];
      for (let i = 0; i <= 6; i++) fr.push(at(box(260, shopH, 220, green), -shopW / 2 + i * shopW / 6, F + shopH / 2, fz));
      fr.push(at(box(shopW + 260, 700, 260, green), 0, F + shopH - 350, fz + 10));
      fr.push(at(box(shopW, 120, 160, green), 0, F + 2700, fz));
      fr.push(at(box(shopW, 520, 160, green), 0, F + 260, fz));
      r.add(merged(fr, green));
      const glass = MAT.glass(0xffffff, 0xf4f8f6, 4000);
      const gl = mesh(new THREE.PlaneGeometry(shopW, shopH - 1300), glass, { cast: false }); gl.position.set(0, F + 520 + (shopH - 1300) / 2, fz - 20); gl.userData.noAO = true; shop.add(gl);
      // fascia lettering (gilded) - generic, not a real brand
      const cv = document.createElement('canvas'); cv.width = 2048; cv.height = 160; const cx = cv.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, 2048, 160); cx.fillStyle = '#fff'; cx.font = '500 104px "Cormorant Garamond", Georgia, serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle';
      cx.fillText('CAFÉ  ·  BRASSERIE  ·  PÂTISSERIE', 1024, 84);
      const ltex = new THREE.CanvasTexture(cv); ltex.colorSpace = THREE.NoColorSpace;
      const lmat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(1.0, 0.77, 0.34), metalness: 1, roughness: 0.25, alphaMap: ltex, transparent: true });
      const letters = mesh(new THREE.PlaneGeometry(6400, 500), lmat, { cast: false }); letters.position.set(0, F + shopH - 350, fz + 145); shop.add(letters);
      r.add(shop);
      // Haussmann stone facade above the shop (limestone, rusticated), wrought-iron balcony band
      const stone = facadeMat('haussmann', { wall: 0xdccdb0, glass: 0x252b31, frame: 0xd4c8b2, winW: 0.42, winH: 0.62, sill: 0.16, groove: 1, lit: 0.06, curtain: 0xcfc3ad }, 14000, 9600);
      const upper = mesh(uvBox(new THREE.BoxGeometry(26000, 16000, 600).translate(0, 8000, 0)), stone, { cast: false }); upper.position.set(0, F + shopH, fz - 300); r.add(upper);
      const iron = MAT.paintedMetal(0x141414).clone();
      const balc = box(26000, 900, 40, iron, { cast: false }); balc.position.set(0, F + shopH + 3200 + 450, fz + 40); balc.material.transparent = true; balc.material.opacity = 0.75; r.add(balc);
      const nW = 13000 - shopW / 2 - 130; const ground = box(nW, shopH, 600, MAT.travertine(1200, 0.7, 2, 3), { cast: false }); ground.position.set(-shopW / 2 - 130 - nW / 2, F + shopH / 2, fz - 300); r.add(ground);
      const ground2 = ground.clone(); ground2.position.x = shopW / 2 + 130 + nW / 2; r.add(ground2);
      // awning (canvas, burgundy) over the windows, scalloped valance
      const awn = new THREE.MeshStandardMaterial({ color: 0x6e1d24, roughness: 0.85, side: THREE.DoubleSide });
      const ag = new THREE.PlaneGeometry(shopW + 200, 1900, 1, 8); const ap = ag.attributes.position;
      for (let i = 0; i < ap.count; i++) { const y = ap.getY(i); ap.setZ(i, 18 * Math.sin((y + 950) / 1900 * Math.PI)); }
      ag.computeVertexNormals(); const awning = mesh(ag, awn, { cast: false }); awning.rotation.x = -Math.PI / 2 + 0.36; awning.position.set(0, F + shopH - 170, fz + 870); r.add(awning);
      const val = mesh(new THREE.PlaneGeometry(shopW + 200, 260), awn, { cast: false }); val.position.set(0, F + shopH - 170 - 340 - 130, fz + 1760); r.add(val);
      // terrace: our guéridon + chairs; more tables behind; boxwood planters
      const tbl = P.bistroTable({ d: 700, top: 'calacatta', rim: 'brass' }); r.add(tbl);
      r.add(at(P.rattanChair(), -470, F, -300, 0.95), at(P.rattanChair(), 520, F, -260, -1.0));
      for (const [x, z, ry] of [[-1900, -1700, 0.4], [1500, -1900, -0.3], [-3500, -1500, 0.2], [3300, -1500, 0.1]]) {
        const t = P.bistroTable({ d: 600, top: 'marble' }); t.position.set(x, 0, z); r.add(t);
        r.add(at(P.rattanChair(), x - 420, F, z + 150, 1.3 + ry), at(P.rattanChair(), x + 420, F, z + 120, -1.4 + ry));
      }
      for (const x of [-5200, 5200]) { const pl = P.pottedPlant({ potD: 520, potH: 600, plantD: 700, pot: 'zinc', leaf: 0x3d5226 }); pl.position.set(x, F, -1200); r.add(pl); }
      // street trees (plane trees) and the opposite facade (reflections, IBL)
      for (const x of [-7000, 7000, -16000, 16000]) r.add(at(P.tree({ h: 12000, canopy: 7000, leaf: [0x4e6a2c, 0x7a9440], seedv: Math.abs(x) % 97 }), x, F, 2700));
      const opp = mesh(uvBox(new THREE.BoxGeometry(40000, 22000, 600).translate(0, 11000, 0)), facadeMat('haussmann2', { wall: 0xe0d2b8, glass: 0x262c33, frame: 0xd8ccb6, winW: 0.42, winH: 0.62, sill: 0.16, groove: 1, lit: 0.05 }, 14000, 9600), { cast: false });
      opp.position.set(0, F - 140, 16000); r.add(opp);
      // tabletop: espresso + spoon, water glass, side plate with confections
      const esp = P.coffeeCup('espresso'); esp.position.set(-185, 0, -165); esp.rotation.y = 0.7; r.add(esp);
      const sp = P.spoon({ kind: 'espresso' }); sp.position.set(-150, REF.espressoSaucer.h - 8.5, -128); sp.rotation.y = 2.5; r.add(sp);
      r.add(at(P.tumbler(), 150, 0, -205));
      const pl = P.confectionPlate(ctx.confection, [{ i: 4, x: -22, z: 8 }, { i: 1, x: 24, z: -16 }], 'side'); pl.position.set(205, 0, 135); r.add(pl);
      st.key = { az: 64, el: 30, kelvin: 5300, intensity: 15, angle: 1.2, extent: 950, pcf: 2 };
      st.cams = { lifestyle: { az: 6, el: 11, focal: 50, fill: 0.34, fstop: 2.8, ty: 0.4, shiftY: -0.25 }, hero: { az: 28, el: 20, focal: 85, fill: 0.7, fstop: 5.6, ty: 0.45 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 5. Yerevan terrace
  {
    id: 'yerevan', name: 'Yerevan Terrace', group: 'Yerevan', swatch: 0xc48f78,
    blurb: 'A walnut table on a sixth-floor café terrace above the pink-tuff centre of Yerevan at golden hour: jezve and surch cups, apricots, pomegranate, Ararat on the horizon.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5000; st.exposure = 0.34; st.contact = 0.5; st.contactBlur = 2.4;
      const tH = REF.diningTable.h, F = -tH;
      const sun = dirFrom(-78, 14);
      const sky = skyDome({ zenith: [0.32, 0.42, 0.78], horizon: [1.6, 1.05, 0.62], ground: [0.3, 0.24, 0.2], sunDir: sun, sunColor: [1.0, 0.72, 0.42], glow: 5.0, haze: 1.0, cloud: 0.18, cloudScale: 1.1, intensity: 1.0 });
      st.skies.push(sky); r.add(sky);
      st.fog = { color: new THREE.Color(1.15, 0.92, 0.76), density: 1.6e-6 };
      // beyond every city block (the card writes no depth); base at the apparent horizon dip seen from a 6th floor
      r.add(araratCard({ dist: 830000, az: -4, horizonY: -12000, haze: [1.0, 0.8, 0.66], rock: [0.42, 0.3, 0.36], snow: [1.0, 0.92, 0.82], sunSide: 1, intensity: 1.3, veil: 0.24 }));
      // terrace: basalt floor, low tuff parapet + black steel railing
      const floor = plane(9000, 7000, MAT.basalt(1200)); floor.position.set(0, F, -800); r.add(floor);
      const par = box(9000, 450, 320, MAT.tuff('pink', 1500, 3, 2)); par.position.set(0, F + 225, -1500); r.add(par);
      const cap = box(9100, 60, 380, MAT.tuff('cream', 1500, 3, 2)); cap.position.set(0, F + 480, -1500); r.add(cap);
      // frameless glass balustrade with a slim brass handrail (keeps the view to Ararat open)
      const rail = MAT.brass(0.32), posts = [];
      const glassB = mesh(new THREE.BoxGeometry(9000, 480, 12), MAT.glass(0xffffff, 0xd8e8e2, 900), { cast: false }); glassB.position.set(0, F + 750, -1500); glassB.userData.noAO = true; r.add(glassB);
      posts.push(at(box(9000, 30, 46, rail, { uv: false }), 0, F + 1000, -1500));                     // 1.0 m guard height
      for (let x = -4500; x <= 4500; x += 1500) posts.push(at(box(40, 70, 60, rail, { uv: false }), x, F + 545, -1500));
      r.add(merged(posts, rail, { cast: true }));
      // side wall of the café (pink tuff ashlar) with a planter
      const side = box(320, 3200, 5000, MAT.tuff('pink', 1500, 3, 4)); side.position.set(-2400, F + 1600, -200); r.add(side);
      r.add(at(P.pottedPlant({ potD: 420, potH: 420, plantD: 650, pot: 'terracotta', leaf: 0x4a6a2a }), -1900, F, -1200));
      // festoon lights (warm bulbs), two catenaries above the terrace
      const bulbM = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.66, 0.32).multiplyScalar(30), fog: false });
      const wire = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }); const bulbs = [];
      for (const [z0, z1, x0, x1] of [[-1450, 400, -2200, 2600], [-1300, -1300, -2200, 3200]]) {
        const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, F + 2550 - 420 * Math.sin(Math.PI * t), z0 + (z1 - z0) * t)); }
        const c = new THREE.CatmullRomCurve3(pts); r.add(mesh(new THREE.TubeGeometry(c, 60, 2.5, 5), wire, { cast: false }));
        for (let i = 1; i < 14; i++) { const p = c.getPoint(i / 14); const b = new THREE.Mesh(new THREE.SphereGeometry(24, 12, 10), bulbM); b.position.copy(p).add(new THREE.Vector3(0, -60, 0)); b.userData.noAO = true; bulbs.push(b); }
      }
      bulbs.forEach(b => r.add(b));
      // the city below: tuff blocks (pink / orange / cream), trees, at 40 - 900 m, roofs ~20 m below the terrace
      const tuffs = [facadeMat('yvn_pink', { wall: 0xc8907e, glass: 0x2a2a2e, frame: 0x5a4a44, winW: 0.4, winH: 0.5, sill: 0.25, arch: 1, lit: 0.1, curtain: 0xb8a088, band: 1 }, 14000, 9600),
        facadeMat('yvn_orange', { wall: 0xc98a62, glass: 0x2b2a2b, frame: 0x4e3e36, winW: 0.38, winH: 0.52, sill: 0.25, arch: 0, lit: 0.08, curtain: 0xb09070, band: 1 }, 14000, 9600),
        facadeMat('yvn_cream', { wall: 0xd8c3a5, glass: 0x262a2e, frame: 0x504840, winW: 0.42, winH: 0.5, sill: 0.25, arch: 0, lit: 0.06 }, 14000, 9600)];
      const city = [[], [], []]; P.reseed(41);
      for (let i = 0; i < 110; i++) {
        const dist = 40000 + Math.pow(P.rnd(), 1.4) * 620000, ang = (P.rnd() - 0.5) * 2.4;
        const x = Math.sin(ang) * dist, z = -Math.cos(ang) * dist - 1500;
        if (Math.abs(Math.atan2(x, -z)) < 0.34 && dist < 400000) continue;     // keep the view to Ararat open
        const w = 14000 + P.rnd() * 26000, d = 12000 + P.rnd() * 14000, h = 14000 + P.rnd() * 12000;          // 4 - 8 storeys: roofs stay below the terrace
        const b = building(w, h, d, tuffs[i % 3]); b.position.set(x, F - 24000 - (dist > 300000 ? 6000 : 0), z); b.rotation.y = (P.rnd() - 0.5) * 0.5; city[i % 3].push(b);
      }
      city.forEach((list, k) => { if (list.length) { const m = merged(list, tuffs[k], { cast: false, receive: false }); r.add(m); } });
      for (let i = 0; i < 26; i++) { const dist = 35000 + P.rnd() * 160000, ang = (P.rnd() - 0.5) * 2.0; const t = P.tree({ h: 11000 + P.rnd() * 5000, canopy: 8000, cards: 260, cardSize: 1500, leaf: [0x4a5e2a, 0x7d8a40], seedv: 100 + i }); t.position.set(Math.sin(ang) * dist, F - 20000, -Math.cos(ang) * dist - 1500); r.add(t); }
      const plain = plane(3000000, 3000000, new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 1 })); plain.position.y = F - 20000; r.add(plain);
      // table + chairs
      const tbl = P.squareTable({ w: 820, d: 820, top: 'walnut' }); r.add(tbl);
      r.add(at(P.thonetChair({ finish: 'dark' }), 0, F, -720, Math.PI));
      // tabletop: jezve, two surch cups, fruit, half pomegranate, confections
      const jz = P.jezve(); jz.position.set(-250, 0, -230); jz.rotation.y = 2.4; r.add(jz);
      const c1 = P.coffeeCup('surch'); c1.position.set(-215, 0, 75); c1.rotation.y = -0.5; r.add(c1);
      const c2 = P.coffeeCup('surch'); c2.position.set(-60, 0, -270); c2.rotation.y = 1.9; r.add(c2);
      const bw = P.bowl(170, 58, MAT.stoneware(0xe2d6c2)); bw.position.set(270, 0, -150); r.add(bw);
      P.reseed(5);
      for (let i = 0; i < 6; i++) { const a = P.apricot(); a.position.set(270 + Math.cos(i * 1.1) * 38 * (i % 3 ? 1 : 0.2), bw.userData.top + (i > 3 ? 30 : 0), -150 + Math.sin(i * 1.1) * 38 * (i % 3 ? 1 : 0.2)); a.rotation.y = i; r.add(a); }
      for (let i = 0; i < 5; i++) { const d = P.driedApricot(); d.position.set(175 + i * 18, 0, -40 - (i % 2) * 22); r.add(d); }
      for (let i = 0; i < 3; i++) { const w = P.walnut(); w.position.set(150 + i * 30, 0, 10 + (i % 2) * 20); r.add(w); }
      const pom = P.pomegranate(REF.pomegranate, true); pom.position.set(330, 0, 40); r.add(pom);
      const pl = P.confectionPlate(ctx.confection, [{ i: 3, x: -26, z: 10 }, { i: 0, x: 22, z: 22 }, { i: 2, x: 4, z: -28 }], 'side'); pl.position.set(250, 0, 210); r.add(pl);
      r.add(at(P.tumbler(), -320, 0, -60));
      st.key = { az: -78, el: 14, kelvin: 3400, intensity: 15, angle: 0.6, extent: 950, pcf: 2 };
      st.cams = { lifestyle: { az: -6, el: 7, focal: 70, fill: 0.36, fstop: 4, ty: 0.5, shiftY: -0.36 }, hero: { az: 30, el: 18, focal: 85, fill: 0.7, fstop: 5.6, ty: 0.45 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 6. the Cascade
  {
    id: 'cascade', name: 'The Cascade', group: 'Yerevan', swatch: 0xd9cdb6,
    blurb: 'At the foot of the Cascade in Yerevan: the box on a travertine garden wall, the white stairway, terraces, fountains and flowerbeds rising 100 m up the hill behind. Afternoon sun.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5600; st.exposure = 0.22; st.contact = 0.5; st.contactBlur = 2.4;
      const wallH = 620, F = -wallH;
      const sun = dirFrom(38, 38);
      const sky = skyDome({ zenith: [0.22, 0.42, 0.9], horizon: [0.88, 0.92, 0.98], ground: [0.3, 0.28, 0.25], sunDir: sun, sunColor: [1.0, 0.93, 0.82], glow: 2.0, haze: 0.7, cloud: 0.25, cloudScale: 1.3, intensity: 1.2 });
      st.skies.push(sky); r.add(sky);
      st.fog = { color: new THREE.Color(0.9, 0.94, 1.0).multiplyScalar(1.15), density: 2.6e-6 };
      const trav = MAT.travertine(1200, 0.55, 2, 3), travBig = MAT.travertine(3600, 0.6, 2, 3);
      // foreground: travertine garden wall (box sits on its coping) with a flowerbed behind
      const coping = slab(6000, 80, 520, MAT.travertine(1200, 0.45, 2, 1), 3, 4); r.add(coping);
      const wall = box(5900, wallH - 80, 460, trav); wall.position.set(0, -80 - (wallH - 80) / 2, 0); r.add(wall);
      const bed = box(5900, 300, 1400, MAT.soil(900), { cast: false }); bed.position.set(0, F + 150, -960); r.add(bed);
      r.add(at(P.hedge(5600, 380, 420, 0x3e5a28), 0, F + 300, -500));
      // flowers: red / white carpet bedding (instanced)
      const nFl = Math.round(2600 * Math.max(0.5, ctx.density)); const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(28, 0), new THREE.MeshStandardMaterial({ roughness: 0.6 }), nFl); const o = new THREE.Object3D(); const col = new THREE.Color(); P.reseed(9);
      for (let i = 0; i < nFl; i++) { o.position.set((P.rnd() - 0.5) * 5600, F + 330 + P.rnd() * 60, -820 - P.rnd() * 1000); o.scale.setScalar(0.6 + P.rnd() * 0.7); o.updateMatrix(); fl.setMatrixAt(i, o.matrix); col.set(P.rnd() < 0.7 ? 0xb4192a : 0xf2efe6); fl.setColorAt(i, col); }
      fl.userData.noAO = true; fl.castShadow = false; r.add(fl);
      // plaza: travertine + basalt paving, lawns, side trees
      const plaza = plane(90000, 170000, travBig); plaza.position.set(0, F - 1, -80000); r.add(plaza);
      for (const x of [-16000, 16000]) { const lawn = plane(16000, 120000, MAT.soil(1200).clone()); lawn.material.color.set(0x6f9a46); lawn.position.set(x, F, -70000); r.add(lawn); }
      for (let i = 0; i < 24; i++) { const s = i % 2 ? 1 : -1; r.add(at(P.tree({ h: 10000 + (i % 3) * 2500, canopy: 7500, cards: 300, cardSize: 1300, leaf: [0x3f5a26, 0x6e8a3a], seedv: 200 + i }), s * (12500 + (i % 4) * 2600), F, -9000 - Math.floor(i / 2) * 10500)); }
      // bronze sculpture on a plinth (garden of the Cafesjian Center) - generic rounded figure
      const bronze = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.26, 0.17, 0.1), metalness: 1, roughness: 0.35 });
      const sculpt = group('sculpture', at(box(1800, 900, 1800, trav), 0, F + 450, 0), at(mesh(new THREE.SphereGeometry(900, 40, 30).scale(1.1, 0.9, 0.8), bronze), 0, F + 1600, 0), at(mesh(new THREE.SphereGeometry(520, 30, 24), bronze), 300, F + 2500, -100));
      sculpt.position.set(-6200, 0, -42000); r.add(sculpt);
      const sculpt2 = sculpt.clone(); sculpt2.position.set(7400, 0, -78000); sculpt2.scale.setScalar(0.8); r.add(sculpt2);
      // THE CASCADE: central stairway + tiered travertine terraces with fountains and flowerbeds, rising ~100 m
      const casc = new THREE.Group(); casc.name = 'cascade'; const cz0 = -140000;
      const tiers = 5, tierH = 19000, tierD = 46000, stairW = 15000, blockW = 23000;
      const parts = [], dark = [], water = [], beds = [];
      for (let t = 0; t < tiers; t++) {
        const y0 = F + t * tierH, z0 = cz0 - t * tierD;
        // stair flight: risers 155 mm, treads 360 mm (grouped into 1 m bands for geometry economy)
        const steps = Math.round(tierH / 1000), run = (tierD * 0.55) / steps;
        for (let s = 0; s < steps; s++) parts.push(at(box(stairW, 1000, run * (steps - s), trav, { uv: true, cast: false }), 0, y0 + 500 + s * 1000, z0 - run * s - run * (steps - s) / 2));
        // landing
        parts.push(at(box(stairW + 2 * blockW, 600, tierD * 0.45, trav, { cast: false }), 0, y0 + tierH - 300, z0 - tierD * 0.55 - tierD * 0.225));
        // side blocks with arcade openings and a cascading fountain face
        for (const s of [-1, 1]) {
          const bx = s * (stairW / 2 + blockW / 2);
          parts.push(at(box(blockW, tierH, tierD * 0.55, trav, { cast: false }), bx, y0 + tierH / 2, z0 - tierD * 0.275));
          for (let k = 0; k < 4; k++) dark.push(at(box(3600, 5200, 400), bx + (k - 1.5) * 5200, y0 + 3600, z0 + 120));
          water.push(at(box(4200, tierH * 0.8, 120), bx, y0 + tierH * 0.42, z0 + 300));
          beds.push(at(box(blockW - 3000, 500, tierD * 0.3), bx, y0 + tierH + 250, z0 - tierD * 0.55 - tierD * 0.15));
        }
      }
      casc.add(merged(parts, trav, { cast: false, receive: false }));
      casc.add(merged(dark, new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }), { cast: false, receive: false }));
      const wMat = new THREE.MeshStandardMaterial({ color: 0xdfeaf0, roughness: 0.15, metalness: 0, emissive: 0x9ab0bc, emissiveIntensity: 0.25 });
      casc.add(merged(water, wMat, { cast: false, receive: false }));
      const bedM = new THREE.MeshStandardMaterial({ color: 0x8a3a2a, roughness: 0.9 }); casc.add(merged(beds, bedM, { cast: false, receive: false }));
      // monument at the top (stepped base + tall stele)
      const top = F + tiers * tierH, tz = cz0 - tiers * tierD - 8000;
      casc.add(at(box(14000, 4000, 14000, trav, { cast: false }), 0, top + 2000, tz), at(box(5000, 52000, 5000, trav, { cast: false }), 0, top + 4000 + 26000, tz));
      // hillside greenery and flanking Soviet tuff apartment blocks
      for (let i = 0; i < 40; i++) { const s = i % 2 ? 1 : -1; const t = P.tree({ h: 12000, canopy: 9000, cards: 200, cardSize: 1800, leaf: [0x3c5424, 0x6a8034], seedv: 300 + i }); const k = Math.floor(i / 2); t.position.set(s * (stairW / 2 + blockW + 6000 + (i % 3) * 5000), F + k * tierH * 0.24, cz0 - k * tierD * 0.24); casc.add(t); }
      const apt = facadeMat('soviet', { wall: 0xc7a690, glass: 0x2a2a2c, frame: 0x6a5a50, winW: 0.5, winH: 0.45, sill: 0.3, lit: 0.04 }, 14000, 9600);
      const blocks = []; for (let i = 0; i < 10; i++) { const s = i % 2 ? 1 : -1; const b = building(26000, 36000 + (i % 3) * 9000, 14000, apt); b.position.set(s * (stairW / 2 + blockW + 30000 + (i % 3) * 9000), F + Math.floor(i / 2) * tierH * 0.8, cz0 - Math.floor(i / 2) * 46000); blocks.push(b); }
      casc.add(merged(blocks, apt, { cast: false, receive: false }));
      casc.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      r.add(casc);
      // a small still life on the coping: confection plate + espresso to go? - keep it pure: two confections
      r.add(conf(ctx, 0, 180, 120), conf(ctx, 4, 220, 70, { ry: 0.8 }));
      st.key = { az: 38, el: 38, kelvin: 5400, intensity: 16, angle: 0.4, extent: 950, pcf: 2 };
      st.cams = { lifestyle: { az: 4, el: 3, focal: 50, fill: 0.3, fstop: 4, ty: 0.45, shiftY: -0.42 }, hero: { az: 28, el: 16, focal: 85, fill: 0.68, fstop: 5.6, ty: 0.45 } };
      return st;
    },
  },
  // ---------------------------------------------------------------- 7. picnic
  {
    id: 'picnic', name: 'Summer Picnic', group: 'Outdoor', swatch: 0x7f9a4e,
    blurb: 'A wool picnic blanket in a meadow, a wicker basket, rosé, cherries and a plate of confections; trees and summer clouds behind, warm late-afternoon sun.',
    build(ctx) {
      const st = newState(); const r = st.root;
      st.wb = 5300; st.exposure = 0.24; st.contact = 0.55; st.contactBlur = 2.8;
      const sun = dirFrom(128, 30);
      const sky = skyDome({ zenith: [0.2, 0.4, 0.88], horizon: [0.95, 0.94, 0.9], ground: [0.25, 0.3, 0.18], sunDir: sun, sunColor: [1.0, 0.86, 0.66], glow: 3.0, haze: 0.8, cloud: 0.4, cloudScale: 1.2, intensity: 1.15 });
      st.skies.push(sky); r.add(sky);
      st.fog = { color: new THREE.Color(0.92, 0.95, 1.0).multiplyScalar(1.1), density: 3.0e-6 };
      const hgt = (x, z) => { const d = Math.hypot(x, z); const far = Math.min(1, d / 30000); return -3 + 40 * Math.sin(x * 0.0006) * Math.sin(z * 0.0005) * Math.min(1, d / 3000) + far * far * 5000 * (0.5 + 0.5 * Math.sin(x * 0.00007 + 1.2)); };
      const gg = new THREE.PlaneGeometry(400000, 400000, 220, 220).rotateX(-Math.PI / 2);
      const gp = gg.attributes.position; for (let i = 0; i < gp.count; i++) gp.setY(i, hgt(gp.getX(i), gp.getZ(i)) - 8);
      gg.computeVertexNormals(); uvPlanar(gg);
      const gm = MAT.soil(1100).clone(); gm.color.set(0x7a9a52); r.add(mesh(gg, gm, { cast: false }));
      r.add(P.grassField({ w: 9000, d: 9000, count: Math.round(42000 * ctx.density), h: [70, 190], ground: hgt, exclude: (x, z) => Math.abs(x) < 760 && Math.abs(z) < 960 }));
      r.add(P.grassField({ w: 40000, d: 40000, count: Math.round(26000 * ctx.density), h: [120, 320], ground: hgt, exclude: (x, z) => Math.abs(x) < 4500 && Math.abs(z) < 4500 }));
      // wildflowers
      const fl = new THREE.InstancedMesh(new THREE.CircleGeometry(9, 6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), 1600); const o = new THREE.Object3D(); const col = new THREE.Color(); P.reseed(17);
      for (let i = 0; i < 1600; i++) { let x, z; do { x = (P.rnd() - 0.5) * 12000; z = (P.rnd() - 0.5) * 12000; } while (Math.abs(x) < 800 && Math.abs(z) < 1000); o.position.set(x, hgt(x, z) + 120 + P.rnd() * 120, z); o.rotation.set((P.rnd() - 0.5) * 0.6, 0, (P.rnd() - 0.5) * 0.6); o.updateMatrix(); fl.setMatrixAt(i, o.matrix); col.set([0xf4f1e8, 0xf2d45a, 0xc9a4d8][i % 3]); fl.setColorAt(i, col); }
      fl.castShadow = false; fl.userData.noAO = true; r.add(fl);
      // tree line + distant hills
      for (let i = 0; i < 22; i++) { const a = -1.3 + i * 0.12 + (i % 2) * 0.05, d = 18000 + (i % 5) * 7000; const x = Math.sin(a) * d, z = -Math.cos(a) * d; r.add(at(P.tree({ h: 9000 + (i % 4) * 2500, canopy: 7000 + (i % 3) * 1500, cards: 420, cardSize: 1300, leaf: [0x3d5a24, 0x76903c], seedv: 500 + i }), x, hgt(x, z) - 100, z)); }
      // blanket (box sits at the centre, flat there)
      r.add(P.blanket({ ground: (x, z) => { const k = Math.min(1, Math.hypot(x / 1.2, z) / 420); return -2 + (hgt(x, z) + 3) * k - 1 * (1 - k); } }));
      // props
      const bk = P.picnicBasket({ open: 0.0 }); bk.position.set(-560, 4, -430); bk.rotation.y = 0.35; r.add(bk);
      const bt = P.bottle({ glassTint: 0xd9b0a8 }); bt.position.set(-380, 4, -620); r.add(bt);
      r.add(at(P.wineGlass({ wine: true }), 190, 4, -300), at(P.wineGlass({ wine: true }), 285, 4, -380));
      const pl = P.confectionPlate(ctx.confection, [{ i: 0, x: -30, z: 18 }, { i: 1, x: 26, z: 28 }, { i: 3, x: 6, z: -30 }, { i: 4, x: -48, z: -32, cup: false }], 'dessert');
      pl.position.set(330, 4, 170); r.add(pl);
      const fk = P.fork(); fk.rotation.y = -Math.PI / 2 - 0.3; fk.position.set(470, 8, 120); r.add(fk);
      const cb = P.bowl(150, 60, MAT.stoneware(0xe9e0cf)); cb.position.set(-300, 4, 210); r.add(cb);
      P.reseed(23); for (let i = 0; i < 9; i++) { const c = P.cherry(); c.position.set(-300 + (P.rnd() - 0.5) * 70, 4 + cb.userData.top + (i > 5 ? 18 : 0), 210 + (P.rnd() - 0.5) * 70); c.rotation.y = P.rnd() * 6; r.add(c); }
      for (let i = 0; i < 3; i++) { const a = P.apricot(); a.position.set(-190 + i * 46, 4, 330 + (i % 2) * 30); r.add(a); }
      const bkk = P.book({ color: 0x5a2a2c }); bkk.position.set(-520, 4, 230); bkk.rotation.y = 0.5; r.add(bkk);
      const nap = P.napkin({ w: 220, d: 220, color: 0xf3eee4 }); nap.position.set(480, 4, -120); nap.rotation.y = 0.3; r.add(nap);
      st.key = { az: 128, el: 30, kelvin: 4600, intensity: 15, angle: 0.4, extent: 1100, pcf: 2 };
      st.fill = { az: -20, el: 14, kelvin: 5200, intensity: 0.9 };
      st.cams = { lifestyle: { az: 18, el: 24, focal: 50, fill: 0.34, fstop: 3.5, ty: 0.4, shiftY: -0.2 }, hero: { az: 30, el: 26, focal: 85, fill: 0.68, fstop: 5.6, ty: 0.45 } };
      return st;
    },
  },
];

const LEGACY = { bright: 'studio', dark: 'noir', marble: 'coffee', wood: 'coffee', cafe: 'paris', shop: 'noir' };
export function envById(id) { id = LEGACY[id] || id; return ENVIRONMENTS.find(e => e.id === id) || ENVIRONMENTS[0]; }
export function resolveEnvId(id) { return envById(id).id; }

/** thumbnail: pre-rendered image if present, else a swatch */
export function envThumbnail(def) { return `assets/env/${def.id}.jpg`; }

/** context handed to env.build */
export function envContext(viewer) {
  return {
    viewer, dims: viewer.dims, density: (viewer.q && viewer.q.density) || 1,
    confection: (i, opts) => (viewer.propConfection ? viewer.propConfection(i, opts) : null),
  };
}
// keep the old import name working
export const propContext = () => ({});
