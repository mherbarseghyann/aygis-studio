// Design import: a PDF exported from a blank template (or an image) -> rasterised pages with their trim box,
// matched to the SKU / component whose die extent they correspond to.
//   - pdf-lib reads MediaBox / CropBox / TrimBox / BleedBox (pdf.js does not expose TrimBox)
//   - pdf.js rasterises each page; optional-content groups (Illustrator layers) named like technical
//     layers (DIE_*, GUIDE_*, TECH_*, GLUE_*, MAGNET*) are hidden so die lines do not print onto the box.
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

const PT = 25.4 / 72;                 // mm per point
export const TECH_LAYER_RE = /^(DIE_|GUIDE_|TECH|GLUE|MAGNET|CUT|CREASE|BLEED|SAFE|LABELS)/i;

function nearly(a, b, tol) { return Math.abs(a - b) <= tol; }

/** Identify which SKU / component / page-side a page of w x h (mm, trim) belongs to. */
export function matchPage(models, wmm, hmm, pageIndex, hint) {
  const tol = 1.0;
  const bleeds = [0, 3.0, 3.175, 5.0];
  const cands = [];
  for (const sku of Object.keys(models.skus)) {
    const m = models.skus[sku];
    for (const comp of ['case', 'insert']) {
      const t = m.template[comp];
      for (const b of bleeds) {
        const tw = t.trim_w + 2 * b, th = t.trim_h + 2 * b;
        if (nearly(wmm, tw, tol) && nearly(hmm, th, tol)) cands.push({ sku, comp: comp.toUpperCase(), bleed: b, rotated: false, score: Math.abs(wmm - tw) + Math.abs(hmm - th) + (b === 0 ? 0 : 0.01) });
        if (nearly(wmm, th, tol) && nearly(hmm, tw, tol)) cands.push({ sku, comp: comp.toUpperCase(), bleed: b, rotated: true, score: 0.5 + Math.abs(wmm - th) + Math.abs(hmm - tw) });
      }
    }
  }
  cands.sort((a, b) => a.score - b.score);
  if (hint && hint.sku) { const pref = cands.find(c => c.sku === hint.sku); if (pref) return pref; }
  return cands[0] || null;
}

/** Read page boxes with pdf-lib. Returns [{media:[x0,y0,x1,y1], crop, trim, bleed, rotate}] in points. */
function loadScript(src) { return new Promise((res, rej) => { if (document.querySelector(`script[src="${src}"]`)) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src)); document.head.appendChild(s); }); }
async function readBoxes(bytes) {
  if (!window.PDFLib) await loadScript(new URL('../vendor/pdf-lib/pdf-lib.min.js', import.meta.url).href);
  const { PDFDocument } = window.PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  const out = [];
  for (const page of doc.getPages()) {
    const box = (fn) => { try { const b = fn(); return b ? [b.x, b.y, b.x + b.width, b.y + b.height] : null; } catch (e) { return null; } };
    const media = box(() => page.getMediaBox());
    const crop = box(() => page.getCropBox()) || media;
    const trim = box(() => page.getTrimBox());
    const bleed = box(() => page.getBleedBox());
    let rotate = 0; try { rotate = page.getRotation().angle || 0; } catch (e) { }
    out.push({ media, crop, trim, bleed, rotate });
  }
  return out;
}

/**
 * Import a PDF (ArrayBuffer).  Returns {pages:[{canvas, width, height, ppmm, ox, oy, match, trimMM:[w,h]}], layersHidden:[], layers:[]}
 * progress(msg) is called with status text.
 */
export async function importPDF(buffer, models, opts = {}) {
  const progress = opts.progress || (() => { });
  const ppmmWanted = opts.ppmm || 8;
  const maxPx = opts.maxPx || 4096;
  progress('Reading page boxes…');
  const bytes = new Uint8Array(buffer);
  const boxes = await readBoxes(bytes.slice());
  progress('Opening PDF…');
  const pdf = await pdfjsLib.getDocument({ data: bytes, useSystemFonts: true, isEvalSupported: false }).promise;
  // optional content (layers)
  const layers = [], hidden = [];
  let occ = null;
  try {
    occ = await pdf.getOptionalContentConfig();
    const order = occ.getOrder() || [];
    const walk = (items) => { for (const it of items) { if (typeof it === 'string') { const g = occ.getGroup(it); const name = g ? g.name : it; layers.push(name); if (TECH_LAYER_RE.test(name)) { occ.setVisibility(it, false); hidden.push(name); } } else if (it && it.order) walk(it.order); }; };
    walk(order);
  } catch (e) { console.warn('optional content', e); }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const bx = boxes[i - 1] || {};
    const view = page.view;                             // [x0,y0,x1,y1] of the CropBox (pdf.js)
    const vw = view[2] - view[0], vh = view[3] - view[1];
    let ppmm = ppmmWanted;
    const pxW = vw * PT * ppmm, pxH = vh * PT * ppmm;   // page size in px at the wanted resolution
    if (Math.max(pxW, pxH) > maxPx) ppmm = ppmm * maxPx / Math.max(pxW, pxH);
    const scale = ppmm * PT;                            // px per pt
    const viewport = page.getViewport({ scale });
    progress(`Rasterising page ${i} of ${pdf.numPages} at ${ppmm.toFixed(1)} px/mm (${Math.round(viewport.width)} × ${Math.round(viewport.height)} px)…`);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport, background: '#ffffff', optionalContentConfigPromise: occ ? Promise.resolve(occ) : undefined }).promise;
    // trim box relative to the rendered view (pt) -> px.  pdf.js renders view[0..3] (CropBox ∩ MediaBox); y is flipped.
    let trim = bx.trim && bx.trim.some((v, k) => Math.abs(v - (bx.media || view)[k]) > 0.5) ? bx.trim : null;
    let trimW, trimH, ox, oy, source;
    if (trim) {
      trimW = (trim[2] - trim[0]) * PT; trimH = (trim[3] - trim[1]) * PT;
      ox = (trim[0] - view[0]) * scale; oy = (view[3] - trim[3]) * scale;
      source = 'TrimBox';
    } else {
      trimW = vw * PT; trimH = vh * PT; ox = 0; oy = 0; source = 'page size';
    }
    let match = matchPage(models, trimW, trimH, i - 1, opts.hint);
    if (match && !trim && match.bleed > 0) {          // page = trim + bleed on every side
      ox = match.bleed * ppmm; oy = match.bleed * ppmm; trimW -= 2 * match.bleed; trimH -= 2 * match.bleed; source = `page size minus ${match.bleed} mm bleed`;
    }
    pages.push({ source: canvas, canvas, width: canvas.width, height: canvas.height, ppmm, ox, oy, trimMM: [trimW, trimH], match, boxSource: source, rotate: bx.rotate || 0 });
  }
  return { pages, layers, layersHidden: hidden, numPages: pdf.numPages };
}

/** Import a raster image (PNG/JPEG): the whole image is taken as the trim (die) area of the page. */
export async function importImage(file, models, opts = {}) {
  const url = URL.createObjectURL(file);
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  URL.revokeObjectURL(url);
  // assume the image covers the trim of the hinted component; scale to its trim size
  const hint = opts.hint || {};
  const m = models.skus[hint.sku || 'BOX-05'];
  const comp = (hint.comp || 'CASE').toLowerCase();
  const t = m.template[comp];
  const ppmm = im.width / t.trim_w;
  const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0);
  return { pages: [{ source: c, canvas: c, width: c.width, height: c.height, ppmm, ox: 0, oy: 0, trimMM: [t.trim_w, im.height / ppmm], match: { sku: hint.sku || 'BOX-05', comp: comp.toUpperCase(), bleed: 0, rotated: false, score: 0 }, boxSource: 'image = trim', rotate: 0 }], layers: [], layersHidden: [], numPages: 1 };
}
