// Real-world scale reference.  The whole studio works in MILLIMETRES (three.js world units = 1 mm, Y up, the
// table / support surface at y = 0).  The AYGIS box is the primary physical reference: its dimensions come from the
// production dieline export (box_models.json), the confection and paper-cup sizes from the same file.  Every prop
// and environment takes its sizes from REF below, so a plate, a fork or a café chair can never drift in scale
// relative to the box, and the same confection is the same 22 mm object in every scene.
//
// Sources: catering-ware catalogues (espresso / cappuccino services, dessert plates, cutlery), furniture standards
// (EN 1729 / EN 581 table and seat heights), Thonet No. 14 and Parisian rattan bistro-chair specifications, and
// typical fruit sizes.  Values are typical, not extreme.

export const REF = {
  // ---- product (overwritten from box_models.json at load: see setProduct)
  confection: { d: 22.0, h: 22.0 },                  // coated nut / fruit confection, dome
  cup: { base: 25.0, top: 34.0, h: 16.0 },            // pleated glassine baking cup
  // ---- coffee service
  espressoCup: { rim: 62, foot: 38, h: 56, wall: 3.2, capacity: 80 },     // demitasse
  espressoSaucer: { d: 118, well: 40, h: 14 },
  cappuccinoCup: { rim: 88, foot: 48, h: 70, wall: 3.5 },
  cappuccinoSaucer: { d: 150, well: 52, h: 16 },
  surchCup: { rim: 56, foot: 34, h: 52, wall: 2.6 },                       // Armenian coffee cup (with gold rim)
  surchSaucer: { d: 108, well: 36, h: 12 },
  jezve: { base: 74, waist: 56, h: 92, handle: 170 },                       // copper Armenian coffee pot (surchep)
  // ---- tableware
  dessertPlate: { d: 210, well: 140, h: 18 },
  sidePlate: { d: 165, well: 110, h: 15 },
  cakePlate: { d: 260, h: 14 },                                             // flat serving plate / charger
  dessertFork: { len: 178, head: 58, tines: 4 },
  cakeFork: { len: 152 },
  teaspoon: { len: 138, bowl: [27, 42] },
  espressoSpoon: { len: 108, bowl: [20, 31] },
  tumbler: { rim: 76, base: 64, h: 98 },
  wineGlass: { rim: 62, bowl: 86, h: 215 },
  carafe: { d: 104, h: 240 },
  napkin: { w: 400, d: 400, folded: [200, 200], thick: 0.6 },
  // ---- furniture
  bistroTable: { top: 600, h: 750, thick: 20 },                             // round two-person café table
  cafeTable: { w: 700, d: 700, h: 750 },
  diningTable: { h: 750 },
  coffeeTable: { h: 420 },
  thonetChair: { h: 880, seat: 460, seatD: 420, rod: 26 },
  bistroChair: { h: 860, seat: 455, w: 470, d: 520 },                       // Parisian woven rattan chair
  banquette: { seat: 450, back: 950, depth: 560 },
  ceiling: { cafe: 3400, haussmannGround: 4200 },
  parasol: { d: 2700, h: 2350 },
  // ---- outdoors
  picnicBlanket: { w: 1500, d: 1900 },
  picnicBasket: { w: 460, d: 310, h: 210, handle: 120 },
  stairRiser: 155, stairTread: 360,
  tree: { h: 11000, canopy: 7000 },
  storey: { soviet: 3200, tamanyan: 4200 },
  eye: 1550,
  // ---- fruit & food
  apple: 78, apricot: 44, pomegranate: 92, fig: 50, walnut: 32, grape: 20, lemon: 70, peach: 70,
  driedApricot: [36, 30, 8],
  wineBottle: { d: 76, h: 300 },
  candlePillar: { d: 70, h: 120 }, tealight: { d: 38, h: 16 },
  book: { w: 210, h: 280, t: 18 },
};

/** take the confection / cup sizes from the production data so props and box agree exactly */
export function setProduct(sku) {
  const p = sku.product;
  REF.confection.d = p.D_conf; REF.confection.h = p.D_conf;
  REF.cup.base = p.cup_base; REF.cup.top = p.cup_top; REF.cup.h = p.cup_h;
}

/** Development check: report props whose bounding size deviates from REF by more than `tol` (fraction). */
export function auditScale(group, THREE, tol = 0.15) {
  const out = [];
  group.traverse(o => {
    const r = o.userData && o.userData.ref; if (!r) return;
    const b = new THREE.Box3().setFromObject(o); const s = new THREE.Vector3(); b.getSize(s);
    const meas = { x: s.x, y: s.y, z: s.z, max: Math.max(s.x, s.z) }[r.axis || 'max'];
    if (Math.abs(meas - r.size) / r.size > tol) out.push(`${o.name}: ${meas.toFixed(0)} mm, expected ${r.size} mm`);
  });
  return out;
}
/** tag an object with its expected real size for auditScale */
export function ref(obj, size, axis = 'max') { obj.userData.ref = { size, axis }; return obj; }

// ---- photographic helpers
/** full-frame (36 x 24 mm) equivalent focal length -> vertical field of view (deg) for an aspect ratio */
export function focalToVFov(focal, aspect) {
  const longHalf = 18;                                   // long edge of the 36 x 24 sensor, half
  if (aspect >= 1) { const hf = 2 * Math.atan(longHalf / focal); return 2 * Math.atan(Math.tan(hf / 2) / aspect) * 180 / Math.PI; }
  return 2 * Math.atan(longHalf / focal) * 180 / Math.PI;
}
/** sensor height (mm) of the full-frame equivalent for the current aspect (for circle-of-confusion maths) */
export function sensorHeight(aspect) { return aspect >= 1 ? 36 / aspect : 36; }

/** correlated colour temperature (K) -> linear RGB (Tanner Helland fit, normalised to max = 1) */
export function kelvin(T) {
  const t = T / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const c = [r, g, b].map(v => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2));
  const m = Math.max(...c); return c.map(v => v / m);
}
/** light colour as seen by a camera white-balanced to `wb` K (luminance-normalised linear RGB) */
export function lightColor(T, wb) {
  const a = kelvin(T), w = kelvin(wb);
  const c = [a[0] / w[0], a[1] / w[1], a[2] / w[2]];
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return c.map(v => v / lum);
}
