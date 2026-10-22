// Port of core/pb_math.py (the source of truth). Keep in sync; verified against fixtures/*.json
// by web/tests.html. Units: mm and degrees in the parameter dict, radians inside.
const { PI, tan, cos, sin, acos, sqrt, abs, max, min } = Math;

export const inv = (a) => tan(a) - a;
export const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };
export const lcm = (a, b) => (a * b) / gcd(a, b);
const radians = (d) => d * (PI / 180);

export const DEFAULTS = {
  OD: 31.7, ID: 18.0, H: 5.0,
  N: 14, Zp: 4, Zs: 31, Zr: 39,            // module 0.71, hunting tooth
  alpha: 22.0, beta: 30.0, reversals: 1,
  expansion: 0.1, root_clear: 0.08, tip_land: 0.025,
  hunting: false,
  min_planet_gap: 0.3, min_module: 0.5,
  ring_wall_min: 0.5, ring_wall_max: 0.0, sun_wall_min: 0.5, sun_wall_max: 0.0,
  module_mode: "Auto", module: 0.5, ring_wall: 0.8, sun_wall: 0.8,
  shift_auto: true, shift: 0.0,
  sun_bore_shape: "Round", planet_bore_d: 0.0, planet_bore_shape: "Round",
  spline_teeth: 12, spline_alpha: 30.0, shaft_length: 15.0, shaft_bore: 0.0,
  taper: 0.0, taper_mirror: false, taper_flip: false,
  od_tex: "None", od_tex_depth: 0.2, od_tex_pitch: 1.5, od_tex_angle: 30.0, od_tex_size: 1.2, od_tex_aspect: 2.5,
  bore_tex: "None", bore_tex_depth: 0.2, bore_tex_pitch: 1.2, bore_tex_angle: 30.0, bore_tex_size: 1.0, bore_tex_aspect: 2.5,
  chamfer: 0.3, planet_chamfer: 0.3, ring_od_chamfer: 0.3, sun_bore_chamfer: 0.3,
  planet_pins: false, pin_d: 2.0, pin_gap: 0.15, pin_v: 0.4, pin_collar: 0.8, carrier_t: 2.0, carrier_fit: 0.1,
  ext_teeth: false, ext_module: 0.6, ext_z_auto: true, ext_z: 30, ext_helix: "Herringbone", ext_beta: 20.0,
  train: "Single", ratio_ab: 0.0, ratio_bc: 0.0, B_OD: 31.7, B_ID: 18.0, C_OD: 31.7, C_ID: 18.0, train_angle: 0.0,
  // mesh-only extras
  sun_bore_flat: 0.4, surface_tol: 0.005, mesh_dev: 0.01,
};
export const DEFAULTS_V1 = { ...DEFAULTS, ID: 22.0, N: 24, Zs: 56, Zr: 64, expansion: 0.15, root_clear: 0.15, tip_land: 0.1, min_module: 0.4 };
export const DEFAULTS_V2 = { ...DEFAULTS, root_clear: 0.1 };

// numpy.linspace, same arithmetic (y = i*step + start, last = stop)
export function linspace(a, b, n) {
  const y = new Float64Array(n);
  if (n === 1) { y[0] = a; return y; }
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) y[i] = i * step + a;
  y[n - 1] = b;
  return y;
}

// numpy.interp for increasing xp
export function interp(x, xp, fp) {
  const n = xp.length, out = new Float64Array(x.length);
  for (let k = 0; k < x.length; k++) {
    const v = x[k];
    if (v <= xp[0]) { out[k] = fp[0]; continue; }
    if (v >= xp[n - 1]) { out[k] = fp[n - 1]; continue; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xp[mid] <= v) lo = mid; else hi = mid; }
    const s = (fp[lo + 1] - fp[lo]) / (xp[lo + 1] - xp[lo]);
    out[k] = s * (v - xp[lo]) + fp[lo];
  }
  return out;
}

// --------------------------------------------------------------------------
//  Basic geometry derived from the parameters
// --------------------------------------------------------------------------
/** dx: extra profile shift for one height of a tapered bearing (see taperDx); x = x0 + dx */
export function derive(p, Zs = null, Zp = null, N = null, dx = 0.0) {
  Zs = Zs ?? p.Zs; Zp = Zp ?? p.Zp; N = N ?? p.N;
  const Zr = Zs + 2 * Zp;
  const al = radians(p.alpha);
  const c = p.root_clear;
  const d = p.expansion / 2.0;
  const z_th = 2.0 / sin(al) ** 2;
  const x_auto = max(0.0, (5.0 / 6.0 * z_th - Zp) / z_th);
  const mode = moduleMode(p);
  const R_out = ringOuterRadius(p);              // OD/2, or the root of the external teeth
  const sa = p.shift_auto ?? true;
  let m;
  if (mode === "Auto") m = (2 * R_out + p.ID) / (Zs + Zr);
  else if (mode === "Walls") {
    // teeth fill the space between the ring-wall and sun-wall targets (at the taper's wide end)
    const R_in = sunBoreRadius(p) + texDepth(p, "bore") + (p.sun_wall ?? 0.8);
    const R_o = R_out - texDepth(p, "od") - (p.ring_wall ?? 0.8);
    m = max(1e-3, (R_o - R_in - 2 * (c + d)) / (Zp + 2 + 2 * x_auto));
    for (let it = 0; it < 4; it++) {
      const xs = (sa ? x_auto : p.shift) + 2 * taperHalf(p, m, al) * (sa ? 1 : 0.5);
      m = max(1e-3, (R_o - R_in - 2 * (c + d)) / (Zp + 2 + 2 * xs));
    }
  } else m = p.module;
  let x = sa ? x_auto + taperHalf(p, m, al) : p.shift;
  x += dx;
  const rs = m * Zs / 2, rp = m * Zp / 2, rr = m * Zr / 2;
  const a = rs + rp;
  const g = { Zs, Zp, Zr, N, m, x, alpha: al, c, d, rs, rp, rr, a,
    rbs: rs * cos(al), rbp: rp * cos(al), rbr: rr * cos(al) };
  g.ra_p = rp + m * (1 + x) - d;
  g.rf_p = rp - m * (1 - x) - c - d;
  g.ra_s = rs + m * (1 - x) - d;
  g.rf_s = rs - m * (1 + x) - c - d;
  const land = p.tip_land ?? 0.1;
  g.ra_p = tipRadius(Zp, m, al, x, d, g.ra_p, land);
  g.ra_s = tipRadius(Zs, m, al, -x, d, g.ra_s, land);
  g.ri_r = max(rr - m * (1 - x) + d, g.rbr * 1.0005);
  g.ro_r = rr + m * (1 + x) + c + d;
  return g;
}

export function tipRadius(Z, m, al, x, d, ra_nom, land) {
  const rp = m * Z / 2.0;
  const rb = rp * cos(al);
  const c0 = (PI / 2 + 2 * x * tan(al)) / Z + inv(al) - d / rb;
  const excess = (r) => c0 - inv(acos(min(1.0, rb / r))) - land / (2 * r);
  if (excess(ra_nom) >= 0) return ra_nom;
  let lo = max(rb, 1e-9), hi = ra_nom;
  if (excess(lo) < 0) return lo;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (excess(mid) >= 0) lo = mid; else hi = mid;
  }
  return lo;
}

export function boreOuterRadius(shape, dia, comp, p = null) {
  if (shape === "None" || dia <= 0) return 0.0;
  if (shape === "Spline") return splineGeometry(p).ro_r;
  const r = dia / 2.0 + comp;
  if (shape === "Hex") return r / cos(PI / 6);
  if (shape === "Square") return r * sqrt(2);
  return r;
}

// Python round() (ties to even) for parity
const pyRound = (v) => { const f = Math.floor(v), r = v - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };

export const sunBoreRadius = (p) => boreOuterRadius(p.sun_bore_shape, p.ID, p.expansion / 2.0, p);

/** 'Auto' | 'Manual' | 'Walls' (older parameter sets only have module_auto). */
export function moduleMode(p) {
  const mm = p.module_mode;
  if (mm === "Auto" || mm === "Manual" || mm === "Walls") return mm;
  return (p.module_auto ?? true) ? "Auto" : "Manual";
}

/** [ring_min, ring_max, sun_min, sun_max]; max 0 = no limit. Older sets have one min_wall. */
export function wallLimits(p) {
  const w = p.min_wall ?? 0.5;
  return [p.ring_wall_min ?? w, p.ring_wall_max ?? 0.0, p.sun_wall_min ?? w, p.sun_wall_max ?? 0.0];
}

export const TEX_TYPES = ["None", "Straight knurl", "Diagonal knurl", "Diamond knurl", "Dimples", "Ovals", "Raised ovals"];

/** Profile-shift change per mm of height: the taper angle is the lean of the load-carrying flanks,
 *  dx/dz = tan(taper) / (m sin(alpha)). Tips and roots lean atan(tan(taper)/sin(alpha)). */
export function taperRate(p, m, al = null) {
  const t = p.taper ?? 0.0;
  if (!t) return 0.0;
  al = al ?? radians(p.alpha);
  return tan(radians(t)) / (m * sin(al));
}

/** Half of the profile-shift range caused by the taper: dx(z) spans [-half, +half]. */
export function taperHalf(p, m, al = null) {
  const k = taperRate(p, m, al);
  if (!k) return 0.0;
  return k * p.H * (p.taper_mirror ? 0.25 : 0.5);
}

/** Profile-shift offset at height z. single: planet wide at the bottom (flip: top);
 *  mirrored: planet fattest at mid-height (flip: thinnest). */
export function taperDx(p, m, z) {
  const k = taperRate(p, m);
  if (!k) return 0.0;
  const H = p.H;
  let s = p.taper_mirror ? (H / 4 - abs(z - H / 2)) : (H / 2 - z);
  if (p.taper_flip) s = -s;
  return k * s;
}

// --------------------------------------------------------------------------
//  V3: spline bore, planet pins, external teeth and gear trains
// --------------------------------------------------------------------------
/** Internal involute spline in the sun bore (ID = pitch diameter) and its shaft; x = 0. */
export function splineGeometry(p) {
  const Z = Math.trunc(p.spline_teeth ?? 12);
  const al = radians(p.spline_alpha ?? 30.0);
  const m = p.ID / Z;
  const c = p.root_clear, d = p.expansion / 2.0;
  const rr = m * Z / 2;
  const g = { Z, Zr: Z, m, alpha: al, x: 0.0, c, d, rr, rbr: rr * cos(al) };
  g.ri_r = max(rr - m + d, g.rbr * 1.0005);
  g.ro_r = rr + m + c + d;
  g.ra_shaft = tipRadius(Z, m, al, 0.0, d, rr + m - d, p.tip_land ?? 0.1);
  g.rf_shaft = rr - m - c - d;
  return g;
}

export function splineProfiles(p) {
  const g = splineGeometry(p), land = p.tip_land;
  const bore = { ...ringProfile(g, land), Z: g.Z };
  const shaft = { ...rackEnvelope(g.Z, g.m, g.alpha, 0.0, g.c, g.d, g.ra_shaft, land), Z: g.Z };
  return { g, bore, shaft };
}

/** Captured planet pin: hourglass bore (narrowest at mid-height) around a matching pin. */
export function pinGeometry(p) {
  const rm = (p.pin_d ?? 2.0) / 2.0, gap = p.pin_gap ?? 0.15, v = p.pin_v ?? 0.4;
  return { pin_mid: rm, pin_face: rm + v, bore_mid: rm + gap, bore_face: rm + gap + v, v, gap,
    collar: p.pin_collar ?? 0.8, captured: v > gap + 1e-9 };
}

export const PIN_RIM = 0.4;

/** Radius the ring wall is measured to: OD/2, or the root of the external teeth. */
export function ringOuterRadius(p) {
  return p.ext_teeth ? extGeometry(p).rf : p.OD / 2.0;
}

/** External teeth on the ring (x = 0). OD is their tip diameter; ext_z_auto: largest count that fits. */
export function extGeometry(p) {
  const m = p.ext_module ?? 1.0, al = radians(p.alpha), c = p.root_clear, d = p.expansion / 2.0;
  const Z = (p.ext_z_auto ?? true) ? max(6, Math.floor((p.OD + 2 * d) / m - 2 + 1e-9)) : Math.trunc(p.ext_z ?? 30);
  const rp = m * Z / 2;
  const ra = tipRadius(Z, m, al, 0.0, d, rp + m - d, p.tip_land ?? 0.1);
  return { Z, m, alpha: al, x: 0.0, c, d, rp, rb: rp * cos(al), ra, rf: rp - m - c - d };
}

/** Rotation (rad) of external teeth at height z; hand alternates along a gear train. */
export function extTwist(p, z, rp, hand) {
  const kind = p.ext_helix ?? "Straight";
  if (kind === "Straight" || !p.ext_beta) return 0.0;
  const tb = tan(radians(p.ext_beta)), H = p.H;
  const w = kind === "Helical" ? z : (z <= H / 2 ? z : H - z);
  return hand * tb * w / rp;
}

const TRAIN_NAMES = ["A", "B", "C"];

function scaledCounts(pa, q) {
  const ga = derive(pa);
  const c = pa.root_clear, d = pa.expansion / 2.0;
  const W_a = ringOuterRadius(pa) - sunBoreRadius(pa);
  const zone_a = ga.ro_r - ga.rf_s;
  const W_q = ringOuterRadius(q) - sunBoreRadius(q);
  const m = ga.m;
  let Zp = pyRound((zone_a / W_a * W_q - 2 * (c + d)) / m - 2 - 2 * ga.x);
  Zp = min(LIMITS.Zp_max, max(LIMITS.Zp_min, Zp));
  const S = (2 * ringOuterRadius(q) + q.ID) / m;
  const Zs = max(LIMITS.Zs_min, pyRound((S - 2 * Zp) / 2.0));
  const a_q = m * (Zs + Zp) / 2.0;
  const N = max(1, pyRound(pa.N * (a_q / ga.a) * (pa.Zp / Zp)));
  return { Zs, Zp, Zr: Zs + 2 * Zp, N };
}

/** Bearings of a gear train A -> B (-> C) meshing on their external teeth. Ratio A:B = B teeth / A
 *  teeth (0 = Auto: from B_OD). Returns {bearings: [{name, p, Ze, cx, cy, rot, hand, a}], notes}. */
export function trainLayout(p) {
  const n = { "Single": 1, "A-B": 2, "A-B-C": 3 }[p.train ?? "Single"] ?? 1;
  const out = [], notes = [];
  if (!p.ext_teeth || n === 1)
    return { bearings: [{ name: "A", p, Ze: p.ext_teeth ? extGeometry(p).Z : 0, cx: 0.0, cy: 0.0, rot: 0.0, hand: 1 }], notes };
  const me = p.ext_module, d = p.expansion / 2.0;
  out.push({ name: "A", p, Ze: extGeometry(p).Z, cx: 0.0, cy: 0.0, rot: 0.0, hand: 1 });
  let prev = out[0], phi = 0.0;
  for (const [k, key] of [[1, "ab"], [2, "bc"]]) {
    if (k >= n) break;
    const name = TRAIN_NAMES[k];
    const ratio = p["ratio_" + key] ?? 0.0;
    const ID = p[name + "_ID"] ?? p.ID;
    let OD, Ze;
    if (ratio && ratio > 0) { Ze = max(6, pyRound(prev.Ze * ratio)); OD = me * (Ze + 2) - 2 * d; }
    else { OD = p[name + "_OD"] ?? p.OD; Ze = max(6, Math.floor((OD + 2 * d) / me - 2 + 1e-9)); }
    const q = { ...p, OD, ID, ext_z_auto: false, ext_z: Ze, train: "Single" };
    Object.assign(q, scaledCounts(p, q));
    const s = solve(q, null);
    Object.assign(q, { Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N });
    for (const t of s.notes) notes.push(`${name}: ${t}`);
    const a = me * (prev.Ze + Ze) / 2.0;
    if (k === 2) phi = radians(p.train_angle ?? 0.0);
    const cx = prev.cx + a * cos(phi), cy = prev.cy + a * sin(phi);
    const pp = 2 * PI / prev.Ze, pt = 2 * PI / Ze;
    const u_prev = fmod1((phi - prev.rot) / pp);
    const rot = phi + PI - pt * (0.5 - u_prev);
    out.push({ name, p: q, Ze, cx, cy, rot, hand: -prev.hand, a });
    prev = out[out.length - 1];
  }
  return { bearings: out, notes };
}

export function taperMode(p) {
  if (p.taper_mirror) return p.taper_flip ? "mirrored, planets thinnest at mid-height" : "mirrored, planets fattest at mid-height";
  return p.taper_flip ? "single, planets wide at the top" : "single, planets wide at the bottom";
}

/** Radial depth a surface texture cuts in ('od' = ring OD, 'bore' = sun bore; Round bores only). */
export function texDepth(p, which) {
  if ((p[which + "_tex"] ?? "None") === "None") return 0.0;
  if (which === "bore" && (p.sun_bore_shape !== "Round" || !(p.ID > 0))) return 0.0;
  if (which === "od" && p.ext_teeth) return 0.0;
  return max(0.0, p[which + "_tex_depth"] ?? 0.0);
}

/** Feature count around and rows over the height for a texture on a cylinder of radius R. */
export function texLayout(p, which, R, chamfer = 0.3) {
  const kind = p[which + "_tex"] ?? "None";
  const pitch = max(0.05, p[which + "_tex_pitch"] ?? 1.0);
  const n = max(3, pyRound(2 * PI * R / pitch));
  const out = { n, rows: 0, pz: 0.0, ext_z: 0.0, w: 0.0, L: 0.0 };
  if (kind === "Dimples" || kind === "Ovals" || kind === "Raised ovals") {
    const oval = kind !== "Dimples";
    const w = max(0.05, p[which + "_tex_size"] ?? 1.0);
    const L = oval ? w * max(1.0, p[which + "_tex_aspect"] ?? 1.0) : w;
    const psi = oval ? radians(p[which + "_tex_angle"] ?? 0.0) : 0.0;
    const ext_z = L * abs(cos(psi)) + w * abs(sin(psi));
    const pz = 0.5 * sqrt(3.0) * pitch * ext_z / w;
    const H = p.H;
    const span = H - 2 * (chamfer + ext_z / 2);
    const rows = span >= 0 ? Math.floor(span / pz) + 1 : (H > ext_z ? 1 : 0);
    Object.assign(out, { rows, pz, ext_z, w, L });
  }
  return out;
}

// --------------------------------------------------------------------------
//  Tooth-count solver
// --------------------------------------------------------------------------
export const LIMITS = { Zp_min: 4, Zp_max: 80, Zs_min: 6, Zs_max: 300, N_min: 1, N_max: 120 };
export const WEIGHTS = { N: 8.0, Zr: 2.0, Zs: 1.0, Zp: 3.0 };
const f3 = (v) => v.toFixed(3), f2 = (v) => v.toFixed(2);

export function feasible(p, Zs, Zp, N, why = false) {
  const reasons = [];
  const Zr = Zs + 2 * Zp;
  if ((Zs + Zr) % N) {
    reasons.push(`(Zs+Zr)=${Zs + Zr} not divisible by N=${N} -> planets cannot be equally spaced`);
    if (!why) return [false, reasons];
  }
  if (p.hunting && gcd(Zs, Zp) !== 1) {
    reasons.push(`gcd(Zs,Zp)=${gcd(Zs, Zp)} != 1 -> not hunting-tooth (uneven wear)`);
    if (!why) return [false, reasons];
  }
  const g = derive(p, Zs, Zp, N);
  const half = taperHalf(p, g.m);
  const g_hi = half ? derive(p, Zs, Zp, N, half) : g;      // widest planet / deepest ring root
  const g_lo = half ? derive(p, Zs, Zp, N, -half) : g;     // thinnest planet
  const minMod = p.min_module ?? 0.0;
  if (g.m < minMod - 1e-12) {
    reasons.push(`module ${f3(g.m)} < min printable module ${f3(minMod)}`);
    if (!why) return [false, reasons];
  }
  if (N >= 2) {
    const gap = 2 * g.a * sin(PI / N) - 2 * g_hi.ra_p;
    if (gap < p.min_planet_gap - 1e-9) {
      reasons.push(`adjacent planet tips gap ${f3(gap)} < ${f3(p.min_planet_gap)} mm`);
      if (!why) return [false, reasons];
    }
  }
  let [rw_min, rw_max, sw_min, sw_max] = wallLimits(p);
  const [wall, rim] = walls(p, g_hi);
  if (moduleMode(p) === "Walls") {
    const tr = (p.ring_wall ?? 0.8) + g.m / 2, ts = (p.sun_wall ?? 0.8) + g.m / 2;
    rw_max = rw_max > 0 ? min(rw_max, tr) : tr;
    sw_max = sw_max > 0 ? min(sw_max, ts) : ts;
  }
  for (const [nm, v, lo_, hi_] of [["ring wall", wall, rw_min, rw_max], ["sun rim", rim, sw_min, sw_max]]) {
    if (v < lo_ - 1e-9) reasons.push(`${nm} ${f3(v)} < ${f3(lo_)} mm`);
    else if (hi_ > 0 && v > hi_ + 1e-9) reasons.push(`${nm} ${f3(v)} > max ${f3(hi_)} mm`);
    else continue;
    if (!why) return [false, reasons];
  }
  if (p.planet_pins) {
    const prim = g_lo.rf_p - pinGeometry(p).bore_face;
    if (prim < PIN_RIM - 1e-9) {
      reasons.push(`planet rim around the pin ${f3(prim)} < ${f2(PIN_RIM)} mm (planets too small for pins)`);
      if (!why) return [false, reasons];
    }
  }
  if (g_hi.rf_s <= 0 || g_lo.rf_p <= 0) reasons.push("negative root radius");
  return [reasons.length === 0, reasons];
}

/** [ring wall, sun rim] at the taper's wide end, after textures. */
export function walls(p, g_hi) {
  return [ringOuterRadius(p) - g_hi.ro_r - texDepth(p, "od"), g_hi.rf_s - sunBoreRadius(p) - texDepth(p, "bore")];
}

/** Closest compatible (Zs, Zp, N). lock: 'N' | 'Zr' | 'Zs' | 'Zp' | null.
 *  Returns {Zs, Zp, Zr, N, notes}. Same candidate order as numpy lexsort((-N, cost)). */
export function solve(p, locked = null) {
  const Zs0 = p.Zs, Zp0 = p.Zp, N0 = p.N, Zr0 = p.Zr;
  const notes = [];
  const L = LIMITS, W = WEIGHTS;
  const nZs = L.Zs_max - L.Zs_min + 1;

  function run(lock) {
    const Nlo = lock === "N" ? N0 : L.N_min, Nhi = lock === "N" ? N0 : L.N_max;
    const nN = Nhi - Nlo + 1;
    const cand = [];
    for (let Zp = L.Zp_min; Zp <= L.Zp_max; Zp++) {
      if (lock === "Zp" && Zp !== Zp0) continue;
      for (let Zs = L.Zs_min; Zs <= L.Zs_max; Zs++) {
        if (lock === "Zs" && Zs !== Zs0) continue;
        const Zr = Zs + 2 * Zp;
        if (lock === "Zr" && Zr !== Zr0) continue;
        for (let N = Nlo; N <= Nhi; N++) {
          if ((Zs + Zr) % N) continue;
          const cost = W.N * abs(N - N0) + W.Zr * abs(Zr - Zr0) + W.Zs * abs(Zs - Zs0) + W.Zp * abs(Zp - Zp0);
          const idx = ((Zp - L.Zp_min) * nZs + (Zs - L.Zs_min)) * nN + (N - Nlo);
          cand.push([cost, N, idx, Zs, Zp]);
        }
      }
    }
    cand.sort((u, v) => u[0] - v[0] || v[1] - u[1] || u[2] - v[2]);
    const lim = min(cand.length, 20000);
    for (let i = 0; i < lim; i++) {
      const [, N, , Zs, Zp] = cand[i];
      if (feasible(p, Zs, Zp, N)[0]) return [Zs, Zp, N];
    }
    return null;
  }

  let res = run(locked);
  if (res === null && locked !== null) {
    const v = { N: N0, Zr: Zr0, Zs: Zs0, Zp: Zp0 }[locked];
    notes.push(`Could not keep ${locked}=${v}: no combination with it gives equal spacing while meeting ` +
      "MinModule / MinWall / MinPlanetGap - released it.");
    res = run(null);
  }
  if (res === null) {
    notes.push("NO compatible combination found near current values - geometry built as-is, check report.");
    return { Zs: Zs0, Zp: Zp0, Zr: Zs0 + 2 * Zp0, N: N0, notes };
  }
  const [Zs, Zp, N] = res;
  const Zr = Zs + 2 * Zp;
  const ch = [];
  for (const [k, a, b] of [["Planets", N0, N], ["Ring", Zr0, Zr], ["Sun", Zs0, Zs], ["Planet teeth", Zp0, Zp]])
    if (a !== b) ch.push(`${k} ${a}->${b}`);
  if (ch.length) notes.push("Auto-adjusted for compatibility: " + ch.join(", "));
  return { Zs, Zp, Zr, N, notes };
}

// --------------------------------------------------------------------------
//  Tooth profiles
// --------------------------------------------------------------------------
/** External tooth generated by a (shifted, expanded) rack. Returns {r, t, rf, ra} (polar half-angles). */
export function rackEnvelope(Z, m, al, x, c, d, ra_target, land_min, n_r = 36, n_phi = 6000) {
  const rp = m * Z / 2.0;
  const p = PI * m;
  const ta = tan(al);
  const vt = -(m + c + d);
  const vtop = m * (2.5 + abs(x));
  const rf = rp + x * m + vt;
  const half = (v) => max(p / 4 + d / cos(al) + v * ta, 0.0);
  const u0 = p / 2.0;
  const A = [u0 - half(vt), vt], B = [u0 - half(vtop), vtop], C = [u0 + half(vt), vt];
  const segs = [[A, B], [A, C]];
  const R = rp + x * m;
  const span = ra_target + p;
  const phis = linspace((u0 - span) / rp, (u0 + span) / rp, n_phi);
  const s = linspace(0, 1, n_r).map((v) => v ** 1.3);
  const r0 = rf + 1e-6 * m, dr = ra_target - rf - 1e-6 * m;
  let r = s.map((v) => r0 + dr * v);
  const r2 = r.map((v) => v * v);
  const best = new Float64Array(n_r).fill(Infinity);
  const thMin = -PI / Z;
  for (const [P0, P1] of segs) {
    const dx = P1[0] - P0[0], dy = P1[1] - P0[1];
    const aa = dx * dx + dy * dy, a4 = 4 * aa, a2 = 2 * aa;
    for (let j = 0; j < n_phi; j++) {
      const phi = phis[j];
      const Ax = P0[0] - rp * phi, Ay = R + P0[1];
      const bb = 2 * (Ax * dx + Ay * dy), cc = Ax * Ax + Ay * Ay, b2 = bb * bb;
      for (let i = 0; i < n_r; i++) {
        const disc = b2 - a4 * (cc - r2[i]);
        if (disc < 0) continue;
        const sq = sqrt(disc);
        for (let sg = -1; sg <= 1; sg += 2) {
          const t = (-bb + sg * sq) / a2;
          if (t < 0 || t > 1) continue;
          const th = Math.atan2(Ax + t * dx, Ay + t * dy) + phi;
          if (th > thMin && th < PI && th < best[i]) best[i] = th;
        }
      }
    }
  }
  let t = best;
  if (!t.every(Number.isFinite)) {
    const fr = [], ft = [];
    for (let i = 0; i < n_r; i++) if (Number.isFinite(t[i])) { fr.push(r[i]); ft.push(t[i]); }
    const it = interp(r, fr, ft);
    t = t.map((v, i) => (Number.isFinite(v) ? v : it[i]));
  }
  // pointed-tip truncation
  let ra = ra_target;
  let bad = -1;
  for (let i = 0; i < n_r; i++) if (t[i] < land_min / (2 * r[i])) { bad = i; break; }
  if (bad >= 0) {
    const i = bad;
    if (i === 0) ra = r[0] + 1e-3;
    else {
      const l0 = land_min / (2 * r[i - 1]), l1 = land_min / (2 * r[i]);
      const f = (t[i - 1] - l0) / ((t[i - 1] - l0) - (t[i] - l1));
      ra = r[i - 1] + f * (r[i] - r[i - 1]);
    }
    const dr2 = ra - rf - 1e-6 * m;
    const rr = s.map((v) => r0 + dr2 * v);
    t = interp(rr, r, t);
    r = rr;
  }
  return { r: Array.from(r), t: Array.from(t), rf, ra };
}

/** Internal ring tooth (material) half-angle psi(r) from inner tip to outer root. */
export function ringProfile(g, land_min, n_r = 24) {
  const { m, alpha: al, x, d, Zr, rr, rbr: rb } = g;
  const s_r = m * (PI / 2 - 2 * x * tan(al));
  const ri = g.ri_r;
  let ro = g.ro_r;
  const psi = (r) => s_r / (2 * rr) - inv(al) + inv(acos(min(1.0, rb / r))) - d / rb;
  const rs_ = linspace(ri, ro, 400);
  for (let i = 0; i < 400; i++) {
    if (PI / Zr - psi(rs_[i]) < land_min / (2 * rs_[i])) { ro = rs_[max(i - 1, 1)]; break; }
  }
  const lin = linspace(0, PI, n_r);
  const r = Array.from(lin, (v) => ri + (ro - ri) * (0.5 - 0.5 * cos(v)));
  const t = r.map(psi);
  return { r, t, ri, ro };
}

export function buildProfiles(p, g) {
  const land = p.tip_land;
  const P = rackEnvelope(g.Zp, g.m, g.alpha, g.x, g.c, g.d, g.ra_p, land);
  const S = rackEnvelope(g.Zs, g.m, g.alpha, -g.x, g.c, g.d, g.ra_s, land);
  const Rg = ringProfile(g, land);
  return {
    planet: { ...P, Z: g.Zp },
    sun: { ...S, Z: g.Zs },
    ring: { ...Rg, Z: g.Zr },
  };
}

/** Profiles at the taper extremes: {g_lo, plo, g_hi, phi}, or null without taper. */
export function taperProfiles(p, g) {
  const half = taperHalf(p, g.m);
  if (!half) return null;
  const g_lo = derive(p, g.Zs, g.Zp, g.N, -half), g_hi = derive(p, g.Zs, g.Zp, g.N, half);
  return { g_lo, plo: buildProfiles(p, g_lo), g_hi, phi: buildProfiles(p, g_hi) };
}

// --------------------------------------------------------------------------
//  Assembly phasing, twist, kinematics
// --------------------------------------------------------------------------
const fmod1 = (v) => ((v % 1) + 1) % 1;

export function phasing(g) {
  const { Zs, Zp, Zr, N } = g;
  const psi0 = PI - PI / Zp;
  const orbit = [], spins = [];
  for (let i = 0; i < N; i++) {
    const th = 2 * PI * i / N;
    orbit.push(th);
    spins.push(psi0 + th * (Zs + Zp) / Zp);
  }
  const f = fmod1((0 - psi0) * Zp / (2 * PI));
  const ring_rot = -(f + 0.5) * 2 * PI / Zr;
  return { orbit, spins, ring_rot };
}

/** Returns {f: z -> [sun, planet, ring] twist (rad), hs} */
export function helixTwist(g, beta_deg, H, reversals) {
  const tb = tan(radians(beta_deg));
  const hs = H / (reversals + 1);
  const w = (z) => { const q = ((z % (2 * hs)) + 2 * hs) % (2 * hs); return q <= hs ? q : 2 * hs - q; };
  const f = (z) => { const s = tb * w(z); return [s / g.rs, -s / g.rp, -s / g.rr]; };
  return { f, hs };
}

/** Ring fixed, carrier angle tc -> sun angle, planet spin delta, orbit delta */
export function kinematics(g, tc) {
  return { sun: tc * (1 + g.Zr / g.Zs), spin: tc * (1 - g.Zr / g.Zp), orbit: tc };
}

// --------------------------------------------------------------------------
//  Report
// --------------------------------------------------------------------------
export function contactRatios(g, prof) {
  const al = g.alpha, m = g.m;
  const pb = PI * m * cos(al);
  const raP = prof.planet.ra, raS = prof.sun.ra, riR = prof.ring.ri;
  const a = g.a;
  const e_sp = (sqrt(max(raS ** 2 - g.rbs ** 2, 0)) + sqrt(max(raP ** 2 - g.rbp ** 2, 0)) - a * sin(al)) / pb;
  const e_rp = (sqrt(max(raP ** 2 - g.rbp ** 2, 0)) - sqrt(max(riR ** 2 - g.rbr ** 2, 0)) + a * sin(al)) / pb;
  return [e_sp, e_rp];
}

const fx = (v, n) => v.toFixed(n);
const fs = (v, n) => (v < 0 || Object.is(v, -0) ? "-" : "+") + abs(v).toFixed(n);   // Python "%+.3f" (keeps -0.000)

export function report(p, g, prof, notes = []) {
  const { Zs, Zp, Zr, N, m } = g;
  const L = [...notes];
  L.push("=== Teeth / layout ===");
  L.push(`Sun ${Zs}  Planet ${Zp} x ${N}  Ring ${Zr}   (Zr = Zs + 2*Zp)`);
  L.push(`Module (transverse) ${fx(m, 4)} mm, normal module ${fx(m * cos(radians(p.beta)), 4)} mm, pressure angle ${fx(p.alpha, 1)} deg`);
  L.push(`Profile shift x: planet ${fs(g.x, 3)}, sun ${fs(-g.x, 3)}, ring ${fs(g.x, 3)}`);
  L.push(`Planet orbit radius ${fx(g.a, 4)} mm, orbit diameter ${fx(2 * g.a, 4)} mm`);
  const sp_ok = (Zs + Zr) % N === 0;
  L.push(`Equal spacing: (Zs+Zr)/N = ${Zs + Zr}/${N} = ${sp_ok ? String((Zs + Zr) / N) : fx((Zs + Zr) / N, 3)} -> ` +
    (sp_ok ? `OK, every planet 360/${N} = ${fx(360.0 / N, 4)} deg` : "NOT POSSIBLE"));
  L.push(`Gear ratios: ring fixed -> sun:carrier = ${fx(1 + Zr / Zs, 4)} : 1 ; sun fixed -> ring:carrier = ${fx(1 + Zs / Zr, 4)} : 1`);
  L.push("=== Phasing / wear ===");
  for (const [nm, Za] of [["Sun-Planet", Zs], ["Ring-Planet", Zr]]) {
    const gg = gcd(Za, Zp);
    const who = nm.split("-")[0].toLowerCase();
    if (gg === 1) {
      L.push(`${nm}: gcd(${Za},${Zp})=1 -> HUNTING TOOTH: every planet tooth meets every ${who} tooth; ` +
        `full cycle every ${lcm(Za, Zp)} engagements, then repeats`);
    } else {
      const kind = gg === 2 ? " (odd teeth only meet odd, even only even)" : "";
      L.push(`${nm}: gcd(${Za},${Zp})=${gg} -> ${gg} ISOLATED wear paths${kind}: each planet tooth only meets ` +
        `${Za / gg} of ${Za} ${who} teeth; pattern repeats every ${lcm(Za, Zp)} engagements`);
    }
  }
  const ph = [...new Set(Array.from({ length: N }, (_, i) => Math.round(fmod1(i * Zs / N) * 1e6) / 1e6))].sort((a, b) => a - b);
  if (ph.length === 1) L.push(`Planet mesh timing: all ${N} planets mesh IN PHASE (same instant)`);
  else L.push(`Planet mesh timing: ${ph.length} distinct mesh phases (sequential meshing, smoother), step ${fx(ph[1] - ph[0], 4)} tooth`);
  L.push(`Even-wear enforcement: ${p.hunting ? "ON" : "OFF"}`);
  L.push("=== Mesh quality ===");
  const [e_sp, e_rp] = contactRatios(g, prof);
  const tb = tan(radians(p.beta));
  const hs = p.H / (p.reversals + 1);
  const e_b = hs * tb / (PI * m);
  L.push(`Transverse contact ratio: sun-planet ${fx(e_sp, 3)}, ring-planet ${fx(e_rp, 3)}${min(e_sp, e_rp) < 1.0 ? "  (WARNING <1.0)" : ""}`);
  L.push(`Overlap (helical) ratio per herringbone leg ${fx(e_b, 3)} -> total sun-planet ${fx(e_sp + e_b, 3)}, ring-planet ${fx(e_rp + e_b, 3)}`);
  L.push(`Herringbone: helix ${fx(p.beta, 1)} deg, ${p.reversals} reversal(s) -> ${p.reversals + 1} legs of ${fx(hs, 3)} mm`);
  L.push("=== Radii (mm) ===");
  const pl = prof.planet, su = prof.sun, ri = prof.ring;
  L.push(`Planet tip ${fx(pl.ra, 4)}${pl.ra < g.ra_p - 1e-6 ? " (truncated, pointed)" : ""} root ${fx(pl.rf, 4)} | ` +
    `Sun tip ${fx(su.ra, 4)}${su.ra < g.ra_s - 1e-6 ? " (truncated, pointed)" : ""} root ${fx(su.rf, 4)} | ` +
    `Ring tip ${fx(ri.ri, 4)} root ${fx(ri.ro, 4)}`);
  const tp = taperProfiles(p, g);
  const hi = tp ? tp.phi : prof, lo = tp ? tp.plo : prof;
  const wall = ringOuterRadius(p) - hi.ring.ro - texDepth(p, "od");
  const rim = hi.sun.rf - sunBoreRadius(p) - texDepth(p, "bore");
  const [rw_min, rw_max, sw_min, sw_max] = wallLimits(p);
  const lim = (a, b) => `min ${fx(a, 2)}` + (b > 0 ? `, max ${fx(b, 2)}` : "");
  L.push(`Ring wall ${fx(wall, 3)} mm (${lim(rw_min, rw_max)}), sun rim ${fx(rim, 3)} mm (${lim(sw_min, sw_max)})` +
    (moduleMode(p) === "Walls" ? ` - module fitted to wall targets ${fx(p.ring_wall ?? 0.8, 2)} / ${fx(p.sun_wall ?? 0.8, 2)}` : ""));
  if (p.planet_pins) {
    const prim = lo.planet.rf - pinGeometry(p).bore_face;
    L.push(`Planet rim around the pin bore ${fx(prim, 3)} mm${prim < PIN_RIM ? "  (WARNING thin)" : ""}`);
  } else if (p.planet_bore_d > 0) {
    const prim = lo.planet.rf - boreOuterRadius(p.planet_bore_shape, p.planet_bore_d, g.d);
    L.push(`Planet rim around bore ${fx(prim, 3)} mm${prim < 0.4 ? "  (WARNING thin)" : ""}`);
  }
  if (N >= 2) {
    const gap = 2 * g.a * sin(PI / N) - 2 * hi.planet.ra;
    L.push(`Planet-to-planet tip gap ${fx(gap, 3)} mm (min ${fx(p.min_planet_gap, 2)})`);
  }
  L.push(`Clearances: flank gap per contact ${fx(p.expansion, 3)} mm (${fx(g.d, 3)} per part), tip-root ${fx(g.c, 3)} + ${fx(p.expansion, 3)} mm`);
  if (tp) L.push(...reportTaper(p, g, tp));
  L.push(...reportTexture(p, g));
  L.push(...reportV3(p, g));
  const [, why] = feasible(p, Zs, Zp, N, true);
  for (const w of why) L.push("WARNING: " + w);
  return L;
}

function reportTaper(p, g, { g_lo, plo, g_hi, phi }) {
  const L = ["=== Taper ==="];
  L.push(`Taper ${fx(p.taper, 1)} deg (${taperMode(p)}): planet profile shift x ${fs(g_lo.x, 3)} .. ${fs(g_hi.x, 3)}, mid-height ${fs(g.x, 3)}`);
  L.push(`Load-carrying flanks lean ${fx(p.taper, 1)} deg; tooth tips and roots form cones of ${fx(Math.atan(tan(radians(p.taper)) / sin(g.alpha)) * 180 / PI, 1)} deg`);
  L.push(`Planet tip ${fx(plo.planet.ra, 4)} .. ${fx(phi.planet.ra, 4)} root ${fx(plo.planet.rf, 4)} .. ${fx(phi.planet.rf, 4)} | ` +
    `Sun tip ${fx(phi.sun.ra, 4)} .. ${fx(plo.sun.ra, 4)} root ${fx(phi.sun.rf, 4)} .. ${fx(plo.sun.rf, 4)} | ` +
    `Ring tip ${fx(plo.ring.ri, 4)} .. ${fx(phi.ring.ri, 4)} root ${fx(plo.ring.ro, 4)} .. ${fx(phi.ring.ro, 4)}`);
  const [a_lo, b_lo] = contactRatios(g_lo, plo), [a_hi, b_hi] = contactRatios(g_hi, phi);
  L.push(`Transverse contact ratio thin end / wide end: sun-planet ${fx(a_lo, 3)} / ${fx(a_hi, 3)}, ring-planet ${fx(b_lo, 3)} / ${fx(b_hi, 3)}` +
    (min(a_lo, a_hi, b_lo, b_hi) < 1.0 ? "  (WARNING <1.0)" : ""));
  const z_th = 2.0 / sin(g.alpha) ** 2;
  const lim_p = (5.0 / 6.0 * z_th - g.Zp) / z_th, lim_s = (5.0 / 6.0 * z_th - g.Zs) / z_th;
  if (g_lo.x < lim_p - 1e-9)
    L.push(`WARNING: planet undercut at the thin end (x ${fs(g_lo.x, 3)} < practical limit ${fs(lim_p, 3)}): weaker tooth roots`);
  if (-g_hi.x < lim_s - 1e-9)
    L.push(`WARNING: sun undercut where the planets are widest (sun x ${fs(-g_hi.x, 3)} < practical limit ${fs(lim_s, 3)})`);
  if (phi.planet.ra < g_hi.rp + g_hi.m * (1 + g_hi.x) - g_hi.d - 1e-6)
    L.push("Planet tips are truncated (pointed) at the wide end - normal for a strong taper");
  return L;
}

function reportTexture(p, g) {
  const L = [];
  for (const [which, label, R] of [["od", "Outer (ring OD)", p.OD / 2], ["bore", "Inner (sun bore)", p.ID / 2 + g.d]]) {
    const kind = p[which + "_tex"] ?? "None";
    if (kind === "None") continue;
    if (!L.length) L.push("=== Surface texture ===");
    if (texDepth(p, which) === 0.0) {
      L.push(`${label}: ${kind} ignored - ${which === "bore" ? "needs a Round sun bore" : "the ring has external teeth"}`);
      continue;
    }
    const lay = texLayout(p, which, R, surfaceChamfer(p, which));
    const d = p[which + "_tex_depth"];
    if (kind.endsWith("knurl")) {
      const ang = kind === "Straight knurl" ? "" : `, helix ${fx(p[which + "_tex_angle"], 1)} deg`;
      L.push(`${label}: ${kind}, depth ${fx(d, 3)} mm, pitch ${fx(p[which + "_tex_pitch"], 2)} mm -> ${lay.n} around${ang}`);
    } else {
      const size = kind === "Dimples" ? `${fx(lay.w, 2)} mm` : `${fx(lay.w, 2)} x ${fx(lay.L, 2)} mm, tilt ${fx(p[which + "_tex_angle"], 1)} deg`;
      L.push(`${label}: ${kind} ${size}, depth ${fx(d, 3)} mm, pitch ${fx(p[which + "_tex_pitch"], 2)} mm -> ${lay.n} around x ${lay.rows} row(s)` +
        (kind === "Raised ovals" ? " - surface recessed by the depth, ovals stand up to the nominal size" : ""));
      if (lay.rows === 0) L.push(`WARNING: ${kind.toLowerCase()} are taller than the height between the chamfers - none placed`);
    }
  }
  return L;
}

/** Chamfer at the ring OD ('od') or the sun bore ('bore'); older sets have one chamfer. */
export function surfaceChamfer(p, which) {
  return p[which === "od" ? "ring_od_chamfer" : "sun_bore_chamfer"] ?? p.chamfer ?? 0.3;
}

function reportV3(p, g) {
  const L = [];
  if (p.sun_bore_shape === "Spline") {
    const sg = splineGeometry(p);
    L.push("=== Spline bore ===");
    L.push(`Spline ${sg.Z} teeth, module ${fx(sg.m, 4)} mm, pressure angle ${fx(sg.alpha * 180 / PI, 1)} deg: bore tip ${fx(sg.ri_r, 4)} root ${fx(sg.ro_r, 4)} | ` +
      `shaft tip ${fx(sg.ra_shaft, 4)} root ${fx(sg.rf_shaft, 4)} (gap ${fx(p.expansion, 3)} per flank), shaft length ${fx(p.shaft_length ?? 15.0, 1)} mm` +
      ((p.shaft_bore ?? 0) > 0 ? `, centre hole ${fx(p.shaft_bore, 2)} mm` : ""));
    if (sg.rf_shaft - (p.shaft_bore ?? 0) / 2 < 0.5) L.push("WARNING: shaft wall around its centre hole is thin");
  }
  if (p.planet_pins) {
    const pg = pinGeometry(p);
    L.push("=== Planet pins (fixed carrier) ===");
    L.push(`Captured pin per planet: diameter ${fx(2 * pg.pin_mid, 2)} at mid-height, ${fx(2 * pg.pin_face, 2)} at the faces; hourglass bore ${fx(2 * pg.bore_mid, 2)}..${fx(2 * pg.bore_face, 2)} ` +
      `(radial gap ${fx(pg.gap, 2)}); collar + ${fx(p.carrier_t ?? 2.0, 1)} mm stub above the top for the ${fx(p.carrier_t ?? 2.0, 1)} mm carrier plate (hole fit ${fs(p.carrier_fit ?? 0.1, 2)})`);
    if (!pg.captured) L.push("WARNING: pin V depth must exceed the radial gap, or the pins fall out");
    L.push(`Carrier fixed: sun:ring = -${g.Zr}:${g.Zs} -> ring turns ${fx(g.Zs / g.Zr, 4)} per sun turn (opposite direction)`);
  }
  if (p.ext_teeth) L.push(...reportTrain(p));
  return L;
}

export function extContactRatio(ga, gb) {
  const a = ga.rp + gb.rp, pb = PI * ga.m * cos(ga.alpha);
  return (sqrt(max(ga.ra ** 2 - ga.rb ** 2, 0)) + sqrt(max(gb.ra ** 2 - gb.rb ** 2, 0)) - a * sin(ga.alpha)) / pb;
}

function reportTrain(p) {
  const { bearings: lay, notes } = trainLayout(p);
  const L = ["=== External teeth / gear train ===", ...notes];
  const style = p.ext_helix ?? "Straight";
  const st = style === "Straight" ? style : `${style} ${fx(p.ext_beta ?? 0.0, 1)} deg`;
  for (const b of lay) {
    const q = b.p, ge = extGeometry(q), gq = derive(q);
    L.push(`${b.name}: ${ge.Z} outer teeth (module ${fx(ge.m, 3)}, ${st}${style === "Straight" ? "" : (b.hand > 0 ? " right" : " left")}), tip dia ${fx(2 * ge.ra, 3)}, ring wall to outer root ${fx(ge.rf - gq.ro_r, 3)} mm | ` +
      `inside sun ${q.Zs} / planets ${q.Zp} x ${q.N} / ring ${q.Zr}, module ${fx(gq.m, 4)}`);
  }
  for (let i = 0; i + 1 < lay.length; i++) {
    const x = lay[i], y = lay[i + 1];
    const eps = extContactRatio(extGeometry(x.p), extGeometry(y.p));
    L.push(`${x.name}-${y.name}: ratio ${x.Ze}:${y.Ze} = ${fx(y.Ze / x.Ze, 4)} (${y.name} turns ${fx(x.Ze / y.Ze, 4)} per ${x.name} turn, opposite direction), centre distance ${fx(y.a, 3)} mm, ` +
      `contact ratio ${fx(eps, 3)}${eps < 1.0 ? "  (WARNING <1.0)" : ""}`);
  }
  if (lay.length === 3) L.push(`A-C overall: ${lay[0].Ze}:${lay[2].Ze} = ${fx(lay[2].Ze / lay[0].Ze, 4)}, C turns the same way as A`);
  if (style !== "Straight" && lay.length > 1) L.push("Neighbours use opposite helix hands so they mesh");
  return L;
}
