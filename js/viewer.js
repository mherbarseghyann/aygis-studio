// Renderer, cameras (photographic lenses), lighting, environments and the progressive render loop.
//
// Rendering model
//  * World units are millimetres (see units.js).  The product sits on the support surface at y = 0.
//  * Image-based lighting is CAPTURED FROM THE ENVIRONMENT ITSELF (PMREM of the dressed set rendered from the
//    product position, two bounces), so reflections and ambient light on the box are exactly the room / street
//    / studio that is visible behind it - no painted HDRI that disagrees with the set.
//  * Direct light is a small physically motivated rig per environment (sun, window or softbox key with an
//    angular size, optional fill / rim), colours from correlated colour temperature relative to the camera's
//    white balance (units.lightColor).
//  * Khronos PBR Neutral tone mapping (keeps the brand burgundy and gold hue-accurate; ACES shifts saturated
//    reds towards orange and darkens them).
//  * Render on demand.  While the camera or the box moves, an "interactive" chain renders at an adaptive
//    resolution with MSAA.  As soon as the view settles, a "final" chain accumulates jittered samples: sub-pixel
//    jitter (anti-aliasing), a thin-lens aperture (physically correct depth of field for the chosen focal length
//    and f-number), and key-light direction jitter over the light's angular size (true soft area-light shadows),
//    with ground-truth AO.  The image converges within a second or two and then rendering stops entirely.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import { envById, envContext } from './environments.js';
import { focalToVFov, sensorHeight, lightColor, auditScale } from './units.js';
import { clearMaterialCache } from './lookdev.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { initBaker, purgeBakeCache, setBakeScale } from './texbake.js';

// ------------------------------------------------------------------ camera presets
// az: degrees around the product from the front (+ = towards the viewer's left), el: elevation, focal: full-frame
// equivalent focal length (mm), fill: fraction of the frame the subject should occupy, fstop: aperture, ty: target
// height as a fraction of the box height, shiftY: lens shift (fraction of the half frame, - = subject lower).
export const CAMS = {
  hero: { label: 'Hero ¾', az: 34, el: 22, focal: 85, fill: 0.74, fstop: 8, ty: 0.45 },
  front: { label: 'Front', az: 0, el: 9, focal: 100, fill: 0.78, fstop: 8, ty: 0.5 },
  top: { label: 'Flat lay', az: 0, el: 89.5, focal: 70, fill: 0.72, fstop: 11, ty: 0.5 },
  side: { label: 'Side', az: -72, el: 15, focal: 85, fill: 0.78, fstop: 8, ty: 0.5 },
  open: { label: 'Open box', az: 22, el: 38, focal: 70, fill: 0.82, fstop: 8, ty: 0.6 },
  interior: { label: 'Interior', az: 0, el: 72, focal: 70, fill: 0.84, fstop: 8, ty: 0.6 },
  detail: { label: 'Detail', az: 30, el: 30, focal: 100, fill: 0.95, fstop: 4, region: 'logo' },
  macro: { label: 'Confections', az: 8, el: 42, focal: 100, fill: 0.92, fstop: 4, region: 'tray' },
  back: { label: 'Back', az: 158, el: 20, focal: 85, fill: 0.78, fstop: 8, ty: 0.5 },
  lifestyle: { label: 'Lifestyle', az: 16, el: 13, focal: 50, fill: 0.36, fstop: 2.8, ty: 0.4, shiftY: -0.22 },
};
// ------------------------------------------------------------------ quality tiers
// prCap: device-pixel-ratio cap for settled frames; maxMP: pixel budget (megapixels) so a 4K / Retina window does not
// render 8+ MP per sample; interCap: DPR cap while moving (further scaled adaptively); texPPMM: artwork texels per mm;
// density: vegetation / instanced set-dressing density.
export const QUALITY = {
  high: { label: 'High', samples: 48, prCap: 2, maxMP: 4.2, interCap: 1.5, ao: true, shadow: 4096, texPPMM: 8, density: 1, bake: 1 },
  medium: { label: 'Medium', samples: 24, prCap: 1.5, maxMP: 2.6, interCap: 1.25, ao: true, shadow: 2048, texPPMM: 6, density: 0.6, bake: 0.5 },
  performance: { label: 'Performance', samples: 10, prCap: 1, maxMP: 1.4, interCap: 1, ao: false, shadow: 2048, texPPMM: 4, density: 0.35, bake: 0.5 },
};
/** Auto tier from the GPU string (refined at runtime by measured frame times) */
export function detectTier(renderer) {
  const gl = renderer.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info');
  const r = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : '';
  const coarse = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
  if (coarse || /SwiftShader|llvmpipe|Software/i.test(r)) return { tier: 'performance', gpu: r };
  if (/Apple M\d|NVIDIA|GeForce|RTX|Quadro|Radeon RX|Radeon Pro W|Radeon Pro 5[5-9]\d\dM?|Radeon Pro Vega|Arc A/i.test(r)) return { tier: 'high', gpu: r };
  return { tier: 'medium', gpu: r };                         // integrated / older discrete / unknown
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };

// ------------------------------------------------------------------ passes
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
/** running average of HDR frames (progressive accumulation); the first sample never reads the (uninitialised)
 *  history buffer, because NaN * 0 = NaN would poison the whole image */
class AccumPass extends Pass {
  constructor() {
    super();
    const o = { type: THREE.HalfFloatType, depthBuffer: false };
    this.rt = [new THREE.WebGLRenderTarget(1, 1, o), new THREE.WebGLRenderTarget(1, 1, o)];
    this.blend = new THREE.ShaderMaterial({ uniforms: { tCur: { value: null }, tPrev: { value: null }, w: { value: 1 } }, vertexShader: QUAD_VS,
      fragmentShader: 'uniform sampler2D tCur, tPrev; uniform float w; varying vec2 vUv; void main(){ vec4 c = texture2D(tCur, vUv); if (w >= 0.999) { gl_FragColor = c; return; } vec4 p = texture2D(tPrev, vUv); gl_FragColor = mix(p, c, w); }', depthTest: false, depthWrite: false });
    this.copy = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: QUAD_VS, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vUv); }', depthTest: false, depthWrite: false });
    this.q = new FullScreenQuad(); this.n = 0;
  }
  setSize(w, h) { this.rt.forEach(r => r.setSize(w, h)); this.n = 0; }
  render(renderer, writeBuffer, readBuffer) {
    this.blend.uniforms.tCur.value = readBuffer.texture; this.blend.uniforms.tPrev.value = this.rt[0].texture; this.blend.uniforms.w.value = 1 / (this.n + 1);
    renderer.setRenderTarget(this.rt[1]); this.q.material = this.blend; this.q.render(renderer);
    const t = this.rt[0]; this.rt[0] = this.rt[1]; this.rt[1] = t; this.n++;
    this.copy.uniforms.t.value = this.rt[0].texture; this.q.material = this.copy;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.q.render(renderer);
  }
  dispose() { this.rt.forEach(r => r.dispose()); this.blend.dispose(); this.copy.dispose(); this.q.dispose(); }
}
/** display-referred finishing: optical vignetting (cos^4 law of the actual lens) and static fine grain */
function finishPass() {
  return new (class extends Pass {
    constructor() {
      super();
      this.mat = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, vig: { value: 0.0 }, grain: { value: 0.0 }, aspect: { value: 1.5 }, tanHalf: { value: 0.2 } },
        vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
        fragmentShader: `uniform sampler2D tDiffuse; uniform float vig, grain, aspect, tanHalf; varying vec2 vUv;
          float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
          void main(){ vec4 c = texture2D(tDiffuse, vUv); vec2 d = (vUv - 0.5) * 2.0; d.x *= aspect;
            float r = length(d) * tanHalf; float c4 = 1.0 / pow(1.0 + r * r, 2.0);          // cos^4 of the field angle
            c.rgb *= mix(1.0, c4, vig);
            c.rgb += (h(gl_FragCoord.xy) - 0.5) * grain;
            gl_FragColor = c; }`,
      });
      this.q = new FullScreenQuad(this.mat);
    }
    render(renderer, writeBuffer, readBuffer) { this.mat.uniforms.tDiffuse.value = readBuffer.texture; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.q.render(renderer); }
  })();
}

// ------------------------------------------------------------------ shader-program economy
// Every distinct material feature set is a separate GPU program, and on ANGLE / Metal each one costs ~0.3 s to
// compile. Standard materials are therefore normalised to ONE feature set (map + roughness/metalness + normal map,
// with neutral 1x1 textures where a surface has no texture), so the whole set shares a handful of programs.
function tex1(r, g, b, srgb) { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; t.userData.shared = true; return t; }
const NEUTRAL = { map: tex1(255, 255, 255, true), orm: tex1(255, 255, 255, false), normal: tex1(128, 128, 255, false) };
const BASE_OBC = THREE.Material.prototype.onBeforeCompile;
export function normalizeMaterial(m) {
  if (!m || !m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.userData.noNormalize || m.onBeforeCompile !== BASE_OBC) return;
  if (m.vertexColors) return;
  let ch = false;
  if (!m.map) { m.map = NEUTRAL.map; ch = true; }
  if (!m.roughnessMap) { m.roughnessMap = NEUTRAL.orm; ch = true; }
  if (!m.metalnessMap) { m.metalnessMap = NEUTRAL.orm; ch = true; }
  if (!m.normalMap) { m.normalMap = NEUTRAL.normal; ch = true; }
  if (ch) m.needsUpdate = true;
}
/**
 * Merge static environment meshes that share a material instance (and shadow / AO flags and vertex layout) into one
 * geometry each. Rich sets drop from ~430 to ~100 draw calls, and every scene render (colour, shadow map, AO normals,
 * IBL capture) gets cheaper. Instanced, transparent, transmissive, shader and confection meshes stay separate.
 */
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map();
  root.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.visible || Array.isArray(o.material)) return;
    const m = o.material, g = o.geometry;
    if (m.transparent || m.transmission > 0 || m.isShaderMaterial || o.userData.noMerge || o.userData.flavour !== undefined) return;
    if (!g.attributes.position || !g.attributes.normal || !g.attributes.uv) return;
    for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) return;
    const sig = ['position', 'normal', 'uv'].map(k => { const a = g.attributes[k]; return a.itemSize + a.array.constructor.name + (a.normalized ? 'n' : ''); }).join(',');
    const key = m.uuid + '|' + o.castShadow + o.receiveShadow + (o.userData.noAO ? 'x' : '') + o.renderOrder + '|' + sig;
    (groups.get(key) || groups.set(key, []).get(key)).push(o);
  });
  let removed = 0, added = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map(o => {
      let g = o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
      g.morphAttributes = {}; g.clearGroups();
      return g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    });
    let mg; try { mg = mergeGeometries(geos, false); } catch (e) { mg = null; }
    geos.forEach(g => g.dispose());
    if (!mg) continue;
    const o0 = list[0];
    const mesh = new THREE.Mesh(mg, o0.material); mesh.castShadow = o0.castShadow; mesh.receiveShadow = o0.receiveShadow; mesh.renderOrder = o0.renderOrder;
    mesh.userData.noAO = o0.userData.noAO; mesh.name = 'merged'; mesh.layers.mask = o0.layers.mask;
    root.add(mesh); added++;
    for (const o of list) { o.parent.remove(o); if (!o.geometry.userData.shared) o.geometry.dispose(); removed++; }
  }
  return { removed, added };
}
export function normalizeTree(root) { root.traverse(o => { if (!o.material) return; (Array.isArray(o.material) ? o.material : [o.material]).forEach(normalizeMaterial); }); }

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x1a1918, 1);
    // production: no shader info-log round trips (each one is a synchronous GPU query); ?debug re-enables them
    this.renderer.debug.checkShaderErrors = /[?&]debug\b/.test(location.search);
    initBaker(this.renderer);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(20, 1, 4, 900000);
    this.camera.position.set(-300, 220, 480);
    this.lens = { focal: 85, fstop: 8, shiftX: 0, shiftY: 0, dof: true };
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.085;
    this.controls.maxPolarAngle = Math.PI * 0.497; this.controls.minDistance = 40; this.controls.maxDistance = 6000;
    this.controls.autoRotateSpeed = 0.6; this.controls.zoomSpeed = 0.7; this.controls.panSpeed = 0.6;
    this.userMovedCamera = false;
    this.controls.addEventListener('start', () => { this.userMovedCamera = true; this._interacting = true; });
    this.controls.addEventListener('end', () => { this._interacting = false; });

    // production frame (Z up, box front = +Y) -> three.js (Y up, box front = +Z)
    this.root = new THREE.Group(); this.root.name = 'product';
    const M = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    this.root.quaternion.setFromRotationMatrix(M);
    this.scene.add(this.root);
    // the environment is built around the subject centre (0, 0, D/2)
    this.stage = new THREE.Group(); this.stage.name = 'stage'; this.scene.add(this.stage);
    this.envRoot = new THREE.Group(); this.envRoot.name = 'environment'; this.stage.add(this.envRoot);

    // lights (configured per environment)
    this.key = new THREE.DirectionalLight(0xffffff, 3);
    this.key.castShadow = true; this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00015; this.key.shadow.normalBias = 0.35; this.key.shadow.radius = 2; this.key.shadow.blurSamples = 12;
    this.stage.add(this.key); this.stage.add(this.key.target);
    this.fill = new THREE.DirectionalLight(0xffffff, 0); this.stage.add(this.fill); this.stage.add(this.fill.target);
    this.rim = new THREE.DirectionalLight(0xffffff, 0); this.stage.add(this.rim); this.stage.add(this.rim.target);
    this.interior = new THREE.PointLight(0xffe6c8, 0, 400, 2); this.scene.add(this.interior);   // opening animation glow
    // practical lights (candles, lamps) - a FIXED pool, so switching sets never changes the light count
    // (a different light count would force every shader program to recompile)
    this.practicals = [0, 1].map(() => { const L = new THREE.PointLight(0xffa050, 0, 0, 2); L.castShadow = false; this.stage.add(L); return L; });

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    // a black PMREM of the same size: first IBL bounce without changing shader defines
    const blk = new THREE.Scene(); blk.background = new THREE.Color(0x000000);
    this._blackEnv = this.pmrem.fromScene(blk, 0, 1, 10, { size: 256 });
    this.scene.environment = this._blackEnv.texture;
    this.scene.fog = new THREE.FogExp2(0xffffff, 0);                 // always present (constant shader defines)
    // transparent-render shadow catcher (only visible for alpha renders)
    this.shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.shadowCatcher.position.y = 0.02; this.shadowCatcher.receiveShadow = true; this.shadowCatcher.visible = false;   // added only for alpha renders
    this._initContactShadow();

    const det = detectTier(this.renderer); this.gpuName = det.gpu; this.autoTier = det.tier;
    this.qualityMode = 'auto'; this.quality = det.tier; this.q = QUALITY[det.tier]; setBakeScale(this.q.bake);
    this.key.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    this.flags = { ao: true, bloom: true, dof: true, film: true, shadows: true, ground: true };
    this.lightScale = 1.0; this.exposureMul = 1.0; this.lightMul = 1.0; this.baseExposure = 1.0;
    this.env = null; this.envState = null;
    this.tweens = []; this.onFrame = []; this.paused = false;
    this.maxSamples = this.q.samples; this.sample = 0; this._dirty = true; this._shadowDirty = true; this._csDirty = true;
    this.interScale = 1.0; this._frameTimes = []; this._lastMove = 0; this._lastRender = 0;
    this.subject = new THREE.Vector3(0, 0, 0); this.dims = { L: 211, D: 100.5, H: 45.5 };
    this.controls.addEventListener('change', () => { this._moved = true; });

    this._buildChains();
    this._resize();
    // coalesce resize bursts (window drags fire dozens of events) into one resize per animation frame
    let rz = 0; new ResizeObserver(() => { if (!rz) rz = requestAnimationFrame(() => { rz = 0; this._resize(); }); }).observe(canvas.parentElement);
    this._p0 = new THREE.Vector3(); this._q0 = new THREE.Quaternion();
    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  // ------------------------------------------------------------------ render chains
  _buildChains() {
    const make = (final) => {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(this.renderer, rt);
      c.renderPass = new RenderPass(this.scene, this.camera); c.addPass(c.renderPass);
      if (final) {
        c.gtao = new GTAOPass(this.scene, this.camera, 4, 4);
        c.gtao.output = GTAOPass.OUTPUT.Default;
        c.gtao.updateGtaoMaterial({ radius: 14, distanceExponent: 1.4, thickness: 3.0, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
        c.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
        c.gtao.blendIntensity = 0.9;
        const ov = c.gtao._overrideVisibility.bind(c.gtao);
        c.gtao._overrideVisibility = function () { ov(); this.scene.traverse(o => { if (o.userData.noAO) o.visible = false; }); };
        c.addPass(c.gtao);
        c.accum = new AccumPass(); c.addPass(c.accum);
      }
      c.output = new OutputPass(); c.addPass(c.output);
      c.finish = finishPass(); c.addPass(c.finish);
      return c;
    };
    this.inter = make(false); this.final = make(true);
  }
  /** effective pixel ratio: DPR, tier cap and pixel budget */
  _pr(cap, budgetMP) { const { w, h } = this.viewSize; return Math.max(0.5, Math.min(this.dpr, cap, Math.sqrt(budgetMP * 1e6 / Math.max(1, w * h)))); }
  _sizeChains() {
    const { w, h } = this.viewSize;
    const prF = this._pr(this.q.prCap, this.q.maxMP);
    this.final.setPixelRatio(prF); this.final.setSize(w, h);
    // GTAO at half resolution is visually identical after the Poisson denoise and costs a quarter
    this.final.gtao.setSize(Math.max(2, Math.round(w * prF / 2)), Math.max(2, Math.round(h * prF / 2)));
    const prI = Math.max(0.5, this._pr(this.q.interCap, this.q.maxMP * 0.7) * this.interScale);
    this.inter.setPixelRatio(prI); this.inter.setSize(w, h);
    this.sample = 0;
  }
  /** mode: 'auto' | 'high' | 'medium' | 'performance' */
  setQuality(mode) {
    this.qualityMode = mode;
    const tier = mode === 'auto' ? this.autoTier : (QUALITY[mode] ? mode : 'medium');
    this.quality = tier; this.q = QUALITY[tier]; this.maxSamples = this.q.samples; setBakeScale(this.q.bake);
    const s = this.q.shadow; if (this.key.shadow.mapSize.x !== s) { this.key.shadow.mapSize.set(s, s); if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; } }
    this._fitShadowBias();
    this._samplePace = []; this._sizeChains(); this.invalidate(true);
    if (this.onQuality) this.onQuality(tier);
  }
  setAO(on) { this.flags.ao = on; this.invalidate(); }
  setDOF(on) { this.flags.dof = on; this.invalidate(); }
  setFilm(on) { this.flags.film = on; this.invalidate(); }
  setFilmStrength() { }
  setBloom(on) { this.flags.bloom = on; this.invalidate(); }

  /** something visible changed: restart accumulation (geometry=true also refreshes shadows) */
  invalidate(geometry = false) { this._dirty = true; this.sample = 0; if (geometry) { this._shadowDirty = true; this._csDirty = true; } }
  productChanged() { this.invalidate(true); }

  // ------------------------------------------------------------------ contact shadow (cached blurred depth from below)
  _initContactShadow() {
    const W = 1100, H = 900, CAM_H = 260;
    const g = new THREE.Group(); g.position.y = 0.04; g.name = 'contactShadow';
    this.cs = { w: W, h: H, group: g, blur: 2.2, darkness: 1.0, opacity: 0.6 };
    this.cs.rt = new THREE.WebGLRenderTarget(512, 512); this.cs.rt.texture.generateMipmaps = false;
    this.cs.rtBlur = new THREE.WebGLRenderTarget(512, 512); this.cs.rtBlur.texture.generateMipmaps = false;
    const pg = new THREE.PlaneGeometry(W, H).rotateX(Math.PI / 2);
    this.cs.plane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: this.cs.rt.texture, opacity: this.cs.opacity, transparent: true, depthWrite: false, toneMapped: false, color: 0x000000 }));
    this.cs.plane.material.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 csT = texture2D( map, vMapUv ); diffuseColor = vec4( 0.0, 0.0, 0.0, csT.a * opacity );'); };
    this.cs.plane.renderOrder = 1; this.cs.plane.scale.y = -1; this.cs.plane.userData.noAO = true; g.add(this.cs.plane);
    this.cs.blurPlane = new THREE.Mesh(pg); this.cs.blurPlane.visible = false; g.add(this.cs.blurPlane);
    this.cs.cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0, CAM_H); this.cs.cam.rotation.x = Math.PI / 2; g.add(this.cs.cam);
    this.cs.cam.layers.set(1);
    const dm = new THREE.MeshDepthMaterial(); dm.userData.darkness = { value: this.cs.darkness };
    dm.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = dm.userData.darkness;
      // occlusion of the lowest surface above each point, falling off with its height above the support
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'float k = pow(1.0 - fragCoordZ, 2.6) * darkness; gl_FragColor = vec4( vec3( 0.0 ), k );');
    };
    dm.depthTest = true; dm.depthWrite = true; this.cs.depthMat = dm;
    this.cs.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader); this.cs.hBlur.depthTest = false;
    this.cs.vBlur = new THREE.ShaderMaterial(VerticalBlurShader); this.cs.vBlur.depthTest = false;
    this.stage.add(g);
  }
  _renderContactShadow() {
    const cs = this.cs; if (!cs.group.visible) return;
    const bg = this.scene.background; this.scene.background = null;
    const envVis = this.envRoot.visible; this.envRoot.visible = false;
    this.scene.overrideMaterial = cs.depthMat;
    const prevClear = new THREE.Color(); this.renderer.getClearColor(prevClear); const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setRenderTarget(cs.rt); this.renderer.clear(); this.renderer.render(this.scene, cs.cam);
    this.scene.overrideMaterial = null;
    const blur = (amount) => {
      cs.blurPlane.visible = true;
      cs.blurPlane.material = cs.hBlur; cs.hBlur.uniforms.tDiffuse.value = cs.rt.texture; cs.hBlur.uniforms.h.value = amount / 256;
      this.renderer.setRenderTarget(cs.rtBlur); this.renderer.clear(); this.renderer.render(cs.blurPlane, cs.cam);
      cs.blurPlane.material = cs.vBlur; cs.vBlur.uniforms.tDiffuse.value = cs.rtBlur.texture; cs.vBlur.uniforms.v.value = amount / 256;
      this.renderer.setRenderTarget(cs.rt); this.renderer.clear(); this.renderer.render(cs.blurPlane, cs.cam);
      cs.blurPlane.visible = false;
    };
    blur(cs.blur); blur(cs.blur * 0.5); blur(cs.blur * 0.25);
    this.renderer.setRenderTarget(null); this.renderer.setClearColor(prevClear, prevAlpha);
    this.scene.background = bg; this.envRoot.visible = envVis;
  }
  /** objects that cast the contact shadow are on layer 1 */
  markShadowCasters() { normalizeTree(this.root); this.root.traverse(o => { o.layers.enable(1); if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); this.productChanged(); }
  /** compile the post-processing programs in the background (parallel compile) so the first settled frame does not stall */
  async warmPostprocessing() {
    if (this._warm) return; this._warm = true;
    const sc = new THREE.Scene(), mats = [];
    const g = this.final.gtao;
    for (const k of ['gtaoMaterial', 'pdMaterial', 'blendMaterial', 'normalMaterial', 'copyMaterial']) if (g[k]) mats.push(g[k]);
    mats.push(this.final.accum.blend, this.final.accum.copy, this.final.finish.mat, this.cs.hBlur, this.cs.vBlur);
    for (const m of mats) { const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); q.frustumCulled = false; sc.add(q); }
    try { await this._compileParallel(sc); } catch (e) { }
    sc.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }

  // ------------------------------------------------------------------ size
  _resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth || 800, h = el.clientHeight || 600;
    this.setSize(w, h, this.dpr);
  }
  setSize(w, h, pr) {
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.viewSize = { w, h, pr };
    this.camera.aspect = w / h;
    const keep = this.dpr; this.dpr = pr; this._sizeChains(); this.dpr = keep;
    this._applyLens();
    this.invalidate();
  }

  // ------------------------------------------------------------------ lens / projection
  setLens({ focal, fstop, shiftX, shiftY } = {}) {
    if (focal !== undefined) this.lens.focal = focal;
    if (fstop !== undefined) this.lens.fstop = fstop;
    if (shiftX !== undefined) this.lens.shiftX = shiftX;
    if (shiftY !== undefined) this.lens.shiftY = shiftY;
    this._applyLens(); this.invalidate();
  }
  _applyLens(jx = 0, jy = 0, ax = 0, ay = 0, focusDist = 1) {
    const cam = this.camera;
    cam.fov = focalToVFov(this.lens.focal, cam.aspect);
    cam.updateProjectionMatrix();
    const e = cam.projectionMatrix.elements;
    e[8] -= this.lens.shiftX; e[9] -= this.lens.shiftY;          // image moves by +shift (NDC): shiftY < 0 = subject lower
    if (ax || ay) { e[8] += -e[0] * ax / focusDist; e[9] += -e[5] * ay / focusDist; }
    if (jx || jy) { const W = this.viewSize ? this.viewSize.w * this.viewSize.pr : 1000, H = this.viewSize ? this.viewSize.h * this.viewSize.pr : 1000; e[8] += jx * 2 / W; e[9] += jy * 2 / H; }
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  }
  focusDistance() {
    const f = new THREE.Vector3(); this.camera.getWorldDirection(f);
    return Math.max(30, this.controls.target.clone().sub(this.camera.position).dot(f));
  }

  // ------------------------------------------------------------------ environments
  refreshEnvironment() { if (this.env) { const d = this.env; this.env = null; this.setEnvironment(d.id); } }
  _disposeEnv() {
    const keep = new Set();
    this.envRoot.traverse(o => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) { if (m.userData.shared) continue; for (const k of ['map', 'normalMap', 'roughnessMap', 'alphaMap', 'emissiveMap', 'metalnessMap', 'aoMap', 'bumpMap']) { const t = m[k]; if (t && !t.userData.shared && !keep.has(t)) { t.dispose(); keep.add(t); } } m.dispose(); }
    });
    this.envRoot.clear();
    if (this.envState && this.envState.dispose) this.envState.dispose();
    purgeBakeCache();                                         // the previous set's procedural textures
    clearMaterialCache();
  }
  async setEnvironment(id) {
    const def = typeof id === 'string' ? envById(id) : id;
    if (this.env && this.env.id === def.id) return;
    const T0 = performance.now();
    this._disposeEnv();
    const st = def.build(envContext(this));
    const T1 = performance.now();
    this.env = def; this.envState = st;
    normalizeTree(st.root);
    if (/[?&]debug\b/.test(location.search)) this.lastAudit = auditScale(st.root, THREE);   // before merging (needs prop groups)
    this.lastMerge = mergeStatic(st.root);
    this.envRoot.add(st.root);
    if (st.fog) { this.scene.fog.color.copy(st.fog.color); this.scene.fog.density = st.fog.density; } else this.scene.fog.density = 0;
    this.practicals.forEach((L, i) => { const p = (st.practicals || [])[i]; if (p) { L.position.copy(p.pos); L.color.setRGB(...lightColor(p.kelvin || 1900, st.wb || 5600)); L.intensity = p.intensity; L.distance = p.distance || 0; } else L.intensity = 0; });
    this.scene.background = st.background !== undefined ? new THREE.Color(st.background) : null;
    this.baseExposure = st.exposure;
    // light rig
    const wb = st.wb || 5600;
    const setDir = (L, d) => {
      if (!d) { L.intensity = 0; L.userData.base = 0; L.userData.dir = L.userData.dir || new THREE.Vector3(0, 1, 0); return; }
      const az = d.az * Math.PI / 180, el = d.el * Math.PI / 180;
      L.userData.dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
      L.userData.angle = (d.angle || 0) * Math.PI / 180;
      L.color.setRGB(...lightColor(d.kelvin || wb, wb)); L.userData.base = d.intensity;
    };
    setDir(this.key, st.key); setDir(this.fill, st.fill); setDir(this.rim, st.rim);
    this.key.castShadow = this.flags.shadows;
    const ext = (st.key && st.key.extent) || 900;
    const sc = this.key.shadow.camera; sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 100; sc.far = 9000; sc.updateProjectionMatrix();
    this.key.shadow.radius = (st.key && st.key.pcf) || 2;
    this._shadowExtent = ext; this._fitShadowBias();
    this._placeLights();
    this.cs.plane.material.opacity = st.contact !== undefined ? st.contact : 0.6;
    this.cs.blur = st.contactBlur || 2.2;
    this.applyLight();
    // compile every new shader program in parallel (KHR_parallel_shader_compile) instead of stalling the page
    await this.compileScene();
    const T2 = performance.now();
    this.captureEnvironment();
    this.productChanged();
    this.envTiming = { build: Math.round(T1 - T0), compile: Math.round(T2 - T1), capture: Math.round(performance.now() - T2) };
  }
  _placeLights(jitterIndex = -1) {
    for (const L of [this.key, this.fill, this.rim]) {
      if (!L.userData.dir) continue;
      let d = L.userData.dir.clone();
      if (L === this.key && jitterIndex >= 0 && L.userData.angle > 0) {
        // sample the light's disc (angular radius) - Vogel spiral
        const r = Math.sqrt((jitterIndex + 0.5) / this.maxSamples) * L.userData.angle, a = jitterIndex * 2.39996;
        const t1 = new THREE.Vector3(0, 1, 0).cross(d).normalize(); if (t1.lengthSq() < 1e-6) t1.set(1, 0, 0);
        const t2 = d.clone().cross(t1).normalize();
        d.addScaledVector(t1, Math.cos(a) * Math.tan(r)).addScaledVector(t2, Math.sin(a) * Math.tan(r)).normalize();
      }
      L.target.position.set(0, 0, 0);
      L.position.copy(d).multiplyScalar(4000);
    }
  }
  /** compile all programs of the current scene in parallel, without letting the render loop compile them synchronously */
  /** critical path: create all programs now (they finish compiling on the first frame, while the overlay is up) */
  async compileScene(scene = this.scene) {
    try { this.renderer.compile(scene, this.camera); } catch (e) { console.warn(e); }
    await new Promise(r => { if (document.hidden) setTimeout(r, 0); else requestAnimationFrame(() => r()); });   // never stall in a background tab
  }
  /** renderer.compile + poll KHR_parallel_shader_compile completion, flushing so the GPU process actually starts
   *  (three's compileAsync never resolves in Chromium while nothing else is being rendered: nothing flushes) */
  _compileParallel(scene) {
    const R = this.renderer, gl = R.getContext();
    const mats = R.compile(scene, this.camera);
    const t0 = performance.now();
    return new Promise((resolve) => {
      const poll = () => {
        gl.flush();
        for (const m of mats) { const p = R.properties.get(m).currentProgram; if (!p || p.isReady()) mats.delete(m); }
        if (!mats.size || performance.now() - t0 > 20000) resolve(); else setTimeout(poll, 60);
      };
      poll();
    });
  }
  /** shadow bias in world units = about one shadow-map texel (grazing suns need it; the old 4096-sized value acned at 2048) */
  _fitShadowBias() { const texel = 2 * (this._shadowExtent || 900) / this.key.shadow.mapSize.x; this.key.shadow.normalBias = texel * 1.1; this.key.shadow.bias = -0.0002; }
  /** IBL from the set itself: two bounces, product hidden */
  captureEnvironment() {
    if (!this.envState) return;
    const vis = { root: this.root.visible, cs: this.cs.group.visible, sc: this.shadowCatcher.visible, int: this.interior.intensity };
    this.root.visible = false; this.cs.group.visible = false; this.shadowCatcher.visible = false; this.interior.intensity = 0;
    // transmissive objects are left out of the capture: three allocates a transmission render target per camera and
    // PMREMGenerator uses a fresh cube camera per call, so glass in the capture leaked two render targets each time
    // (and glass adds nothing measurable to the room's irradiance)
    const glass = []; this.envRoot.traverse(o => { if (o.visible && o.material && !Array.isArray(o.material) && o.material.transmission > 0) { glass.push(o); o.visible = false; } });
    if (this.envState.onCapture) this.envState.onCapture(true);
    const pos = new THREE.Vector3(this.subject.x, (this.dims.H || 45) * 0.6, this.subject.z);
    this.renderer.shadowMap.needsUpdate = true;
    if (this._envRT) { this._envRT.dispose(); this._envRT = null; }
    this.scene.environment = this._blackEnv.texture;
    const size = 256;
    let rt = this.pmrem.fromScene(this.scene, 0, 8, 900000, { size, position: pos });
    this.scene.environment = rt.texture;
    const rt2 = this.pmrem.fromScene(this.scene, 0, 8, 900000, { size, position: pos });   // second bounce
    rt.dispose(); rt = rt2;
    this.scene.environment = rt.texture; this._envRT = rt;
    this.scene.environmentIntensity = 1.0;
    if (this.envState.onCapture) this.envState.onCapture(false);
    for (const o of glass) o.visible = true;
    this.root.visible = vis.root; this.cs.group.visible = vis.cs; this.shadowCatcher.visible = vis.sc; this.interior.intensity = vis.int;
    this.invalidate(true);
  }
  applyLight() {
    const s = this.lightScale * this.lightMul;
    for (const L of [this.key, this.fill, this.rim]) L.intensity = (L.userData.base || 0) * s;
    this.renderer.toneMappingExposure = this.baseExposure * this.exposureMul;
    this.invalidate();
  }
  setLight(scale) { this.lightScale = scale; this.applyLight(); }
  setExposure(v) { this.exposureMul = v; this.applyLight(); }
  /** transient multipliers used by animations */
  setAnimLight(lightMul = 1, exposureMul = 1, interior = 0) {
    if (this.lightMul === lightMul && this._expAnim === exposureMul && this._intAnim === interior) return;
    this.lightMul = lightMul; this._expAnim = exposureMul; this._intAnim = interior;
    this.interior.intensity = interior * 2200;
    const s = this.lightScale * this.lightMul;
    for (const L of [this.key, this.fill, this.rim]) L.intensity = (L.userData.base || 0) * s;
    this.renderer.toneMappingExposure = this.baseExposure * this.exposureMul * exposureMul;
    this.invalidate();
  }
  setGround(on) { this.flags.ground = on; this.envRoot.visible = on; this.cs.group.visible = true; this.scene.background = on ? null : new THREE.Color(0xd9d6d1); this.invalidate(true); }
  setShadows(on) { this.flags.shadows = on; this.key.castShadow = on; this.scene.traverse(o => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.needsUpdate = true); } }); this.invalidate(true); }
  setAutoRotate(on) { this.controls.autoRotate = on; this.invalidate(); }
  setBackgroundVisible(on) { this.envRoot.visible = on; this.invalidate(); }

  /** subject (box) dimensions: centre the stage on the box footprint */
  setSubject(dims) {
    this.dims = dims;
    this.subject.set(0, 0, dims.D / 2);
    this.stage.position.copy(this.subject);
    this.interior.position.set(0, dims.H * 0.9, dims.D * 0.45);
    this._placeLights();
    this.productChanged();
  }

  // ------------------------------------------------------------------ cameras
  productBounds() {
    const b = new THREE.Box3(); this.root.updateMatrixWorld(true);
    this.root.traverse(o => { if (o.isMesh && o.visible && o.geometry) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); b.union(bb); } });
    return b;
  }
  regionBounds(region) {
    const b = this.productBounds(); if (b.isEmpty()) return b;
    const d = this.dims;
    if (region === 'logo') {                                   // front-left third of the lid: AYGIS wordmark + foil
      return new THREE.Box3(new THREE.Vector3(-d.L * 0.42, d.H * 0.75, d.D * 0.15), new THREE.Vector3(d.L * 0.02, d.H, d.D * 0.95));
    }
    if (region === 'tray') {
      return new THREE.Box3(new THREE.Vector3(-d.L * 0.36, d.H * 0.2, d.D * 0.12), new THREE.Vector3(d.L * 0.12, d.H * 1.1, d.D * 0.9));
    }
    return b;
  }
  /** pure camera placement for a named preset (no animation) -> {pos, target, focal, fstop, shiftY} */
  cameraFor(dims, name = 'hero', aspect = this.camera.aspect) {
    const env = this.envState && this.envState.cams && this.envState.cams[name];
    const c = { ...(CAMS[name] || CAMS.hero), ...(env || {}) };
    const box = c.region ? this.regionBounds(c.region) : this.productBounds();
    if (box.isEmpty()) box.set(new THREE.Vector3(-dims.L / 2, 0, 0), new THREE.Vector3(dims.L / 2, dims.H, dims.D));
    const ctr = box.getCenter(new THREE.Vector3());
    const target = c.region ? ctr : new THREE.Vector3(0, dims.H * (c.ty ?? 0.5), dims.D / 2);
    const az = c.az * Math.PI / 180, el = c.el * Math.PI / 180;
    const dir = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    // fit: every corner of the subject box inside `fill` of the frame (exact perspective fit)
    const vfov = focalToVFov(c.focal, aspect) * Math.PI / 180;
    const tv = Math.tan(vfov / 2), th = tv * aspect;
    const fwd = dir.clone().negate();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)); if (right.lengthSq() < 1e-8) right.set(1, 0, 0); right.normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const sy = c.shiftY || 0;
    // corner at lateral offset x, y and depth z beyond the target (along the view axis) projects to
    // x / ((d + z) tan) -> it fits in `fill` of the half-frame when d >= x / (tan * fill) - z.  Lens shift moves the
    // whole image and does not change the distance.
    let dist = 0;
    for (let i = 0; i < 8; i++) {
      const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(target);
      const x = Math.abs(p.dot(right)), y = Math.abs(p.dot(up)), z = p.dot(fwd);
      dist = Math.max(dist, x / (th * c.fill) - z, y / (tv * c.fill) - z);
    }
    dist = Math.max(dist, 60);
    return { pos: target.clone().addScaledVector(dir, dist), target, focal: c.focal, fstop: c.fstop, shiftY: sy };
  }
  frame(dims, presetName = 'hero', animate = true) {
    const c = this.cameraFor(dims, presetName);
    this.userMovedCamera = false;
    this.home = { pos: c.pos.clone(), target: c.target.clone(), focal: c.focal, fstop: c.fstop, shiftY: c.shiftY };
    return this.moveCamera(c.pos, c.target, animate ? 950 : 0, c);
  }
  moveCamera(pos, target, dur = 800, lens = null) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const f0 = this.lens.focal, s0 = this.lens.shiftY;
    const f1 = lens && lens.focal ? lens.focal : f0, s1 = lens && lens.shiftY !== undefined ? lens.shiftY : s0;
    if (lens && lens.fstop) this.lens.fstop = lens.fstop;
    if (!dur) { this.camera.position.copy(pos); this.controls.target.copy(target); this.lens.focal = f1; this.lens.shiftY = s1; this._applyLens(); this.controls.update(); this.invalidate(); return Promise.resolve(); }
    return this.tween(dur, (k) => {
      // interpolate the field of view logarithmically so a zoom feels linear
      this.lens.focal = Math.exp(Math.log(f0) + (Math.log(f1) - Math.log(f0)) * k); this.lens.shiftY = s0 + (s1 - s0) * k; this._applyLens();
      this.camera.position.lerpVectors(p0, pos, k); this.controls.target.lerpVectors(t0, target, k);
    });
  }
  setCamera(pos, target, lens) {
    this.camera.position.copy(pos); this.controls.target.copy(target); this.camera.lookAt(target);
    if (lens) { if (lens.focal) this.lens.focal = lens.focal; if (lens.fstop) this.lens.fstop = lens.fstop; if (lens.shiftY !== undefined) this.lens.shiftY = lens.shiftY; this._applyLens(); }
    this.invalidate();
  }

  tween(dur, fn, ease = easeInOut) { return new Promise((res) => { this.tweens.push({ t0: performance.now(), dur, fn, ease, res }); }); }
  cancelTweens() { for (const t of this.tweens) t.res(); this.tweens = []; }

  // ------------------------------------------------------------------ frame rendering
  _prepare(final) {
    this.renderer.toneMappingExposure = this.baseExposure * this.exposureMul * (this._expAnim ?? 1);
    // the contact shadow is soft and low-frequency: while animating it is refreshed every other frame
    if (this._csDirty && (final || (this._csTick = !this._csTick))) { this._renderContactShadow(); this._csDirty = false; }
    const c = final ? this.final : this.inter;
    if (final) {
      c.gtao.enabled = this.flags.ao && this.q.ao;
    }
    const tanHalf = Math.tan(this.camera.fov * Math.PI / 360);
    c.finish.enabled = this.flags.film;
    c.finish.mat.uniforms.vig.value = 0.55; c.finish.mat.uniforms.grain.value = final ? 0.012 : 0.0;
    c.finish.mat.uniforms.aspect.value = this.camera.aspect; c.finish.mat.uniforms.tanHalf.value = tanHalf;
    return c;
  }
  /** interactive frame: adaptive resolution, no accumulation */
  renderFrame(updateControls = true) {
    if (updateControls) this.controls.update();
    if (this._shadowDirty) { this._placeLights(); this.renderer.shadowMap.needsUpdate = true; this._shadowDirty = false; }
    this._applyLens();
    const c = this._prepare(false);
    c.render();
  }
  /** one accumulation sample of the final chain (sample index n) */
  _renderSample(n) {
    const c = this._prepare(true);
    if (n === 0) c.accum.n = 0;
    const jitter = n > 0;
    const jx = jitter ? halton(n + 1, 2) - 0.5 : 0, jy = jitter ? halton(n + 1, 3) - 0.5 : 0;
    // thin lens: entrance pupil radius = f / 2N (world mm, full-frame equivalent)
    let ax = 0, ay = 0; const fd = this.focusDistance();
    if (jitter && this.flags.dof && this.lens.fstop > 0 && this.maxSamples > 1) {
      const R = this.lens.focal / (2 * this.lens.fstop);
      const r = Math.sqrt(halton(n, 5)) * R, a = halton(n, 7) * Math.PI * 2;
      ax = Math.cos(a) * r; ay = Math.sin(a) * r;
    }
    const savedPos = this.camera.position.clone();
    if (ax || ay) {
      this.camera.updateMatrixWorld();
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
      this.camera.position.addScaledVector(right, ax).addScaledVector(up, ay);
    }
    this._applyLens(jx, jy, ax, ay, fd);
    // area light: jitter the key direction over its angular size (re-render the shadow map)
    if (this.key.castShadow && this.key.userData.angle > 0 && jitter) { this._placeLights(n); this.renderer.shadowMap.needsUpdate = true; }
    else if (this._shadowDirty || n === 0) { this._placeLights(); this.renderer.shadowMap.needsUpdate = true; this._shadowDirty = false; }
    this.camera.updateMatrixWorld();
    c.render();
    this.camera.position.copy(savedPos); this.camera.updateMatrixWorld();
    this._applyLens();
  }
  _tick(now) {
    if (this.paused) return;
    let anim = false;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; const k = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(tw.ease(k)); anim = true;
      if (k >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
    for (const f of this.onFrame) if (f(now)) anim = true;
    this._moved = false;
    const p0 = this._p0.copy(this.camera.position), q0 = this._q0.copy(this.camera.quaternion);
    this.controls.update();
    if (this._moved && !this._interacting && !anim && !this.controls.autoRotate) {
      // end the damping tail once it is visually irrelevant (< ~0.3 px), so accumulation can start
      const rel = p0.distanceTo(this.camera.position) / Math.max(1, this.controls.getDistance()), rot = 1 - Math.abs(q0.dot(this.camera.quaternion));
      if (rel < 1.5e-4 && rot < 1e-8) { const c = this.controls; c._sphericalDelta.set(0, 0, 0); c._panOffset.set(0, 0, 0); this._moved = false; }
    }
    const moving = anim || this._moved || this.controls.autoRotate;
    if (moving) {
      if (this._lastRender) { this._frameTimes.push(now - this._lastRender); if (this._frameTimes.length > 12) this._frameTimes.shift(); }
      this._adapt(now);
      this.renderFrame(false); this._lastRender = now; this._lastMove = now;
      this.sample = 0; this._dirty = false;
      if (this.onRendered) this.onRendered('interactive');
      return;
    }
    this._lastRender = 0;
    // settle 80 ms after the last movement, then accumulate
    if (now - this._lastMove < 80) return;
    if (this.sample < this.maxSamples || this._dirty) {
      if (this._dirty) { this.sample = 0; this._dirty = false; }
      this._renderSample(this.sample); this.sample++;
      this._pace(now);
      if (this.sample >= this.maxSamples && this.key.userData.angle > 0) this._shadowDirty = true;   // un-jitter the key for the next frame
      if (this.onRendered) this.onRendered(this.sample >= this.maxSamples ? 'converged' : 'refining');
    }
  }
  /** Auto mode: if settled samples arrive slower than ~9 per second on this device, step down one tier (once) */
  _pace(now) {
    if (this.qualityMode !== 'auto' || this._downgraded) return;
    const p = this._samplePace || (this._samplePace = []);
    if (this.sample === 1) { p.length = 0; p.push(now); return; }
    p.push(now);
    if (p.length >= 9) {
      const dt = (p[p.length - 1] - p[0]) / (p.length - 1); p.length = 0;
      if (dt > 110 && this.autoTier !== 'performance') { this._downgraded = true; this.autoTier = this.autoTier === 'high' ? 'medium' : 'performance'; this.setQuality('auto'); }
    }
  }
  _adapt(now) {
    if (now - (this._lastAdapt || 0) < 900 || this._frameTimes.length < 8) return;
    const avg = this._frameTimes.reduce((a, b) => a + b, 0) / this._frameTimes.length;
    let s = this.interScale;
    if (avg > 34 && s > 0.5) s = Math.max(0.5, s - 0.15); else if (avg < 19 && s < 1) s = Math.min(1, s + 0.1);
    if (s !== this.interScale) { this.interScale = s; const prI = Math.max(0.5, this._pr(this.q.interCap, this.q.maxMP * 0.7) * s); this.inter.setPixelRatio(prI); this.inter.setSize(this.viewSize.w, this.viewSize.h); }
    this._lastAdapt = now; this._frameTimes = [];
  }
  /** render n accumulated samples synchronously (stills, video frames) */
  renderAccumulated(n = this.maxSamples) {
    const keep = this.maxSamples; this.maxSamples = Math.max(1, n);
    this.controls.update();
    for (let i = 0; i < this.maxSamples; i++) this._renderSample(i);
    this.sample = this.maxSamples; this._dirty = false;
    this.maxSamples = keep;
  }

  pick(clientX, clientY, objects) {
    const r = this.canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this._applyLens();
    const rc = new THREE.Raycaster(); rc.setFromCamera(nd, this.camera);
    return rc.intersectObjects(objects, false)[0] || null;
  }

  // ------------------------------------------------------------------ still render
  /**
   * Render a still at an explicit pixel size. opts: {width, height, transparent, hideGround, samples}
   * Returns a Promise<Blob> (PNG).  The viewport is restored afterwards.
   */
  async renderStill({ width, height, transparent = false, hideGround = false, samples = 96 }) {
    const prev = { ...this.viewSize }; const prevQ = this.q;
    this.q = { ...QUALITY.high, maxMP: 64, prCap: 1 };            // exports render at the requested size, full quality
    const vis = { env: this.envRoot.visible, bg: this.scene.background, sc: this.shadowCatcher.visible, fog: this.scene.fog.density };
    this.paused = true;
    try {
      this.setSize(width, height, 1);
      if (transparent) { this.envRoot.visible = false; this.scene.background = null; this.scene.fog.density = 0; this.stage.add(this.shadowCatcher); this.shadowCatcher.visible = true; this.renderer.setClearColor(0x000000, 0); }
      else if (hideGround) { this.envRoot.visible = false; this.scene.background = new THREE.Color(0xd9d6d1); }
      this._renderContactShadow();
      // spread the work over animation frames so the browser stays responsive
      const keep = this.maxSamples; this.maxSamples = samples;
      // yield between batches of samples, but never after the last one: the drawing buffer is not preserved, so the
      // PNG must be read in the same task as the final sample
      for (let i = 0; i < samples; i++) { this._renderSample(i); if (i % 8 === 7 && i < samples - 1) await new Promise(r => setTimeout(r, 0)); }
      this.maxSamples = keep;
      const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
      return blob;
    } finally {
      this.envRoot.visible = vis.env; this.scene.background = vis.bg; this.shadowCatcher.visible = false; this.stage.remove(this.shadowCatcher); this.scene.fog.density = vis.fog;
      this.renderer.setClearColor(0x1a1918, 1);
      this.q = prevQ;
      this.setSize(prev.w, prev.h, prev.pr);
      this.paused = false; this.invalidate();
    }
  }
  screenshot() { this.renderAccumulated(Math.min(this.maxSamples, 32)); return this.canvas.toDataURL('image/png'); }
}
