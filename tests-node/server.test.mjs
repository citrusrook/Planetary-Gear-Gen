// Starts server.js on a spare port and checks the page, vendored libraries, download and API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 39000 + Math.floor(Math.random() * 500);
const URLB = `http://127.0.0.1:${PORT}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "pipe" });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(URLB + "/api/health")).ok) return; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not start");
});
after(() => proc && proc.kill());

test("page uses vendored three.js and has the local-version link", async () => {
  const html = await (await fetch(URLB + "/")).text();
  assert.match(html, /\/vendor\/three\/build\/three\.module\.js/);
  assert.doesNotMatch(html, /cdn\.jsdelivr/);
  assert.match(html, /href="\/download\/local"/);
  for (const u of ["/vendor/three/build/three.module.js", "/vendor/three/examples/jsm/controls/OrbitControls.js", "/vendor/earcut.mjs", "/js/app.js", "/js/earcut.js"])
    assert.equal((await fetch(URLB + u)).status, 200, u);
  const ec = await (await fetch(URLB + "/vendor/earcut.mjs")).text();
  assert.match(ec, /export default module\.exports/);
});

test("API: defaults, solve, report, stl", async () => {
  const d = await (await fetch(URLB + "/api/defaults")).json();
  assert.equal(d.Zs, 31);
  const post = (u, body) => fetch(URLB + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const s = await (await post("/api/solve", { params: { N: 40 }, lock: "N" })).json();
  assert.ok(s.notes.some((n) => n.includes("Could not keep")));
  const rep = await (await post("/api/report", { params: { taper: 1.5 } })).json();
  assert.ok(rep.report.some((l) => l.includes("Load-carrying flanks lean 1.5 deg")));
  const r = await post("/api/stl", { params: {}, which: "planets" });
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  const n = buf.readUInt32LE(80);
  assert.equal(buf.length, 84 + 50 * n);
  assert.equal(Number(r.headers.get("x-facets")), n);
  const bad = await post("/api/stl", { params: { sun_bore_shape: "Hex", ID: 22 } });
  assert.equal(bad.status, 422);
});
