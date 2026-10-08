// AYGIS Packaging Studio - application / UI wiring (Design, Render and Studio modes).
import * as THREE from 'three';
import { Viewer } from './viewer.js';
import { FoldedComponent, lidAngles } from './boxmodel.js';
import { Confections } from './confections.js';
import { ArtworkSet, loadDefaultArtwork, paperMaterial, edgeMaterial, BOARD_WHITE } from './artwork.js';
import { isDesigner, verifyPin, leaveDesigner } from './access.js';
import { ENVIRONMENTS, envThumbnail } from './environments.js';
import { VIDEO_PRESETS, foldState, foldCamera, FOLD_DURATION } from './timeline.js';
import { recordVideo, pickMime, downloadBlob } from './recorder.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const OPEN_DEG = 112;

const state = {
  models: null, manifest: null, samples: [],
  sku: 'BOX-10', openDeg: 0, lifted: false, lift: 0,
  showConf: true, showInsert: true,
  artMode: 'default', defaultSets: {}, customSets: {},
  box: null, insert: null, dims: null, placement: null,
  inspecting: null, camBefore: null,
  mode: 'design', studioTab: 'video', envId: 'studio',
  videoPreset: 'orbit', vState: 'closed', vCamera: 'path', foldCamera: 'path', foldSpeed: 1,
  player: { kind: null, t: 0, playing: false, duration: 10, last: 0 },
  busy: false,
};

let viewer, confections;
const whiteMats = () => { const m = paperMaterial(null, { color: BOARD_WHITE }); const e = edgeMaterial(); return { front: () => m, back: () => m, edge: e, all: [m, e] }; };

// ---------------------------------------------------------------- small UI helpers
function overlay(text, k) {
  const o = $('#overlay');
  if (text === null) { o.classList.add('hidden'); return; }
  o.classList.remove('hidden'); $('#overlay-text').textContent = text;
  $('#overlay-bar').style.width = (k !== undefined ? Math.round(k * 100) : 0) + '%';
  $('#overlay-bar').parentElement.style.visibility = k !== undefined ? 'visible' : 'hidden';
}
let toastT = 0;
function toast(text, ms = 3200) { const t = $('#toast'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), ms); }
function status(sel, html) { $(sel).innerHTML = html; }
const nextPaint = () => new Promise(r => { if (document.hidden) setTimeout(r, 0); else requestAnimationFrame(() => setTimeout(r, 0)); });   // never stall in a background tab

// ---------------------------------------------------------------- materials
function materialsFor(comp) {
  const sku = state.sku;
  if (state.artMode === 'white') return whiteMats();
  const custom = state.customSets[sku];
  if (state.artMode === 'custom' && custom && custom.pages[comp.toLowerCase()].outside) return custom.materialsFor(comp);
  const def = state.defaultSets[sku];
  return def ? def.materialsFor(comp) : whiteMats();
}
async function ensureDefault(sku) {
  if (!state.defaultSets[sku]) state.defaultSets[sku] = await loadDefaultArtwork(sku, state.models, state.manifest, viewer.renderer);
  return state.defaultSets[sku];
}

// ---------------------------------------------------------------- box
async function buildBox(sku, { keepCamera = false } = {}) {
  if (state.player.kind) exitTimeline();
  overlay(`Folding ${sku}…`, 0.75);
  await ensureDefault(sku);
  if (state.box) { viewer.root.remove(state.box.group); viewer.root.remove(state.insert.group); }
  const m = state.models.skus[sku];
  state.sku = sku; state.dims = { L: m.outer.L, D: m.outer.D, H: m.outer.H };
  state.placement = new THREE.Matrix4(); state.placement.set(...m.insert_placement);
  state.box = new FoldedComponent(m.case, materialsFor('CASE'));
  state.insert = new FoldedComponent(m.insert, materialsFor('INSERT'), state.placement);
  viewer.root.add(state.box.group); viewer.root.add(state.insert.group);
  state.insert.group.visible = state.showInsert;
  confections.populate(m, state.insert);
  confections.setVisible(state.showConf && state.showInsert);
  viewer.markShadowCasters();
  applyLift(state.lift);
  setOpen(state.openDeg);
  $$('#sku-seg button').forEach(b => b.classList.toggle('active', b.dataset.sku === sku));
  syncQuickbar();
  $('#sku-dims').textContent = `${m.count} confections (${m.rows} × ${m.cols}) · ${m.outer.L} × ${m.outer.D} × ${m.outer.H} mm · inside ${m.inner.A} × ${m.inner.B} × ${m.inner.H} mm`;
  $('#badge').innerHTML = `<b>AYGIS</b> &nbsp;${sku} · ${m.count} confections<br>${m.outer.L} × ${m.outer.D} × ${m.outer.H} mm · magnetic closure`;
  for (const [id, f] of [['#dl-case-pdf', `${sku}_CASE_TEMPLATE-BLANK.pdf`], ['#dl-case-ai', `${sku}_CASE_TEMPLATE-BLANK.ai`], ['#dl-insert-pdf', `${sku}_INSERT_TEMPLATE-BLANK.pdf`], ['#dl-insert-ai', `${sku}_INSERT_TEMPLATE-BLANK.ai`]]) { const a = $(id); a.href = 'assets/dielines/' + f; a.download = f; }
  if (!keepCamera) viewer.frame(state.dims, 'hero', true);
  else { const t = new THREE.Vector3(0, state.dims.H / 2, state.dims.D / 2); viewer.moveCamera(viewer.camera.position.clone(), t, 500); viewer.home = { pos: viewer.camera.position.clone(), target: t }; }
  overlay(null);
}
function refreshMaterials() {
  if (!state.box) return;
  state.box.setMaterials(materialsFor('CASE'));
  state.insert.setMaterials(materialsFor('INSERT'));
}
function setOpenRaw(deg) {
  if (!state.box) return;
  const m = state.models.skus[state.sku];
  const a = lidAngles(m, m.case, deg);
  state.box.update({ LT: a.LT, FO: a.FO });
}
function setOpen(deg) {
  state.openDeg = deg; setOpenRaw(deg);
  $('#lid-range').value = Math.round(deg); $('#lid-val').textContent = `${Math.round(deg)}°`;
  $('#btn-open').textContent = deg > 5 ? 'Close box' : 'Open box';
  syncQuickbar();
}
function animateOpen(target) { if (!state.box) return Promise.resolve(); const from = state.openDeg; return viewer.tween(1300, (k) => setOpen(from + (target - from) * k)); }
function applyLift(z) {
  state.lift = z;
  if (!state.insert) return;
  state.insert.extra.makeTranslation(0, 0, z);
  state.insert.update({});
  confections.updatePositions();
}
function liftHeight() { return Math.max(55, state.dims.H * 1.3); }
function animateLift(on) {
  if (!state.box) return Promise.resolve();
  state.lifted = on; $('#btn-lift').classList.toggle('active', on); syncQuickbar();
  const from = state.lift, to = on ? liftHeight() : 0;
  const pre = (on && state.openDeg < 100) ? animateOpen(OPEN_DEG) : Promise.resolve();
  return pre.then(() => viewer.tween(900, (k) => applyLift(from + (to - from) * k)));
}

// ---------------------------------------------------------------- inspect
function inspect(hit) {
  const c = hit.object, d = c.userData;
  state.inspecting = c;
  state.camBefore = { pos: viewer.camera.position.clone(), target: viewer.controls.target.clone() };
  const p = new THREE.Vector3(); c.getWorldPosition(p); p.y += 8;
  const dir = viewer.camera.position.clone().sub(p).normalize(); dir.y = Math.max(dir.y, 0.45); dir.normalize();
  viewer.moveCamera(p.clone().add(dir.multiplyScalar(95)), p, 900);
  $('#inspect').classList.remove('hidden');
  const m = state.models.skus[state.sku];
  $('#inspect-text').textContent = `Confection ${d.index + 1} of ${m.count} · ${d.name} · ${m.product.D_conf} mm in a ${m.product.cup_base} × ${m.product.cup_h} mm paper cup · cavity Ø ${m.cavities.hole_d} mm at ${m.cavities.pitch} mm pitch`;
}
function leaveInspect() {
  if (!state.inspecting) return;
  state.inspecting = null; $('#inspect').classList.add('hidden');
  if (state.camBefore) viewer.moveCamera(state.camBefore.pos, state.camBefore.target, 800);
}

// ---------------------------------------------------------------- design import
async function handleImport(getBuffer, label) {
  try {
    overlay('Importing design…');
    status('#design-status', 'Importing…');
    const { importPDF, importImage } = await import('./pdfimport.js');
    let res;
    if (getBuffer.image) res = await importImage(getBuffer.image, state.models, { hint: { sku: state.sku, comp: 'CASE' } });
    else { const buf = await getBuffer(); res = await importPDF(buf, state.models, { hint: { sku: state.sku }, progress: (t) => overlay(t) }); }
    overlay('Mapping pages onto the dieline…');
    const lines = [], groups = {};
    res.pages.forEach((pg, i) => {
      if (!pg.match) { lines.push(`<span class="warn">Page ${i + 1}: ${pg.trimMM[0].toFixed(1)} × ${pg.trimMM[1].toFixed(1)} mm does not match any template (CASE 392.4 × 307.1 / 379.1 / 451.1, INSERT 260.1 × 155.8 / 227.8 / 299.8). Skipped.</span>`); return; }
      if (pg.match.rotated) { lines.push(`<span class="warn">Page ${i + 1} is rotated 90° - export it in the template orientation. Skipped.</span>`); return; }
      (groups[`${pg.match.sku}|${pg.match.comp}`] ||= []).push({ pg, i });
    });
    const keys = Object.keys(groups);
    if (!keys.length) { status('#design-status', lines.join('\n') || '<span class="err">Nothing could be mapped.</span>'); overlay(null); return; }
    let targetSku = state.sku;
    for (const key of keys) {
      const [sku, comp] = key.split('|'); targetSku = sku;
      const m = state.models.skus[sku];
      const set = state.customSets[sku] || (state.customSets[sku] = new ArtworkSet(viewer.renderer));
      const bbox = (comp === 'CASE' ? m.case : m.insert).bbox;
      const sides = comp === 'CASE' ? ['outside', 'inside'] : ['outside'];
      groups[key].forEach(({ pg, i }, k) => {
        const side = sides[k];
        if (!side) { lines.push(`<span class="warn">Page ${i + 1}: extra page for ${sku} ${comp} ignored.</span>`); return; }
        set.setPage(comp, side, { source: pg.canvas, width: pg.width, height: pg.height, ppmm: pg.ppmm, ox: pg.ox, oy: pg.oy, gold: null }, bbox);
        lines.push(`<span class="ok">Page ${i + 1} → ${sku} ${comp} ${side}${side === 'inside' ? ' (mirrored reverse)' : ''}</span> · ${pg.trimMM[0].toFixed(1)} × ${pg.trimMM[1].toFixed(1)} mm from ${pg.boxSource} · ${pg.ppmm.toFixed(1)} px/mm`);
      });
      if (comp === 'CASE' && groups[key].length === 1) { set.setPage('CASE', 'inside', null, bbox); lines.push('No second page: the inside of the lid / flap / back wall is shown as unprinted board.'); }
      set.label = label;
    }
    if (res.layersHidden && res.layersHidden.length) lines.push(`Layers hidden (technical): ${res.layersHidden.join(', ')}`);
    else if (res.layers && res.layers.length) lines.push(`PDF layers: ${res.layers.join(', ')}`);
    else if (!getBuffer.image) lines.push('No PDF layers found: if die lines were exported flattened they will show on the model.');
    state.artMode = 'custom';
    $('#btn-default').classList.remove('active'); $('#btn-white').classList.remove('active');
    if (targetSku !== state.sku) { toast(`Design matches ${targetSku}: switching variant`); await buildBox(targetSku, { keepCamera: true }); } else refreshMaterials();
    status('#design-status', `<b>${label}</b>\n` + lines.join('\n'));
    toast('Design mapped onto the box');
  } catch (e) {
    console.error(e); status('#design-status', `<span class="err">Import failed: ${e.message || e}</span>`);
  } finally { overlay(null); }
}
function fileImport(file) {
  if (!file || !document.body.classList.contains('designer')) return;
  if (/\.(png|jpe?g)$/i.test(file.name) || /^image\//.test(file.type)) { const g = () => null; g.image = file; return handleImport(g, file.name); }
  return handleImport(() => file.arrayBuffer(), file.name);
}

// ---------------------------------------------------------------- environments
async function setEnvironmentUI(id) {
  if (state.envId === id && viewer.env) return;
  const def = ENVIRONMENTS.find(e => e.id === id);
  overlay(`Building environment · ${def.name}…`); await nextPaint();
  viewer.setEnvironment(id);
  state.envId = id;
  $$('.env-card').forEach(c => c.classList.toggle('active', c.dataset.env === id));
  $('#env-blurb').textContent = def.blurb;
  overlay(null);
}
function buildEnvGrid() {
  const grid = $('#env-grid');
  for (const def of ENVIRONMENTS) {
    const b = document.createElement('button'); b.className = 'env-card'; b.dataset.env = def.id; b.title = def.blurb;
    b.innerHTML = `<img alt=""><span>${def.name}</span>`;
    b.addEventListener('click', () => setEnvironmentUI(def.id));
    grid.appendChild(b);
  }
  // thumbnails after first paint (cheap, ~30 ms each)
  setTimeout(() => { for (const def of ENVIRONMENTS) { const img = grid.querySelector(`[data-env="${def.id}"] img`); img.src = envThumbnail(def); } }, 50);
}

// ---------------------------------------------------------------- timeline player (video + fold)
function timelineCtx() {
  return { cam: (n) => viewer.cameraFor(state.dims, n), dims: state.dims, startOpen: state.vState === 'open' ? OPEN_DEG : 0, endOpen: 0, OPEN: OPEN_DEG };
}
function cameraAuto() { return (state.player.kind === 'fold' ? state.foldCamera : state.vCamera) === 'path' && !viewer.userMovedCamera; }
function applyVideoFrame(t, auto = cameraAuto()) {
  const P = VIDEO_PRESETS[state.videoPreset];
  const f = P.fn(t, timelineCtx());
  if (auto) viewer.setCamera(f.cam.pos, f.cam.target);
  setOpenRaw(f.open); applyLift(f.lift || 0);
  viewer.setAnimLight(f.light ?? 1, f.exposure ?? 1, f.interior ?? 0);
}
function applyFoldFrame(t, auto = cameraAuto()) {
  const m = state.models.skus[state.sku];
  const st = foldState(t, m, m.case, m.insert, m.insert_placement);
  state.box.extra.copy(st.caseExtra); state.box.update(st.caseAngles);
  state.insert.base.copy(st.insertBase); state.insert.extra.identity(); state.insert.update(st.insertAngles);
  state.insert.group.visible = true;
  confections.group.visible = st.conf.visible && state.showConf;
  confections.updatePositions(st.conf.drop);
  if (auto) { const c = foldCamera(t, (n) => viewer.cameraFor(state.dims, n), state.dims); viewer.setCamera(c.pos, c.target); }
  viewer.setAnimLight(1, 1, 0);
  const cap = $('#caption'); cap.textContent = st.caption; cap.classList.remove('hidden');
}
function applyFrame(t, auto) { if (state.player.kind === 'fold') applyFoldFrame(t, auto); else applyVideoFrame(t, auto); }
function startTimeline(kind, duration) {
  leaveInspect();
  const p = state.player; p.kind = kind; p.t = 0; p.duration = duration; p.playing = true; p.last = performance.now();
  viewer.userMovedCamera = false; viewer.cancelTweens(); viewer.setAutoRotate(false); $('#chk-rotate').checked = false;
  $('#timeline').classList.remove('hidden'); $('#quickbar').classList.add('hidden-by-timeline');
  applyFrame(0); updateTimelineUI();
}
function exitTimeline() {
  const p = state.player; if (!p.kind) return;
  p.kind = null; p.playing = false;
  $('#timeline').classList.add('hidden'); $('#caption').classList.add('hidden'); $('#quickbar').classList.remove('hidden-by-timeline');
  state.box.extra.identity(); state.insert.base.copy(state.placement); state.insert.extra.identity();
  setOpen(state.openDeg); applyLift(state.lift);
  state.insert.group.visible = state.showInsert; confections.setVisible(state.showConf && state.showInsert); confections.updatePositions();
  viewer.setAnimLight(1, 1, 0);
  $('#f-play').textContent = 'Play'; $('#tl-play').textContent = '▶';
}
function updateTimelineUI() {
  const p = state.player;
  $('#tl-range').value = Math.round(p.t * 1000);
  $('#tl-time').textContent = `${(p.t * p.duration).toFixed(1)} s`;
  $('#tl-play').textContent = p.playing ? '❚❚' : '▶';
  if (p.kind === 'fold') { $('#f-prog').value = Math.round(p.t * 1000); $('#f-prog-val').textContent = `${Math.round(p.t * 100)} %`; $('#f-play').textContent = p.playing ? 'Pause' : 'Play'; $('#f-caption').textContent = $('#caption').textContent; }
}
function seekTimeline(t) { const p = state.player; p.t = Math.max(0, Math.min(1, t)); applyFrame(p.t); updateTimelineUI(); }
function togglePlay() { const p = state.player; if (!p.kind) return; if (p.t >= 1 && !p.playing) p.t = 0; p.playing = !p.playing; p.last = performance.now(); updateTimelineUI(); }
function playerTick(now) {
  const p = state.player; if (!p.kind || !p.playing) return;
  const dt = Math.min(0.1, (now - p.last) / 1000); p.last = now;
  const speed = p.kind === 'fold' ? state.foldSpeed : 1;
  p.t = Math.min(1, p.t + dt * speed / p.duration);
  applyFrame(p.t); updateTimelineUI();
  if (p.t >= 1) { if (p.kind === 'video' && state.videoPreset === 'orbit') p.t = 0; else { p.playing = false; updateTimelineUI(); } }
}

// ---------------------------------------------------------------- exports
function aspectWH(key, longEdge) {
  const map = { '3:2': 3 / 2, '16:9': 16 / 9, '1:1': 1, '4:5': 4 / 5, '2:3': 2 / 3, 'A4L': 297 / 210, 'A4P': 210 / 297 };
  let r = map[key]; if (key === 'view') r = viewer.viewSize.w / viewer.viewSize.h;
  const w = r >= 1 ? longEdge : Math.round(longEdge * r), h = r >= 1 ? Math.round(longEdge / r) : longEdge;
  return [w, h];
}
async function renderStillUI() {
  if (state.busy) return; state.busy = true;
  const cam = $('#r-cam').value, bg = $('#r-bg').value;
  const [w, h] = aspectWH($('#r-aspect').value, +$('#r-size').value);
  const wantOpen = $('#r-openstate').checked || cam === 'open' || cam === 'interior';
  const wantTray = $('#r-tray').checked;
  const saved = { pos: viewer.camera.position.clone(), target: viewer.controls.target.clone(), open: state.openDeg, lift: state.lift };
  try {
    overlay(`Rendering ${w} × ${h} px…`); await nextPaint();
    if (state.player.kind) exitTimeline();
    setOpenRaw(wantOpen ? OPEN_DEG : state.openDeg);
    applyLift(wantTray ? liftHeight() : 0);
    if (cam !== 'current') { viewer.camera.aspect = w / h; viewer.camera.updateProjectionMatrix(); const c = viewer.cameraFor(state.dims, cam); viewer.setCamera(c.pos, c.target); }
    const blob = await viewer.renderStill({ width: w, height: h, transparent: bg === 'transparent', hideGround: bg === 'plain' });
    const url = URL.createObjectURL(blob);
    const name = `AYGIS_${state.sku}_${cam}_${w}x${h}.png`;
    $('#render-img').src = url; $('#render-dl').href = url; $('#render-dl').download = name; $('#render-preview').classList.remove('hidden');
    downloadBlob(blob, name);
    status('#render-status', `<span class="ok">Rendered ${w} × ${h} px</span> · ${(blob.size / 1048576).toFixed(1)} MB PNG${bg === 'transparent' ? ' · alpha background (ground shadow kept)' : ''}`);
  } catch (e) { console.error(e); status('#render-status', `<span class="err">Render failed: ${e.message || e}</span>`); }
  finally {
    setOpenRaw(saved.open); applyLift(saved.lift);
    viewer.camera.aspect = viewer.viewSize.w / viewer.viewSize.h; viewer.camera.updateProjectionMatrix();
    viewer.setCamera(saved.pos, saved.target);
    overlay(null); state.busy = false;
  }
}
async function exportVideoUI(kind) {
  if (state.busy) return; state.busy = true;
  const [w, h] = $('#v-size').value.split('x').map(Number); const fps = +$('#v-fps').value;
  const sel = kind === 'fold' ? '#fold-status' : '#video-status';
  const mime = pickMime();
  if (!mime) { status(sel, '<span class="err">This browser cannot record video (MediaRecorder unsupported). Use Chrome, Edge, Firefox or Safari 14.5+.</span>'); state.busy = false; return; }
  const duration = kind === 'fold' ? FOLD_DURATION / state.foldSpeed : +$('#v-dur').value;
  const saved = { pos: viewer.camera.position.clone(), target: viewer.controls.target.clone(), open: state.openDeg, lift: state.lift };
  const wasPlaying = state.player.kind;
  try {
    if (!state.player.kind || state.player.kind !== kind) { startTimeline(kind, duration); } state.player.playing = false;
    const auto = (kind === 'fold' ? state.foldCamera : state.vCamera) === 'path';
    viewer.userMovedCamera = false;
    overlay(`Recording ${w} × ${h} @ ${fps} fps…`, 0); await nextPaint();
    const res = await recordVideo(viewer, { width: w, height: h, fps, duration, onFrame: (t) => applyFrame(t, auto), onProgress: (k, msg) => overlay(msg, k) });
    const name = `AYGIS_${state.sku}_${kind === 'fold' ? 'fold-sequence' : state.videoPreset}_${w}x${h}.${res.ext}`;
    downloadBlob(res.blob, name);
    status(sel, `<span class="ok">Exported ${name}</span> · ${res.frames} frames · ${(res.blob.size / 1048576).toFixed(1)} MB · ${res.mime.split(';')[0]}${res.ext === 'webm' ? '\nWebM plays in Chrome, Edge, Firefox and VLC; convert to MP4 with HandBrake or ffmpeg for Keynote / PowerPoint.' : ''}`);
  } catch (e) { console.error(e); status(sel, `<span class="err">Export failed: ${e.message || e}</span>`); }
  finally {
    overlay(null);
    if (!wasPlaying) exitTimeline(); else { seekTimeline(state.player.t); }
    viewer.camera.aspect = viewer.viewSize.w / viewer.viewSize.h; viewer.camera.updateProjectionMatrix();
    viewer.setCamera(saved.pos, saved.target);
    state.busy = false;
  }
}

// ---------------------------------------------------------------- modes
function setMode(mode) {
  state.mode = mode;
  $$('#modes button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  for (const m of ['design', 'render', 'studio']) $(`#panel-${m}`).classList.toggle('hidden', m !== mode);
  if (mode !== 'studio' && state.player.kind) exitTimeline();
  if (mode !== 'design') leaveInspect();
  updateFrameGuide();
}
function setStudioTab(tab) {
  state.studioTab = tab;
  $$('#studio-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#studio-video').classList.toggle('hidden', tab !== 'video'); $('#studio-fold').classList.toggle('hidden', tab !== 'fold');
  if (state.player.kind && state.player.kind !== tab) exitTimeline();
}
function buildPresetList() {
  const list = $('#video-presets');
  for (const [id, p] of Object.entries(VIDEO_PRESETS)) {
    const b = document.createElement('button'); b.dataset.preset = id; b.innerHTML = `${p.name}<small>${p.duration} s</small>`;
    b.addEventListener('click', () => { state.videoPreset = id; $$('#video-presets button').forEach(x => x.classList.toggle('active', x.dataset.preset === id)); $('#video-blurb').textContent = p.blurb; $('#v-dur').value = p.duration; $('#v-dur-val').textContent = `${p.duration} s`; if (state.player.kind === 'video') { state.player.duration = p.duration; seekTimeline(0); } });
    list.appendChild(b);
  }
  list.querySelector('button').classList.add('active'); $('#video-blurb').textContent = VIDEO_PRESETS.orbit.blurb;
}

// ---------------------------------------------------------------- collapsible sections, quick bar, gestures
const SECT_KEY = 'aygis.sections';
function wireCollapsible() {
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(SECT_KEY) || '{}'); } catch (e) { }
  $$('.block').forEach(b => {
    const h = b.querySelector('h2'); if (!h) return;
    const key = h.textContent.trim();
    if (saved[key] !== undefined) b.classList.toggle('collapsed', !!saved[key]);
    h.addEventListener('click', () => { b.classList.toggle('collapsed'); saved[key] = b.classList.contains('collapsed'); try { localStorage.setItem(SECT_KEY, JSON.stringify(saved)); } catch (e) { } });
  });
}
function quickAction(fn) { return () => { if (state.busy || !state.box) return; if (state.player.kind) exitTimeline(); fn(); }; }
function syncQuickbar() {
  $('#q-open').textContent = state.openDeg > 5 ? 'Close' : 'Open';
  $('#q-open').classList.toggle('active', state.openDeg > 5);
  $('#q-lift').classList.toggle('active', state.lifted);
  $$('#quickbar [data-qsku]').forEach(b => b.classList.toggle('active', b.dataset.qsku === state.sku));
}
function nextEnvironment(dir = 1) {
  const i = ENVIRONMENTS.findIndex(e => e.id === state.envId);
  const n = ENVIRONMENTS[(i + dir + ENVIRONMENTS.length) % ENVIRONMENTS.length];
  setEnvironmentUI(n.id); toast(n.name, 1600);
}
function wireQuickbar() {
  $('#q-open').addEventListener('click', quickAction(() => animateOpen(state.openDeg > 5 ? 0 : OPEN_DEG)));
  $('#q-lift').addEventListener('click', quickAction(() => animateLift(!state.lifted)));
  $$('#quickbar [data-qsku]').forEach(b => b.addEventListener('click', quickAction(() => { if (b.dataset.qsku !== state.sku) buildBox(b.dataset.qsku, { keepCamera: true }); })));
  $('#q-env').addEventListener('click', () => nextEnvironment(1));
  $('#q-cam').addEventListener('click', quickAction(() => { leaveInspect(); viewer.frame(state.dims, 'hero', true); }));
  $('#q-shot').addEventListener('click', () => { const a = document.createElement('a'); a.href = viewer.screenshot(); a.download = `AYGIS_${state.sku}_${state.openDeg > 5 ? 'open' : 'closed'}.png`; a.click(); toast('Snapshot saved', 1500); });
  // mobile bottom sheet
  const panel = $('#panel');
  const togglePanel = (on) => panel.classList.toggle('open', on === undefined ? !panel.classList.contains('open') : on);
  $('#panel-toggle').addEventListener('click', () => togglePanel());
  $('#sheet-handle').addEventListener('click', () => togglePanel(false));
  let sy = null;
  $('#sheet-handle').addEventListener('touchstart', (e) => { sy = e.touches[0].clientY; }, { passive: true });
  $('#sheet-handle').addEventListener('touchmove', (e) => { if (sy !== null && e.touches[0].clientY - sy > 40) { togglePanel(false); sy = null; } }, { passive: true });
  $('#modes').addEventListener('click', () => togglePanel(true));
}
/** touch / mouse gestures on the viewport: tap = inspect, double-tap = open/close, long-press = tray */
function wireGestures() {
  const c = $('#c');
  let down = null, lastTap = 0, tapTimer = 0, pressTimer = 0, pointers = 0;
  const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; } };
  c.addEventListener('pointerdown', (e) => {
    pointers++;
    if (pointers > 1) { cancelPress(); down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    cancelPress();
    pressTimer = setTimeout(() => { pressTimer = 0; if (!down || state.busy || !state.box) return; down = null; if (state.player.kind) exitTimeline(); animateLift(!state.lifted); if (navigator.vibrate) navigator.vibrate(12); }, 520);
  });
  c.addEventListener('pointermove', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) { cancelPress(); down = null; } });
  const end = (e) => {
    pointers = Math.max(0, pointers - 1);
    cancelPress();
    if (!down) return;
    const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 500) return;
    const now = performance.now();
    if (now - lastTap < 320) {                               // double-tap -> open / close
      lastTap = 0; clearTimeout(tapTimer); tapTimer = 0;
      if (state.busy || !state.box) return;
      if (state.player.kind) exitTimeline();
      animateOpen(state.openDeg > 5 ? 0 : OPEN_DEG);
      return;
    }
    lastTap = now;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {                            // single tap -> inspect / leave inspect
      tapTimer = 0;
      if (state.mode !== 'design' || !confections.visible || state.player.kind) return;
      const hit = viewer.pick(e.clientX, e.clientY, confections.meshes);
      if (hit) inspect(hit); else if (state.inspecting) leaveInspect();
    }, 300);
  };
  c.addEventListener('pointerup', end);
  c.addEventListener('pointercancel', () => { pointers = Math.max(0, pointers - 1); cancelPress(); down = null; });
  c.addEventListener('dblclick', (e) => e.preventDefault());
  c.addEventListener('contextmenu', (e) => { if (e.pointerType === 'touch' || matchMedia('(pointer: coarse)').matches) e.preventDefault(); });
}

// ---------------------------------------------------------------- UI wiring
function wireUI() {
  wireCollapsible(); wireQuickbar(); wireGestures(); wireAccess();
  $$('#modes button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $$('#studio-tabs button').forEach(b => b.addEventListener('click', () => setStudioTab(b.dataset.tab)));
  $$('#sku-seg button').forEach(b => b.addEventListener('click', () => { if (b.dataset.sku !== state.sku) buildBox(b.dataset.sku, { keepCamera: true }); }));
  $('#btn-open').addEventListener('click', () => animateOpen(state.openDeg > 5 ? 0 : OPEN_DEG));
  $('#lid-range').addEventListener('input', (e) => setOpen(+e.target.value));
  $('#btn-lift').addEventListener('click', () => animateLift(!state.lifted));
  $('#chk-conf').addEventListener('change', (e) => { state.showConf = e.target.checked; confections.setVisible(state.showConf && state.showInsert); });
  $('#chk-insert').addEventListener('change', (e) => { state.showInsert = e.target.checked; state.insert.group.visible = state.showInsert; confections.setVisible(state.showConf && state.showInsert); });

  $('#btn-import').addEventListener('click', () => $('#file').click());
  $('#file').addEventListener('change', (e) => { fileImport(e.target.files[0]); e.target.value = ''; });
  const drop = $('#drop'), stage = $('#stage');
  for (const el of [drop, stage]) {
    el.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    el.addEventListener('dragleave', () => drop.classList.remove('over'));
    el.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); fileImport(e.dataTransfer.files[0]); });
  }
  $('#sample').addEventListener('change', async (e) => { const f = e.target.value; e.target.value = ''; if (f) await handleImport(async () => (await fetch('assets/samples/' + f)).arrayBuffer(), f); });
  $('#btn-default').addEventListener('click', () => { state.artMode = 'default'; refreshMaterials(); status('#design-status', '<b>AYGIS production artwork</b> (from the PDF/X-4 masters, foil rendered as metallic gold)'); $('#btn-default').classList.add('active'); $('#btn-white').classList.remove('active'); });
  $('#btn-white').addEventListener('click', () => { state.artMode = 'white'; refreshMaterials(); status('#design-status', 'Unprinted board (white sample)'); $('#btn-white').classList.add('active'); $('#btn-default').classList.remove('active'); });

  $('#light-range').addEventListener('input', (e) => { viewer.setLight(+e.target.value); $('#light-val').textContent = (+e.target.value).toFixed(2); });
  $('#expo-range').addEventListener('input', (e) => { viewer.setExposure(+e.target.value); $('#expo-val').textContent = (+e.target.value).toFixed(2); });
  $('#chk-ground').addEventListener('change', (e) => viewer.setGround(e.target.checked));
  $('#chk-rotate').addEventListener('change', (e) => viewer.setAutoRotate(e.target.checked));
  $('#chk-shadow').addEventListener('change', (e) => viewer.setShadows(e.target.checked));
  $('#chk-ao').addEventListener('change', (e) => viewer.setAO(e.target.checked));
  $('#chk-bloom').addEventListener('change', (e) => viewer.setBloom(e.target.checked));
  $('#chk-dof').addEventListener('change', (e) => viewer.setDOF(e.target.checked));
  $('#chk-film').addEventListener('change', (e) => viewer.setFilm(e.target.checked));
  $('#btn-share').addEventListener('click', shareLink);
  ['#r-aspect', '#r-cam'].forEach(sel => $(sel).addEventListener('change', updateFrameGuide));
  new ResizeObserver(updateFrameGuide).observe($('#stage'));

  $$('#cam-seg button').forEach(b => b.addEventListener('click', () => { leaveInspect(); viewer.frame(state.dims, b.dataset.cam, true); }));
  $('#btn-reset').addEventListener('click', resetScene);
  $('#btn-shot').addEventListener('click', () => { const a = document.createElement('a'); a.href = viewer.screenshot(); a.download = `AYGIS_${state.sku}_${state.openDeg > 5 ? 'open' : 'closed'}.png`; a.click(); });
  $('#btn-inspect-back').addEventListener('click', leaveInspect);

  // render
  $('#btn-render').addEventListener('click', renderStillUI);
  $('#r-goto-env').addEventListener('click', () => { setMode('design'); $('#env-grid').scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  // studio: video
  $('#v-dur').addEventListener('input', (e) => { $('#v-dur-val').textContent = `${e.target.value} s`; if (state.player.kind === 'video') state.player.duration = +e.target.value; });
  $('#v-state').addEventListener('change', (e) => { state.vState = e.target.value; if (state.player.kind === 'video') seekTimeline(state.player.t); });
  $('#v-camera').addEventListener('change', (e) => { state.vCamera = e.target.value; viewer.userMovedCamera = false; });
  $('#v-preview').addEventListener('click', () => startTimeline('video', +$('#v-dur').value));
  $('#v-stop').addEventListener('click', exitTimeline);
  $('#v-export').addEventListener('click', () => exportVideoUI('video'));
  // studio: fold
  $('#f-play').addEventListener('click', () => { if (state.player.kind !== 'fold') startTimeline('fold', FOLD_DURATION); else togglePlay(); });
  $('#f-restart').addEventListener('click', () => { if (state.player.kind !== 'fold') startTimeline('fold', FOLD_DURATION); else { viewer.userMovedCamera = false; seekTimeline(0); state.player.playing = true; state.player.last = performance.now(); updateTimelineUI(); } });
  $('#f-prog').addEventListener('input', (e) => { if (state.player.kind !== 'fold') { startTimeline('fold', FOLD_DURATION); state.player.playing = false; } seekTimeline(+e.target.value / 1000); });
  $('#f-speed').addEventListener('change', (e) => { state.foldSpeed = +e.target.value; });
  $('#f-camera').addEventListener('change', (e) => { state.foldCamera = e.target.value; viewer.userMovedCamera = false; if (state.player.kind === 'fold') seekTimeline(state.player.t); });
  $('#f-export').addEventListener('click', () => exportVideoUI('fold'));
  // timeline bar
  $('#tl-play').addEventListener('click', togglePlay);
  $('#tl-restart').addEventListener('click', () => { viewer.userMovedCamera = false; seekTimeline(0); state.player.playing = true; state.player.last = performance.now(); updateTimelineUI(); });
  $('#tl-range').addEventListener('input', (e) => { state.player.playing = false; seekTimeline(+e.target.value / 1000); });
  $('#tl-close').addEventListener('click', exitTimeline);

  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && state.player.kind) { e.preventDefault(); togglePlay(); }
    else if (k === 'o' && !state.player.kind) animateOpen(state.openDeg > 5 ? 0 : OPEN_DEG);
    else if (k === 'r') resetScene();
    else if (k === 'escape') { leaveInspect(); if (state.player.kind) exitTimeline(); }
    else if (k === 'l' && !state.player.kind) animateLift(!state.lifted);
    else if (k === 'e') nextEnvironment(e.shiftKey ? -1 : 1);
    else if (k === '1') buildBox('BOX-05', { keepCamera: true });
    else if (k === '2') buildBox('BOX-10', { keepCamera: true });
    else if (k === '3') buildBox('BOX-15', { keepCamera: true });
  });
}
function shareLink() {
  const q = new URLSearchParams();
  q.set('sku', state.sku); q.set('env', state.envId); if (state.openDeg > 1) q.set('open', Math.round(state.openDeg)); if (state.lifted) q.set('lift', '1');
  const p = viewer.camera.position, t = viewer.controls.target;
  q.set('cam', [p.x, p.y, p.z, t.x, t.y, t.z].map(v => v.toFixed(1)).join(','));
  if (state.artMode === 'custom' && state.customSets[state.sku] && /\.pdf$/i.test(state.customSets[state.sku].label || '') && state.samples.some(s => s.file === state.customSets[state.sku].label)) q.set('sample', state.customSets[state.sku].label);
  const url = location.origin + location.pathname + '?' + q.toString();
  (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => toast('Link copied - imported PDFs are not included in a link, only sample designs'), () => prompt('Copy this link:', url));
}
function updateFrameGuide() {
  const g = $('#frame-guide');
  const key = $('#r-aspect').value;
  if (state.mode !== 'render' || key === 'view') { g.classList.add('hidden'); return; }
  const [w, h] = aspectWH(key, 1000);
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  const sc = Math.min((W * 0.92) / w, (H * 0.92) / h);
  g.style.width = Math.round(w * sc) + 'px'; g.style.height = Math.round(h * sc) + 'px';
  g.dataset.label = $('#r-aspect').selectedOptions[0].textContent.toUpperCase();
  g.classList.remove('hidden');
}
// ---------------------------------------------------------------- client / designer access
function applyAccess() {
  const d = isDesigner();
  document.body.classList.toggle('designer', d);
  $('#designer-link').textContent = d ? 'Exit designer mode' : 'Designer access';
  if (!d && state.artMode === 'custom') { state.artMode = 'default'; refreshMaterials(); }
}
function wireAccess() {
  const modal = $('#pin-modal'), input = $('#pin-input'), msg = $('#pin-msg');
  $('#designer-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (isDesigner()) { leaveDesigner(); applyAccess(); toast('Client mode', 1500); return; }
    msg.textContent = ''; input.value = ''; modal.classList.remove('hidden'); setTimeout(() => input.focus(), 50);
  });
  $('#pin-cancel').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  $('#pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await verifyPin(input.value);
    if (ok) { modal.classList.add('hidden'); applyAccess(); toast('Designer mode unlocked', 1800); }
    else { msg.innerHTML = '<span class="err">Incorrect PIN</span>'; input.select(); }
  });
  applyAccess();
}
function resetScene() {
  leaveInspect(); if (state.player.kind) exitTimeline();
  if (state.lifted) { state.lifted = false; $('#btn-lift').classList.remove('active'); applyLift(0); }
  setOpen(0);
  $('#chk-rotate').checked = false; viewer.setAutoRotate(false);
  viewer.setAnimLight(1, 1, 0);
  viewer.frame(state.dims, 'hero', true);
}

// ---------------------------------------------------------------- boot
async function main() {
  viewer = new Viewer($('#c'));
  confections = new Confections();
  viewer.root.add(confections.group);
  window.AYGIS = { state, viewer, confections, buildBox, setOpen, animateOpen, animateLift, handleImport, lidAngles, THREE, startTimeline, exitTimeline, seekTimeline, applyFrame, renderStillUI, exportVideoUI, setEnvironmentUI, setMode, setStudioTab, foldState, VIDEO_PRESETS };
  overlay('Loading geometry…', 0.1);
  const [models, manifest, samples] = await Promise.all([
    fetch('assets/models/box_models.json').then(r => r.json()),
    fetch('assets/artwork/manifest.json').then(r => r.json()),
    fetch('assets/samples/index.json').then(r => r.ok ? r.json() : []).catch(() => []),
  ]);
  state.models = models; state.manifest = manifest; state.samples = samples;
  $('#version').textContent = `dielines ${models.version}`; $('#foot-ver').textContent = models.version;
  for (const s of samples) { const o = document.createElement('option'); o.value = s.file; o.textContent = s.label; $('#sample').appendChild(o); }
  buildEnvGrid(); buildPresetList();
  overlay('Loading confections…', 0.45);
  await confections.load('assets/models/confections.glb');
  viewer.propCtx.confection = (i) => confections.makeOne(i);
  wireUI();
  const q = new URLSearchParams(location.search);
  if (q.get('env') && q.get('env') !== 'studio') await setEnvironmentUI(q.get('env')); else { viewer.refreshEnvironment(); $$('.env-card')[0].classList.add('active'); $('#env-blurb').textContent = ENVIRONMENTS[0].blurb; }
  await buildBox(q.get('sku') || 'BOX-10');
  $('#btn-default').classList.add('active');
  status('#design-status', '<b>AYGIS production artwork</b> (from the PDF/X-4 masters, foil rendered as metallic gold)');
  viewer.onFrame.push(playerTick);
  viewer.onFrame.push(() => { if (!state.player.kind && (state.lifted || viewer.tweens.length)) confections.updatePositions(); });
  if (q.get('open')) setOpen(+q.get('open'));
  if (q.get('mode')) setMode(q.get('mode'));
  if (q.get('sample')) await handleImport(async () => (await fetch('assets/samples/' + q.get('sample'))).arrayBuffer(), q.get('sample'));
  if (q.get('cam')) { const v = q.get('cam').split(',').map(Number); if (v.length === 6 && v.every(Number.isFinite)) { viewer.cancelTweens(); viewer.setCamera(new THREE.Vector3(v[0], v[1], v[2]), new THREE.Vector3(v[3], v[4], v[5])); } }
  if (q.get('lift') === '1') animateLift(true);
  $('#panel').scrollTop = 0;
}
main().catch(e => { console.error(e); overlay('Failed to start: ' + (e.message || e)); });
