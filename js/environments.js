// Curated presentation environments.  Each one is a procedural photo set: an equirectangular backdrop (used as the
// visible background, blurred, and as the image-based lighting), a ground / table surface with a procedural PBR
// texture, optional props (bistro table, stone terraces) and a key / fill light rig.  Everything is generated at
// runtime - no image assets, works offline.
import * as THREE from 'three';
import { equirectBackdrop, bokehSet, woodTexture, marbleTexture, linenTexture, ginghamTexture, tuffTexture, lacquerTexture, plasterTexture, grassTexture } from './procgen.js';
import * as P from './props.js';

const K = (color, intensity, position) => ({ color, intensity, position });

export const ENVIRONMENTS = [
  {
    id: 'studio', swatch: 0xe6e1d8, name: 'Studio Tabletop', group: 'Studio', blurb: 'Neutral product-photography sweep with two large softboxes.',
    backdrop: (size) => equirectBackdrop({ top: 0xd9d6d0, horizon: 0xe9e6e0, ground: 0xcfcbc4, horizonV: 0.52, variation: 0.05,
      windows: [{ u: 0.25, v: 0.3, w: 0.18, h: 0.22, color: 0xffffff, a: 0.85, blur: 14 }, { u: 0.72, v: 0.28, w: 0.1, h: 0.16, color: 0xfff6ea, a: 0.55, blur: 12 }] }, size),
    bgBlur: 0.55, envIntensity: 1.0, exposure: 1.0,
    ground: () => ({ tex: linenTexture(0xe6e1d8), tile: 380, clearcoat: 0 }),
    key: K(0xfff3e4, 2.6, [-380, 640, 420]), fill: K(0xe4ecff, 0.9, [460, 300, -260]), hemi: 0.28, shadow: 0.5, contact: 0.55,
  },
  {
    id: 'dark', swatch: 0x161416, name: 'Dark Luxury Table', group: 'Studio', blurb: 'Black lacquered table, low key, one warm rim light.',
    backdrop: (size) => equirectBackdrop({ top: 0x0c0b0c, horizon: 0x1e1a19, ground: 0x070707, horizonV: 0.55, variation: 0.1,
      windows: [{ u: 0.78, v: 0.33, w: 0.08, h: 0.2, color: 0xffd8b0, a: 0.75, blur: 10 }, { u: 0.2, v: 0.3, w: 0.16, h: 0.12, color: 0x8fa4c8, a: 0.25, blur: 16 }], vignette: 0.5 }, size),
    bgBlur: 0.5, envIntensity: 0.7, exposure: 1.0,
    ground: () => ({ tex: lacquerTexture(), tile: 600, clearcoat: 0.9, clearcoatRoughness: 0.12 }),
    props: (c) => [c.at(P.candle(), -340, 0, -170), c.at(P.glass(), 300, 0, -150), c.confPlate(2, 320, 0, 70)],
    key: K(0xffe2c4, 3.2, [-300, 560, 460]), fill: K(0x9fb3dd, 0.45, [520, 240, -360]), hemi: 0.1, shadow: 0.7, contact: 0.7,
  },
  {
    id: 'bright', swatch: 0xf6f4f0, name: 'Bright Minimal', group: 'Studio', blurb: 'High-key white table, soft shadowless daylight.',
    backdrop: (size) => equirectBackdrop({ top: 0xf4f4f6, horizon: 0xffffff, ground: 0xeeeeef, horizonV: 0.5, variation: 0.02,
      windows: [{ u: 0.3, v: 0.3, w: 0.3, h: 0.3, color: 0xffffff, a: 0.5, blur: 20 }] }, size),
    bgBlur: 0.6, envIntensity: 1.15, exposure: 1.05,
    ground: () => ({ tex: plasterTexture(0xf6f4f0), tile: 500, clearcoat: 0 }),
    props: (c) => [c.confPlate(1, 330, 0, 30)],
    key: K(0xffffff, 2.0, [-300, 700, 500]), fill: K(0xffffff, 1.2, [500, 300, -300]), hemi: 0.4, shadow: 0.38, contact: 0.4,
  },
  {
    id: 'marble', swatch: 0xe9e6e0, name: 'Marble Table', group: 'Tables', blurb: 'Carrara marble, cool daylight from a window.',
    backdrop: (size) => equirectBackdrop({ top: 0xc9d2dc, horizon: 0xeae8e3, ground: 0xb9b4ad, horizonV: 0.5, variation: 0.06,
      windows: [{ u: 0.22, v: 0.3, w: 0.2, h: 0.28, color: 0xf3f7ff, a: 0.9, blur: 12 }] }, size),
    bgBlur: 0.5, envIntensity: 1.0, exposure: 1.0,
    ground: () => ({ tex: marbleTexture('white'), tile: 900, clearcoat: 0.6, clearcoatRoughness: 0.18 }),
    props: (c) => [c.confPlate(2, -330, 0, 10), c.at(P.glass(), 300, 0, -150)],
    key: K(0xf4f7ff, 2.4, [-420, 600, 380]), fill: K(0xffe9d2, 0.8, [480, 260, -300]), hemi: 0.3, shadow: 0.5, contact: 0.5,
  },
  {
    id: 'wood', swatch: 0xa77a4c, name: 'Wooden Table', group: 'Tables', blurb: 'Oak planks, warm afternoon window light.',
    backdrop: (size) => equirectBackdrop({ top: 0xb9a48a, horizon: 0xe4d3bb, ground: 0x6b5235, horizonV: 0.52, variation: 0.08,
      windows: [{ u: 0.3, v: 0.32, w: 0.16, h: 0.26, color: 0xfff1d8, a: 0.9, blur: 10 }] }, size),
    bgBlur: 0.5, envIntensity: 1.0, exposure: 1.0,
    ground: () => ({ tex: woodTexture('oak'), tile: 700, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    props: (c) => [c.at(P.napkin(0xe9e2d2), 330, 0, 60, 0.3), c.at(P.cup(), 330, 2.5, 60, 0.4), c.confPlate(2, -340, 0, -40)],
    key: K(0xffe6c6, 2.6, [-360, 560, 440]), fill: K(0xcfd9ea, 0.6, [460, 240, -320]), hemi: 0.25, shadow: 0.55, contact: 0.6,
  },
  {
    id: 'cafe', swatch: 0xe9e4dc, name: 'French Café Table', group: 'Cafés', blurb: 'Bistro marble table with a brass rim, warm interior bokeh.',
    backdrop: (size) => equirectBackdrop({ top: 0x2b221c, horizon: 0x6e5a48, ground: 0x241c17, horizonV: 0.52, variation: 0.12,
      bokeh: bokehSet(26, 11, { vMin: 0.22, vMax: 0.5, colors: [0xffd59a, 0xffc27a, 0xfff0d2] }),
      windows: [{ u: 0.15, v: 0.33, w: 0.12, h: 0.24, color: 0xcfd8e8, a: 0.5, blur: 10 }], vignette: 0.35 }, size),
    bgBlur: 0.45, envIntensity: 0.9, exposure: 1.0,
    ground: () => ({ tex: woodTexture('walnut'), tile: 800, clearcoat: 0.2, floorY: -740 }),
    props: (c) => [c.bistroTable({ top: 'marble', rim: 0xb08d57 }), c.at(P.cup(), -225, 0, -130, 0.7), c.at(P.spoon(), -150, 0, -175, 1.1), c.confPlate(1, 235, 0, -110, 80), c.at(P.chair(), -430, 0, -430, 0.7), c.at(P.chair(), 500, 0, -380, -0.6)],
    key: K(0xffd9b0, 2.8, [-320, 560, 460]), fill: K(0xffc98a, 0.7, [500, 200, -300]), hemi: 0.2, shadow: 0.6, contact: 0.6,
  },
  {
    id: 'paris', swatch: 0x8f9296, name: 'Parisian Café Terrace', group: 'Cafés', blurb: 'Zinc bistro table on a terrace, soft overcast Paris light.',
    backdrop: (size) => equirectBackdrop({ top: 0x9fb0c4, horizon: 0xe1dcd3, ground: 0x6b6762, horizonV: 0.5, variation: 0.1,
      bokeh: bokehSet(14, 23, { vMin: 0.3, vMax: 0.5, rMin: 0.015, rMax: 0.035, colors: [0xfff4e6, 0xd9e2ea, 0xffe3b8], aMin: 0.2, aMax: 0.45 }),
      windows: [{ u: 0.5, v: 0.22, w: 0.5, h: 0.3, color: 0xf3f0ea, a: 0.45, blur: 24 }] }, size),
    bgBlur: 0.45, envIntensity: 1.05, exposure: 1.0,
    ground: () => ({ tex: plasterTexture(0x8f8a84), tile: 600, clearcoat: 0, floorY: -740 }),
    props: (c) => [c.bistroTable({ top: 'zinc', rim: 0x8a8d90 }), c.at(P.glass(), -235, 0, -130), c.confPlate(1, 235, 0, -115, 80), c.at(P.cup({ small: true }), -200, 0, 95, 0.5), c.at(P.chair({ dark: false }), -440, 0, -420, 0.75), c.at(P.chair({ dark: false }), 500, 0, -380, -0.6)],
    key: K(0xfff6ea, 2.2, [-380, 620, 400]), fill: K(0xd7e2f2, 1.0, [460, 300, -280]), hemi: 0.35, shadow: 0.42, contact: 0.5,
  },
  {
    id: 'picnic', swatch: 0xd0675f, name: 'Picnic', group: 'Outdoor', blurb: 'Gingham cloth under a bright sky, soft open shade.',
    backdrop: (size) => equirectBackdrop({ top: 0x7faee0, horizon: 0xe4ecd9, ground: 0x6f8f4e, horizonV: 0.5, variation: 0.08, skyCurve: 1.2,
      bokeh: bokehSet(10, 41, { vMin: 0.32, vMax: 0.49, rMin: 0.02, rMax: 0.05, colors: [0xbfd79a, 0xf6f1c7, 0x9fc17a], aMin: 0.25, aMax: 0.5 }) }, size),
    bgBlur: 0.5, envIntensity: 1.1, exposure: 1.02,
    ground: () => ({ tex: grassTexture(), tile: 520, clearcoat: 0, floorY: -2 }),
    props: (c) => [P.picnicCloth(1500, 1200), P.grass({ exclude: [760, 610] }), c.at(P.basket(), -520, 0, -330, 0.4), c.at(P.apple(), -330, 0, -400), c.at(P.apple(true, 30), -270, 0, -330), c.at(P.apple(), -560, 0, -40), c.confPlate(1, 400, 0, -300, 80), c.at(P.glass(), 540, 0, -140), c.at(P.napkin(0xf1ece0, 180, 140), 420, 0, 260, -0.4)],
    key: K(0xfff5e4, 2.8, [-300, 700, 300]), fill: K(0xbfd4ff, 1.1, [500, 300, -300]), hemi: 0.45, shadow: 0.5, contact: 0.5,
  },
  {
    id: 'shop', swatch: 0x3b2718, name: 'Confectionery Shop', group: 'Cafés', blurb: 'Dark walnut counter, warm shelf lighting behind.',
    backdrop: (size) => equirectBackdrop({ top: 0x1a130f, horizon: 0x4a3627, ground: 0x15100c, horizonV: 0.55, variation: 0.1,
      stripes: { count: 5, u0: 0.1, u1: 0.9, color: 0xe8b270, a: 0.5 },
      bokeh: bokehSet(32, 77, { vMin: 0.15, vMax: 0.5, rMin: 0.008, rMax: 0.02, colors: [0xffd9a3, 0xffe9c7, 0xf7b56b], aMin: 0.4, aMax: 0.85 }), vignette: 0.4 }, size),
    bgBlur: 0.42, envIntensity: 0.85, exposure: 1.0,
    ground: () => ({ tex: woodTexture('walnut'), tile: 800, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
    props: (c) => [P.shelves({ width: 2600, z: -760, baseY: 0 }), c.cakeStand(5, -360, -220), c.confPlate(3, 330, 0, -170, 95), c.at(P.glass({ water: false }), 470, 0, -330)],
    key: K(0xffd7a8, 3.0, [-260, 560, 420]), fill: K(0xffb978, 0.6, [520, 220, -300]), hemi: 0.15, shadow: 0.65, contact: 0.65,
  },
  {
    id: 'yerevan', swatch: 0xc9988a, name: 'Yerevan Café Terrace', group: 'Yerevan', blurb: 'Pink tuff stone table, golden evening light, Ararat on the horizon.',
    backdrop: (size) => equirectBackdrop({ top: 0x6f7fa8, horizon: 0xf0c9a0, ground: 0x7a5a4c, horizonV: 0.5, variation: 0.08, skyCurve: 1.1,
      mountains: { color: 0x8c7f9a, peaks: [{ u: 0.62, h: 0.09, w: 0.09 }, { u: 0.7, h: 0.055, w: 0.06 }, { u: 0.4, h: 0.03, w: 0.2 }] },
      bokeh: bokehSet(12, 5, { vMin: 0.36, vMax: 0.5, rMin: 0.01, rMax: 0.025, colors: [0xffd9a0, 0xffe6bf], aMin: 0.25, aMax: 0.55 }),
      windows: [{ u: 0.2, v: 0.3, w: 0.14, h: 0.2, color: 0xffe2c0, a: 0.6, blur: 14 }] }, size),
    bgBlur: 0.45, envIntensity: 1.0, exposure: 1.02,
    ground: () => ({ tex: tuffTexture('black'), tile: 700, clearcoat: 0, floorY: -740 }),
    props: (c) => [c.slabTable({ tex: tuffTexture('pink'), w: 1300, d: 820, h: 50 }), c.at(P.cup({ small: true }), -250, 0, -165, 0.6), c.at(P.jezve(), -340, 0, -330, -0.4), c.confPlate(2, 265, 0, -175, 85), c.at(P.apricot(), 330, 0, -330), c.at(P.apricot(18), 372, 0, -300), c.at(P.apricot(19), 345, 0, -270)],
    key: K(0xffd2a0, 3.0, [-420, 420, 520]), fill: K(0x9fb0d8, 0.7, [480, 260, -340]), hemi: 0.28, shadow: 0.6, contact: 0.6,
  },
  {
    id: 'cascade', swatch: 0xc9a583, name: 'Cascade Terrace', group: 'Yerevan', blurb: 'Pale stone terraces stepping up behind the box, clear afternoon sky.',
    backdrop: (size) => equirectBackdrop({ top: 0x7ea4d8, horizon: 0xe8dcc8, ground: 0xb9a98f, horizonV: 0.5, variation: 0.05, skyCurve: 1.3 }, size),
    bgBlur: 0.35, envIntensity: 1.05, exposure: 1.0,
    ground: () => ({ tex: tuffTexture('ochre'), tile: 900, clearcoat: 0 }),
    props: (c) => [...c.terraces({ tex: tuffTexture('ochre'), steps: 4, rise: 150, run: 260, width: 2800, z: -560 }), c.at(P.stairs({ steps: 20, width: 720, rise: 30, run: 52 }), 0, 0, -560), c.at(P.planter(720, 150, 80), -1080, 150, -690), c.at(P.planter(720, 150, 80), 1080, 150, -690), c.at(P.planter(720, 150, 80), -1080, 300, -950), c.at(P.planter(720, 150, 80), 1080, 300, -950), c.at(P.planter(720, 150, 80), -1080, 450, -1210), c.at(P.planter(720, 150, 80), 1080, 450, -1210), c.at(P.fountain(150), -640, 0, -330), c.at(P.fountain(150), 640, 0, -330)],
    key: K(0xfff0d8, 2.9, [-460, 560, 380]), fill: K(0xbcd0f0, 0.9, [520, 300, -300]), hemi: 0.35, shadow: 0.55, contact: 0.55,
  },
];

export function envById(id) { return ENVIRONMENTS.find(e => e.id === id) || ENVIRONMENTS[0]; }

/** small thumbnail (data URL) from the backdrop canvas + ground tone */
export function envThumbnail(def, w = 112, h = 64) {
  const bd = def.backdrop(256);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const src = bd.userData.canvas;
  ctx.drawImage(src, src.width * 0.2, src.height * 0.14, src.width * 0.6, src.height * 0.5, 0, 0, w, h * 0.64);
  ctx.fillStyle = '#' + def.swatch.toString(16).padStart(6, '0'); ctx.fillRect(0, h * 0.64, w, h * 0.36);
  const grad = ctx.createLinearGradient(0, h * 0.5, 0, h); grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad; ctx.fillRect(0, h * 0.5, w, h * 0.5);
  bd.dispose();
  return c.toDataURL('image/jpeg', 0.85);
}

/** Prop builders (ctx passed to env.props) */
export function propContext() {
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xb08d57, metalness: 1, roughness: 0.35, clearcoat: 0.3 });
  return {
    confection: null,                      // (i) => Object3D, set by the app once the confection GLB is loaded
    at(obj, x, y, z, ry = 0) { obj.position.set(x, y, z); obj.rotation.y = ry; return obj; },
    confPlate(n, x, z, r = 90) {
      const g = new THREE.Group(); g.position.set(x, 0, z); g.add(P.plate(r));
      if (this.confection) { if (n === 1) { const c = this.confection(2); if (c) { c.position.y = 3.5; g.add(c); } } else g.add(P.confectionRing(this.confection, n, r * 0.42, 3.5, 1)); }
      return g;
    },
    cakeStand(n, x, z) {
      const g = new THREE.Group(); g.position.set(x, 0, z); const st = P.cakeStand(); g.add(st);
      if (this.confection) g.add(P.confectionRing(this.confection, n, 72, st.userData.topY, 3));
      return g;
    },
    bistroTable({ top = 'marble', rim = 0xb08d57, radius = 340 } = {}) {
      const g = new THREE.Group(); g.name = 'prop_table';
      const mat = top === 'marble'
        ? (() => { const t = marbleTexture('white'); const m = new THREE.MeshPhysicalMaterial({ map: t.map, roughnessMap: t.rough, roughness: 1, clearcoat: 0.7, clearcoatRoughness: 0.15 }); m.map.repeat.set(1.2, 1.2); return m; })()
        : new THREE.MeshPhysicalMaterial({ color: 0x9a9da0, metalness: 0.85, roughness: 0.42, clearcoat: 0.1 });
      const topMesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 22, 96), mat);
      topMesh.position.y = -11; topMesh.receiveShadow = true; topMesh.castShadow = true; g.add(topMesh);
      const rimMat = new THREE.MeshPhysicalMaterial({ color: rim, metalness: 1, roughness: 0.3, clearcoat: 0.2 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius + 2, 7, 16, 128), rimMat); ring.rotation.x = Math.PI / 2; ring.position.y = -6; g.add(ring);
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(22, 26, 700, 32), new THREE.MeshPhysicalMaterial({ color: 0x1c1a19, metalness: 0.7, roughness: 0.45 }));
      leg.position.y = -22 - 350; leg.castShadow = true; g.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(180, 200, 16, 64), leg.material); foot.position.y = -22 - 700 + 8; g.add(foot);
      g.userData.floorY = -740;
      return g;
    },
    slabTable({ tex, w = 1200, d = 800, h = 50 } = {}) {
      const g = new THREE.Group(); g.name = 'prop_slab';
      const m = new THREE.MeshPhysicalMaterial({ map: tex.map, normalMap: tex.normal, roughnessMap: tex.rough, roughness: 1, clearcoat: 0 });
      m.map.repeat.set(2, 1.4); if (m.normalMap) m.normalMap.repeat.set(2, 1.4); m.roughnessMap.repeat.set(2, 1.4);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); slab.position.y = -h / 2; slab.receiveShadow = true; slab.castShadow = true; g.add(slab);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 700, d * 0.6), new THREE.MeshPhysicalMaterial({ color: 0x5a4a44, roughness: 0.95 })); base.position.y = -h - 350; g.add(base);
      g.userData.floorY = -h - 700;
      return g;
    },
    terraces({ tex, steps = 4, rise = 150, run = 260, width = 2600, z = -520 } = {}) {
      const out = [];
      const m = new THREE.MeshPhysicalMaterial({ map: tex.map, normalMap: tex.normal, roughnessMap: tex.rough, roughness: 1 });
      m.map.repeat.set(4, 1); if (m.normalMap) m.normalMap.repeat.set(4, 1); m.roughnessMap.repeat.set(4, 1);
      for (let i = 0; i < steps; i++) {
        const h = rise * (i + 1);
        const b = new THREE.Mesh(new THREE.BoxGeometry(width, h, run), m);
        b.position.set(0, h / 2, z - run / 2 - i * run); b.receiveShadow = true; b.castShadow = true; b.name = 'prop_terrace';
        out.push(b);
      }
      // a dark slit of greenery hint between steps: thin box with deep green
      return out;
    },
  };
}
