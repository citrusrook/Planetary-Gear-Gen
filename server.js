#!/usr/bin/env node
// Node.js server for the 3DP Herringbone Planetary Generator.
//  * serves the web app (web/) with three.js and earcut from node_modules (no CDN needed)
//  * /download/local  -> single-file offline version (dist/, built by `npm run build`)
//  * JSON API using the same gear code as the browser: /api/defaults, /api/solve, /api/report, /api/stl
//  * /web/tests.html + /fixtures for the browser port checks
// Render: binds 0.0.0.0:$PORT (see render.yaml).
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import * as pm from "./web/js/pbmath.js";
import { build } from "./web/js/engine.js";
import { writeSTL } from "./web/js/stl.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const THREE_DIR = path.dirname(path.dirname(require.resolve("three")));   // .../three/build/three.cjs -> .../three
const EARCUT_SRC = require.resolve("earcut");
const LOCAL_FILE = path.join(ROOT, "dist", "3dp-planetary-generator-local.html");
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------- the app page
// index.html is written for the CDN; here the import map points at node_modules and a
// "Local version" download link is added to the header.
function indexHtml() {
  let html = fs.readFileSync(path.join(ROOT, "web", "index.html"), "utf8");
  html = html
    .replace("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js", "/vendor/three/build/three.module.js")
    .replace("https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/", "/vendor/three/examples/jsm/")
    .replace('src="./js/app.js"', 'src="/js/app.js"')
    .replace('<button id="reset"', '<a class="btnlink" href="/download/local" download title="One HTML file that runs offline in any browser (double-click it)">Local version</a>\n    <button id="reset"')
    .replace("</style>", "  a.btnlink { color: inherit; text-decoration: none; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; white-space: nowrap; }\n  a.btnlink:hover { border-color: var(--muted); }\n</style>");
  return html;
}
const sendIndex = (req, res) => res.type("html").send(indexHtml());
app.get(["/", "/index.html", "/web/", "/web/index.html"], sendIndex);

const noStore = { setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") };
app.use("/js", express.static(path.join(ROOT, "web", "js"), noStore));
app.use("/web", express.static(path.join(ROOT, "web"), noStore));
app.use("/fixtures", express.static(path.join(ROOT, "fixtures"), noStore));
app.use("/vendor/three", express.static(THREE_DIR, { maxAge: "7d" }));
// earcut 2.2.4 ships as CommonJS: wrap it as an ES module for the browser and the worker
const earcutEsm = `const module = { exports: {} };\n${fs.readFileSync(EARCUT_SRC, "utf8")}\nexport default module.exports;\n`;
app.get(["/vendor/earcut.mjs", "/web/vendor/earcut.mjs"], (req, res) => res.type("text/javascript").send(earcutEsm));

// ---------------------------------------------------------------- local version
app.get("/download/local", (req, res) => {
  if (!fs.existsSync(LOCAL_FILE)) {
    res.status(503).type("text").send("The local version has not been built on this server yet (npm run build).");
    return;
  }
  res.download(LOCAL_FILE, "3dp-planetary-generator-local.html");
});

// ---------------------------------------------------------------- API
const params = (body) => {
  const p = { ...pm.DEFAULTS };
  const src = (body && body.params) || {};
  for (const [k, v] of Object.entries(src)) {
    if (!(k in pm.DEFAULTS)) continue;                                   // only known keys
    if (typeof v !== typeof pm.DEFAULTS[k]) continue;                    // and the right type
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    p[k] = v;
  }
  return p;
};
// builds are synchronous (one at a time on Node's event loop); errors become 400s
function guarded(fn) {
  return (req, res) => {
    try { fn(req, res); } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
  };
}

app.get("/api/health", (req, res) => res.json({ ok: true, version: PKG.version }));
app.get("/api/defaults", (req, res) => res.json(pm.DEFAULTS));
app.post("/api/solve", guarded((req, res) => {
  const p = params(req.body);
  const lock = ["N", "Zr", "Zs", "Zp"].includes(req.body?.lock) ? req.body.lock : null;
  res.json(pm.solve(p, lock));
}));
app.post("/api/report", guarded((req, res) => {
  const p = params(req.body);
  const s = pm.solve(p, null);
  const q = { ...p, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N };
  const g = pm.derive(q);
  res.json({ params: q, report: pm.report(q, g, pm.buildProfiles(q, g), s.notes) });
}));
const PICK = { all: () => true, ring: (n) => n === "ring", sun: (n) => n === "sun", planets: (n) => n === "planet" || n === "pin",
  extras: (n) => n === "carrier" || n === "shaft" };
app.post("/api/stl", guarded((req, res) => {
  const p = params(req.body);
  const which = PICK[req.body?.which] ? req.body.which : "all";
  const s = pm.solve(p, null);
  const r = build({ ...p, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N }, s.notes);
  if (r.fatal) { res.status(422).json({ error: "geometry invalid", details: r.fatal, report: r.report }); return; }
  const items = r.parts.filter((pt) => PICK[which](pt.name)).flatMap((pt) => pt.inst.map((q) => ({ body: pt.body, x: q.x, y: q.y, rot: q.rot })));
  const buf = Buffer.from(writeSTL(items, "3DP Herringbone Planetary Generator"));
  res.set("Content-Type", "model/stl");
  res.set("Content-Disposition", `attachment; filename="PlanetaryBearing_${which}.stl"`);
  res.set("X-Facets", String(buf.readUInt32LE(80)));
  res.send(buf);
}));

app.use((req, res) => res.status(404).type("text").send("Not found"));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
app.listen(PORT, HOST, () => console.log(`3DP Herringbone Planetary Generator v${PKG.version} on http://localhost:${PORT}/`));
