// earcut loader (same 2.2.4 algorithm everywhere):
//  * Node (server.js API, tests, the local-version build): the npm package
//  * browser / worker served by server.js: /vendor/earcut.mjs (no CDN needed)
//  * browser served statically (tools/serve_web.py, GitHub): the jsDelivr CDN
// Import maps don't reach module workers, so this can't be a bare "earcut" specifier.
let mod;
if (typeof process !== "undefined" && process.versions && process.versions.node) {
  mod = await import("earcut");
} else {
  try {
    mod = await import(new URL("../vendor/earcut.mjs", import.meta.url).href);
  } catch (e) {
    mod = await import("https://cdn.jsdelivr.net/npm/earcut@2.2.4/+esm");
  }
}
const earcut = mod.default ?? mod;
export default earcut;
