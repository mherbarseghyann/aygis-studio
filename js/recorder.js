// Frame-accurate video export.
//  * Primary: WebCodecs VideoEncoder (H.264 baseline, no B-frames) + a minimal progressive MP4 muxer below. Every
//    frame gets an exact timestamp i / fps, so the video plays at the intended speed however long a frame takes to
//    render (accumulated samples at 1080p take much longer than 1/fps). Chrome, Edge, Safari 16.4+, recent Firefox.
//  * Fallback: MediaRecorder on the canvas stream (real-time paced; frames that render slower than 1/fps stretch
//    the timeline, so this path is only used where WebCodecs is missing).
export function pickMime() {
  if (typeof VideoEncoder !== 'undefined') return 'video/mp4;codecs=avc1.42E028';
  const cands = ['video/mp4;codecs=avc3.42E01E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
  return null;
}

/**
 * @param viewer     Viewer
 * @param opts       {width, height, fps, duration (s), bitrate, samples, onFrame(t), onProgress(k, msg), signal}
 * @returns {blob, mime, ext, frames}
 */
export async function recordVideo(viewer, opts) {
  if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
    const level = opts.width * opts.height > 2.1e6 ? '33' : '28';              // 4.0 up to 1080p, 5.1 beyond
    const codec = 'avc1.42E0' + level;
    try {
      const sup = await VideoEncoder.isConfigSupported({ codec, width: even(opts.width), height: even(opts.height), bitrate: opts.bitrate || 14e6, framerate: opts.fps || 30, avc: { format: 'avc' } });
      if (sup && sup.supported) return await recordWebCodecs(viewer, { ...opts, codec });
    } catch (e) { console.warn('WebCodecs unavailable, falling back to MediaRecorder', e); }
  }
  return recordMediaRecorder(viewer, opts);
}
const even = (v) => v + (v & 1);

async function recordWebCodecs(viewer, opts) {
  const { fps = 30, duration = 8, bitrate = 14e6, onFrame, onProgress = () => { }, signal, samples = 6, codec } = opts;
  const width = even(opts.width), height = even(opts.height);
  const prev = { ...viewer.viewSize };
  viewer.paused = true;
  viewer.setSize(width, height, 1);
  const chunks = []; let description = null; let error = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); chunks.push({ data: d, key: chunk.type === 'key' }); if (meta && meta.decoderConfig && meta.decoderConfig.description) description = new Uint8Array(meta.decoderConfig.description); },
    error: (e) => { error = e; },
  });
  enc.configure({ codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', avc: { format: 'avc' } });
  const N = Math.max(2, Math.round(duration * fps)), dt = 1e6 / fps, keyEvery = Math.round(fps * 2);
  try {
    for (let i = 0; i < N; i++) {
      if (signal && signal.aborted) break;
      if (error) throw error;
      onFrame(i / (N - 1));
      viewer.renderAccumulated(samples);                                  // AA + soft shadows + depth of field
      const frame = new VideoFrame(viewer.canvas, { timestamp: Math.round(i * dt), duration: Math.round(dt) });
      enc.encode(frame, { keyFrame: i % keyEvery === 0 }); frame.close();
      while (enc.encodeQueueSize > 3) await new Promise(r => setTimeout(r, 4));
      if (i % 5 === 0) { onProgress(i / N, `Rendering frame ${i + 1} / ${N}`); await new Promise(r => setTimeout(r, 0)); }
    }
    await enc.flush();
    if (error) throw error;
  } finally {
    try { enc.close(); } catch (e) { }
    viewer.setSize(prev.w, prev.h, prev.pr);
    viewer.paused = false;
  }
  if (!description) throw new Error('encoder returned no AVC configuration');
  const blob = muxMP4(chunks, description, width, height, fps);
  return { blob, mime: 'video/mp4', ext: 'mp4', frames: chunks.length };
}

// ------------------------------------------------------------------ minimal progressive MP4 (ISO BMFF) muxer
function muxMP4(samples, avcC, width, height, fps) {
  const u32 = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const u16 = (v) => [(v >>> 8) & 255, v & 255];
  const str = (s) => Array.from(s).map(c => c.charCodeAt(0));
  const box = (type, ...parts) => { const body = parts.flat(Infinity); return [...u32(8 + body.length), ...str(type), ...body]; };
  const full = (type, ver, flags, ...parts) => box(type, [ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);
  const timescale = fps * 1000, delta = 1000, n = samples.length, durMs = Math.round(n * 1000 / fps);
  const matrix = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];
  const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
  const mdatSize = 8 + samples.reduce((a, s) => a + s.data.length, 0);
  const dataOffset = ftyp.length + 8;
  const avc1 = box('avc1', [0, 0, 0, 0, 0, 0], u16(1), new Array(16).fill(0), u16(width), u16(height), u32(0x00480000), u32(0x00480000), u32(0), u16(1),
    new Array(32).fill(0), u16(0x0018), u16(0xffff), box('avcC', Array.from(avcC)));
  const stbl = box('stbl',
    full('stsd', 0, 0, u32(1), avc1),
    full('stts', 0, 0, u32(1), u32(n), u32(delta)),
    full('stss', 0, 0, u32(samples.filter(s => s.key).length), samples.map((s, i) => (s.key ? u32(i + 1) : [])).flat()),
    full('stsc', 0, 0, u32(1), u32(1), u32(n), u32(1)),
    full('stsz', 0, 0, u32(0), u32(n), samples.map(s => u32(s.data.length)).flat()),
    full('stco', 0, 0, u32(1), u32(dataOffset)));
  const minf = box('minf', full('vmhd', 0, 1, [0, 0, 0, 0, 0, 0, 0, 0]), box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))), stbl);
  const mdia = box('mdia', full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(n * delta), u16(0x55c4), u16(0)),
    full('hdlr', 0, 0, u32(0), str('vide'), u32(0), u32(0), u32(0), str('AYGIS video'), [0]), minf);
  const tkhd = full('tkhd', 0, 3, u32(0), u32(0), u32(1), u32(0), u32(durMs), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), matrix, u32(width << 16), u32(height << 16));
  const mvhd = full('mvhd', 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x10000), u16(0x100), u16(0), u32(0), u32(0), matrix, new Array(24).fill(0), u32(2));
  const moov = box('moov', mvhd, box('trak', tkhd, mdia));
  return new Blob([new Uint8Array(ftyp), new Uint8Array([...u32(mdatSize), ...str('mdat')]), ...samples.map(s => s.data), new Uint8Array(moov)], { type: 'video/mp4' });
}

// ------------------------------------------------------------------ fallback: MediaRecorder (real-time paced)
async function recordMediaRecorder(viewer, opts) {
  const { width, height, fps = 30, duration = 8, bitrate = 14e6, onFrame, onProgress = () => { }, signal, samples = 6 } = opts;
  const cands = ['video/mp4;codecs=avc3.42E01E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const mime = typeof MediaRecorder !== 'undefined' ? cands.find(c => MediaRecorder.isTypeSupported(c)) : null;
  if (!mime) throw new Error('This browser cannot record video (no WebCodecs or MediaRecorder support).');
  const canvas = viewer.canvas;
  const prev = { ...viewer.viewSize };
  viewer.paused = true;
  viewer.setSize(width, height, 1);
  onFrame(0); viewer.renderAccumulated(samples); await new Promise(r => setTimeout(r, 80)); viewer.renderAccumulated(samples); await new Promise(r => setTimeout(r, 40));
  const stream = canvas.captureStream ? canvas.captureStream(0) : null;
  if (!stream) throw new Error('canvas.captureStream is not available in this browser.');
  const track = stream.getVideoTracks()[0];
  const manual = typeof track.requestFrame === 'function';
  if (!manual) track.stop();
  const liveStream = manual ? stream : canvas.captureStream(fps);
  const rec = new MediaRecorder(liveStream, { mimeType: mime, videoBitsPerSecond: bitrate });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise((res) => { rec.onstop = res; });
  const N = Math.max(2, Math.round(duration * fps));
  const frameMs = 1000 / fps;
  try {
    rec.start();
    const t0 = performance.now() + 60;
    for (let i = 0; i < N; i++) {
      if (signal && signal.aborted) break;
      onFrame(i / (N - 1));
      viewer.renderAccumulated(samples);
      const due = t0 + i * frameMs, now = performance.now();
      if (now < due) await new Promise(r => setTimeout(r, due - now));
      if (manual) liveStream.getVideoTracks()[0].requestFrame();
      if (i % 5 === 0) { onProgress(i / N, `Recording frame ${i + 1} / ${N}`); await new Promise(r => setTimeout(r, 0)); }
    }
    await new Promise(r => setTimeout(r, frameMs * 2));
    rec.stop();
    await done;
  } finally {
    liveStream.getTracks().forEach(tr => tr.stop());
    viewer.setSize(prev.w, prev.h, prev.pr);
    viewer.paused = false;
  }
  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  return { blob, mime, ext: mime.includes('mp4') ? 'mp4' : 'webm', frames: N };
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
