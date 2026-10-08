// Animation timelines: easing, video presets (camera + box state over normalised time) and the dieline-driven
// fold sequence (flat printed sheet -> folded carton), all expressed as pure functions of t in [0, 1].
import * as THREE from 'three';
import { lidAngles } from './boxmodel.js';

export const ease = {
  linear: t => t,
  inOut: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: t => 1 - Math.pow(1 - t, 3),
  in: t => t * t * t,
  smooth: t => t * t * (3 - 2 * t),
  smoother: t => t * t * t * (t * (t * 6 - 15) + 10),
  outBack: t => { const c = 1.2; return 1 + c * Math.pow(t - 1, 3) + (c - 0) * Math.pow(t - 1, 2) * (1 - c) ; },
};
const clamp01 = v => Math.max(0, Math.min(1, v));
/** 0 before a, 1 after b, eased in between */
export function seg(t, a, b, e = ease.inOut) { return e(clamp01((t - a) / (b - a))); }
const lerp = (a, b, k) => a + (b - a) * k;

function orbitPos(center, pos, angleRad, elevDelta = 0) {
  const v = pos.clone().sub(center);
  const r = Math.hypot(v.x, v.z); const a0 = Math.atan2(v.x, v.z) + angleRad;
  return new THREE.Vector3(center.x + r * Math.sin(a0), center.y + v.y + elevDelta, center.z + r * Math.cos(a0));
}

// ---------------------------------------------------------------- video presets
// ctx: { cam(name) -> {pos, target}, dims, startOpen, endOpen, OPEN }
export const VIDEO_PRESETS = {
  orbit: { name: 'Orbit', blurb: 'Slow 360° turntable in the chosen box state.', duration: 12,
    fn(t, c) { const h = c.cam('hero'); const pos = orbitPos(h.target, h.pos, -t * Math.PI * 2, 0); return { cam: { pos, target: h.target }, open: c.startOpen, lift: 0, light: 1, exposure: 1 }; } },
  slide: { name: 'Slow Product Slide', blurb: 'Lateral dolly with gentle parallax, closed or open as set.', duration: 9,
    fn(t, c) { const f = c.cam('front'); const k = ease.smoother(t); const x = lerp(-c.dims.L * 0.55, c.dims.L * 0.55, k);
      const pos = f.pos.clone().add(new THREE.Vector3(x, c.dims.H * 0.9, -c.dims.D * 0.1)); const tgt = f.target.clone().add(new THREE.Vector3(x * 0.35, 0, 0));
      return { cam: { pos, target: tgt }, open: c.startOpen, lift: 0, light: 1, exposure: 1 }; } },
  opening: { name: 'Box Opening', blurb: 'From closed to open, lid and flap on the real hinges; the camera rises to reveal the confections.', duration: 9,
    fn(t, c) { const a = c.cam('hero'), b = c.cam('open'); const k = ease.smoother(seg(t, 0.05, 0.95, ease.linear));
      const pos = a.pos.clone().lerp(b.pos, k); const tgt = a.target.clone().lerp(b.target, k);
      const open = c.OPEN * seg(t, 0.22, 0.78, ease.smoother);
      const reveal = seg(t, 0.45, 0.9, ease.smooth);
      return { cam: { pos, target: tgt }, open, lift: 0, light: 0.9 + 0.2 * reveal, exposure: 0.94 + 0.1 * reveal, interior: reveal * 0.5 }; } },
  closing: { name: 'Box Closing', blurb: 'The reverse: lid comes down, camera settles on the closed hero.', duration: 8,
    fn(t, c) { const a = c.cam('open'), b = c.cam('hero'); const k = ease.smoother(seg(t, 0.05, 0.95, ease.linear));
      const pos = a.pos.clone().lerp(b.pos, k); const tgt = a.target.clone().lerp(b.target, k);
      const open = c.OPEN * (1 - seg(t, 0.2, 0.75, ease.smoother));
      return { cam: { pos, target: tgt }, open, lift: 0, light: 1.05 - 0.1 * k, exposure: 1.02 - 0.06 * k, interior: 0.5 * (1 - k) }; } },
  openOrbit: { name: 'Open + Orbit', blurb: 'Opens, then a half orbit around the open box.', duration: 14,
    fn(t, c) { const a = c.cam('hero'), b = c.cam('open'); const k1 = ease.smoother(seg(t, 0.0, 0.42, ease.linear));
      let pos = a.pos.clone().lerp(b.pos, k1); const tgt = a.target.clone().lerp(b.target, k1);
      const orb = seg(t, 0.42, 1.0, ease.inOut) * Math.PI * 0.9;
      pos = orbitPos(tgt, pos, -orb, 0);
      const open = c.OPEN * seg(t, 0.12, 0.45, ease.smoother);
      return { cam: { pos, target: tgt }, open, lift: 0, light: 1, exposure: 1, interior: 0.4 * seg(t, 0.3, 0.5) }; } },
  hero: { name: 'Hero Reveal', blurb: 'Starts dark on the lid detail and pulls back into light.', duration: 8,
    fn(t, c) { const a = c.cam('detail'), b = c.cam('hero'); const k = ease.smoother(seg(t, 0.08, 0.92, ease.linear));
      const pos = a.pos.clone().lerp(b.pos, k); const tgt = a.target.clone().lerp(b.target, k);
      const lit = seg(t, 0.0, 0.55, ease.smooth);
      return { cam: { pos, target: tgt }, open: c.startOpen, lift: 0, light: 0.25 + 0.75 * lit, exposure: 0.55 + 0.45 * lit }; } },
};

// ---------------------------------------------------------------- fold sequence
export const FOLD_DURATION = 26;
const FOLD_STEPS = [
  { a: 0.00, b: 0.06, caption: 'The printed sheet: one flat CASE blank and one INSERT blank, straight from the die-cutter.' },
  { a: 0.06, b: 0.15, caption: 'Both blanks are turned over: the carton is folded with the printed face down.' },
  { a: 0.15, b: 0.23, caption: 'Step 1 - The four dust flaps fold inwards along their creases.' },
  { a: 0.22, b: 0.33, caption: 'Step 2 - Front wall and back wall (with the lid still in line) stand up.' },
  { a: 0.32, b: 0.52, caption: 'Step 3 - Each end wall rises, rolls over 180° on the double crease and the inner layer locks into the floor slots.' },
  { a: 0.50, b: 0.62, caption: 'Step 4 - The front wall rolls over: the inner front wall folds down inside and its three tabs lock.' },
  { a: 0.24, b: 0.58, caption: 'Insert - legs fold down, the riser and the lower cup-support deck fold under and lock into the front leg.' },
  { a: 0.60, b: 0.73, caption: 'Step 5 - The finished insert is turned upright and dropped into the case; it braces the double walls.' },
  { a: 0.72, b: 0.83, caption: 'The paper cups with the confections are placed in the cavities.' },
  { a: 0.83, b: 1.00, caption: 'Step 6 - The lid folds over; the front flap drops outside the front wall and the magnets hold it closed.' },
];
export function foldCaption(t) {
  const active = FOLD_STEPS.filter(s => t >= s.a && t < s.b);
  const s = active.length ? active[active.length - 1] : FOLD_STEPS[FOLD_STEPS.length - 1];
  return s.caption;
}

/** rigid interpolation between two placements (Matrix4) about a pivot given in local coordinates, with a lift arc (z) */
export function rigidLerp(A, B, k, pivot, lift = 0, e = ease.inOut) {
  const kk = e(k);
  const P = new THREE.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z);
  const Pi = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const A2 = A.clone().multiply(P), B2 = B.clone().multiply(P);
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), sa = new THREE.Vector3();
  const pb = new THREE.Vector3(), qb = new THREE.Quaternion(), sb = new THREE.Vector3();
  A2.decompose(pa, qa, sa); B2.decompose(pb, qb, sb);
  const p = pa.clone().lerp(pb, kk); p.z += lift * Math.sin(Math.PI * kk);
  const q = qa.clone().slerp(qb, kk);
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)).multiply(Pi);
}

/**
 * Fold-sequence state at time t (0..1) for a SKU.  Returns:
 *   { caseAngles, caseExtra (Matrix4, multiplies the component's global transform), insertAngles, insertBase,
 *     conf: {visible, drop (0..1)}, caption, showArtworkSheet }
 * Conventions: hinge angle 0 = flat; closed angle from the dieline (90 for every crease). The case global
 * transform already lays the blank printed-face DOWN; 'extra' is used to present it printed-face UP first and
 * to turn it over.  The insert is folded printed-face down beside the case, turned over and dropped in.
 */
export function foldState(t, sku, caseComp, insComp, placement) {
  const tC = caseComp.t, tI = insComp.t;
  const [cx0, cy0, cx1, cy1] = caseComp.bbox, [ix0, iy0, ix1, iy1] = insComp.bbox;
  const caseC = new THREE.Vector3((cx0 + cx1) / 2, (cy0 + cy1) / 2, 0);
  const insC = new THREE.Vector3((ix0 + ix1) / 2, (iy0 + iy1) / 2, 0);
  const G = new THREE.Matrix4().set(...caseComp.global);
  const Ginv = G.clone().invert();
  // case: printed-face-up presentation = translation only (mid-plane at z = t/2) -> extra = U * G^-1
  const Ucase = new THREE.Matrix4().makeTranslation(0, 0, tC / 2);
  const extraUp = Ucase.clone().multiply(Ginv);
  const extraDown = new THREE.Matrix4();
  const flipK = seg(t, 0.06, 0.15, ease.linear);
  const caseExtra = rigidLerp(extraUp, extraDown, flipK, caseC.clone().applyMatrix4(G), 190, ease.inOut);
  // --- case hinge angles
  const A = {};
  const dust = 90 * seg(t, 0.15, 0.23);
  for (const n of ['DF_FWoL', 'DF_FWoR', 'DF_BWL', 'DF_BWR']) A[n] = dust;
  A.FWo = 90 * seg(t, 0.22, 0.33); A.BW = 90 * seg(t, 0.23, 0.34);
  A.SWoL = 90 * seg(t, 0.32, 0.40); A.SWoR = 90 * seg(t, 0.33, 0.41);
  A.SSL = 90 * seg(t, 0.39, 0.45); A.SSR = 90 * seg(t, 0.40, 0.46);
  A.SWiL = 90 * seg(t, 0.44, 0.51); A.SWiR = 90 * seg(t, 0.45, 0.52);
  A.SF = 90 * seg(t, 0.50, 0.56); A.FWi = 90 * seg(t, 0.55, 0.62);
  const lidOpen = 90 - 90 * seg(t, 0.84, 1.0, ease.smoother);          // lid in line (open 90) -> closed
  const la = lidAngles(sku, caseComp, lidOpen);
  A.LT = la.LT; A.FO = la.FO;
  // --- insert: flat beside the case (printed up), flip, fold, flip + move into the case
  const dx = cx0 - 70 - (ix1 - ix0) / 2 - insC.x;          // flat -X = viewer's right in the Y-up scene
  const dy = caseC.y - insC.y;
  const Uins = new THREE.Matrix4().makeTranslation(dx, dy, tI / 2);
  const flipIns = new THREE.Matrix4().makeTranslation(insC.x, insC.y, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-insC.x, -insC.y, 0));
  const Dins = Uins.clone().multiply(flipIns);                        // printed face down, same spot
  const Pins = new THREE.Matrix4().set(...placement);
  let insertBase;
  if (t < 0.60) insertBase = rigidLerp(Uins, Dins, seg(t, 0.06, 0.15, ease.linear), insC, 160, ease.inOut);
  else insertBase = rigidLerp(Dins, Pins, seg(t, 0.60, 0.73, ease.linear), insC, 170, ease.inOut);
  const I = {};
  I.FL = 90 * seg(t, 0.26, 0.34); I.USL = 90 * seg(t, 0.28, 0.36); I.USR = 90 * seg(t, 0.29, 0.37);
  I.BK = 90 * seg(t, 0.38, 0.46); I.LD = 90 * seg(t, 0.46, 0.57);
  const conf = { visible: t >= 0.72, drop: seg(t, 0.72, 0.83, ease.out) };
  return { caseAngles: A, caseExtra, insertAngles: I, insertBase, conf, caption: foldCaption(t), lidOpen };
}

/** camera path for the fold studio: from above the flat sheets to the hero view.
 *  Scene X = -flat X: the case blank is centred, the insert blank lies to the viewer's right. */
export function foldCamera(t, cam, dims) {
  const midX = dims.L * 0.8;                                    // between the two blanks
  const sheetTarget = new THREE.Vector3(midX, 0, dims.D * 0.55);
  const top = { pos: sheetTarget.clone().add(new THREE.Vector3(-90, 980, 560)), target: sheetTarget };
  const mid = { pos: new THREE.Vector3(midX - 540, 430, 640), target: new THREE.Vector3(midX * 0.7, 25, dims.D * 0.5) };
  const hero = cam('hero');
  const k1 = ease.smoother(seg(t, 0.0, 0.3, ease.linear)), k2 = ease.smoother(seg(t, 0.6, 0.96, ease.linear));
  let pos = top.pos.clone().lerp(mid.pos, k1), tgt = top.target.clone().lerp(mid.target, k1);
  pos.lerp(hero.pos, k2); tgt.lerp(hero.target, k2);
  return { pos, target: tgt };
}
