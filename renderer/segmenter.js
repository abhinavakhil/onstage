/* Person segmentation for the camera (MediaPipe selfie model, runs locally).
   personMask(video, now) returns a canvas whose alpha channel is "how much this pixel is the person",
   or null while the model is still loading or if it could not start. */
(() => {
  'use strict';
  const BASE = 'vendor/mediapipe';
  const maskCanvas = document.createElement('canvas');
  const mctx = maskCanvas.getContext('2d');
  let segmenter = null, loading = null, failed = false, pixels = null, lastRun = 0, hasMask = false;

  async function load() {
    const { FilesetResolver, ImageSegmenter } = await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}/wasm`);
    const create = (delegate) => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${BASE}/selfie_segmenter.tflite`, delegate },
      runningMode: 'VIDEO', outputCategoryMask: false, outputConfidenceMasks: true,
    });
    segmenter = await create('GPU').catch(() => create('CPU'));
  }

  function onResult(result) {
    const mask = result.confidenceMasks[result.confidenceMasks.length - 1];
    const data = mask.getAsFloat32Array();
    if (!pixels || pixels.width !== mask.width || pixels.height !== mask.height) {
      maskCanvas.width = mask.width; maskCanvas.height = mask.height;
      pixels = mctx.createImageData(mask.width, mask.height);
    }
    for (let i = 0; i < data.length; i++) pixels.data[i * 4 + 3] = data[i] * 255;
    mctx.putImageData(pixels, 0, 0);
    hasMask = true;
  }

  window.personMask = (video, now) => {
    if (failed) return null;
    if (!segmenter) {
      loading ||= load().catch((err) => {
        failed = true;
        console.error('segmenter failed', err);
        window.dispatchEvent(new CustomEvent('segmenter-error', { detail: err.message }));
      });
      return null;
    }
    // ~20 masks a second is plenty; the camera itself still draws at full rate
    if (now - lastRun >= 50) { lastRun = now; segmenter.segmentForVideo(video, now, onResult); }
    return hasMask ? maskCanvas : null;
  };
})();
