#!/usr/bin/env node
// Builds dist/3dp-planetary-generator-local.html: the whole web app (three.js, earcut, the gear code
// and the web worker) in ONE html file that runs offline from a double-click (file://).
//   npm run build
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const OUT = path.join(ROOT, "dist", "3dp-planetary-generator-local.html");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

// three/addons -> three/examples/jsm; the earcut loader -> the npm package (no top-level await in an IIFE)
const resolver = {
  name: "local-resolve",
  setup(b) {
    b.onResolve({ filter: /^three\/addons\// }, (a) => ({ path: require.resolve(a.path.replace("three/addons/", "three/examples/jsm/")) }));
    b.onResolve({ filter: /^\.\/earcut\.js$/ }, () => ({ path: "earcut-shim", namespace: "shim" }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, () => ({ contents: 'import e from "earcut"; export default e;', resolveDir: ROOT, loader: "js" }));
  },
};
const common = { bundle: true, format: "iife", minify: true, target: ["es2020"], plugins: [resolver], logLevel: "warning", write: false };

const worker = await esbuild.build({ ...common, entryPoints: [path.join(ROOT, "web", "js", "worker.js")] });
const workerSrc = worker.outputFiles[0].text;
const appJs = await esbuild.build({
  ...common,
  entryPoints: [path.join(ROOT, "web", "js", "app.js")],
  define: { __PB_WORKER_SRC__: JSON.stringify(workerSrc), "import.meta.url": '"about:blank"' },
});
const bundle = appJs.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

let html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
html = html
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, "")
  .replace(/<script type="module" src="\.\/js\/app\.js"><\/script>/, () => `<script>\n${bundle}\n</script>`)
  .replace("<title>Planetary Bearing</title>", "<title>Planetary Generator (local)</title>")
  .replace('<h1>Planetary Bearing</h1>', `<h1>Planetary Bearing <small style="font-weight:400;color:var(--muted)">local v${PKG.version}</small></h1>`);
if (html.includes('type="module"') || html.includes("importmap")) throw new Error("module script left in the local build");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(html.length / 1024).toFixed(0)} KB)`);
