// Warms the HTTP cache with the MediaPipe bundle, wasm and face model while the person reads the welcome
// screen, so the camera screen does not wait for ~12 MB later. The files are fetched one after another at
// low priority and thrown away; MediaPipe's own requests for the same URLs then come from the cache
// (the server sends Cache-Control: max-age=7d for /vendor and /models). Skipped on Data Saver.

const SIMD_TEST = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11);

export function supportsSimd() {
  try { return WebAssembly.validate(SIMD_TEST); } catch { return false; }
}

export function preloadUrls(simd = supportsSimd()) {
  const wasm = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  return [
    '/vendor/mediapipe/vision_bundle.js',
    `/vendor/mediapipe/wasm/${wasm}.js`,
    `/vendor/mediapipe/wasm/${wasm}.wasm`,
    '/models/face_landmarker.task',
  ];
}

async function drain(res) {
  const reader = res.body?.getReader?.();
  if (!reader) { await res.arrayBuffer(); return; }
  while (!(await reader.read()).done) { /* discard */ }
}

let started = false;
export async function warmUp({ fetchFn = (...a) => fetch(...a), nav = globalThis.navigator } = {}) {
  if (started || nav?.connection?.saveData) return;
  started = true;
  for (const url of preloadUrls()) {
    try { await drain(await fetchFn(url, { priority: 'low' })); } catch { return; }   // offline or blocked: the camera screen will load them
  }
}

// Start once the welcome screen has painted.
export function warmUpWhenIdle() {
  const go = () => warmUp();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 });
  else setTimeout(go, 800);
}
