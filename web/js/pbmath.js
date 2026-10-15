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
  expansion: 0.1, root_clear: 0.1, tip_land: 0.025,
  hunting: false,
  min_planet_gap: 0.3, min_wall: 0.5, min_module: 0.5,
  module_auto: true, module: 0.5,
  shift_auto: true, shift: 0.0,
  sun_bore_shape: "Round", planet_bore_d: 0.0, planet_bore_shape: "Round",
  taper: 0.0, taper_mirror: false, taper_flip: false,
  od_tex: "None", od_tex_depth: 0.2, od_tex_pitch: 1.5, od_tex_angle: 30.0, od_tex_size: 1.2, od_tex_aspect: 2.5,
  bore_tex: "None", bore_tex_depth: 0.2, bore_tex_pitch: 1.2, bore_tex_angle: 30.0, bore_tex_size: 1.0, bore_tex_aspect: 2.5,
  // FreeCAD-object extras (geometry only, not used by the solver)
  chamfer: 0.3, sun_bore_flat: 0.4, surface_tol: 0.005, mesh_dev: 0.01,
};
export const DEFAULTS_V1 = { ...DEFAULTS, ID: 22.0, N: 24, Zs: 56, Zr: 64, expansion: 0.15, root_clear: 0.15, tip_land: 0.1, min_module: 0.4 };

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
  const m = (p.module_auto ?? true) ? (p.OD + p.ID) / (Zs + Zr) : p.module;
  let x;
  if (p.shift_auto ?? true) {
    const z_th = 2.0 / sin(al) ** 2;
    x = max(0.0, (5.0 / 6.0 * z_th - Zp) / z_th);
    x += taperHalf(p, m);          // taper: thin end of the planet sits at the practical undercut limit
  } else x = p.shift;
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

export function boreOuterRadius(shape, dia, comp) {
  if (shape === "None" || dia <= 0) return 0.0;
  const r = dia / 2.0 + comp;
  if (shape === "Hex") return r / cos(PI / 6);
  if (shape === "Square") return r * sqrt(2);
  return r;
}

// Python round() (ties to even) for parity
const pyRound = (v) => { const f = Math.floor(v), r = v - f; return r > 0.5 ? f + 1 : r < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };

export const TEX_TYPES = ["None", "Straight knurl", "Diagonal knurl", "Diamond knurl", "Dimples", "Ovals"];

/** Half of the profile-shift range caused by the taper: dx(z) spans [-half, +half]. */
export function taperHalf(p, m) {
  const t = p.taper ?? 0.0;
  if (!t) return 0.0;
  return tan(radians(t)) / m * p.H * (p.taper_mirror ? 0.25 : 0.5);
}

/** Profile-shift offset at height z. single: planet wide at the bottom (flip: top);
 *  mirrored: planet fattest at mid-height (flip: thinnest). */
export function taperDx(p, m, z) {
  const t = p.taper ?? 0.0;
  if (!t) return 0.0;
  const H = p.H;
  let s = p.taper_mirror ? (H / 4 - abs(z - H / 2)) : (H / 2 - z);
  if (p.taper_flip) s = -s;
  return tan(radians(t)) / m * s;
}

export function taperMode(p) {
  if (p.taper_mirror) return p.taper_flip ? "mirrored, planets thinnest at mid-height" : "mirrored, planets fattest at mid-height";
  return p.taper_flip ? "single, planets wide at the top" : "single, planets wide at the bottom";
}

/** Radial depth a surface texture cuts in ('od' = ring OD, 'bore' = sun bore; Round bores only). */
export function texDepth(p, which) {
  if ((p[which + "_tex"] ?? "None") === "None") return 0.0;
  if (which === "bore" && (p.sun_bore_shape !== "Round" || !(p.ID > 0))) return 0.0;
  return max(0.0, p[which + "_tex_depth"] ?? 0.0);
}

/** Feature count around and rows over the height for a texture on a cylinder of radius R. */
export function texLayout(p, which, R, chamfer = 0.3) {
  const kind = p[which + "_tex"] ?? "None";
  const pitch = max(0.05, p[which + "_tex_pitch"] ?? 1.0);
  const n = max(3, pyRound(2 * PI * R / pitch));
  const out = { n, rows: 0, pz: 0.0, ext_z: 0.0, w: 0.0, L: 0.0 };
  if (kind === "Dimples" || kind === "Ovals") {
    const w = max(0.05, p[which + "_tex_size"] ?? 1.0);
    const L = kind === "Ovals" ? w * max(1.0, p[which + "_tex_aspect"] ?? 1.0) : w;
    const psi = kind === "Ovals" ? radians(p[which + "_tex_angle"] ?? 0.0) : 0.0;
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
  const wall = p.OD / 2 - g_hi.ro_r - texDepth(p, "od");
  if (wall < p.min_wall - 1e-9) {
    reasons.push(`ring wall ${f3(wall)} < ${f3(p.min_wall)} mm`);
    if (!why) return [false, reasons];
  }
  const rim = g_hi.rf_s - boreOuterRadius(p.sun_bore_shape, p.ID, g.d) - texDepth(p, "bore");
  if (rim < p.min_wall - 1e-9) {
    reasons.push(`sun rim ${f3(rim)} < ${f3(p.min_wall)} mm`);
    if (!why) return [false, reasons];
  }
  if (g_hi.rf_s <= 0 || g_lo.rf_p <= 0) reasons.push("negative root radius");
  return [reasons.length === 0, reasons];
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
  const wall = p.OD / 2 - hi.ring.ro - texDepth(p, "od");
  const rim = hi.sun.rf - boreOuterRadius(p.sun_bore_shape, p.ID, g.d) - texDepth(p, "bore");
  L.push(`Ring wall ${fx(wall, 3)} mm, sun rim ${fx(rim, 3)} mm (min ${fx(p.min_wall, 2)})`);
  if (p.planet_bore_d > 0) {
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
  const [, why] = feasible(p, Zs, Zp, N, true);
  for (const w of why) L.push("WARNING: " + w);
  return L;
}

function reportTaper(p, g, { g_lo, plo, g_hi, phi }) {
  const L = ["=== Taper ==="];
  L.push(`Taper ${fx(p.taper, 1)} deg (${taperMode(p)}): planet profile shift x ${fs(g_lo.x, 3)} .. ${fs(g_hi.x, 3)}, mid-height ${fs(g.x, 3)}`);
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
    if (texDepth(p, which) === 0.0) { L.push(`${label}: ${kind} ignored - needs a Round sun bore`); continue; }
    const lay = texLayout(p, which, R, p.chamfer ?? 0.3);
    const d = p[which + "_tex_depth"];
    if (kind.endsWith("knurl")) {
      const ang = kind === "Straight knurl" ? "" : `, helix ${fx(p[which + "_tex_angle"], 1)} deg`;
      L.push(`${label}: ${kind}, depth ${fx(d, 3)} mm, pitch ${fx(p[which + "_tex_pitch"], 2)} mm -> ${lay.n} around${ang}`);
    } else {
      const size = kind === "Dimples" ? `${fx(lay.w, 2)} mm` : `${fx(lay.w, 2)} x ${fx(lay.L, 2)} mm, tilt ${fx(p[which + "_tex_angle"], 1)} deg`;
      L.push(`${label}: ${kind} ${size}, depth ${fx(d, 3)} mm, pitch ${fx(p[which + "_tex_pitch"], 2)} mm -> ${lay.n} around x ${lay.rows} row(s)`);
      if (lay.rows === 0) L.push(`WARNING: ${kind.toLowerCase()} are taller than the height between the chamfers - none placed`);
    }
  }
  return L;
}
