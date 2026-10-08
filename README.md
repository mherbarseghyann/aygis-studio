# AYGIS Packaging Studio

Browser-based packaging visualization studio for the AYGIS confection boxes (BOX-05 / BOX-10 / BOX-15), folded
from the **production dielines** (`../PACKAGING_PRINT_FILES`, R1.1, magnetic closure) with the concept's confection
models. Three modes:

* **Design** - inspect your artwork on the finished package: import a PDF designed on a blank template, switch
  5 / 10 / 15, open / close, lift the tray, inspect confections, choose one of seven photographic sets.
* **Render** - still product shots at print sizes (up to 4096 px), with photographic camera presets, formats and a
  transparent PNG option.
* **Studio** - *Video*: cinematic presets exported as video; *Fold*: the flat printed sheet folding into the box
  along the real creases, with play / pause / scrub.

## Run locally

No build step. The page needs a local web server (browsers block texture / PDF loading from `file://`).

```bash
cd AYGIS_3D_PREVIEW
python3 -m http.server 8765
```

then open <http://localhost:8765>. Any static server works. Chrome, Edge, Firefox and Safari 16+ (WebGL 2).
Everything (three.js, pdf.js, pdf-lib, fonts) is vendored in `vendor/`, so it runs offline.
Add `?debug` to the URL for shader error checking and the real-world scale audit in the console.

## Deploy (GitHub Pages / any static host)

The folder is deployable as-is: all URLs are relative (works under a `/<repo>/` sub-path), there is no routing,
`.nojekyll` disables Jekyll processing.

* **Bump `VERSION` in `sw.js` on every deploy.** GitHub Pages serves every file with `Cache-Control: max-age=600`
  and cannot be configured, so the service worker provides the caching: code (html/js/css/json) is network-first
  (a deploy is live on the next load, modules never mix versions, offline fallback), heavy static assets
  (vendor libraries, models, artwork, fonts) are cache-first. The worker registers on HTTPS only, so local
  development is never served stale files. Sample PDFs and dieline downloads are never stored.
* GitHub Pages compresses text (gzip) automatically; images and models are already compressed formats.
* `_headers` is only used by Netlify / Cloudflare Pages; GitHub Pages ignores it.

## Rendering model

* **Units**: millimetres everywhere (three.js world unit = 1 mm). `js/units.js` holds the reference sizes of every
  real object (coffee services, plates, cutlery, glassware, furniture to EN heights, fruit, stairs, storeys); the box
  and confection sizes come from `box_models.json`. Props are tagged with their expected size and checked by
  `auditScale` (`?debug`).
* **Light**: each set has one physical light logic - sun + sky, window daylight, or studio softboxes - with colours
  from correlated colour temperature relative to the set's camera white balance. The IBL is **captured from the set
  itself** (PMREM of the dressed scene from the product position, two bounces), so reflections and ambient light on
  the box are the room / street / studio behind it. The sun disc and softbox energy carried by the shadow-casting
  key are excluded from the capture, so nothing is lit twice.
* **Tone**: Khronos PBR Neutral tone mapping (keeps the brand burgundy and foil gold hue-accurate).
* **Progressive rendering**: render on demand only. While the camera or the box moves, an interactive chain renders
  at an adaptive resolution with MSAA. When the view settles, a final chain accumulates jittered samples - sub-pixel
  AA, a thin-lens aperture (physically correct depth of field for the preset's focal length and f-number) and key
  light jitter over the light's angular size (real soft area shadows) - with half-resolution GTAO. The image
  converges in about a second and then the GPU sleeps.
* **Box materials**: soft-touch laminated board, hot-foil gold from the production foil masks (metal response,
  foil grain, 0.06 mm deboss normal), uncoated printed reverse, edge-inked knife cuts, fold fillets of radius t/2 on
  every crease (no seams at any fold angle). The closure magnets are concealed and not modelled.
* **Confections**: the concept domes (Ø 22 mm) with a procedural crushed-nut / seed / candied-fruit coating
  (object-space Voronoi pieces, binder in the crevices, per-flavour palette and gloss), in procedural pleated
  glassine cups (25 × 34 × 16 mm).

## Sets and shots

Product Studio · Noir Table · Morning Coffee · Parisian Café · Yerevan Terrace · The Cascade · Summer Picnic.
Each is a dressed set with foreground, midground and background, built at real scale from procedural geometry and
GPU-baked PBR textures (`js/environments.js`, `js/props.js`, `js/lookdev.js`, `js/sky.js`).
Camera shots use full-frame-equivalent lenses: Hero ¾ (85 mm f/8), Lifestyle (50-70 mm f/2.8-4, set-specific,
with lens shift), Front (100 mm), Flat lay, Side, Open box, Detail (100 mm macro on the foil), Confections
(100 mm macro). Old share links with retired set ids still resolve.

## Quality

`Quality: Auto / High / Medium / Performance` (Environment section). Auto picks a tier from the GPU and steps down
once if settled samples arrive too slowly. Tiers change the pixel budget and DPR cap, accumulation samples, GTAO,
shadow-map size, artwork texels per mm (8 / 6 / 4), procedural texture resolution and vegetation density. Stills and
video exports always render at full quality at the requested size.

## Assets

* `assets/models/box_models.json` - geometry of the three boxes (generated by `_SUPPORT/generator/export_web.py`).
* `assets/models/confections.glb` - confection domes only (cups are procedural); int8 normals
  (`KHR_mesh_quantization`), 16-bit indices: 539 KB.
* `assets/artwork/*.webp` - default page artwork, lossy WebP q92 (6-15x smaller than the former JPEG q90 4:4:4,
  mean error < 0.6/255), `*_gold.png` lossless foil masks, `manifest.json`. Pages are resampled on the GPU to the
  tier's texels per mm; only the visible SKU keeps its page textures on the GPU.
* `assets/env/*.jpg` - set thumbnails. `assets/samples`, `assets/dielines` - downloads, loaded only on demand.
* `vendor/three` - three.js r175 **minified** build (byte-identical source to the official 0.175.0 package) plus
  only the add-ons in use.

Regenerate the box assets after a dieline change: `python _SUPPORT/generator/build_all.py web` (writes WebP).

## Workflow (designers)

1. Open `../PACKAGING_PRINT_FILES/TEMPLATES-BLANK/BOX-xx_CASE_TEMPLATE-BLANK.ai` (or the `.pdf`) in Illustrator.
2. Design on the layer **ARTWORK (design here)**; artboard 1 = outside, artboard 2 = inside (reverse, mirrored).
3. Export *Adobe PDF* [PDF/X-4:2008], all artboards, *Create Acrobat Layers from Top-Level Layers* on.
4. **Design → Import PDF…** (or drop the file). The importer reads the TrimBox, recognises box / component from the
   page size, hides technical layers (`DIE_*`, `GUIDE_*`, `TECH_*`) and maps page 1 / 2 to outside / inside. The
   rasterised pages are resampled to the quality tier's resolution on the GPU and released from memory.

## Video export

Frames are rendered one by one (accumulated samples per frame) and pushed into `MediaRecorder`; the recorder is
paused while each frame renders, so the recorded timeline advances exactly 1/fps per frame and the video plays at
the intended speed regardless of render time. MP4 (H.264) where the browser supports it, otherwise WebM (VP9).
Keep the tab in the foreground while recording.

## Controls

Drag to orbit, wheel to zoom, right-drag to pan, click a confection to inspect, `O` open / close, `L` tray,
`E` next set (`Shift+E` previous), `R` reset, `1` `2` `3` variant, `Space` play / pause, `Esc` leave.
Touch: one finger orbits, pinch zooms, two fingers pan, tap to inspect, double-tap opens / closes, long-press lifts
the tray.

## URL parameters

`?sku=BOX-15` · `&open=112` · `&env=yerevan` · `&mode=studio` · `&cam=x,y,z,tx,ty,tz` · `&debug`.

## Files

```
index.html, css/app.css          UI
sw.js                            service worker (bump VERSION per deploy)
js/app.js                        state, UI wiring, import flow, inspect mode, exports, timeline player, loader
js/viewer.js                     renderer, quality tiers, progressive accumulation, lenses, IBL capture, light rig
js/environments.js               the seven sets (geometry, light logic, white balance, exposure, shots)
js/props.js                      tableware, cutlery, glassware, furniture, fruit, vegetation (real dimensions)
js/lookdev.js                    GPU-baked material recipes and calibrated material presets
js/texbake.js                    GPU texture baker (periodic noise library)
js/sky.js                        HDR sky dome, Mount Ararat card
js/units.js                      scale reference, lenses, colour temperature
js/artwork.js                    page textures, foil / laminate / edge materials
js/panelgeom.js, js/boxmodel.js  board slab geometry, fold fillets, fold kinematics
js/confections.js                confection coating shader, glassine cups, placement
js/timeline.js, js/recorder.js   video / fold timelines, MediaRecorder capture
js/pdfimport.js                  PDF / image import (lazy-loaded with pdf.js and pdf-lib)
```
