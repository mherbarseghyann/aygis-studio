// Sky and far distance.
// The sky dome outputs scene-referred HDR radiance (not a picture): it is what the camera sees AND, through the
// PMREM capture, the light source for every diffuse and glossy surface.  The sun disk itself is excluded from the
// capture (the sun is the directional key light), so it is not counted twice.
// Distant terrain (Mount Ararat seen from Yerevan) is a card at a few hundred metres scaled to the true angular
// size: Masis 5137 m and Sis 3896 m at ~60 km from Yerevan (about 1000 m a.s.l.) -> Masis rises ~4.1 deg above the
// horizon and the massif spans ~40 deg; aerial perspective (haze) is painted in from the real distance.
import * as THREE from 'three';

const SKY_FS = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor;
uniform float uSunSize, uSunGlow, uHaze, uShowSun, uCloud, uCloudScale, uGroundBlend;
varying vec3 vDir;
float sh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
float sf(vec2 p){ float s = 0., a = 0.5; for (int i = 0; i < 6; i++){ s += a * sn(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  float hp = max(h, 0.0);
  vec3 sky = mix(uHorizon, uZenith, pow(hp, 0.45));
  sky = mix(sky, uHorizon * 1.08, exp(-hp * 14.0) * uHaze);
  float cs = dot(d, normalize(uSunDir));
  sky += uSunColor * uSunGlow * (0.06 * pow(max(cs, 0.0), 4.0) + 0.25 * pow(max(cs, 0.0), 48.0) + 0.6 * pow(max(cs, 0.0), 600.0));
  if (uCloud > 0.0 && h > 0.0){
    vec2 p = d.xz / (h + 0.12) * uCloudScale;
    float c = sf(p + 3.1); float cov = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.28, c);
    float lit = 0.75 + 0.35 * smoothstep(0.3, 1.0, sf(p + uSunDir.xz * 0.35)) ;
    vec3 cc = mix(uHorizon * 1.15, uSunColor * 0.06 + uZenith * 0.9 + vec3(0.35), 0.6) * lit;
    sky = mix(sky, cc, cov * smoothstep(0.0, 0.18, h) * 0.85);
  }
  vec3 col = h >= 0.0 ? sky : mix(uHorizon * 0.85, uGround, smoothstep(0.0, 0.25, -h) * uGroundBlend + (1.0 - uGroundBlend) * 0.0);
  col += uShowSun * uSunColor * 60.0 * smoothstep(cos(uSunSize * 1.25), cos(uSunSize), cs);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * opts: zenith, horizon, ground (linear RGB arrays or Color), sunDir (Vector3), sunColor, sunSize (rad, 0.0047 = real),
 *       glow, haze, cloud (coverage 0..1), cloudScale, intensity (multiplier)
 */
export function skyDome(o = {}) {
  const C = (v, def) => (v === undefined ? new THREE.Color(...def) : v.isColor ? v.clone() : new THREE.Color(...v));
  const k = o.intensity ?? 1;
  const u = {
    uZenith: { value: C(o.zenith, [0.25, 0.42, 0.85]).multiplyScalar(k) }, uHorizon: { value: C(o.horizon, [0.75, 0.8, 0.85]).multiplyScalar(k) }, uGround: { value: C(o.ground, [0.2, 0.18, 0.15]).multiplyScalar(k) },
    uSunDir: { value: (o.sunDir || new THREE.Vector3(0.3, 0.6, -0.7)).clone().normalize() }, uSunColor: { value: C(o.sunColor, [1, 0.95, 0.85]).multiplyScalar(k) },
    uSunSize: { value: o.sunSize ?? 0.012 }, uSunGlow: { value: o.glow ?? 1.0 }, uHaze: { value: o.haze ?? 0.5 }, uShowSun: { value: 1 },
    uCloud: { value: o.cloud ?? 0 }, uCloudScale: { value: o.cloudScale ?? 1.6 }, uGroundBlend: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: SKY_FS,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(800000, 64, 32), mat);
  m.frustumCulled = false; m.renderOrder = -10; m.castShadow = false; m.receiveShadow = false; m.userData.noAO = true; m.name = 'sky';
  m.userData.setCapture = (on) => { u.uShowSun.value = on ? 0 : 1; };
  return m;
}

/**
 * Mount Ararat as seen from Yerevan, painted procedurally on a vertical arc at `dist` mm, centred on azimuth `az`
 * (deg, 0 = -Z, + towards +X).  Real geometry: summit elevation angle ~4.1 deg, massif ~40 deg wide; Sis (Little
 * Ararat) stands to the east = LEFT of Masis when looking south from Yerevan.
 */
export function araratCard({ dist = 600000, az = 8, horizonY = 0, haze = [0.86, 0.78, 0.74], rock = [0.42, 0.40, 0.48], snow = [1.0, 0.97, 0.94], sunSide = 1, intensity = 1.0, veil = 0.55 } = {}) {
  const W = 2048, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  const img = x.createImageData(W, H); const D = img.data;
  const hz = (h) => h;                                       // card height in "degrees above the horizon" units below
  // ridge profile in degrees: u in [-20, 20] deg
  const ridge = (u) => {
    const masis = 4.1 * Math.exp(-Math.pow((u - 3) / 6.2, 2)) * (1 - 0.02 * Math.sin(u * 3.3));
    const sis = 2.9 * Math.exp(-Math.pow((u + 8.5) / 2.6, 2));
    const saddle = 1.6 * Math.exp(-Math.pow((u + 3.5) / 5.5, 2));
    const foot = 0.55 * Math.exp(-Math.pow(u / 16, 2)) + 0.12 * Math.sin(u * 1.7) * Math.exp(-Math.pow(u / 18, 2));
    return Math.max(masis, sis, saddle, foot) + 0.04 * Math.sin(u * 9.1) * Math.sin(u * 3.7);
  };
  const maxDeg = 4.6;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = (0.5 - i / (W - 1)) * 40, e = (1 - j / (H - 1)) * maxDeg;     // u mirrored: the card is seen from inside
    const top = ridge(u); const o = (j * W + i) * 4;
    if (e > top) { D[o + 3] = 0; continue; }
    const rel = e / Math.max(top, 0.01);
    const isMasis = Math.abs(u - 3) < 9;
    const snowLine = isMasis ? 2.85 + 0.25 * Math.sin(u * 4.1) + 0.15 * Math.sin(u * 11.3) : 3.6;
    const gully = 0.5 + 0.5 * Math.sin(u * 7 + e * 4) * Math.sin(u * 2.3);
    let k = e > snowLine ? Math.min(1, (e - snowLine) * 3 + 0.4) * (0.8 + 0.2 * gully) : 0;
    // slopes facing the sun (west = right when looking south) are brighter
    const slope = (ridge(u + 0.05) - ridge(u - 0.05)) * sunSide;
    const lit = 0.85 + 0.25 * Math.max(-1, Math.min(1, -slope * 4));
    const base = rock.map((v, n) => v * lit * (0.9 + 0.1 * rel));
    const col = base.map((v, n) => v * (1 - k) + snow[n] * lit * k);
    // aerial perspective: 60 km of haze -> strong veil, more at the foot
    const v = veil + 0.25 * (1 - rel);
    const out = col.map((c, n) => c * (1 - v) + haze[n] * v);
    D[o] = Math.min(255, out[0] * 255); D[o + 1] = Math.min(255, out[1] * 255); D[o + 2] = Math.min(255, out[2] * 255);
    D[o + 3] = 255 * Math.min(1, (top - e) * 40);
  }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const span = 40 * Math.PI / 180, height = dist * Math.tan(maxDeg * Math.PI / 180);
  const geo = new THREE.CylinderGeometry(dist, dist, height, 96, 1, true, Math.PI - span / 2 + az * Math.PI / 180, span);
  geo.translate(0, height / 2 + horizonY, 0);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, color: new THREE.Color(intensity, intensity, intensity) });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = -5; m.userData.noAO = true; m.castShadow = false; m.name = 'ararat';
  return m;
}
