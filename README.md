# AYGIS Packaging Studio

Browser-based packaging visualization studio for the AYGIS confection boxes (BOX-05 / BOX-10 / BOX-15), folded
from the **production dielines** (`../PACKAGING_PRINT_FILES`, R1.1, magnetic closure) with the concept's confection
models. Three modes:

* **Design** - inspect your artwork on the finished package: import a PDF designed on a blank template, switch
  5 / 10 / 15, open / close, lift the tray, inspect confections, choose one of 11 photo-set environments.
* **Render** - still product shots at print sizes (up to 4096 px), with camera presets, formats and a transparent
  PNG option.
* **Studio** - *Video*: cinematic presets (Orbit, Slow Product Slide, Box Opening, Box Closing, Open + Orbit,
  Hero Reveal) previewed in the viewport and exported as video; *Fold*: the flat printed sheet folding into the
  box along the real creases, with play / pause / scrub.

Everything works with the imported artwork - the user's PDF stays the surface artwork in every mode.

## Run

No build step. The page needs a local web server (browsers block texture / PDF loading from `file://`).

```bash
cd AYGIS_3D_PREVIEW
python3 -m http.server 8765
```

then open <http://localhost:8765>.  On macOS you can also double-click `serve.command`.
Any static server works (`npx serve`, VS Code Live Server, …).  Chrome, Safari 16+, Firefox and Edge are fine;
WebGL 2 is required.  Everything (three.js, pdf.js, pdf-lib) is vendored in `vendor/`, so it runs offline.

## Workflow

1. Open `../PACKAGING_PRINT_FILES/TEMPLATES-BLANK/BOX-xx_CASE_TEMPLATE-BLANK.ai` (or the `.pdf`) in Illustrator.
2. Design on the layer **ARTWORK (design here)**; artboard 1 = outside, artboard 2 = inside (reverse, mirrored).
   Keep the DIE / GUIDE layers untouched. Fill to the bleed guide, keep text inside the safe guide, and read the
   orientation hint under each panel name (panels that look rotated on the flat are upright on the box).
3. Export: *File → Save As → Adobe PDF*, preset **[PDF/X-4:2008]** (or High Quality Print), all artboards,
   *Create Acrobat Layers from Top-Level Layers* on. For the printer enter a 3 mm bleed under *Marks and Bleeds*
   (the template document stores no bleed value); for the preview, bleed on or off both work.
4. In the preview: **Design → Import PDF…** (or drop the file on the page).  The importer reads the page's
   TrimBox, recognises which box / component the page belongs to from its size, hides the technical layers
   (`DIE_*`, `GUIDE_*`, `TECH_*`) and maps page 1 to the outside faces and page 2 to the inside faces.
   The variant switches automatically if the PDF belongs to another box size.
5. Rotate / zoom, **Open box**, **Lift tray**, click a confection to inspect it, change the environment, **Save image**.

Also accepted: an INSERT template PDF (mapped onto the tray), a PNG/JPEG covering exactly the trim area of the
current CASE template, and the production PDF/X-4 files themselves (*Load a sample design…*).

## Rendering

* Materials: coated folding board as a physical material (satin clearcoat, fibre bump, roughness variation,
  specular response), raw board core on the knife-cut edges only. The 0.45 mm edge faces that lie on a crease are
  textured like the printed face, so folds read as continuous printed surface (this removed the light seam lines of
  the first version, which were the exposed board-core faces along every crease).
* Lighting: per-environment procedural equirectangular backdrop used as image-based lighting (PMREM) and as the
  blurred background, a key light with soft shadow map, fill and hemisphere lights; a blurred-depth contact shadow
  under the box; ACES tone mapping with per-environment exposure.
* Post-processing (toggle under *Rendering* in the Design tab): ground-truth ambient occlusion (GTAO) for the
  interior and contact areas, a very light bloom for foil highlights, MSAA.
* Environments are generated at runtime from noise (wood, marble, linen, gingham, tuff stone, lacquer) and
  painted backdrops (softboxes, café bokeh, shelves, the Ararat silhouette for the Yerevan terrace); no image
  downloads, works offline.

## Scenes

Each environment is a dressed set, built procedurally at runtime: the picnic has a finite gingham cloth on grass
(instanced tufts) with a wicker basket, apples, a plate with a real confection, a glass and a napkin; the cafés
have bistro tables with chairs, cups, spoons and plates; the Yerevan terrace a pink tuff slab with a jezve, a small
coffee cup, apricots and a plate; the Cascade a stone plaza with stepped terraces, a central staircase, hedge planters
and two fountains; the shop a walnut counter with stocked shelves and a cake stand; the dark table a candle (with its
own warm light). Confections on the props are the same meshes as in the box.

## Render what you see

In the Render tab the defaults are **Current view** + **Viewport**: place the box, orbit and zoom, then *Render still*
exports exactly the framing on screen at the chosen size. Picking another format shows a gold frame guide over the
viewport for the crop. The optional camera presets are still there for quick standard shots.

## Cinematic look and sharing

*Rendering* (Design tab) has **Depth of field** (focus follows the orbit target) and **Cinematic look** (vignette, film
grain, slight chromatic aberration) in addition to ambient occlusion and bloom. **Copy share link** puts box, scene,
open/tray state and the exact camera into the URL so a client can open the same view on the same server; a sample
design is included in the link, an imported PDF is not (it lives only in the browser).

## Video export

Recording uses the browser's `MediaRecorder` on the WebGL canvas, frame by frame at the chosen size and frame rate
(the animation is driven by frame index, not wall-clock, so the export is deterministic).
* Chrome / Edge: MP4 (H.264) where the platform supports it, otherwise WebM (VP9).  Firefox: WebM.  Safari 14.5+: MP4.
* WebM plays in Chrome, Edge, Firefox and VLC; convert with HandBrake or `ffmpeg -i in.webm -c:v libx264 -pix_fmt yuv420p out.mp4`
  for Keynote / PowerPoint.
* Keep the browser tab in the foreground while recording (background tabs throttle timers).

## How the mapping works

* `assets/models/box_models.json` is exported by the same generator that produces the dielines
  (`_SUPPORT/generator/export_web.py`): every panel polygon (mm, printed face), every crease as a hinge with its
  closed angle, the case flip transform and the insert placement.  `js/boxmodel.js` folds it exactly like the
  Python fold simulation (`foldsim.py`), so the 3D box *is* the dieline.
* Panel UVs are the flat millimetre coordinates. A page texture is mapped with one affine texture matrix
  per side (`js/artwork.js`): outside page → front faces, inside page (mirrored in X, as printed on the reverse)
  → back faces.  Adjacent panels therefore share one continuous texture: no seams, no per-panel cropping.
* PDF import (`js/pdfimport.js`): pdf-lib reads MediaBox/TrimBox, pdf.js rasterises each page at 8 px/mm
  (capped at 4096 px) with technical optional-content groups switched off.  A page whose trim size matches a
  template (±1 mm, with or without 3 / 3.175 / 5 mm bleed) is assigned to that SKU / component.
* The lid opens about the real hinge crease; the front flap hangs under gravity, is pushed outwards by the
  front wall while the lid is nearly closed and stays in line with the lid past 90° (`lidAngles()`).
* Confections: the vertex-coloured meshes from the concept GLB (`assets/models/confections.glb`,
  scaled to the 22 mm product envelope) in the production paper cup (25 base × 34 top × 16 mm) sitting on the
  insert's lower deck, at the cavity centres of the dieline.
* Gold foil / metallic ink of the brand artwork is rendered as metal via a metalness/roughness mask generated
  from the production artwork (`assets/artwork/*_gold.png`); imported designs are rendered as coated board.

## Files

```
index.html, css/app.css          UI (Design / Render / Studio)
js/app.js                        state, UI wiring, import flow, inspect mode, render + video exports, timeline player
js/viewer.js                     renderer, post-processing, contact shadow, environments, cameras, still render
js/environments.js               the curated environment set (backdrop, ground, props, light rig per environment)
js/procgen.js                    noise, procedural material textures, equirect backdrops
js/timeline.js                   easing, video presets, dieline-driven fold sequence and its camera path
js/recorder.js                   MediaRecorder capture
js/boxmodel.js                   fold kinematics (FoldedComponent, lidAngles)
js/panelgeom.js                  polygon-with-holes -> board slab geometry (front / back / crease-edge / cut-edge groups)
js/artwork.js                    page textures, texture matrices, paper material
js/confections.js                confection + cup placement, inspect data
js/pdfimport.js                  PDF / image import and template matching
assets/models/box_models.json    geometry of the three boxes (generated)
assets/models/confections.glb    confection + cup meshes (generated from the concept GLB)
assets/artwork/*.jpg|png         default (brand) artwork pages + gold masks (generated from the print masters)
assets/samples/*.pdf             production PDFs, blank templates and test designs for the sample menu
vendor/                          three.js 0.175 (+ OrbitControls, GLTFLoader, post-processing passes), pdf.js 4.10, pdf-lib 1.17, Cormorant Garamond + Inter (OFL)
```

Regenerate the assets after a dieline change: `python _SUPPORT/generator/build_all.py web`.

## Client mode and designer mode

The page opens in **client mode**: everything needed for a presentation (variants, open / close, tray, inspect,
environments, render, video, fold studio, share link) and nothing else. **Designer access** (bottom of the panel)
asks for a PIN and unlocks the *Dielines* section (download the blank CASE / INSERT template as PDF or AI for the
selected box) and the *Artwork* section (import the designed PDF, load sample designs, white board). The PIN check
is client-side (a hash in `js/access.js`), which keeps clients out of designer tools but is not real security; the
template files themselves are public static files. Change the PIN by replacing the hash in `js/access.js`
(`printf '%s' NEWPIN | shasum -a 256`). Designer mode lasts for the browser session; *Exit designer mode* ends it.

## Hosting

Everything is static and client-side: no server code, no API. Deploy the folder as-is to any static host
(Cloudflare Pages, GitHub Pages, Netlify). `_headers` sets long cache lifetimes for the vendored libraries on
Cloudflare; `.nojekyll` keeps GitHub Pages from ignoring underscore files. The share link always uses the page's own
origin and path, so it works on a sub-path such as `user.github.io/aygis-studio/`.

## Controls and gestures

* Every panel section collapses by clicking its title (remembered between visits). The quick bar at the bottom of
  the viewport always offers Open / Close, Tray, 5 / 10 / 15, next Scene, reset View and Snapshot.
* Mouse / keyboard: drag to orbit, wheel to zoom, right-drag to pan, click a confection to inspect, `O` open / close,
  `L` tray, `E` next environment (`Shift+E` previous), `R` reset, `1` `2` `3` variant, `Space` play / pause, `Esc` leave.
* Touch: one finger orbits, pinch zooms, two fingers pan, tap a confection to inspect, **double-tap** the viewport to
  open / close, **long-press** to lift the tray. On phones the control panel is a bottom sheet behind the ☰ button;
  swipe the handle down to hide it.

## URL parameters

`?sku=BOX-15` start variant · `&open=112` start with the lid open · `&env=yerevan` start environment · `&mode=studio` start mode.
