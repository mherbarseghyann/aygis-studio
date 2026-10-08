// Folds a component (CASE or INSERT) from box_models.json exactly like the Python fold simulation:
// every panel rotates about its hinge line (oriented so +angle folds away from the printed face) and
// inherits its parent's transform.  Z-up millimetre frame of the production files; the viewer's root
// group converts it to three.js Y-up.
import * as THREE from 'three';
import { buildPanelGeometry, foldFillet } from './panelgeom.js';

const DEG = Math.PI / 180;

function rowMajor(arr) { const m = new THREE.Matrix4(); m.set(...arr); return m; }

function rotationAboutAxis(a, b, deg) {
  const A = new THREE.Vector3(a[0], a[1], 0), B = new THREE.Vector3(b[0], b[1], 0);
  const axis = B.clone().sub(A).normalize();
  const R = new THREE.Matrix4().makeRotationAxis(axis, deg * DEG);
  return new THREE.Matrix4().makeTranslation(A.x, A.y, A.z).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-A.x, -A.y, -A.z));
}

export class FoldedComponent {
  /**
   * @param comp      component json (case / insert)
   * @param materials {front(panel)->Material, back(panel)->Material, edge: Material}
   * @param base      THREE.Matrix4 placed before the fold chain (e.g. insert placement), optional
   */
  constructor(comp, materials, base) {
    this.comp = comp;
    this.group = new THREE.Group();
    this.group.name = comp.name;
    this.meshes = {};
    this.children = {};
    this.hingeByChild = {};
    for (const h of comp.hinges) { (this.children[h.parent] ||= []).push(h); this.hingeByChild[h.child] = h; }
    this.global = rowMajor(comp.global);
    this.base = base ? base.clone() : new THREE.Matrix4();
    this.extra = new THREE.Matrix4();           // e.g. tray lift
    for (const p of comp.panels) {
      const creases = comp.hinges.filter(hh => hh.kind !== 'none' && (hh.parent === p.name || hh.child === p.name)).map(hh => [hh.a, hh.b]);
      const geo = buildPanelGeometry(p.polys, comp.t, creases);
      const mesh = new THREE.Mesh(geo, [materials.front(p), materials.back(p), materials.front(p), materials.edge]);
      mesh.matrixAutoUpdate = false;
      mesh.name = p.name;
      mesh.userData.panel = p;
      mesh.castShadow = true; mesh.receiveShadow = true;
      this.meshes[p.name] = mesh;
      this.group.add(mesh);
    }
    // rounded outer surface of every fold (moves with the parent panel)
    this.fillets = [];
    for (const hh of comp.hinges) {
      if (hh.kind === 'none') continue;
      const parent = comp.panels.find(pp => pp.name === hh.parent);
      const f = new THREE.Mesh(foldFillet(hh.a, hh.b, comp.t), [materials.front(parent), materials.back(parent)]);
      f.matrixAutoUpdate = false; f.name = `fold_${hh.parent}_${hh.child}`; f.castShadow = true; f.receiveShadow = true;
      f.userData.parent = hh.parent; f.userData.panel = parent;
      this.fillets.push(f); this.group.add(f);
    }
    this.T = {};
    this.angles = {};
    this.update({});
  }

  setMaterials(materials) {
    for (const p of this.comp.panels) {
      const m = this.meshes[p.name];
      m.material = [materials.front(p), materials.back(p), materials.front(p), materials.edge];
    }
    for (const f of this.fillets) f.material = [materials.front(f.userData.panel), materials.back(f.userData.panel)];
  }

  /** angles: {childName: degrees} overrides; others use the closed-state angle from the dieline. */
  update(angles) {
    this.angles = angles || {};
    const T = {};
    T[this.comp.root] = new THREE.Matrix4();
    const stack = [this.comp.root];
    while (stack.length) {
      const p = stack.pop();
      for (const h of (this.children[p] || [])) {
        const ang = (this.angles[h.child] !== undefined) ? this.angles[h.child] : h.angle;
        T[h.child] = T[p].clone().multiply(rotationAboutAxis(h.a, h.b, ang));
        stack.push(h.child);
      }
    }
    this.T = T;
    const pre = this.extra.clone().multiply(this.base).multiply(this.global);
    for (const name in this.meshes) {
      const m = this.meshes[name];
      m.matrix.copy(pre).multiply(T[name] || new THREE.Matrix4());
      m.matrixWorldNeedsUpdate = true;
    }
    for (const f of this.fillets || []) { f.matrix.copy(this.meshes[f.userData.parent].matrix); f.matrixWorldNeedsUpdate = true; }
  }

  /** world (Z-up component frame, before the viewer's root rotation) matrix of a panel */
  panelMatrix(name) {
    return this.meshes[name].matrix.clone();
  }

  /** flat point on a panel -> component-frame point */
  mapPoint(name, x, y, z = 0) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.meshes[name].matrix);
  }
}

/**
 * Lid kinematics of the CASE: lid angle (deg open) -> hinge angles for LT and FO.
 * Phase 1 (lid 0-30 deg): the front flap peels off the front wall and hangs under gravity; while the lid is
 *   nearly closed the top edge of the front wall pushes it outwards (it cannot pass through the wall).
 * Phase 2 (30-100 deg): the flap swings out until it is in line with the lid (the concept's open state);
 *   beyond 100 deg it stays in line.
 */
const HANG_END = 30, INLINE_AT = 100;
const smooth = (k) => k * k * (3 - 2 * k);

function hangAngle(caseComp, cl, openDeg) {
  const LT = 90 - openDeg;
  const tmp = new FoldedComponentLite(caseComp);
  const P = tmp.pointOnPanel('LT', cl, LT);                           // flap hinge (lid front edge), Z-up frame
  const th = openDeg * DEG;
  const uL = new THREE.Vector2(Math.cos(th), Math.sin(th));           // lid direction hinge -> front edge (y forward, z up)
  const nL = new THREE.Vector2(-Math.sin(th), Math.cos(th));          // printed-face normal
  const t = caseComp.t;
  const C = new THREE.Vector2(cl.y_fwo + t / 2 + cl.c_fo + t / 2, cl.z_top);   // front-wall top corner + flap half thickness
  let d = new THREE.Vector2(0, -1);                                   // gravity
  if (P.y < C.x && P.z > C.y + 0.5) d = new THREE.Vector2(C.x - P.y, C.y - P.z).normalize();   // lean out to clear the wall
  let phi = Math.atan2(-(d.dot(nL)), d.dot(uL)) / DEG;
  if (phi < 0) phi += 360;
  return Math.max(90 - 1e-6, Math.min(200, phi));
}

export function lidAngles(sku, caseComp, openDeg) {
  const cl = sku.closure;
  const LT = 90 - openDeg;
  let FO;
  if (openDeg <= HANG_END) FO = hangAngle(caseComp, cl, openDeg);
  else if (openDeg >= INLINE_AT) FO = 0;
  else { const k = smooth((openDeg - HANG_END) / (INLINE_AT - HANG_END)); FO = hangAngle(caseComp, cl, HANG_END) * (1 - k); }
  return { LT, FO };
}

// Minimal transform evaluator (no meshes) used for the lid kinematics.
class FoldedComponentLite {
  constructor(comp) { this.comp = comp; this.children = {}; for (const h of comp.hinges) (this.children[h.parent] ||= []).push(h); this.global = rowMajor(comp.global); }
  pointOnPanel(name, cl, LTangle) {
    // FO hinge start point lies on LT: the lid's front edge
    const hFO = this.comp.hinges.find(h => h.child === 'FO');
    const T = {}; T[this.comp.root] = new THREE.Matrix4();
    const stack = [this.comp.root];
    while (stack.length) {
      const p = stack.pop();
      for (const h of (this.children[p] || [])) {
        const ang = (h.child === 'LT') ? LTangle : h.angle;
        T[h.child] = T[p].clone().multiply(rotationAboutAxis(h.a, h.b, ang));
        stack.push(h.child);
      }
    }
    const M = this.global.clone().multiply(T['LT']);
    return new THREE.Vector3(hFO.a[0], hFO.a[1], 0).applyMatrix4(M);
  }
}
