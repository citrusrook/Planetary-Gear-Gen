// UI: parameter panels (same groups/names as the FreeCAD object), solver locks, report, preview, export.
import { DEFAULTS, TEX_TYPES } from "./pbmath.js";
import { writeSTL } from "./stl.js";

// [key in p, FreeCAD property name ("-" = web app only), label, kind, {min,max,step} | options, doc]
const GROUPS = [
  ["1 Envelope", [
    ["OD", "OD", "Outer diameter", "num", { min: 2, max: 500, step: 0.1 }, "Outer diameter of the ring (mm). With outer teeth: their tip diameter"],
    ["ID", "ID", "Sun bore", "num", { min: 0, max: 400, step: 0.1 }, "Sun bore size (mm). Hex/Square = across flats, Spline = pitch diameter"],
    ["H", "Height", "Height", "num", { min: 0.5, max: 200, step: 0.1 }, "Bearing height (mm)"],
  ]],
  ["2 Teeth", [
    ["N", "PlanetCount", "Planets", "int", { min: 1, max: 120, step: 1 }, "Number of planets (equally spaced). Edited value is held if possible"],
    ["Zp", "PlanetTeeth", "Planet teeth", "int", { min: 4, max: 80, step: 1 }, "Planet tooth count"],
    ["Zs", "SunTeeth", "Sun teeth", "int", { min: 6, max: 300, step: 1 }, "Sun tooth count"],
    ["Zr", "RingTeeth", "Ring teeth", "int", { min: 14, max: 460, step: 1 }, "Ring (internal) tooth count = Sun + 2*Planet"],
    ["alpha", "PressureAngle", "Pressure angle °", "num", { min: 10, max: 35, step: 0.5 }, "Pressure angle (deg)"],
  ]],
  ["3 Herringbone & taper", [
    ["beta", "HelixAngle", "Helix angle °", "num", { min: 0, max: 60, step: 1 }, "Helix angle at pitch cylinder (deg). 0 = spur"],
    ["reversals", "Reversals", "Reversals", "int", { min: 0, max: 50, step: 1 }, "Helix direction changes over the height (1 = classic V, 0 = plain helical)"],
    ["taper", "-", "Taper (flank) angle °", "num", { min: 0, max: 15, step: 0.25 }, "Tapered (lazy-susan) bearing: the load-carrying tooth flanks lean by this angle, so the planets act like tapered rollers and carry axial load (tips/roots lean about 2.7x more). 0 = straight. Large planets (8+ teeth) allow larger angles"],
    ["taper_mirror", "-", "Mirror (double taper)", "bool", null, "Reverse the taper at mid-height: planets become double cones that lock both ways"],
    ["taper_flip", "-", "Flip taper", "bool", null, "Single taper: planets wide at the top instead of the bottom. Mirrored: planets thinnest instead of fattest at mid-height"],
  ]],
  ["4 Print tolerance", [
    ["expansion", "PrintExpansion", "Flank gap", "num", { min: -0.5, max: 1, step: 0.01 }, "Total flank gap per contact (mm). Each mating part is pulled back by half. Also enlarges bores by half"],
    ["root_clear", "RootClearance", "Root clearance", "num", { min: 0, max: 1, step: 0.01 }, "Radial clearance tooth tip -> mating root (mm), on top of the flank gap"],
    ["tip_land", "TipLand", "Tip land", "num", { min: 0, max: 1, step: 0.005 }, "Minimum tooth top land (mm); pointed tips are truncated to this"],
  ]],
  ["5 Chamfers", [
    ["chamfer", "EdgeChamfer", "Sun & ring teeth", "num", { min: 0, max: 2, step: 0.05 }, "45° chamfer on the sun and ring tooth tips, top & bottom"],
    ["planet_chamfer", "-", "Planets", "num", { min: 0, max: 2, step: 0.05 }, "45° chamfer on the planet tooth tips and planet bores"],
    ["ring_od_chamfer", "-", "Ring outside", "num", { min: 0, max: 3, step: 0.05 }, "45° chamfer on the ring's outer edge (or its outer teeth), top & bottom"],
    ["sun_bore_chamfer", "-", "Sun bore", "num", { min: 0, max: 3, step: 0.05 }, "45° chamfer on the sun bore edge (and the spline shaft), top & bottom"],
  ]],
  ["6 Walls", [
    ["ring_wall_min", "-", "Ring wall min", "num", { min: 0, max: 20, step: 0.05 }, "Thinnest allowed ring wall between the tooth roots and the outside (mm)"],
    ["ring_wall_max", "-", "Ring wall max", "num", { min: 0, max: 50, step: 0.05 }, "Thickest allowed ring wall (mm), 0 = no limit. The solver picks tooth counts to stay inside"],
    ["sun_wall_min", "-", "Sun rim min", "num", { min: 0, max: 20, step: 0.05 }, "Thinnest allowed sun rim between the bore and the tooth roots (mm)"],
    ["sun_wall_max", "-", "Sun rim max", "num", { min: 0, max: 50, step: 0.05 }, "Thickest allowed sun rim (mm), 0 = no limit"],
    ["ring_wall", "-", "Ring wall target", "num", { min: 0.1, max: 20, step: 0.05 }, "Module mode Walls (group 12): ring wall the teeth are fitted to (mm)"],
    ["sun_wall", "-", "Sun rim target", "num", { min: 0.1, max: 20, step: 0.05 }, "Module mode Walls (group 12): sun rim the teeth are fitted to (mm)"],
  ]],
  ["7 Bores & spline", [
    ["sun_bore_shape", "SunBoreShape", "Sun bore shape", "sel", ["Round", "Hex", "Square", "D-Flat", "Spline", "None"], "Sun bore shape (size = ID). Spline: internal teeth with a matching splined shaft"],
    ["sun_bore_flat", "SunBoreFlat", "D-flat position", "num", { min: 0.05, max: 0.5, step: 0.01 }, "D-Flat: centre-to-flat distance as a fraction of ID (0.4 = 5 mm shaft with 4.5 flat)"],
    ["spline_teeth", "-", "Spline teeth", "int", { min: 6, max: 120, step: 1 }, "Spline: tooth count (module = ID / teeth)"],
    ["spline_alpha", "-", "Spline pressure °", "num", { min: 14.5, max: 45, step: 0.5 }, "Spline pressure angle (30° is the usual involute spline)"],
    ["shaft_length", "-", "Shaft length", "num", { min: 1, max: 300, step: 0.5 }, "Length of the matching splined shaft (exported next to the bearing)"],
    ["shaft_bore", "-", "Shaft centre hole", "num", { min: 0, max: 100, step: 0.1 }, "Hole through the shaft (mm), 0 = solid"],
    ["planet_bore_d", "PlanetBoreDiameter", "Planet bore", "num", { min: 0, max: 100, step: 0.05 }, "Planet bore diameter (0 = solid planets). Hex = across flats. Ignored with planet pins"],
    ["planet_bore_shape", "PlanetBoreShape", "Planet bore shape", "sel", ["Round", "Hex"], "Planet bore shape"],
  ]],
  ["8 Planet pins (fixed carrier)", [
    ["planet_pins", "-", "Captured pin per planet", "bool", null, "Print-in-place axle in every planet (hourglass, so it can't fall out) with a stub on top for a carrier plate: hold the carrier still and use the sun and ring as input / output"],
    ["pin_d", "-", "Pin diameter", "num", { min: 0.6, max: 50, step: 0.1 }, "Pin diameter at mid-height (mm)"],
    ["pin_gap", "-", "Pin gap", "num", { min: 0.05, max: 1, step: 0.01 }, "Radial clearance between pin and planet (mm)"],
    ["pin_v", "-", "Pin V depth", "num", { min: 0.1, max: 5, step: 0.05 }, "How much wider the hourglass is at the faces than in the middle (mm, per side). Must exceed the gap"],
    ["pin_collar", "-", "Collar", "num", { min: 0.2, max: 5, step: 0.1 }, "45° collar above each planet that the carrier plate sits on (mm)"],
    ["carrier_t", "-", "Carrier thickness", "num", { min: 0.6, max: 20, step: 0.1 }, "Carrier plate thickness = pin stub length (mm)"],
    ["carrier_fit", "-", "Carrier hole fit", "num", { min: -0.3, max: 0.5, step: 0.01 }, "Carrier hole diameter minus stub diameter (mm); negative = press fit"],
  ]],
  ["9 Surface texture", [...texFields("od", "Outer (ring OD)"), ...texFields("bore", "Inner (sun bore)")]],
  ["10 Outer teeth & gear train", [
    ["ext_teeth", "-", "Teeth on the ring outside", "bool", null, "Ring gets external teeth so the bearing works as a gear and meshes with other bearings"],
    ["ext_module", "-", "Outer module", "num", { min: 0.3, max: 10, step: 0.05 }, "Module of the outer teeth (shared by all bearings of a train so they mesh)"],
    ["ext_z_auto", "-", "Outer teeth", "mode", { min: 6, max: 1000, step: 1, val: "ext_z" }, "Auto = the largest count that fits the OD"],
    ["ext_helix", "-", "Outer tooth style", "sel", ["Straight", "Helical", "Herringbone"], "Angled outer teeth; neighbours in a train get opposite hands automatically"],
    ["ext_beta", "-", "Outer helix angle °", "num", { min: 0, max: 45, step: 1 }, "Helix angle of the outer teeth"],
    ["train", "-", "Gear train", "sel", ["Single", "A-B", "A-B-C"], "Lay out 2 or 3 bearings meshing on their outer teeth (A = this bearing)"],
    ["ratio_ab", "-", "Ratio A:B", "num", { min: 0, max: 20, step: 0.05 }, "B teeth / A teeth (B turns this many times slower). 0 = Auto: B size from B OD"],
    ["B_OD", "-", "B outer diameter", "num", { min: 5, max: 500, step: 0.5 }, "Used when Ratio A:B is Auto"],
    ["B_ID", "-", "B sun bore", "num", { min: 0, max: 400, step: 0.5 }, "Sun bore of bearing B"],
    ["ratio_bc", "-", "Ratio B:C", "num", { min: 0, max: 20, step: 0.05 }, "C teeth / B teeth. 0 = Auto: C size from C OD"],
    ["C_OD", "-", "C outer diameter", "num", { min: 5, max: 500, step: 0.5 }, "Used when Ratio B:C is Auto"],
    ["C_ID", "-", "C sun bore", "num", { min: 0, max: 400, step: 0.5 }, "Sun bore of bearing C"],
    ["train_angle", "-", "C direction °", "num", { min: -180, max: 180, step: 5 }, "Where C sits around B, measured from the A->B line (0 = straight row)"],
  ]],
  ["11 Phasing & wear", [
    ["hunting", "EvenWear", "Even wear (hunting tooth)", "bool", null, "Force gcd(sun, planet) = 1 so every tooth meets every mating tooth"],
  ]],
  ["12 Advanced", [
    ["module_mode", "ModuleMode", "Module", "modesel", { opts: ["Auto", "Manual", "Walls"], manual: "Manual", min: 0.05, max: 20, step: 0.001, val: "module" }, "Auto = planets centred, m = (OD+ID)/(Zs+Zr). Manual = this value. Walls = teeth fill the space between the wall targets (group 6)"],
    ["shift_auto", "ProfileShiftMode", "Profile shift x", "mode", { min: -1, max: 1.5, step: 0.001, val: "shift" }, "Auto = planet shift to avoid undercut (S0 scheme: sun -x, ring +x)"],
    ["min_planet_gap", "MinPlanetGap", "Min planet gap", "num", { min: 0, max: 5, step: 0.05 }, "Minimum gap between neighbouring planet tips (mm)"],
    ["min_module", "MinModule", "Min module", "num", { min: 0.05, max: 10, step: 0.05 }, "Smallest module the solver may use (mm)"],
    ["surface_tol", "SurfaceTolerance", "Helix tolerance", "num", { min: 0.0005, max: 0.05, step: 0.0005 }, "Max helix approximation error (mm): sets the number of z sections"],
    ["mesh_dev", "MeshDeviation", "Mesh deviation", "num", { min: 0.001, max: 0.2, step: 0.001 }, "Max chord error of arcs / flanks in the STL (mm)"],
  ]],
];
function texFields(w, title) {
  const where = w === "od" ? "the ring's outer surface" : "the sun bore (Round bores only)";
  return [
    [w + "_tex", "-", title, "sel", TEX_TYPES, `Texture on ${where}: knurls (straight / diagonal / diamond), dimples, oval pockets or raised ovals`],
    [w + "_tex_depth", "-", " depth", "num", { min: 0.05, max: 2, step: 0.05 }, "How deep the texture cuts in (mm). Raised ovals: how far they stand above the recessed surface. Counts against the ring wall / sun rim"],
    [w + "_tex_pitch", "-", " pitch", "num", { min: 0.3, max: 20, step: 0.1 }, "Spacing between ridges / dimples / ovals around the surface (mm)"],
    [w + "_tex_angle", "-", " angle °", "num", { min: 0, max: 75, step: 1 }, "Diagonal / diamond knurl: helix angle from the axis. Ovals: tilt from the axis"],
    [w + "_tex_size", "-", " width", "num", { min: 0.2, max: 20, step: 0.1 }, "Dimple diameter / oval width (mm)"],
    [w + "_tex_aspect", "-", " oval length ×", "num", { min: 1, max: 6, step: 0.1 }, "Oval length as a multiple of its width"],
  ];
}
const LOCKS = { N: "N", Zr: "Zr", Zs: "Zs", Zp: "Zp" };
const RESOLVE_TRIGGERS = new Set(["N", "Zr", "Zs", "Zp", "OD", "ID", "H", "alpha", "expansion", "root_clear", "tip_land",
  "sun_bore_shape", "hunting", "module_mode", "module", "shift_auto", "shift", "min_planet_gap", "min_module",
  "taper", "taper_mirror", "taper_flip", "od_tex", "od_tex_depth", "bore_tex", "bore_tex_depth",
  "ring_wall_min", "ring_wall_max", "sun_wall_min", "sun_wall_max", "ring_wall", "sun_wall", "spline_teeth", "spline_alpha",
  "planet_pins", "pin_d", "pin_gap", "pin_v", "ext_teeth", "ext_module", "ext_z_auto", "ext_z"]);
const STORE = "pb.params.v3";
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
    det.open = /^[1-4] /.test(title);
    det.innerHTML = `<summary>${title}</summary>`;
    const box = document.createElement("div");
    box.className = "fields";
    for (const [key, prop, label, kind, opt, doc] of fs) {
      const row = document.createElement("div");
      row.className = "f";
      row.title = prop === "-" ? `${doc} (web app only)` : `${prop}: ${doc}`;
      const id = "p_" + key;
      let ctl;
      if (kind === "num" || kind === "int") {
        ctl = `<input type="number" id="${id}" min="${opt.min}" max="${opt.max}" step="${opt.step}" inputmode="decimal">`;
      } else if (kind === "sel") {
        ctl = `<select id="${id}">${opt.map((o) => `<option>${o}</option>`).join("")}</select>`;
      } else if (kind === "bool") {
        ctl = `<input type="checkbox" class="chk" id="${id}">`;
      } else if (kind === "modesel") {
        ctl = `<div class="pair"><select id="${id}">${opt.opts.map((o) => `<option>${o}</option>`).join("")}</select>` +
              `<input type="number" id="p_${opt.val}" min="${opt.min}" max="${opt.max}" step="${opt.step}"></div>`;
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
    else if (kind === "modesel") {
      el.value = P[key];
      const v = $("p_" + spec[4].val);
      v.disabled = P[key] !== spec[4].manual;
      v.value = fmtNum(P[spec[4].val], 6);
    } else if (kind === "mode") {
      el.value = P[key] ? "1" : "0";
      const v = $("p_" + spec[4].val);
      v.disabled = !!P[key];
      v.value = fmtNum(P[spec[4].val], 6);
    } else el.value = fmtNum(P[key], 6);
  }
  $("p_sun_bore_flat").disabled = P.sun_bore_shape !== "D-Flat";
  $("p_planet_bore_shape").disabled = !(P.planet_bore_d > 0) || P.planet_pins;
  $("p_planet_bore_d").disabled = P.planet_pins;
  const spl = P.sun_bore_shape === "Spline";
  for (const k of ["spline_teeth", "spline_alpha", "shaft_length", "shaft_bore"]) $("p_" + k).disabled = !spl;
  for (const k of ["pin_d", "pin_gap", "pin_v", "pin_collar", "carrier_t", "carrier_fit"]) $("p_" + k).disabled = !P.planet_pins;
  $("p_ring_wall").disabled = $("p_sun_wall").disabled = P.module_mode !== "Walls";
  const ext = P.ext_teeth;
  for (const k of ["ext_module", "ext_z_auto", "ext_helix", "train"]) $("p_" + k).disabled = !ext;
  if (!ext) $("p_ext_z").disabled = true;
  $("p_ext_beta").disabled = !ext || P.ext_helix === "Straight";
  const n = ext ? { "Single": 1, "A-B": 2, "A-B-C": 3 }[P.train] : 1;
  $("p_ratio_ab").disabled = $("p_B_ID").disabled = n < 2;
  $("p_B_OD").disabled = n < 2 || P.ratio_ab > 0;
  $("p_ratio_bc").disabled = $("p_C_ID").disabled = $("p_train_angle").disabled = n < 3;
  $("p_C_OD").disabled = n < 3 || P.ratio_bc > 0;
  $("p_taper_mirror").disabled = $("p_taper_flip").disabled = !(P.taper > 0);
  for (const w of ["od", "bore"]) {
    const k = P[w + "_tex"], on = k !== "None" && !(w === "bore" && P.sun_bore_shape !== "Round");
    $("p_" + w + "_tex_depth").disabled = $("p_" + w + "_tex_pitch").disabled = !on;
    const oval = k === "Ovals" || k === "Raised ovals";
    $("p_" + w + "_tex_angle").disabled = !on || !(k === "Diagonal knurl" || k === "Diamond knurl" || oval);
    $("p_" + w + "_tex_size").disabled = !on || !(k === "Dimples" || oval);
    $("p_" + w + "_tex_aspect").disabled = !on || !oval;
  }
  $("p_bore_tex").disabled = P.sun_bore_shape !== "Round";
  $("p_od_tex").disabled = !!P.ext_teeth;
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
  if (kind === "sel" || kind === "modesel") return el.value;
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
  if (key === "module_mode" && v === "Manual" && last) P.module = +last.g.m.toFixed(6);
  if (key === "ext_z_auto" && !v && last && last.bearings) P.ext_z = last.bearings[0].Ze || P.ext_z;
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
  if (P.module_mode !== "Manual") $("p_module").value = fmtNum(r.g.m, 6);
  if (P.shift_auto) $("p_shift").value = fmtNum(r.g.x, 6);
  if (P.ext_teeth && P.ext_z_auto) $("p_ext_z").value = String(r.bearings[0].Ze);
  const ms = performance.now() - t0;
  const nf = facets(r);
  setStatus(`${nf.toLocaleString()} facets · ${bodies(r)} bodies · ${ms.toFixed(0)} ms`, false);
  renderSummary(r);
  renderChecks(r);
  renderReport(r.report);
  setExport(true);
  if (view) view.update(r);
}
const facets = (r) => r.checks.reduce((a, c) => a + c.tris * c.count, 0);
const bodies = (r) => r.checks.reduce((a, c) => a + c.count, 0);

// ------------------------------------------------------------------ panels
function renderSummary(r) {
  const g = r.g;
  const k = [
    [`${g.Zs} / ${g.Zp}×${g.N} / ${g.Zr}`, "sun / planets / ring"],
    [`${g.m.toFixed(4)}`, "module (mm)"],
    [`${(1 + g.Zr / g.Zs).toFixed(3)} : 1`, "sun : carrier"],
    [`${(2 * g.a).toFixed(3)}`, "orbit Ø (mm)"],
    [`${r.walls[0].toFixed(2)} / ${r.walls[1].toFixed(2)}`, "ring wall / sun rim (mm)"],
    [`${(facets(r) / 1000).toFixed(0)}k`, "facets"],
  ];
  $("kpis").innerHTML = k.map(([b, s]) => `<div class="kpi"><b title="${b}">${b}</b><span>${s}</span></div>`).join("");
}

const NICE = { ring: "Ring", sun: "Sun", planet: "Planet", pin: "Pin", carrier: "Carrier plate", shaft: "Spline shaft" };
function renderChecks(r) {
  const row = (c) =>
    `<tr><td>${r.multi ? c.bearing + " " : ""}${NICE[c.name] || c.name}${c.count > 1 ? ` ×${c.count}` : ""}</td><td class="${c.ok ? "ok" : "bad"}">${c.ok ? "closed ✓" : c.badEdges + " open edges"}</td>` +
    `<td>${c.tris.toLocaleString()}</td><td>${c.volume.toFixed(2)}</td></tr>`;
  $("checks").innerHTML = `<tr><th>Body</th><th>Manifold</th><th>Facets</th><th>Vol mm³</th></tr>` + r.checks.map(row).join("");
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
function setExport(on) {
  for (const id of ["dl", "dlRing", "dlSun", "dlPl", "dlEx"]) $(id).disabled = !on;
  if (on && last) $("dlEx").disabled = !last.parts.some((pt) => EXTRAS.has(pt.name));
}

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
  const tp = P.taper > 0 ? `_tp${g6(P.taper)}${P.taper_mirror ? "m" : ""}${P.taper_flip ? "f" : ""}` : "";
  const ex = P.ext_teeth ? `_Z${last.bearings.map((b) => b.Ze).join("-")}m${g6(P.ext_module)}` : "";
  return `OD${g6(P.OD)}_ID${g6(P.ID)}_H${g6(P.H)}_S${g.Zs}P${g.Zp}x${g.N}R${g.Zr}_b${g6(P.beta)}_e${g6(P.expansion)}${tp}${ex}`;
}
function save(buf, name) {
  const url = URL.createObjectURL(new Blob([buf], { type: "model/stl" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const EXTRAS = new Set(["carrier", "shaft"]);
const PICK = { all: () => true, ring: (n) => n === "ring", sun: (n) => n === "sun", planets: (n) => n === "planet" || n === "pin", extras: (n) => EXTRAS.has(n) };
export function stlItems(r, which = "all") {
  return r.parts.filter((pt) => PICK[which](pt.name)).flatMap((pt) => pt.inst.map((q) => ({ body: pt.body, x: q.x, y: q.y, rot: q.rot })));
}
function exportSTL(which) {
  if (!last) return;
  const names = { all: "PlanetaryBearing", ring: "Ring", sun: "Sun", planets: "Planets", extras: "Extras" };
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
$("dlEx").onclick = () => exportSTL("extras");
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
