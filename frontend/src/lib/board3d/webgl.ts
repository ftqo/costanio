// Can this client draw the board? If not, the game screen shows a message where
// the board would be and the lobby skips the model warm-up.
//
// Cached: probing costs a real GL context and the answer is fixed per page load.
let cached: boolean | undefined;

export function supportsWebGL(): boolean {
  if (cached !== undefined) return cached;
  cached = probe();
  return cached;
}

function probe(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    // `webgl2` only: three.js's WebGLRenderer requires it, so a WebGL 1 client
    // would pass a looser probe and then throw in the renderer.
    const gl = canvas.getContext("webgl2");
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
