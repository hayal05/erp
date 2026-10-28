// Selfie capture helpers (spec 7 step 3). Pure maths + an injectable encoder, so the compression rules are unit-tested
// without a browser. The browser pieces (video -> canvas -> JPEG) are thin wrappers at the bottom.

export const TARGET_MAX_BYTES = 200 * 1024; // upper end of the ~100-200 KB goal (server hard cap is 600 KB)
export const PREFERRED_BYTES = 160 * 1024; // aim a little under the cap so one more bit of noise cannot cross it
export const MAX_SIDE = 960;
const MIN_SIDE = 320;
const MIN_QUALITY = 0.4;
const MAX_QUALITY = 0.92;

// Scale (width, height) down so the longer side is at most maxSide. Never scales up. Whole pixels, at least 1.
export function fitWithin(width, height, maxSide = MAX_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

// Largest JPEG quality whose size is <= limit, by bisection (size grows with quality). Returns null if even MIN_QUALITY is too big.
async function bestQuality(encode, width, height, limit) {
  let lo = MIN_QUALITY, hi = MAX_QUALITY, best = null;
  const top = await encode(width, height, hi);
  if (top.size <= limit) return { blob: top, quality: hi };
  for (let i = 0; i < 5; i += 1) {
    const mid = (lo + hi) / 2;
    const blob = await encode(width, height, mid);
    if (blob.size <= limit) { best = { blob, quality: mid }; lo = mid; } else hi = mid;
  }
  if (best) return best;
  const floor = await encode(width, height, MIN_QUALITY);
  return floor.size <= limit ? { blob: floor, quality: MIN_QUALITY } : null;
}

// Encode at the best quality that fits under the limit; if the lowest quality is still too big, shrink the picture by
// 15% and try again (down to MIN_SIDE). encode(width, height, quality) -> Promise<{size}>. Returns {blob, width, height, quality}.
export async function compressToTarget(encode, srcWidth, srcHeight, { limit = PREFERRED_BYTES, maxSide = MAX_SIDE } = {}) {
  let side = maxSide;
  for (;;) {
    const { width, height } = fitWithin(srcWidth, srcHeight, side);
    const found = await bestQuality(encode, width, height, limit);
    if (found) return { ...found, width, height };
    if (side <= MIN_SIDE) {
      const blob = await encode(width, height, MIN_QUALITY);
      return { blob, width, height, quality: MIN_QUALITY };
    }
    side = Math.max(MIN_SIDE, Math.floor(side * 0.85));
  }
}

// Native size of the video frame (0 until the first frame has loaded).
export function frameSize(video) {
  return { width: video?.videoWidth || 0, height: video?.videoHeight || 0 };
}

// Browser only: draw the current video frame (not mirrored: the saved photo shows the scene as it is) and compress it.
export async function captureSelfie(video) {
  const { width: sw, height: sh } = frameSize(video);
  if (!sw || !sh) throw new Error('camera_not_ready');
  const canvas = document.createElement('canvas');
  const encode = (width, height, quality) => new Promise((resolve, reject) => {
    canvas.width = width; canvas.height = height;
    canvas.getContext('2d').drawImage(video, 0, 0, width, height);
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality);
  });
  return compressToTarget(encode, sw, sh);
}

// Why the camera could not start -> a short message for the person (never the raw browser error).
export function describeCameraError(err) {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Camera access is blocked. Allow the camera for this site in your browser settings, then try again.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No front camera was found on this device.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The camera is busy. Close other apps using it and try again.';
  if (err?.message === 'unsupported') return 'This browser cannot open the camera here. Use a recent browser over a secure (https) connection.';
  return 'The camera could not be started. Please try again.';
}

// Browser only: Blob -> raw base64 (no 'data:' prefix), the form POST /attendance/scan expects.
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*;base64,/, ''));
    reader.onerror = () => reject(new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}
