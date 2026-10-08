// Frame-driven video capture: the animation is rendered frame by frame at the chosen size, each frame is pushed
// into a MediaRecorder stream (canvas.captureStream(0) + requestFrame).  Output: WebM (VP9) in Chromium / Firefox,
// MP4 (H.264) where the browser's MediaRecorder supports it (Safari 14.5+, recent Chrome on some platforms).
export function pickMime() {
  const cands = ['video/mp4;codecs=avc3.42E01E', 'video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
  return null;
}

/**
 * @param viewer     Viewer
 * @param opts       {width, height, fps, duration (s), bitrate, onFrame(t), onProgress(k, msg), signal}
 * @returns {blob, mime, ext, frames}
 */
export async function recordVideo(viewer, opts) {
  const { width, height, fps = 30, duration = 8, bitrate = 14e6, onFrame, onProgress = () => { }, signal } = opts;
  const mime = opts.mime || pickMime();
  if (!mime) throw new Error('This browser cannot record video (no MediaRecorder support).');
  const canvas = viewer.canvas;
  const prev = { ...viewer.viewSize };
  viewer.paused = true;
  viewer.setSize(width, height, 1);
  // settle the drawing buffer at the export size before the stream is attached (keeps the H.264 SPS constant)
  onFrame(0); viewer.renderFrame(); await new Promise(r => setTimeout(r, 80)); viewer.renderFrame(); await new Promise(r => setTimeout(r, 40));
  const stream = canvas.captureStream ? canvas.captureStream(0) : null;
  if (!stream) throw new Error('canvas.captureStream is not available in this browser.');
  const track = stream.getVideoTracks()[0];
  const manual = typeof track.requestFrame === 'function';
  if (!manual) { stream.getVideoTracks()[0].stop(); }
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
      const t = i / (N - 1);
      onFrame(t);
      viewer.renderFrame();
      const due = t0 + i * frameMs;
      const now = performance.now();
      if (now < due) await new Promise(r => setTimeout(r, due - now));
      if (manual) { const tr = liveStream.getVideoTracks()[0]; tr.requestFrame(); }
      if (i % 5 === 0) { onProgress(i / N, `Recording frame ${i + 1} / ${N}`); await new Promise(r => setTimeout(r, 0)); }
    }
    // hold the last frame so the encoder flushes it
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
