// Confections and paper cups: the vertex-coloured meshes extracted from the original concept GLB
// (assets/models/confections.glb, scaled to the 22 mm product envelope) placed in the insert cavities.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';

const NAMES = ['sesame', 'cranberry', 'pistachio', 'apricot', 'honey-walnut'];

function seeded(k) { let s = (k + 1) * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

export class Confections {
  constructor() {
    this.group = new THREE.Group(); this.group.name = 'confections';
    this.proto = []; this.cupWall = null; this.cupBase = null;
    this.items = []; this.meshes = [];
    this.visible = true;
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const found = [];
    gltf.scene.traverse(o => { if (o.isMesh) found.push(o); });
    for (const o of found) {
      if (o.name.startsWith('confection_')) {
        o.material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, clearcoat: 0.28, clearcoatRoughness: 0.5, sheen: 0.25, sheenRoughness: 0.8, sheenColor: new THREE.Color(0xfff4e0), specularIntensity: 0.6 });
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        this.proto.push(o);
      } else if (o.name === 'cup_wall') this.cupWall = o;
      else if (o.name === 'cup_base') this.cupBase = o;
    }
    this.proto.sort((a, b) => a.name.localeCompare(b.name));
    this.cupMat = new THREE.MeshPhysicalMaterial({ color: 0x2a1308, roughness: 0.82, metalness: 0, side: THREE.DoubleSide, clearcoat: 0.08, clearcoatRoughness: 0.6 });
    this.meta = (gltf.parser.json.extras && gltf.parser.json.extras.confections) || [];
    return this;
  }

  /** Build cups + confections for a SKU; positions follow the insert's UPPER DECK panel. */
  populate(skuData, foldedInsert) {
    this.clear();
    this.sku = skuData; this.insert = foldedInsert;
    const cav = skuData.cavities;
    cav.flat_U.forEach(([x, y], k) => {
      const g = new THREE.Group();
      g.userData.flat = [x, y];
      g.rotation.x = Math.PI / 2;                       // GLB is Y-up, the component frame is Z-up
      if (this.cupWall) { const w = this.cupWall.clone(); w.material = this.cupMat; w.castShadow = true; w.receiveShadow = true; g.add(w); }
      if (this.cupBase) { const b = this.cupBase.clone(); b.material = this.cupMat; b.receiveShadow = true; g.add(b); }
      const type = k % this.proto.length;
      const rnd = seeded(k);
      const c = this.proto[type].clone();
      c.position.y = skuData.product.cup_thk;
      c.rotation.y = rnd() * Math.PI * 2;
      c.rotation.z = (rnd() - 0.5) * 0.12;
      c.castShadow = true; c.receiveShadow = true;
      c.userData = { index: k, type, name: NAMES[type] || ('type ' + (type + 1)) };
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

  /** a cup + confection group in the Y-up world frame (for scene props) */
  makeOne(i) {
    if (!this.proto.length) return null;
    const g = new THREE.Group();
    if (this.cupWall) { const w = this.cupWall.clone(); w.material = this.cupMat; w.castShadow = true; g.add(w); }
    if (this.cupBase) { const b = this.cupBase.clone(); b.material = this.cupMat; g.add(b); }
    const c = this.proto[i % this.proto.length].clone(); c.position.y = 0.15; c.rotation.y = i * 1.7; c.castShadow = true; c.receiveShadow = true; g.add(c);
    return g;
  }

  clear() {
    for (const g of this.items) this.group.remove(g);
    this.items = []; this.meshes = [];
  }

  setVisible(v) { this.visible = v; this.group.visible = v; }
}
