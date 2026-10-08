// UI: parameter panels (same groups/names as the FreeCAD object), solver locks, report, preview, export.
import { DEFAULTS } from "./pbmath.js";
import { writeSTL } from "./stl.js";

// [key in p, FreeCAD property name, label, kind, {min,max,step} | options, doc]
const GROUPS = [
  ["1 Envelope", [
    ["OD", "OD", "Outer diameter", "num", { min: 2, max: 500, step: 0.1 }, "Outer diameter of the ring (mm)"],
    ["ID", "ID", "Sun bore", "num", { min: 0, max: 400, step: 0.1 }, "Sun bore size (mm). Hex/Square = across flats"],
    ["H", "Height", "Height", "num", { min: 0.5, max: 200, step: 0.1 }, "Bearing height (mm)"],
  ]],
  ["2 Teeth", [
    ["N", "PlanetCount", "Planets", "int", { min: 1, max: 120, step: 1 }, "Number of planets (equally spaced). Edited value is held if possible"],
    ["Zp", "PlanetTeeth", "Planet teeth", "int", { min: 4, max: 80, step: 1 }, "Planet tooth count"],
    ["Zs", "SunTeeth", "Sun teeth", "int", { min: 6, max: 300, step: 1 }, "Sun tooth count"],
    ["Zr", "RingTeeth", "Ring teeth", "int", { min: 14, max: 460, step: 1 }, "Ring (internal) tooth count = Sun + 2*Planet"],
    ["alpha", "PressureAngle", "Pressure angle °", "num", { min: 10, max: 35, step: 0.5 }, "Pressure angle (deg)"],
  ]],
  ["3 Herringbone", [
    ["beta", "HelixAngle", "Helix angle °", "num", { min: 0, max: 60, step: 1 }, "Helix angle at pitch cylinder (deg). 0 = spur"],
    ["reversals", "Reversals", "Reversals", "int", { min: 0, max: 50, step: 1 }, "Helix direction changes over the height (1 = classic V, 0 = plain helical)"],
  ]],
  ["4 Print tolerance", [
    ["expansion", "PrintExpansion", "Flank gap", "num", { min: -0.5, max: 1, step: 0.01 }, "Total flank gap per contact (mm). Each mating part is pulled back by half. Also enlarges bores by half"],
    ["root_clear", "RootClearance", "Root clearance", "num", { min: 0, max: 1, step: 0.01 }, "Radial clearance tooth tip -> mating root (mm), on top of the flank gap"],
    ["chamfer", "EdgeChamfer", "Edge chamfer", "num", { min: 0, max: 2, step: 0.05 }, "45° chamfer on tooth tips, OD and bore edges, top & bottom (elephant foot / print-in-place)"],
    ["tip_land", "TipLand", "Tip land", "num", { min: 0, max: 1, step: 0.01 }, "Minimum tooth top land (mm); pointed tips are truncated to this"],
  ]],
  ["5 Bores", [
    ["sun_bore_shape", "SunBoreShape", "Sun bore shape", "sel", ["Round", "Hex", "Square", "D-Flat", "None"], "Sun bore shape (size = ID)"],
    ["sun_bore_flat", "SunBoreFlat", "D-flat position", "num", { min: 0.05, max: 0.5, step: 0.01 }, "D-Flat: centre-to-flat distance as a fraction of ID (0.4 = 5 mm shaft with 4.5 flat)"],
    ["planet_bore_d", "PlanetBoreDiameter", "Planet bore", "num", { min: 0, max: 100, step: 0.05 }, "Planet bore diameter (0 = solid planets). Hex = across flats"],
    ["planet_bore_shape", "PlanetBoreShape", "Planet bore shape", "sel", ["Round", "Hex"], "Planet bore shape"],
  ]],
  ["6 Phasing & wear", [
    ["hunting", "EvenWear", "Even wear (hunting tooth)", "bool", null, "Force gcd(sun, planet) = 1 so every tooth meets every mating tooth"],
  ]],
  ["7 Advanced", [
    ["module_auto", "ModuleMode", "Module", "mode", { min: 0.05, max: 20, step: 0.001, val: "module" }, "Auto = planets centred in the OD/ID annulus, m = (OD+ID)/(Zs+Zr)"],
    ["shift_auto", "ProfileShiftMode", "Profile shift x", "mode", { min: -1, max: 1.5, step: 0.001, val: "shift" }, "Auto = planet shift to avoid undercut (S0 scheme: sun -x, ring +x)"],
    ["min_planet_gap", "MinPlanetGap", "Min planet gap", "num", { min: 0, max: 5, step: 0.05 }, "Minimum gap between neighbouring planet tips (mm)"],
    ["min_wall", "MinWall", "Min wall", "num", { min: 0, max: 10, step: 0.05 }, "Minimum ring wall / sun rim (mm)"],
    ["min_module", "MinModule", "Min module", "num", { min: 0.05, max: 10, step: 0.05 }, "Smallest module the solver may use (mm)"],
    ["surface_tol", "SurfaceTolerance", "Helix tolerance", "num", { min: 0.0005, max: 0.05, step: 0.0005 }, "Max helix approximation error (mm): sets the number of z sections"],
    ["mesh_dev", "MeshDeviation", "Mesh deviation", "num", { min: 0.001, max: 0.2, step: 0.001 }, "Max chord error of arcs / flanks in the STL (mm)"],
  ]],
];
const LOCKS = { N: "N", Zr: "Zr", Zs: "Zs", Zp: "Zp" };
const RESOLVE_TRIGGERS = new Set(["N", "Zr", "Zs", "Zp", "OD", "ID", "alpha", "expansion", "root_clear", "tip_land",
  "sun_bore_shape", "hunting", "module_auto", "module", "shift_auto", "shift", "min_planet_gap", "min_wall", "min_module"]);
const STORE = "pb.params.v1";
const FIELDS = new Map();          // key -> spec
for (const [, fs] of GROUPS) for (const f of fs) FIELDS.set(f[0], f);

const $ = (id) => document.getElementById(id);
let P = loadParams();
let last = null;                   // last build result
let pendingNotes = [];
let view = null;

// ------------------------------------------------------------------ engine (worker with fallback)
let worker = null, seq = 0, engineMod = null;
const waiting = new Map();
try {
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => { const w = waiting.get(ev.data.id); if (w) { waiting.delete(ev.data.id); ev.data.ok ? w.res(ev.data.result) : w.rej(new Error(ev.data.error)); } };
  worker.onerror = (e) => { console.warn("worker failed, using main thread", e); worker = null; for (const w of waiting.values()) w.retry(); waiting.clear(); };
} catch (e) { worker = null; }

async function call(type, payload) {
  const local = async () => {
    engineMod = engineMod || await import("./engine.js");
    return type === "solve" ? engineMod.resolve(payload.p, payload.lock) : engineMod.build(payload.p, payload.notes);
  };
  if (!worker) return local();
  return new Promise((res, rej) => {
    const id = ++seq;
    waiting.set(id, { res, rej, retry: () => local().then(res, rej) });
    worker.postMessage({ id, type, ...payload });
  });
}

// ------------------------------------------------------------------ params
function loadParams() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) || "{}"); } catch (e) { saved = {}; }
  const p = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (k in saved && typeof saved[k] === typeof DEFAULTS[k]) p[k] = saved[k];
  return p;
}
function saveParams() { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch (e) { /* private mode */ } }

// ------------------------------------------------------------------ form
function buildForm() {
  const root = $("params");
  root.innerHTML = "";
  for (const [title, fs] of GROUPS) {
    const det = document.createElement("details");
    det.open = !title.startsWith("7");
    det.innerHTML = `<summary>${title}</summary>`;
    const box = document.createElement("div");
    box.className = "fields";
    for (const [key, prop, label, kind, opt, doc] of fs) {
      const row = document.createElement("div");
      row.className = "f";
      row.title = `${prop}: ${doc}`;
      const id = "p_" + key;
      let ctl;
      if (kind === "num" || kind === "int") {
        ctl = `<input type="number" id="${id}" min="${opt.min}" max="${opt.max}" step="${opt.step}" inputmode="decimal">`;
      } else if (kind === "sel") {
        ctl = `<select id="${id}">${opt.map((o) => `<option>${o}</option>`).join("")}</select>`;
      } else if (kind === "bool") {
        ctl = `<input type="checkbox" class="chk" id="${id}">`;
      } else if (kind === "mode") {
        ctl = `<div class="pair"><select id="${id}"><option value="1">Auto</option><option value="0">Manual</option></select>` +
              `<input type="number" id="p_${opt.val}" min="${opt.min}" max="${opt.max}" step="${opt.step}"></div>`;
      }
      row.innerHTML = `<label for="${id}">${label}</label>${ctl}`;
      box.appendChild(row);
    }
    det.appendChild(box);
    root.appendChild(det);
  }
  const foot = document.createElement("p");
  foot.className = "hint";
  foot.style.padding = "10px 16px 0";
  foot.textContent = "Tooth counts and planet count are auto-corrected so the planets stay equally spaced and printable; " +
    "the value you just edited is held if possible. Hover a field for details.";
  root.appendChild(foot);

  root.addEventListener("change", onFieldChange);
}

function writeForm(changed = []) {
  for (const [key, spec] of FIELDS) {
    const el = $("p_" + key), kind = spec[3];
    if (kind === "bool") el.checked = !!P[key];
    else if (kind === "sel") el.value = P[key];
    else if (kind === "mode") {
      el.value = P[key] ? "1" : "0";
      const v = $("p_" + spec[4].val);
      v.disabled = !!P[key];
      v.value = fmtNum(P[spec[4].val], 6);
    } else el.value = fmtNum(P[key], 6);
  }
  $("p_sun_bore_flat").disabled = P.sun_bore_shape !== "D-Flat";
  $("p_planet_bore_shape").disabled = !(P.planet_bore_d > 0);
  for (const k of changed) {
    const el = $("p_" + k);
    if (!el) continue;
    el.classList.remove("changed"); void el.offsetWidth; el.classList.add("changed");
  }
}
const fmtNum = (v, d) => String(parseFloat(Number(v).toFixed(d)));

function readField(key) {
  const el = $("p_" + key);
  const spec = FIELDS.get(key);
  if (!spec) {                      // module / shift value inputs
    const v = parseFloat(el.value);
    return Number.isFinite(v) ? v : P[key];
  }
  const [, , , kind, opt] = spec;
  if (kind === "bool") return el.checked;
  if (kind === "sel") return el.value;
  if (kind === "mode") return el.value === "1";
  let v = parseFloat(el.value);
  if (!Number.isFinite(v)) return P[key];
  v = Math.min(opt.max, Math.max(opt.min, v));
  return kind === "int" ? Math.round(v) : v;
}

async function onFieldChange(ev) {
  const key = ev.target.id.replace(/^p_/, "");
  const v = readField(key);
  if (P[key] === v) { writeForm(); return; }
  P = { ...P, [key]: v };
  if (key === "module_auto" && !v && last) P.module = +last.g.m.toFixed(6);
  if (key === "shift_auto" && !v && last) P.shift = +last.g.x.toFixed(6);
  if (RESOLVE_TRIGGERS.has(key)) {
    setStatus("solving…", true);
    const before = { N: P.N, Zp: P.Zp, Zs: P.Zs, Zr: P.Zr };
    const s = await call("solve", { p: P, lock: LOCKS[key] ?? null });
    P = { ...P, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N };
    const changed = Object.keys(before).filter((k) => before[k] !== P[k] || (k === key));
    for (const n of s.notes) toast(n);
    pendingNotes = s.notes;
    writeForm(changed.filter((k) => k !== key));
  } else writeForm();
  saveParams();
  scheduleBuild();
}

// ------------------------------------------------------------------ build
let buildTimer = null, buildGen = 0;
function scheduleBuild() {
  clearTimeout(buildTimer);
  buildTimer = setTimeout(runBuild, 120);
}
async function runBuild() {
  const gen = ++buildGen;
  setStatus("building…", true);
  setExport(false);
  const t0 = performance.now();
  let r;
  try {
    r = await call("build", { p: P, notes: pendingNotes });
  } catch (e) {
    console.error(e);
    setStatus("build failed: " + e.message.split("\n")[0], false);
    return;
  }
  if (gen !== buildGen) return;
  pendingNotes = [];
  // build() may have re-solved inconsistent counts
  if (r.p.Zs !== P.Zs || r.p.Zp !== P.Zp || r.p.N !== P.N || r.p.Zr !== P.Zr) {
    P = { ...P, Zs: r.p.Zs, Zp: r.p.Zp, Zr: r.p.Zr, N: r.p.N };
    writeForm(["Zs", "Zp", "Zr", "N"]);
    saveParams();
  }
  if (r.fatal) {
    last = null;
    setStatus("cannot build: " + r.fatal.join("; "), false);
    $("checks").innerHTML = r.fatal.map((f) => `<tr><td class="bad" style="text-align:left">✗ ${f}</td></tr>`).join("");
    renderReport([...r.fatal.map((f) => "WARNING: geometry invalid - " + f), ...r.report]);
    $("kpis").innerHTML = "";
    if (view) view.clear();
    return;
  }
  last = r;
  if (P.module_auto || P.shift_auto) {
    if (P.module_auto) $("p_module").value = fmtNum(r.g.m, 6);
    if (P.shift_auto) $("p_shift").value = fmtNum(r.g.x, 6);
  }
  const ms = performance.now() - t0;
  const nf = facets(r);
  setStatus(`${nf.toLocaleString()} facets · ${2 + r.placements.length} bodies · ${ms.toFixed(0)} ms`, false);
  renderSummary(r);
  renderChecks(r);
  renderReport(r.report);
  setExport(true);
  if (view) view.update(r);
}
const facets = (r) => r.checks.ring.tris + r.checks.sun.tris + r.checks.planet.tris * r.placements.length;

// ------------------------------------------------------------------ panels
function renderSummary(r) {
  const g = r.g;
  const k = [
    [`${g.Zs} / ${g.Zp}×${g.N} / ${g.Zr}`, "sun / planets / ring"],
    [`${g.m.toFixed(4)}`, "module (mm)"],
    [`${(1 + g.Zr / g.Zs).toFixed(3)} : 1`, "sun : carrier"],
    [`${(2 * g.a).toFixed(3)}`, "orbit Ø (mm)"],
    [`${(P.OD / 2 - r.ringRo).toFixed(2)}`, "ring wall (mm)"],
    [`${(facets(r) / 1000).toFixed(0)}k`, "facets"],
  ];
  $("kpis").innerHTML = k.map(([b, s]) => `<div class="kpi"><b title="${b}">${b}</b><span>${s}</span></div>`).join("");
}

function renderChecks(r) {
  const row = (name, c, n) =>
    `<tr><td>${name}${n > 1 ? ` ×${n}` : ""}</td><td class="${c.ok ? "ok" : "bad"}">${c.ok ? "closed ✓" : c.badEdges + " open edges"}</td>` +
    `<td>${c.tris.toLocaleString()}</td><td>${c.volume.toFixed(2)}</td></tr>`;
  $("checks").innerHTML = `<tr><th>Body</th><th>Manifold</th><th>Facets</th><th>Vol mm³</th></tr>` +
    row("Ring", r.checks.ring, 1) + row("Sun", r.checks.sun, 1) + row("Planet", r.checks.planet, r.placements.length);
}

function renderReport(lines) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  $("report").innerHTML = lines.map((l) => {
    if (l.startsWith("===")) return `<span class="h">${esc(l.replace(/=/g, "").trim())}</span>`;
    if (/WARNING|NOT POSSIBLE|NO compatible/.test(l)) return `<span class="w">${esc(l)}</span>`;
    if (/^(Auto-adjusted|Could not keep)/.test(l)) return `<span class="n">${esc(l)}</span>`;
    return esc(l) + "\n";
  }).join("");
}

function setStatus(text, busy) { const s = $("status"); s.textContent = text; s.classList.toggle("busy", !!busy); }
function setExport(on) { for (const id of ["dl", "dlRing", "dlSun", "dlPl"]) $(id).disabled = !on; }

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// ------------------------------------------------------------------ export
const g6 = (v) => String(parseFloat(Number(v).toPrecision(6)));   // Python %g
function tag() {
  const g = last.g;
  return `OD${g6(P.OD)}_ID${g6(P.ID)}_H${g6(P.H)}_S${g.Zs}P${g.Zp}x${g.N}R${g.Zr}_b${g6(P.beta)}_e${g6(P.expansion)}`;
}
function save(buf, name) {
  const url = URL.createObjectURL(new Blob([buf], { type: "model/stl" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function stlItems(r, which = "all") {
  const pl = r.placements.map((q) => ({ body: r.planet, x: q.x, y: q.y, rot: q.rot }));
  if (which === "ring") return [{ body: r.ring }];
  if (which === "sun") return [{ body: r.sun }];
  if (which === "planets") return pl;
  return [{ body: r.ring }, { body: r.sun }, ...pl];
}
function exportSTL(which) {
  if (!last) return;
  const names = { all: "PlanetaryBearing", ring: "Ring", sun: "Sun", planets: "Planets" };
  const buf = writeSTL(stlItems(last, which), `PlanetaryBearing ${tag()}`);
  save(buf, `${names[which]}_${tag()}.stl`);
  toast(`Saved ${names[which]}_${tag()}.stl (${(buf.byteLength / 1e6).toFixed(1)} MB)`);
}
window.__pb = { get last() { return last; }, get P() { return P; }, writeSTL, stlItems, tag };

// ------------------------------------------------------------------ wiring
buildForm();
writeForm();
$("dl").onclick = () => exportSTL("all");
$("dlRing").onclick = () => exportSTL("ring");
$("dlSun").onclick = () => exportSTL("sun");
$("dlPl").onclick = () => exportSTL("planets");
$("reset").onclick = async () => {
  P = { ...DEFAULTS };
  writeForm(); saveParams(); scheduleBuild();
};
$("copy").onclick = () => {
  if (!last) return;
  navigator.clipboard?.writeText(last.report.join("\n")).then(() => toast("Report copied"), () => toast("Clipboard blocked"));
};

import("./view3d.js").then((m) => {
  view = m.createView($("view"), {
    anim: $("anim"), speed: $("speed"), clip: $("clip"),
    showRing: $("showRing"), showSun: $("showSun"), showPl: $("showPl"), fit: $("fit"),
  });
  if (last) view.update(last);
}).catch((e) => {
  console.warn("3D preview unavailable", e);
  $("err3d").style.display = "grid";
});

// make sure the stored counts are compatible before the first build
call("solve", { p: P, lock: null }).then((s) => {
  P = { ...P, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N };
  pendingNotes = s.notes;
  writeForm();
  runBuild();
}).catch((e) => setStatus("engine failed: " + e.message, false));
