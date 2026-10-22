// The JS gear code under Node must match the Python reference (fixtures/) exactly, and build
// closed meshes; same checks as web/tests.html, without a browser.   npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as pm from "../web/js/pbmath.js";
import { build } from "../web/js/engine.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIX = fs.readdirSync(path.join(ROOT, "fixtures")).filter((f) => f.endsWith(".json"));
const maxAbs = (a, b) => (a.length !== b.length ? Infinity : Math.max(...a.map((v, i) => Math.abs(v - b[i]))));

for (const name of FIX) {
  test(`fixture ${name}`, () => {
    const fx = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", name), "utf8"));
    const p = { ...pm.DEFAULTS, ...fx.params };
    const g = pm.derive(p);
    for (const [k, v] of Object.entries(fx.derived)) assert.ok(Math.abs(g[k] - v) < 1e-9, `derived ${k}: ${g[k]} vs ${v}`);
    const prof = pm.buildProfiles(p, g);
    for (const k of ["planet", "sun", "ring"]) {
      assert.ok(maxAbs(prof[k].r, fx.profiles[k].r) < 1e-6, `${k} r`);
      assert.ok(maxAbs(prof[k].t, fx.profiles[k].t) < 1e-6, `${k} t`);
    }
    assert.deepEqual(pm.report(p, g, prof), fx.report);
    for (const sc of fx.solver) {
      const s = pm.solve({ ...p, ...sc.input }, sc.lock);
      assert.deepEqual({ Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N }, sc.out, JSON.stringify(sc.input));
      assert.deepEqual(s.notes, sc.notes);
    }
    if (fx.train) {
      const t = pm.trainLayout(p);
      assert.equal(t.bearings.length, fx.train.bearings.length);
      t.bearings.forEach((b, i) => {
        const f = fx.train.bearings[i];
        assert.equal(b.Ze, f.Ze);
        assert.ok(Math.abs(b.rot - f.rot) < 1e-9 && Math.abs(b.cx - f.cx) < 1e-9 && Math.abs(b.cy - f.cy) < 1e-9, b.name);
      });
    }
  });
}

for (const [name, over] of [["defaults", {}], ["spline + pins", { OD: 60, ID: 10, H: 8, sun_bore_shape: "Spline", planet_pins: true, pin_d: 3, Zp: 12, Zs: 30, Zr: 54, N: 6 }],
  ["A-B train", { OD: 40, ID: 20, ext_teeth: true, train: "A-B", ratio_ab: 1.5 }]]) {
  test(`mesh ${name} is closed`, () => {
    const p = { ...pm.DEFAULTS, ...over };
    const s = pm.solve(p, null);
    const r = build({ ...p, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N });
    assert.ok(!r.fatal, String(r.fatal));
    for (const c of r.checks) assert.ok(c.ok && c.volume > 0, `${c.bearing} ${c.name}: ${c.badEdges} bad edges`);
  });
}
