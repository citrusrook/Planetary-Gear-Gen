// Direct triangle-mesh builder (no B-rep): every part is a twisted extrusion of 2D loops.
//  * V2: tapered teeth = a different profile (shift x0 + dx(z)) per z section on a fixed vertex layout;
//    textured OD / bore = loops whose radius depends on angle and height (knurl, dimples, ovals)
// Mirrors freecad/PlanetaryBearing.py build_parts(); see HANDOFF.md §7.
//  * each loop (gear outline, toothed ring hole, OD circle, bore) gets its own z sections:
//    helix sections (sag <= surface_tol, same rule as twisted_loft) + chamfer sections near faces
//  * chamfers = per-vertex radial clamp:  external tips r' = min(r, ra - c + dz), holes r' = max(r, rh + c - dz)
//  * caps = earcut of the z=0 / z=H rings (outer + holes), sharing the wall vertices -> watertight
import earcut from "https://cdn.jsdelivr.net/npm/earcut@2.2.4/+esm";
import * as pm from "./pbmath.js";

const { PI, cos, sin, max, min, ceil, round, abs, hypot } = Math;

const dphiFor = (r, tol) => 2 * Math.acos(max(-1, 1 - tol / max(r, 1e-6)));

// ---------------------------------------------------------------- 2D loops (polar r, angle)
function pushArc(R, A, r, a0, a1, tol, withStart, withEnd) {
  const n = max(1, ceil(abs(a1 - a0) / dphiFor(r, tol)));
  for (let j = withStart ? 0 : 1; j <= (withEnd ? n : n - 1); j++) { R.push(r); A.push(a0 + (a1 - a0) * j / n); }
}

// Douglas-Peucker on one flank (keeps first/last); returns kept indices
function simplifyFlank(r, t, tol) {
  const n = r.length, X = r.map((v, i) => v * cos(t[i])), Y = r.map((v, i) => v * sin(t[i]));
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const dx = X[i1] - X[i0], dy = Y[i1] - Y[i0], L = hypot(dx, dy) || 1e-12;
    let dm = -1, im = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const dd = abs((X[i] - X[i0]) * dy - (Y[i] - Y[i0]) * dx) / L;
      if (dd > dm) { dm = dd; im = i; }
    }
    if (dm > tol) { keep[im] = 1; stack.push([i0, im], [im, i1]); }
  }
  const idx = [];
  for (let i = 0; i < n; i++) if (keep[i]) idx.push(i);
  return idx;
}

function dedupe(R, A) {
  const r = [], a = [];
  const n = R.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = R[i] * cos(A[i]) - R[j] * cos(A[j]), dy = R[i] * sin(A[i]) - R[j] * sin(A[j]);
    if (hypot(dx, dy) > 1e-9) { r.push(R[i]); a.push(A[i]); }
  }
  return { r: Float64Array.from(r), a: Float64Array.from(a) };
}

// Tooth templates (polar, tooth centred on angle 0) so a chamfer can be clamped along the flanks.
// External: right flank (r up, -t), tip arc, left flank (r down, +t), root arc  -> material inside.
// Ring hole: down flank (r down, -psi), tip arc at ri, up flank (+psi), root arc -> material outside.
//
// A tapered bearing has a different profile in every z section, but the walls join section j to j+1
// vertex-by-vertex, so the template *layout* (kept flank samples, arc point counts, dropped points)
// is fixed once by toothLayout() from all the profiles that will be used, then filled per profile.
const arcN = (r, span, tol) => max(1, ceil(abs(span) / dphiFor(r, tol)));

function toothLayout(profs, tol, flankTol, ring) {
  const p0 = profs[0], pitch = 2 * PI / p0.Z;
  const ki = simplifyFlank(p0.r, p0.t, flankTol);        // same radial parametrisation in every section
  let nTip = 1, nRoot = 1;
  for (const pr of profs) {
    const n = pr.r.length;
    if (!ring) { nTip = max(nTip, arcN(pr.r[n - 1], 2 * pr.t[n - 1], tol)); nRoot = max(nRoot, arcN(pr.r[0], pitch - 2 * pr.t[0], tol)); }
    else { nTip = max(nTip, arcN(pr.r[0], 2 * pr.t[0], tol)); nRoot = max(nRoot, arcN(pr.r[n - 1], pitch - 2 * pr.t[n - 1], tol)); }
  }
  const L = { ki, nTip, nRoot, ring, Z: p0.Z, pitch, keep: null };
  // drop coincident neighbours (zero tip land), including across the tooth boundary - decided on p0
  const T = rawTemplate(p0, L);
  L.keep = T.r.map((_, i) => {
    const j = i + 1 < T.r.length ? i + 1 : 0, aj = j ? T.a[j] : T.a[0] + pitch;
    return hypot(T.r[i] * cos(T.a[i]) - T.r[j] * cos(aj), T.r[i] * sin(T.a[i]) - T.r[j] * sin(aj)) > 1e-9;
  });
  return L;
}

function arcInterior(R, A, r, a0, a1, n) { for (let j = 1; j < n; j++) { R.push(r); A.push(a0 + (a1 - a0) * j / n); } }

function rawTemplate(prof, L) {
  const fr = L.ki.map((i) => prof.r[i]), ft = L.ki.map((i) => prof.t[i]);
  const n = fr.length, pitch = L.pitch, R = [], A = [];
  if (!L.ring) {
    for (let i = 0; i < n; i++) { R.push(fr[i]); A.push(-ft[i]); }
    arcInterior(R, A, fr[n - 1], -ft[n - 1], ft[n - 1], L.nTip);
    for (let i = n - 1; i >= 0; i--) { R.push(fr[i]); A.push(ft[i]); }
    arcInterior(R, A, fr[0], ft[0], pitch - ft[0], L.nRoot);          // root arc at r[0] (closure)
  } else {
    for (let i = n - 1; i >= 0; i--) { R.push(fr[i]); A.push(-ft[i]); }
    arcInterior(R, A, fr[0], -ft[0], ft[0], L.nTip);
    for (let i = 0; i < n; i++) { R.push(fr[i]); A.push(ft[i]); }
    arcInterior(R, A, fr[n - 1], ft[n - 1], pitch - ft[n - 1], L.nRoot);
  }
  return { r: R, a: A };
}

function toothTemplate(prof, L) {
  const T = rawTemplate(prof, L);
  const r = [], a = [];
  for (let i = 0; i < T.r.length; i++) if (L.keep[i]) { r.push(T.r[i]); a.push(T.a[i]); }
  return { r: Float64Array.from(r), a: Float64Array.from(a), Z: L.Z, pitch: L.pitch, prof };
}

/** Chamfered section of a tooth template: the part beyond the cone radius Rc is replaced by an
 *  arc at Rc spanning exactly +-t(Rc) (where the cone meets the flanks); clamped vertices are
 *  spread along that arc in their original order, so the vertex count never changes. */
function clampTemplate(T, Rc, ring) {
  const { r, a, prof } = T, M = r.length;
  const R = Float64Array.from(r), A = Float64Array.from(a);
  let i0 = -1, i1 = -1;
  for (let i = 0; i < M; i++) if (ring ? r[i] < Rc : r[i] > Rc) { if (i0 < 0) i0 = i; i1 = i; }
  if (i0 < 0) return { r: R, a: A };
  const lo = prof.r[0], hi = prof.r[prof.r.length - 1];
  if (Rc <= lo || Rc >= hi || i0 === 0 || i1 === M - 1) {        // chamfer deeper than the tooth: radial clamp
    for (let i = 0; i < M; i++) R[i] = ring ? max(r[i], Rc) : min(r[i], Rc);
    return { r: R, a: A };
  }
  const tc = pm.interp([Rc], prof.r, prof.t)[0];
  const u0 = a[i0], u1 = a[i1];
  for (let i = i0; i <= i1; i++) {
    R[i] = Rc;
    A[i] = u1 > u0 ? -tc + (a[i] - u0) / (u1 - u0) * 2 * tc : 0;
  }
  return { r: R, a: A };
}

/** Loop of Z teeth. profAt(z) gives this gear's profile at height z (one profile without taper);
 *  Rc_of(dz, prof) the chamfer cone radius at distance dz from a face (null = none). */
function toothLoop(L, profAt, Rc_of) {
  const M = L.keep.filter(Boolean).length * L.Z, tcache = new Map(), cache = new Map();
  const at = (z, dz) => {
    const prof = profAt(z);
    let T = tcache.get(prof);
    if (!T) { T = toothTemplate(prof, L); tcache.set(prof, T); }
    const Rc = Rc_of(dz, prof);
    let byRc = cache.get(prof);
    if (!byRc) { byRc = new Map(); cache.set(prof, byRc); }
    const key = Rc === null ? "base" : Rc;
    if (byRc.has(key)) return byRc.get(key);
    const S = Rc === null ? T : clampTemplate(T, Rc, L.ring);
    const r = new Float64Array(M), a = new Float64Array(M), m = T.r.length;
    for (let k = 0; k < L.Z; k++) for (let i = 0; i < m; i++) { r[k * m + i] = S.r[i]; a[k * m + i] = S.a[i] + k * L.pitch; }
    const out = { r, a };
    byRc.set(key, out);
    return out;
  };
  return { M, at };
}

/** Plain loop {r,a} with a radial clamp (exact for circles; flats of polygons become arcs). */
function radialLoop(L, clamp) {
  const M = L.r.length;
  return { M, at: (z, dz) => ({ r: L.r.map((v) => clamp(v, dz)), a: L.a }) };
}

/** External gear outline, CCW, tooth 0 centred on +x (no chamfer). */
export function externalLoop(prof, tol, flankTol) { return toothLoop(toothLayout([prof], tol, flankTol, false), () => prof, () => null).at(0, 1); }
/** Toothed hole of the ring, CCW, ring tooth 0 centred on +x (no chamfer). */
export function ringHoleLoop(prof, tol, flankTol) { return toothLoop(toothLayout([prof], tol, flankTol, true), () => prof, () => null).at(0, 1); }

// ---------------------------------------------------------------- surface textures
// A textured cylinder (ring OD: cut inward, sign -1; sun bore: cut outward, sign +1) is a loop whose
// radius depends on angle and height: r = R0 + sign * depth * f(theta, z), f in [0,1] = cut fraction.
const tri01 = (u) => 1 - abs(2 * (u - Math.floor(u)) - 1);     // 0 at integer u (crest), 1 at half (groove)

/** Returns {loop, zs} for a textured cylinder, or null for "None". clamp(r, dz) adds the chamfer. */
function textureLoop(p, which, R0, sign, H, chamferC, clamp) {
  const kind = p[which + "_tex"] ?? "None";
  const depth = pm.texDepth(p, which);
  if (kind === "None" || !(depth > 0)) return null;
  const lay = pm.texLayout(p, which, R0, pm.surfaceChamfer(p, which));
  const n = lay.n, pc = 2 * PI * R0 / n;                       // circumferential pitch at the surface
  let M, zs, f;
  if (kind.endsWith("knurl")) {
    const k = 8;                                                // grid steps per pitch: crests/grooves on vertices
    M = n * k;
    const tpsi = Math.tan((p[which + "_tex_angle"] ?? 30) * PI / 180);
    if (kind === "Straight knurl" || !(abs(tpsi) > 1e-6)) {
      zs = mergeZ([0, H], chamferSections(H, chamferC));
      f = (i) => tri01(i / k);
    } else {
      const dz = Math.min(H / 2, Math.max(0.02, pc / (k * abs(tpsi))));   // phase moves one grid step per section
      const grid = [];
      for (let z = 0; z < H - 1e-9; z += dz) grid.push(z);
      zs = mergeZ(grid, [H], chamferSections(H, chamferC));
      const sh = (z) => z * tpsi / pc;
      f = kind === "Diagonal knurl" ? (i, z) => tri01(i / k + sh(z)) : (i, z) => max(tri01(i / k + sh(z)), tri01(i / k - sh(z)));
    }
  } else {                                                      // Dimples / Ovals: spherical-cap pockets, staggered rows;
                                                                // Raised ovals: surface recessed by depth, domes back up to R0
    const w = lay.w, Lz = lay.L, step = Math.max(0.03, Math.min(w / 8, pc / 6, 0.25));
    M = Math.max(n * 4, ceil(2 * PI * R0 / step));
    const nz = Math.max(2, ceil(H / step));
    zs = mergeZ(Array.from({ length: nz + 1 }, (_, j) => H * j / nz), chamferSections(H, chamferC));
    const psi = kind !== "Dimples" ? (p[which + "_tex_angle"] ?? 0) * PI / 180 : 0;
    const raised = kind === "Raised ovals";
    const cs = cos(psi), sn = sin(psi);
    const d = Math.min(depth, 0.499 * w), Rs = (w * w / 4 + d * d) / (2 * d);
    const rows = [];
    for (let j = 0; j < lay.rows; j++) rows.push(H / 2 + (j - (lay.rows - 1) / 2) * lay.pz);
    const extS = w * abs(cs) + Lz * abs(sn), reachCols = ceil(extS / 2 / pc) + 1;
    f = (i, z) => {
      let best = 0;
      const th = 2 * PI * i / M;
      for (let j = 0; j < rows.length; j++) {
        const t = z - rows[j];
        if (abs(t) > lay.ext_z / 2 + 1e-9) continue;
        const off = j % 2 ? 0.5 : 0;
        const c0 = Math.round(th / (2 * PI / n) - off);
        for (let c = c0 - reachCols; c <= c0 + reachCols; c++) {
          let dth = th - (c + off) * 2 * PI / n;
          dth -= 2 * PI * Math.round(dth / (2 * PI));
          const s = dth * R0;
          const aS = s * cs - t * sn, aL = s * sn + t * cs;          // short / long axis coordinates
          const q = (aS / (w / 2)) ** 2 + (aL / (Lz / 2)) ** 2;
          if (q >= 1) continue;
          const rho = Math.sqrt(q) * w / 2;
          const dep = Math.sqrt(Rs * Rs - rho * rho) - (Rs - d);
          if (dep > best) best = dep;
        }
      }
      return raised ? 1 - best / depth : best / depth;
    };
  }
  const A = Float64Array.from({ length: M }, (_, i) => 2 * PI * i / M);
  const cache = new Map();
  const at = (z, dz) => {
    const key = z;
    if (cache.has(key)) return cache.get(key);
    const r = new Float64Array(M);
    for (let i = 0; i < M; i++) r[i] = clamp(R0 + sign * depth * f(i, z), dz);
    const out = { r, a: A };
    cache.set(key, out);
    return out;
  };
  return { loop: { M, at }, zs };
}

export function circleLoop(r, tol) {
  const n = max(24, ceil(2 * PI / dphiFor(r, tol)));
  const R = new Float64Array(n).fill(r), A = new Float64Array(n);
  for (let i = 0; i < n; i++) A[i] = 2 * PI * i / n;
  return { r: R, a: A };
}

function polyLoop(xy, tol) {
  // straight-edged polygon (CCW), edges subdivided so a chamfer clamp turns them into arcs
  const R = [], A = [];
  for (let i = 0; i < xy.length; i++) {
    const [x0, y0] = xy[i], [x1, y1] = xy[(i + 1) % xy.length];
    const rm = min(hypot(x0, y0), hypot(x1, y1));
    const span = abs(Math.atan2(x0 * y1 - y0 * x1, x0 * x1 + y0 * y1));
    const n = max(1, ceil(span / dphiFor(rm, tol)));
    for (let j = 0; j < n; j++) {
      const x = x0 + (x1 - x0) * j / n, y = y0 + (y1 - y0) * j / n;
      R.push(hypot(x, y)); A.push(Math.atan2(y, x));
    }
  }
  return dedupe(R, A);
}

/** Bore outline (CCW). Same shapes / orientation as bore_solid() in the FreeCAD object. */
export function boreLoop(shape, dia, comp, flatFrac, tol) {
  const r = dia / 2.0 + comp;
  if (shape === "Round") return circleLoop(r, tol);
  if (shape === "Hex" || shape === "Square") {
    const n = shape === "Hex" ? 6 : 4, R = r / cos(PI / n), off = n === 4 ? PI / n : 0;
    return polyLoop(Array.from({ length: n }, (_, i) => [R * cos(2 * PI * i / n + off), R * sin(2 * PI * i / n + off)]), tol);
  }
  if (shape === "D-Flat") {
    const fx = flatFrac * dia + comp;
    if (fx >= r) return circleLoop(r, tol);
    const a = Math.acos(fx / r);                 // flat spans angles (-a, a) on the +x side
    const Rr = [], Aa = [];
    pushArc(Rr, Aa, r, a, 2 * PI - a, tol, true, true);
    const yTop = r * sin(a), nf = max(1, ceil(2 * a / dphiFor(fx, tol)));
    for (let j = 1; j < nf; j++) {               // flat from (fx,-yTop) up to (fx,yTop)
      const y = -yTop + 2 * yTop * j / nf;
      Rr.push(hypot(fx, y)); Aa.push(Math.atan2(y, fx));
    }
    return dedupe(Rr, Aa);
  }
  return null;
}

// ---------------------------------------------------------------- z sections
function helixSections(H, hs, twistLeg, rmax, tol) {
  const legs = max(1, round(H / hs));
  const dphi = dphiFor(rmax, tol);
  const k = twistLeg > 1e-12 ? max(1, ceil(twistLeg / max(dphi, 1e-6))) : 1;
  const zs = [];
  for (let L = 0; L < legs; L++) for (let j = 0; j < k; j++) zs.push(L * hs + hs * j / k);
  zs.push(H);
  return zs;
}

function chamferSections(H, c) {
  if (!(c > 0)) return [];
  const nc = max(2, ceil(c / 0.06)), out = [];
  for (let i = 1; i <= nc; i++) { const z = min(c * i / nc, H / 2); out.push(z, H - z); }
  return out;
}

function mergeZ(...lists) {
  const all = lists.flat().sort((a, b) => a - b), out = [];
  for (const z of all) if (!out.length || z - out[out.length - 1] > 1e-6) out.push(z);
  return out;
}

// ---------------------------------------------------------------- body assembly
/**
 * loops: [{loop:{M, at(z, dz)->{r,a}}, zs, twist(z)->angle, hole:bool}], first loop is the outer boundary.
 * Returns {pos: Float64Array, idx: Uint32Array}
 */
function buildBody(loops, H) {
  let nv = 0, nt = 0;
  for (const L of loops) { const M = L.loop.M; nv += M * L.zs.length; nt += 2 * M * (L.zs.length - 1); }
  const pos = new Float64Array(nv * 3);
  const tri = [];
  let base = 0;
  for (const L of loops) {
    const M = L.loop.M;
    L.base = base;
    let o = base * 3;
    for (const z of L.zs) {
      const tw = L.twist(z), { r, a } = L.loop.at(z, min(z, H - z));
      for (let i = 0; i < M; i++) {
        const ang = a[i] + tw;
        pos[o++] = r[i] * cos(ang); pos[o++] = r[i] * sin(ang); pos[o++] = z;
      }
    }
    for (let j = 0; j + 1 < L.zs.length; j++) {
      const s0 = base + j * M, s1 = s0 + M;
      for (let i = 0; i < M; i++) {
        const i1 = (i + 1) % M;
        const A = s0 + i, B = s0 + i1, C = s1 + i1, D = s1 + i;
        if (L.hole) tri.push(A, C, B, A, D, C); else tri.push(A, B, C, A, C, D);
      }
    }
    L.bottom = base; L.top = base + (L.zs.length - 1) * M;
    base += M * L.zs.length;
  }
  addCap(pos, loops, "bottom", tri);
  addCap(pos, loops, "top", tri);
  return { pos, idx: Uint32Array.from(tri) };
}

function addCap(pos, loops, which, tri) {
  const flat = [], map = [], holes = [];
  loops.forEach((L, li) => {
    if (li > 0) holes.push(map.length);
    const s = L[which], M = L.loop.M;
    for (let i = 0; i < M; i++) { flat.push(pos[(s + i) * 3], pos[(s + i) * 3 + 1]); map.push(s + i); }
  });
  const ears = earcut(flat, holes.length ? holes : null, 2);
  let t = [];
  for (let k = 0; k < ears.length; k += 3) t.push([map[ears[k]], map[ears[k + 1]], map[ears[k + 2]]]);
  // earcut drops exactly-collinear / duplicate points: re-insert them (T-junction repair)
  t = repairDropped(t, loops, which);
  // orient: bottom faces -z (CW in xy), top +z (CCW) - earcut output is uniformly wound
  let area = 0;
  for (const [a, b, c] of t) area += (pos[b * 3] - pos[a * 3]) * (pos[c * 3 + 1] - pos[a * 3 + 1]) - (pos[c * 3] - pos[a * 3]) * (pos[b * 3 + 1] - pos[a * 3 + 1]);
  const flip = which === "top" ? area < 0 : area > 0;
  for (const [a, b, c] of t) if (flip) tri.push(a, c, b); else tri.push(a, b, c);
}

function repairDropped(t, loops, which) {
  const used = new Set();
  for (const f of t) for (const v of f) used.add(v);
  for (const L of loops) {
    const s = L[which], M = L.loop.M;
    let start = -1;
    for (let i = 0; i < M; i++) if (used.has(s + i)) { start = i; break; }
    if (start < 0) continue;
    for (let q = 0; q < M; q++) {
      const i = (start + q) % M;
      if (used.has(s + i)) continue;
      // run of dropped vertices from i; u = previous used, w = next used
      const u = s + ((i - 1 + M) % M), run = [];
      let j = i;
      while (!used.has(s + j)) { run.push(s + j); j = (j + 1) % M; }
      const w = s + j;
      const fi = t.findIndex((f) => f.includes(u) && f.includes(w));
      if (fi >= 0) {
        const f = t[fi], iu = f.indexOf(u), x = f[3 - iu - f.indexOf(w)];
        const fwd = f[(iu + 1) % 3] === w;                // triangle walks u -> w
        const chain = fwd ? [u, ...run, w] : [w, ...run.slice().reverse(), u];
        const repl = [];
        for (let k = 0; k + 1 < chain.length; k++) repl.push([chain[k], chain[k + 1], x]);
        t.splice(fi, 1, ...repl);
      }
      for (const v of run) used.add(v);
      q += run.length - 1;
    }
  }
  return t;
}

// ---------------------------------------------------------------- full bearing
/** z sections where the taper changes the profile: |dx| per step <= 0.08 (plus the mirror kink).
 *  The profile moves almost linearly with x, so the straight walls between sections deviate far
 *  less than mesh_dev; finer steps only add facets. */
function taperSections(p, m, H) {
  const k = pm.taperRate(p, m);
  if (!k) return [];
  const step = Math.min(H / 4, Math.max(0.04, 0.08 / k));
  const n = ceil(H / step), out = [];
  for (let j = 0; j <= n; j++) out.push(H * j / n);
  if (p.taper_mirror) out.push(H / 2);
  return out;
}

/** z sections for the external teeth: sag <= tol per helix leg (+ chamfer sections). */
function extSections(p, H, rp, rmax, c, tol) {
  const kind = p.ext_helix ?? "Straight";
  if (kind === "Straight" || !p.ext_beta) return mergeZ([0, H], chamferSections(H, c));
  const tb = Math.tan(p.ext_beta * PI / 180);
  const legs = kind === "Helical" ? [[0, H]] : [[0, H / 2], [H / 2, H]];
  const zs = [];
  for (const [z0, z1] of legs) {
    const k = max(1, ceil(tb * (z1 - z0) / rp / dphiFor(rmax, tol)));
    for (let j = 0; j <= k; j++) zs.push(z0 + (z1 - z0) * j / k);
  }
  return mergeZ(zs, chamferSections(H, c));
}

/** Loop with a z-dependent radius about (0,0): rOf(z) -> radius. */
function circleZLoop(R0, rOf, tol) {
  const L = circleLoop(R0, tol), M = L.r.length;
  return { M, at: (z) => ({ r: new Float64Array(M).fill(rOf(z)), a: L.a }) };
}

/** Off-centre circle (cx, cy, r) as a polar loop about the origin (for holes in a plate). */
function offCircleLoop(cx, cy, r, tol) {
  const n = max(24, ceil(2 * PI / dphiFor(r, tol)));
  const R = new Float64Array(n), A = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = 2 * PI * i / n, x = cx + r * cos(t), y = cy + r * sin(t);
    R[i] = hypot(x, y); A[i] = Math.atan2(y, x);
  }
  return { M: n, at: () => ({ r: R, a: A }) };
}

/** Solid of revolution from an (r, z) profile, z strictly increasing. */
function revolveBody(rz, tol) {
  const zs = rz.map((q) => q[1]), Rm = Math.max(...rz.map((q) => q[0]));
  const byZ = new Map(rz.map(([r, z]) => [z, r]));
  const loop = circleZLoop(Rm, (z) => byZ.get(z), tol);
  return buildBody([{ loop, zs, twist: () => 0, hole: false }], zs[zs.length - 1]);
}

/** One planetary bearing. opts: {hand, extRot} for external teeth in a gear train.
 *  Returns {g, prof, phasing, parts: [{name, body, inst: [{x, y, rot, orbit?}]}], ringRoMax, ...}. */
export function buildBearing(p, opts = {}) {
  const T0 = performance.now();
  const H = p.H, tol = p.surface_tol ?? 0.005, dev = p.mesh_dev ?? 0.01;
  const ch = p.chamfer ?? 0.3, chPl = p.planet_chamfer ?? ch;
  const chOD = pm.surfaceChamfer(p, "od");
  let chBore = pm.surfaceChamfer(p, "bore");
  const flankTol = dev * 0.25;
  const g = pm.derive(p);
  const prof = pm.buildProfiles(p, g);
  // taper: one profile set per distinct shift offset dx(z) (mirror -> each one is used twice)
  const half = pm.taperHalf(p, g.m);
  const tapered = half > 0;
  const profCache = new Map([[0, prof]]);
  const profsAtDx = (dx) => {
    const key = Math.round(dx * 1e12) / 1e12;
    let pr = profCache.get(key);
    if (!pr) { pr = pm.buildProfiles(p, pm.derive(p, null, null, null, dx)); profCache.set(key, pr); }
    return pr;
  };
  const profsAt = tapered ? (z) => profsAtDx(pm.taperDx(p, g.m, z)) : () => prof;
  const extremes = tapered ? [prof, profsAtDx(-half), profsAtDx(half)] : [prof];
  const tz = taperSections(p, g.m, H);
  const T1 = performance.now();
  const d = g.d;
  const { f: twist, hs } = pm.helixTwist(g, p.beta, H, p.reversals);
  const ph = pm.phasing(g);
  const leg = (k) => abs(twist(hs)[k] - twist(0)[k]);
  const zero = () => 0, ident = (r) => r;
  const holeClamp = (rh, c) => (c > 0 ? (r, dz) => (dz < c ? max(r, rh + c - dz) : r) : ident);
  const odClamp = (R, c) => (c > 0 ? (r, dz) => (dz < c ? min(r, R - c + dz) : r) : ident);
  const fixedZ = (c, h = H) => mergeZ([0, h], chamferSections(h, c));
  const extRc = (c) => (dz, pr) => (c > 0 && dz < c ? pr.ra - c + dz : null);
  const intRc = (c) => (dz, pr) => (c > 0 && dz < c ? pr.ri + c - dz : null);
  const minOver = (fn) => Math.min(...extremes.map(fn));
  const parts = [];
  // a bore chamfer may take at most 90% of the sun rim (it must not reach the tooth roots)
  if (p.sun_bore_shape !== "Spline" && p.sun_bore_shape !== "None" && p.ID > 0)
    chBore = min(chBore, max(0, 0.9 * (minOver((e) => e.sun.rf) - pm.sunBoreRadius(p) - pm.texDepth(p, "bore"))));

  // ---- sun
  const sch = ch > 0 ? minOver((e) => min(ch, 0.5 * (e.sun.ra - e.sun.rf))) : 0;
  const sunLoops = [{
    loop: toothLoop(toothLayout(extremes.map((e) => e.sun), dev, flankTol, false), (z) => profsAt(z).sun, extRc(sch)),
    twist: (z) => twist(z)[0], hole: false,
    zs: mergeZ(helixSections(H, hs, leg(0), prof.sun.ra, tol), chamferSections(H, sch), tz),
  }];
  let spline = null;
  if (p.sun_bore_shape === "Spline" && p.ID > 0) {
    spline = pm.splineProfiles(p);
    const bc = chBore > 0 ? min(chBore, 0.5 * (spline.bore.ro - spline.bore.ri)) : 0;
    sunLoops.push({ loop: toothLoop(toothLayout([spline.bore], dev, flankTol, true), () => spline.bore, intRc(bc)),
      twist: zero, zs: fixedZ(bc), hole: true });
  } else if (p.sun_bore_shape !== "None" && p.ID > 0) {
    const rb = p.ID / 2 + d;
    const tex = textureLoop(p, "bore", rb, +1, H, chBore, holeClamp(rb, chBore));
    sunLoops.push(tex ? { loop: tex.loop, zs: tex.zs, twist: zero, hole: true } : {
      loop: radialLoop(boreLoop(p.sun_bore_shape, p.ID, d, p.sun_bore_flat ?? 0.4, dev), holeClamp(rb, chBore)),
      twist: zero, zs: fixedZ(chBore), hole: true });
  }
  parts.push({ name: "sun", body: buildBody(sunLoops, H), inst: [{ x: 0, y: 0, rot: 0 }] });

  // ---- ring (plain / textured OD, or external teeth)
  const R = p.OD / 2.0;
  const roMax = Math.max(...extremes.map((e) => e.ring.ro));
  let outer;
  if (p.ext_teeth) {
    const ge = pm.extGeometry(p);
    const ep = { ...pm.rackEnvelope(ge.Z, ge.m, ge.alpha, 0.0, ge.c, ge.d, ge.ra, p.tip_land), Z: ge.Z };
    const ce = chOD > 0 ? min(chOD, 0.5 * (ep.ra - ep.rf)) : 0;
    const hand = opts.hand ?? 1, rot0 = opts.extRot ?? 0;
    outer = { loop: toothLoop(toothLayout([ep], dev, flankTol, false), () => ep, extRc(ce)),
      twist: (z) => rot0 + pm.extTwist(p, z, ge.rp, hand), hole: false, zs: extSections(p, H, ge.rp, ep.ra, ce, tol) };
  } else {
    const c2 = chOD > 0 ? min(chOD, 0.45 * (R - roMax - pm.texDepth(p, "od"))) : 0;
    const odTex = textureLoop(p, "od", R, -1, H, c2, odClamp(R, c2));
    outer = odTex ? { loop: odTex.loop, zs: odTex.zs, twist: zero, hole: false }
      : { loop: radialLoop(circleLoop(R, dev), odClamp(R, c2)), twist: zero, zs: fixedZ(c2), hole: false };
  }
  parts.push({ name: "ring", body: buildBody([outer,
    { loop: toothLoop(toothLayout(extremes.map((e) => e.ring), dev, flankTol, true), (z) => profsAt(z).ring, intRc(ch)),
      twist: (z) => twist(z)[2] + ph.ring_rot, hole: true,
      zs: mergeZ(helixSections(H, hs, leg(2), roMax, tol), chamferSections(H, ch), tz) },
  ], H), inst: [{ x: 0, y: 0, rot: 0 }] });

  // ---- planet (one body, N placements); optional captured pin in an hourglass bore
  const pch = chPl > 0 ? minOver((e) => min(chPl, 0.5 * (e.planet.ra - e.planet.rf))) : 0;
  const raMax = Math.max(...extremes.map((e) => e.planet.ra));
  const plLoops = [{
    loop: toothLoop(toothLayout(extremes.map((e) => e.planet), dev, flankTol, false), (z) => profsAt(z).planet, extRc(pch)),
    twist: (z) => twist(z)[1], hole: false,
    zs: mergeZ(helixSections(H, hs, leg(1), raMax, tol), chamferSections(H, pch), tz),
  }];
  const pg = p.planet_pins ? pm.pinGeometry(p) : null;
  if (pg) {
    const hg = (z) => pg.bore_mid + pg.v * abs(z - H / 2) / (H / 2);
    plLoops.push({ loop: circleZLoop(pg.bore_face, hg, dev), twist: zero, zs: [0, H / 2, H], hole: true });
  } else if (p.planet_bore_d > 0) {
    const bch = min(chPl, 0.2);
    plLoops.push({ loop: radialLoop(boreLoop(p.planet_bore_shape, p.planet_bore_d, d, 0.4, dev), holeClamp(p.planet_bore_d / 2 + d, bch)),
      twist: zero, zs: fixedZ(bch), hole: true });
  }
  const placements = ph.orbit.map((th, i) => ({ x: g.a * cos(th), y: g.a * sin(th), rot: ph.spins[i], orbit: th }));
  parts.push({ name: "planet", body: buildBody(plLoops, H), inst: placements });

  const extras = [];
  if (pg) {
    // pin: hourglass inside the planet, 0.3 mm above the top a 45 deg collar, then a stub for the carrier
    const gapTop = 0.3, cTop = H + gapTop + pg.collar, t = p.carrier_t ?? 2.0;
    const e0 = min(0.15, pg.pin_face * 0.2);
    const pin = revolveBody([[pg.pin_face - e0, 0], [pg.pin_face, e0], [pg.pin_mid, H / 2], [pg.pin_face, H],
      [pg.pin_face, H + gapTop], [pg.pin_face + pg.collar, cTop], [pg.pin_face, cTop + 1e-3], [pg.pin_face, cTop + t - e0],
      [pg.pin_face - e0, cTop + t]], dev);
    parts.push({ name: "pin", body: pin, inst: placements.map((q) => ({ x: q.x, y: q.y, rot: 0, orbit: q.orbit })) });
    // carrier plate: annulus over the planet orbit with a hole per pin stub
    const w = pg.pin_face + pg.collar + 1.5;
    const holes = placements.map((q) => ({ loop: offCircleLoop(q.x, q.y, pg.pin_face + (p.carrier_fit ?? 0.1) / 2, dev),
      twist: zero, zs: [0, t], hole: true }));
    const plate = buildBody([{ loop: radialLoop(circleLoop(g.a + w, dev), ident), twist: zero, zs: [0, t], hole: false },
      { loop: radialLoop(circleLoop(Math.max(0.5, g.a - w), dev), ident), twist: zero, zs: [0, t], hole: true }, ...holes], t);
    extras.push({ name: "carrier", body: plate, R: g.a + w });
  }
  if (spline) {
    const L = Math.max(1, p.shaft_length ?? 15), sh = spline.shaft;
    const sc = chBore > 0 ? min(chBore, 0.5 * (sh.ra - sh.rf)) : 0;
    const loops = [{ loop: toothLoop(toothLayout([sh], dev, flankTol, false), () => sh, extRc(sc)), twist: zero, zs: fixedZ(sc, L), hole: false }];
    if ((p.shaft_bore ?? 0) > 0) loops.push({ loop: radialLoop(circleLoop(p.shaft_bore / 2 + d, dev), holeClamp(p.shaft_bore / 2 + d, min(sc, 0.3))),
      twist: zero, zs: fixedZ(min(sc, 0.3), L), hole: true });
    extras.push({ name: "shaft", body: buildBody(loops, L), R: sh.ra });
  }
  const T2 = performance.now();
  return { g, prof, phasing: ph, parts, extras, placements, ringRoMax: roMax, profileSets: profCache.size,
    Rmax: p.ext_teeth ? pm.extGeometry(p).ra : R, ms: { profiles: T1 - T0, mesh: T2 - T1 } };
}

/** Whole build: one bearing, or every bearing of a gear train placed at its centre; extras
 *  (spline shafts, carrier plates) laid out in a row below so the STL prints in one go. */
export function buildTrain(p) {
  const { bearings, notes } = pm.trainLayout(p);
  const built = bearings.map((b) => ({ ...b, B: buildBearing(b.p, { hand: b.hand, extRot: b.rot }) }));
  const parts = [];
  let minY = Infinity, minX = Infinity;
  for (const b of built) {
    minY = Math.min(minY, b.cy - b.B.Rmax); minX = Math.min(minX, b.cx - b.B.Rmax);
    for (const pt of b.B.parts)
      parts.push({ ...pt, bearing: b.name, inst: pt.inst.map((q) => ({ ...q, x: q.x + b.cx, y: q.y + b.cy })) });
  }
  let x = minX;
  for (const b of built) for (const ex of b.B.extras) {
    const y = minY - 4 - ex.R;
    parts.push({ name: ex.name, bearing: b.name, body: ex.body, inst: [{ x: x + ex.R, y, rot: 0 }] });
    x += 2 * ex.R + 4;
  }
  return { bearings: built, parts, notes };
}

// ---------------------------------------------------------------- checks
export function volume(body) {
  const { pos: P, idx: I } = body;
  let v = 0;
  for (let k = 0; k < I.length; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}

/** Closed, consistently oriented 2-manifold check: every directed edge appears once and its reverse once. */
export function manifoldCheck(body) {
  const I = body.idx, nv = body.pos.length / 3, E = new Map();
  for (let k = 0; k < I.length; k += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[k + e], b = I[k + (e + 1) % 3];
      const key = a * nv + b;
      E.set(key, (E.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  for (const [key, n] of E) {
    const a = Math.floor(key / nv), b = key - a * nv;
    if (n !== 1 || E.get(b * nv + a) !== 1) bad++;
  }
  return { ok: bad === 0, badEdges: bad, tris: I.length / 3 };
}
