// Scene, lighting, environments, post-processing, cameras, still-render export and the render loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js';
import { envById, propContext } from './environments.js';

export const CAMS = {
  hero: { dir: [-0.62, 0.62, 1.0], zoom: 0.86, targetY: 0.55 },
  front: { dir: [0.0, 0.30, 1.0], zoom: 1.0, targetY: 0.5 },
  top: { dir: [0.0, 1.0, 0.0001], zoom: 0.95, targetY: 0.5 },
  side: { dir: [1.0, 0.42, 0.25], zoom: 1.0, targetY: 0.5 },
  open: { dir: [-0.45, 0.78, 1.0], zoom: 0.92, targetY: 1.1 },
  interior: { dir: [0.0, 1.0, 0.35], zoom: 0.78, targetY: 0.8 },
  detail: { dir: [-0.35, 0.72, 1.0], zoom: 0.36, targetY: 1.0 },
  back: { dir: [-0.5, 0.55, -1.0], zoom: 1.0, targetY: 0.5 },
};
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.pixelRatio = Math.min(window.devicePixelRatio, 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 2, 12000);
    this.camera.position.set(-300, 320, 480);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495; this.controls.minDistance = 35; this.controls.maxDistance = 3000;
    this.controls.autoRotateSpeed = 0.7;
    this.userMovedCamera = false;
    this.controls.addEventListener('start', () => { this.userMovedCamera = true; });

    // production frame (Z up, box front = +Y) -> three.js (Y up, box front = +Z)
    this.root = new THREE.Group();
    const M = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    this.root.quaternion.setFromRotationMatrix(M);
    this.scene.add(this.root);

    // lights
    this.key = new THREE.DirectionalLight(0xfff4e6, 2.5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004; this.key.shadow.normalBias = 1.6;
    const sc = this.key.shadow.camera; sc.near = 50; sc.far = 3000; sc.left = -360; sc.right = 360; sc.top = 360; sc.bottom = -360;
    this.scene.add(this.key); this.scene.add(this.key.target);
    this.fill = new THREE.DirectionalLight(0xdfe8ff, 0.9); this.scene.add(this.fill);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8a7f70, 0.25); this.scene.add(this.hemi);
    this.interior = new THREE.PointLight(0xffe6c8, 0, 400, 2); this.scene.add(this.interior);   // used by the opening animation

    // ground + props + contact shadow
    this.pmrem = new THREE.PMREMGenerator(this.renderer); this.pmrem.compileEquirectangularShader();
    this.ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 128), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.03; this.ground.receiveShadow = true; this.ground.name = 'ground';
    this.scene.add(this.ground);
    this.shadowCatcher = new THREE.Mesh(new THREE.CircleGeometry(3000, 128), new THREE.ShadowMaterial({ opacity: 0.5 }));
    this.shadowCatcher.rotation.x = -Math.PI / 2; this.shadowCatcher.position.y = -0.015; this.shadowCatcher.receiveShadow = true; this.shadowCatcher.name = 'shadowCatcher';
    this.scene.add(this.shadowCatcher);
    this.props = new THREE.Group(); this.props.name = 'props'; this.scene.add(this.props);
    this.propCtx = propContext();
    this._initContactShadow();

    // post-processing
    this.quality = 'high';
    this._initComposer();

    this.lightScale = 1.0; this.exposureMul = 1.0; this.lightMul = 1.0; this.baseExposure = 1.0;
    this.env = null;
    this.setEnvironment('studio');
    this.tweens = [];
    this.onFrame = [];
    this.paused = false;
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  // ------------------------------------------------------------ composer / quality
  _initComposer() {
    const size = new THREE.Vector2(); this.renderer.getSize(size);
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.updateGtaoMaterial({ radius: 16, distanceExponent: 1.0, thickness: 4.0, scale: 1.25, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
    this.gtao.blendIntensity = 0.85;
    this.bloom = new UnrealBloomPass(size, 0.12, 0.6, 0.92);
    this.dof = new BokehPass(this.scene, this.camera, { focus: 500, aperture: 0.00003, maxblur: 0.0085 });
    this.outputPass = new OutputPass();
    this.film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, vignette: { value: 0.32 }, grain: { value: 0.028 }, aberration: { value: 0.0012 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time, vignette, grain, aberration; varying vec2 vUv;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453 + time); }
        void main(){ vec2 d = vUv - 0.5; float r2 = dot(d,d);
          vec3 c; c.r = texture2D(tDiffuse, vUv + d * aberration * r2 * 4.0).r; c.g = texture2D(tDiffuse, vUv).g; c.b = texture2D(tDiffuse, vUv - d * aberration * r2 * 4.0).b;
          float v = 1.0 - vignette * smoothstep(0.15, 0.85, r2 * 2.2);
          float g = (hash(vUv * 1000.0) - 0.5) * grain;
          gl_FragColor = vec4(c * v + g, 1.0); }`,
    });
    this.composer.addPass(this.renderPass); this.composer.addPass(this.gtao); this.composer.addPass(this.dof); this.composer.addPass(this.bloom); this.composer.addPass(this.outputPass); this.composer.addPass(this.film);
    this.dof.enabled = false; this.film.enabled = true;
    this.setQuality('high');
  }
  /** 'high' = AO + bloom, 'standard' = AO only, 'fast' = direct render */
  setQuality(q) {
    this.quality = q;
    this.gtao.enabled = (q !== 'fast');
    this.bloom.enabled = (q === 'high');
  }
  setAO(on) { this.gtao.enabled = on && this.quality !== 'fast'; }
  setDOF(on) { this.dof.enabled = on && this.quality !== 'fast'; }
  setFilm(on) { this.film.enabled = on && this.quality !== 'fast'; }
  setFilmStrength(v) { this.film.uniforms.vignette.value = 0.32 * v; this.film.uniforms.grain.value = 0.028 * v; this.film.uniforms.aberration.value = 0.0012 * v; }
  setBloom(on) { this.bloom.enabled = on && this.quality !== 'fast'; }

  _initContactShadow() {
    const W = 1400, H = 1200, CAM_H = 300;
    const g = new THREE.Group(); g.position.y = -0.005; g.name = 'contactShadow';
    this.cs = { w: W, h: H, group: g, blur: 1.6, darkness: 1.35, opacity: 0.55 };
    this.cs.rt = new THREE.WebGLRenderTarget(1024, 1024); this.cs.rt.texture.generateMipmaps = false;
    this.cs.rtBlur = new THREE.WebGLRenderTarget(1024, 1024); this.cs.rtBlur.texture.generateMipmaps = false;
    const pg = new THREE.PlaneGeometry(W, H).rotateX(Math.PI / 2);
    this.cs.plane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: this.cs.rt.texture, opacity: this.cs.opacity, transparent: true, depthWrite: false, toneMapped: false }));
    this.cs.plane.renderOrder = 1; this.cs.plane.scale.y = -1; g.add(this.cs.plane);
    this.cs.blurPlane = new THREE.Mesh(pg); this.cs.blurPlane.visible = false; g.add(this.cs.blurPlane);
    this.cs.cam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0, CAM_H); this.cs.cam.rotation.x = Math.PI / 2; g.add(this.cs.cam);
    this.cs.cam.layers.set(1);
    const dm = new THREE.MeshDepthMaterial(); dm.userData.darkness = { value: this.cs.darkness };
    dm.onBeforeCompile = (shader) => {
      shader.uniforms.darkness = dm.userData.darkness;
      shader.fragmentShader = 'uniform float darkness;\n' + shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');
    };
    dm.depthTest = false; dm.depthWrite = false; this.cs.depthMat = dm;
    this.cs.hBlur = new THREE.ShaderMaterial(HorizontalBlurShader); this.cs.hBlur.depthTest = false;
    this.cs.vBlur = new THREE.ShaderMaterial(VerticalBlurShader); this.cs.vBlur.depthTest = false;
    this.scene.add(g);
  }
  _renderContactShadow() {
    const cs = this.cs; if (!cs.plane.visible) return;
    const bg = this.scene.background; this.scene.background = null;
    this.scene.overrideMaterial = cs.depthMat;
    const prevAlpha = this.renderer.getClearAlpha(); this.renderer.setClearAlpha(0);
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
    blur(cs.blur); blur(cs.blur * 0.4);
    this.renderer.setRenderTarget(null); this.renderer.setClearAlpha(prevAlpha); this.scene.background = bg;
  }
  /** objects that should cast the contact shadow must be on layer 1 (and 0) */
  markShadowCasters() { this.root.traverse(o => { o.layers.enable(1); }); }

  // ------------------------------------------------------------ size
  _resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth || 800, h = el.clientHeight || 600;
    this.setSize(w, h, this.pixelRatio);
  }
  setSize(w, h, pr) {
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h); this.composer.setPixelRatio(pr);
    if (this.dof) this.dof.setSize(w * pr, h * pr);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.viewSize = { w, h, pr };
  }

  // ------------------------------------------------------------ environments
  refreshEnvironment() { if (this.env) { const d = this.env.def; this.env = null; this.setEnvironment(d); } }
  setEnvironment(id) {
    const def = typeof id === 'string' ? envById(id) : id;
    if (this.env && this.env.def === def) return;
    if (this.env) { this.env.backdrop.dispose(); this.env.envMap.dispose(); }
    const backdrop = def.backdrop();
    const envMap = this.pmrem.fromEquirectangular(backdrop).texture;
    this.scene.environment = envMap;
    this.scene.background = backdrop; this.scene.backgroundBlurriness = def.bgBlur; this.scene.backgroundIntensity = 1.0;
    this.baseExposure = def.exposure;
    // ground
    const g = def.ground(); const gm = this.ground.material;
    const rep = 6000 / g.tile;
    gm.map = g.tex.map.clone(); gm.map.repeat.set(rep, rep); gm.map.needsUpdate = true;
    gm.normalMap = g.tex.normal ? g.tex.normal.clone() : null; if (gm.normalMap) { gm.normalMap.repeat.set(rep, rep); gm.normalMap.needsUpdate = true; gm.normalScale.set(0.6, 0.6); }
    gm.roughnessMap = g.tex.rough ? g.tex.rough.clone() : null; if (gm.roughnessMap) { gm.roughnessMap.repeat.set(rep, rep); gm.roughnessMap.needsUpdate = true; }
    gm.roughness = 1.0; gm.clearcoat = g.clearcoat || 0; gm.clearcoatRoughness = g.clearcoatRoughness || 0.3; gm.color.set(0xffffff); gm.needsUpdate = true;
    // props
    while (this.props.children.length) { const c = this.props.children.pop(); c.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    let floorY = g.floorY !== undefined ? g.floorY : -0.03;
    if (def.props) for (const p of def.props(this.propCtx)) { this.props.add(p); if (p.userData && p.userData.floorY !== undefined) floorY = p.userData.floorY; }
    this.ground.position.y = floorY;
    this.props.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.castShadow = o.castShadow !== false; o.layers.enable(1); } });
    // lights
    this.lightRig = def;
    this.key.color.set(def.key.color); this.fill.color.set(def.fill.color);
    this.key.position.set(...def.key.position); this.fill.position.set(...def.fill.position);
    this.shadowCatcher.material.opacity = def.shadow;
    this.cs.plane.material.opacity = def.contact;
    this.env = { def, backdrop, envMap };
    this.applyLight();
  }
  applyLight() {
    const d = this.lightRig; const s = this.lightScale * this.lightMul;
    this.scene.environmentIntensity = d.envIntensity * s;
    this.key.intensity = d.key.intensity * s; this.fill.intensity = d.fill.intensity * s; this.hemi.intensity = d.hemi * s;
    this.renderer.toneMappingExposure = this.baseExposure * this.exposureMul;
  }
  setLight(scale) { this.lightScale = scale; this.applyLight(); }
  setExposure(v) { this.exposureMul = v; this.applyLight(); }
  /** transient multipliers used by animations */
  setAnimLight(lightMul = 1, exposureMul = 1, interior = 0) { this.lightMul = lightMul; this.interior.intensity = interior * 2200; this.applyLight(); }
  setGround(on) { this.ground.visible = on; this.props.visible = on; this.shadowCatcher.visible = on; this.cs.plane.visible = on; }
  setShadows(on) { this.renderer.shadowMap.enabled = on; this.key.castShadow = on; this.scene.traverse(o => { if (o.isMesh && o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => m.needsUpdate = true); } }); }
  setAutoRotate(on) { this.controls.autoRotate = on; }
  setBackgroundVisible(on) { this.scene.background = on ? this.env.backdrop : null; }

  // ------------------------------------------------------------ cameras
  /** pure camera placement for a named preset (no animation) */
  cameraFor(dims, name = 'hero') {
    const c = CAMS[name] || CAMS.hero;
    const target = new THREE.Vector3(0, dims.H * c.targetY, dims.D / 2);
    const dir = new THREE.Vector3(...c.dir).normalize();
    const vfov = this.camera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * this.camera.aspect);
    const span = Math.hypot(dims.L, dims.D) * 0.95 + dims.H;
    const dist = Math.max(span / (2 * Math.tan(Math.min(hfov, vfov) / 2)) * 1.05 * c.zoom, 60);
    return { pos: target.clone().add(dir.multiplyScalar(dist)), target };
  }
  frame(dims, presetName = 'hero', animate = true) {
    const { pos, target } = this.cameraFor(dims, presetName);
    this.key.target.position.copy(target); this.interior.position.set(0, dims.H * 0.9, dims.D * 0.45);
    this.userMovedCamera = false;
    this.home = { pos: pos.clone(), target: target.clone() };
    return this.moveCamera(pos, target, animate ? 900 : 0);
  }
  moveCamera(pos, target, dur = 800) {
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    if (!dur) { this.camera.position.copy(pos); this.controls.target.copy(target); this.controls.update(); return Promise.resolve(); }
    return this.tween(dur, (k) => { this.camera.position.lerpVectors(p0, pos, k); this.controls.target.lerpVectors(t0, target, k); });
  }
  setCamera(pos, target) { this.camera.position.copy(pos); this.controls.target.copy(target); this.camera.lookAt(target); }

  tween(dur, fn, ease = easeInOut) { return new Promise((res) => { this.tweens.push({ t0: performance.now(), dur, fn, ease, res }); }); }
  cancelTweens() { for (const t of this.tweens) t.res(); this.tweens = []; }

  // ------------------------------------------------------------ frame
  renderFrame() {
    this.controls.update();
    if (this.dof.enabled) { const dist = this.camera.position.distanceTo(this.controls.target); this.dof.uniforms.focus.value = dist; this.dof.uniforms.aperture.value = 0.014 / Math.max(dist, 60); }
    this.film.uniforms.time.value = (performance.now() % 100000) / 1000;
    this._renderContactShadow();
    if (this.quality === 'fast') this.renderer.render(this.scene, this.camera); else this.composer.render();
  }
  _tick(now) {
    if (this.paused) return;
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]; const k = Math.min(1, (now - tw.t0) / tw.dur); tw.fn(tw.ease(k));
      if (k >= 1) { this.tweens.splice(i, 1); tw.res(); }
    }
    for (const f of this.onFrame) f(now);
    this.renderFrame();
  }

  pick(clientX, clientY, objects) {
    const r = this.canvas.getBoundingClientRect();
    const nd = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(nd, this.camera);
    return rc.intersectObjects(objects, false)[0] || null;
  }

  // ------------------------------------------------------------ still render
  /**
   * Render a still at an explicit pixel size. opts: {width, height, transparent, hideGround}
   * Returns a Promise<Blob> (PNG).  The viewport is restored afterwards.
   */
  async renderStill({ width, height, transparent = false, hideGround = false }) {
    const prev = { ...this.viewSize };
    const prevGround = this.ground.visible, prevProps = this.props.visible, prevBg = this.scene.background;
    this.paused = true;
    try {
      this.setSize(width, height, 1);
      if (transparent) { this.scene.background = null; this.ground.visible = false; this.props.visible = false; this.renderer.setClearColor(0x000000, 0); }
      else if (hideGround) { this.ground.visible = false; this.props.visible = false; }
      this.controls.update();
      this._renderContactShadow();
      if (transparent || this.quality === 'fast') { this.renderer.setRenderTarget(null); this.renderer.clear(); this.renderer.render(this.scene, this.camera); }
      else this.composer.render();
      const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
      return blob;
    } finally {
      this.scene.background = prevBg; this.ground.visible = prevGround; this.props.visible = prevProps; this.renderer.setClearColor(0x000000, 1);
      this.setSize(prev.w, prev.h, prev.pr);
      this.paused = false;
    }
  }
  screenshot() { this.renderFrame(); return this.canvas.toDataURL('image/png'); }
}
