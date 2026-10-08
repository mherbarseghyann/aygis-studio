// Panel geometry: a flat board panel (polygon with holes, mm, printed face = +Z) extruded to thickness t.
// Groups: 0 = printed (front) cap, 1 = reverse (back) cap, 2 = CREASE edges (the 0.45 mm board side faces that lie
// on a hinge line: on the real carton the printed surface wraps around the fold, so these are textured like the
// front face -> no light seam lines at the folds), 3 = CUT edges (true knife edges, raw board core).
// UVs of caps and crease edges are the flat coordinates (mm); the page texture matrix maps them into the page.
import * as THREE from 'three';

function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function cleanRing(r) {
  const out = [];
  for (const p of r) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) out.push([p[0], p[1]]); }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop(); }
  return out;
}
function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L2 = dx * dx + dy * dy;
  let t = L2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * @param polys   [{outer:[[x,y]..], holes:[[[x,y]..]..]}]
 * @param t       board thickness (mm)
 * @param creases [[[ax,ay],[bx,by]], ...] hinge lines touching this panel (own hinge + children's hinges)
 */
export function buildPanelGeometry(polys, t, creases = []) {
  const pos = [], nrm = [], uv = [];
  const iF = [], iB = [], iC = [], iS = [];
  const h = t / 2;
  const onCrease = (p, q) => creases.some(([a, b]) => distToSeg(p, a, b) < 0.02 && distToSeg(q, a, b) < 0.02);
  for (const poly of polys) {
    let outer = cleanRing(poly.outer);
    if (outer.length < 3) continue;
    if (signedArea(outer) < 0) outer.reverse();
    const holes = (poly.holes || []).map(cleanRing).filter(r => r.length >= 3).map(r => (signedArea(r) > 0 ? r.reverse() : r));
    const contour = outer.map(p => new THREE.Vector2(p[0], p[1]));
    const holeV = holes.map(r => r.map(p => new THREE.Vector2(p[0], p[1])));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holeV); } catch (e) { console.warn('triangulation failed', e); tris = []; }
    const all = outer.concat(...holes);
    const baseF = pos.length / 3;
    for (const p of all) { pos.push(p[0], p[1], h); nrm.push(0, 0, 1); uv.push(p[0], p[1]); }
    for (const tr of tris) {
      const a = all[tr[0]], b = all[tr[1]], c = all[tr[2]];
      const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (ar >= 0) iF.push(baseF + tr[0], baseF + tr[1], baseF + tr[2]); else iF.push(baseF + tr[0], baseF + tr[2], baseF + tr[1]);
    }
    const baseB = pos.length / 3;
    for (const p of all) { pos.push(p[0], p[1], -h); nrm.push(0, 0, -1); uv.push(p[0], p[1]); }
    for (const tr of tris) {
      const a = all[tr[0]], b = all[tr[1]], c = all[tr[2]];
      const ar = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (ar >= 0) iB.push(baseB + tr[0], baseB + tr[2], baseB + tr[1]); else iB.push(baseB + tr[0], baseB + tr[1], baseB + tr[2]);
    }
    for (const ring of [outer, ...holes]) {
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const nx = dy / len, ny = -dx / len;
        const b = pos.length / 3;
        pos.push(p[0], p[1], h, q[0], q[1], h, q[0], q[1], -h, p[0], p[1], -h);
        for (let k = 0; k < 4; k++) nrm.push(nx, ny, 0);
        // UV: flat coordinates slightly INSIDE the panel so the sampled colour is the printed face next to the edge
        const ex = -nx * 0.4, ey = -ny * 0.4;
        uv.push(p[0] + ex, p[1] + ey, q[0] + ex, q[1] + ey, q[0] + ex, q[1] + ey, p[0] + ex, p[1] + ey);
        (onCrease(p, q) ? iC : iS).push(b, b + 2, b + 1, b, b + 3, b + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(iF.concat(iB, iC, iS));
  let off = 0;
  g.addGroup(off, iF.length, 0); off += iF.length;
  g.addGroup(off, iB.length, 1); off += iB.length;
  g.addGroup(off, iC.length, 2); off += iC.length;
  g.addGroup(off, iS.length, 3);
  g.computeBoundingSphere();
  return g;
}
