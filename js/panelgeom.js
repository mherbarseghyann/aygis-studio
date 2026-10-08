// Panel geometry: a flat board panel (polygon with holes, mm, printed face = +Z) extruded to thickness t.
// Groups: 0 = printed (front) cap, 1 = reverse (back) cap, 2 = CREASE edges (the board side faces that lie on a hinge
// line: on the real carton the printed surface wraps around the fold, so these are textured like the front face),
// 3 = CUT edges (true knife edges).
// An edge can lie only PARTLY on a hinge (e.g. the front flap is 4.4 mm wider than the lid it hinges on): such edges
// are split, so only the parts beyond the crease are knife cuts.  (The first version classified the whole edge as a
// cut, which produced the light board-core line along the lid's front edge.)
// UVs of caps and crease edges are the flat coordinates (mm); the page texture matrix maps them into the page.
// foldFillet() builds the rounded outer surface of a fold (radius t/2 about the hinge axis), which closes the notch
// between two folded panels exactly at any fold angle.
import * as THREE from 'three';

function signedArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function cleanRing(r) {
  const out = [];
  for (const p of r) { const l = out[out.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-6) out.push([p[0], p[1]]); }
  if (out.length > 1) { const a = out[0], b = out[out.length - 1]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) out.pop(); }
  return out;
}
function distToLine(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1]; const L = Math.hypot(dx, dy) || 1;
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L;
}
/** parameter intervals [t0, t1] (0..1 along p->q) where the edge p-q lies on one of the crease segments */
function creaseIntervals(p, q, creases) {
  const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy;
  const iv = [];
  for (const [a, b] of creases) {
    if (distToLine(a, p, q) > 0.02 || distToLine(b, p, q) > 0.02) continue;      // not collinear
    const ta = ((a[0] - p[0]) * dx + (a[1] - p[1]) * dy) / L2, tb = ((b[0] - p[0]) * dx + (b[1] - p[1]) * dy) / L2;
    const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(1, Math.max(ta, tb));
    if (t1 - t0 > 1e-6) iv.push([t0, t1]);
  }
  iv.sort((u, v) => u[0] - v[0]);
  const merged = [];
  for (const s of iv) { const l = merged[merged.length - 1]; if (l && s[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], s[1]); else merged.push([...s]); }
  return merged;
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
        // split the edge into crease / cut pieces
        const iv = creaseIntervals(p, q, creases);
        const pieces = []; let t0 = 0;
        for (const [a, b] of iv) { if (a > t0 + 1e-6) pieces.push([t0, a, false]); pieces.push([a, b, true]); t0 = b; }
        if (t0 < 1 - 1e-6) pieces.push([t0, 1, false]);
        for (const [a, b, isCrease] of pieces) {
          const P = [p[0] + dx * a, p[1] + dy * a], Q = [p[0] + dx * b, p[1] + dy * b];
          const base = pos.length / 3;
          pos.push(P[0], P[1], h, Q[0], Q[1], h, Q[0], Q[1], -h, P[0], P[1], -h);
          for (let k = 0; k < 4; k++) nrm.push(nx, ny, 0);
          // UV: flat coordinates slightly INSIDE the panel so the sampled colour is the printed face next to the edge
          const ex = -nx * 0.4, ey = -ny * 0.4;
          uv.push(P[0] + ex, P[1] + ey, Q[0] + ex, Q[1] + ey, Q[0] + ex, Q[1] + ey, P[0] + ex, P[1] + ey);
          (isCrease ? iC : iS).push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
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
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

/**
 * Rounded outer surface of a fold: a cylinder of radius t/2 on the hinge axis (the board mid-plane), in the PARENT
 * panel's flat frame.  Both panels rotate about this axis, so it is tangent to both printed faces at every fold
 * angle and closes the notch between them.  Group 0 = printed half (z >= 0), group 1 = reverse half.
 */
export function foldFillet(a, b, t, segs = 10) {
  const r = t / 2;
  const ax = b[0] - a[0], ay = b[1] - a[1], L = Math.hypot(ax, ay);
  const ux = ax / L, uy = ay / L;          // along the hinge
  const px = -uy, py = ux;                 // in-plane perpendicular
  const pos = [], nrm = [], uv = [], idxF = [], idxB = [];
  const half = (phi0, phi1, out) => {
    const base = pos.length / 3;
    for (let i = 0; i <= segs; i++) {
      const phi = phi0 + (phi1 - phi0) * i / segs;
      const nx = Math.cos(phi) * px, ny = Math.cos(phi) * py, nz = Math.sin(phi);
      for (const e of [a, b]) { pos.push(e[0] + nx * r, e[1] + ny * r, nz * r); nrm.push(nx, ny, nz); uv.push(e[0], e[1]); }
    }
    for (let i = 0; i < segs; i++) { const k = base + i * 2; out.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  };
  half(0, Math.PI, idxF); half(Math.PI, 2 * Math.PI, idxB);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const F = idxF, B = idxB;                // (a_i, a_i+1, b_i) winds outwards: (dn x u) points along n
  g.setIndex(F.concat(B)); g.addGroup(0, F.length, 0); g.addGroup(F.length, B.length, 1);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}
