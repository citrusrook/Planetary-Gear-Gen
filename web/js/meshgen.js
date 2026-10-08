// Direct triangle-mesh builder (no B-rep): every part is a twisted extrusion of 2D loops.
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
function toothTemplate(prof, tol, flankTol, ring) {
  const { Z, r, t } = prof;
  const ki = simplifyFlank(r, t, flankTol);
  const fr = ki.map((i) => r[i]), ft = ki.map((i) => t[i]);
  const n = fr.length, pitch = 2 * PI / Z;
  const R = [], A = [];
  if (!ring) {
    for (let i = 0; i < n; i++) { R.push(fr[i]); A.push(-ft[i]); }
    pushArc(R, A, fr[n - 1], -ft[n - 1], ft[n - 1], tol, false, false);
    for (let i = n - 1; i >= 0; i--) { R.push(fr[i]); A.push(ft[i]); }
    pushArc(R, A, fr[0], ft[0], pitch - ft[0], tol, false, false);    // root arc at r[0] (closure)
  } else {
    for (let i = n - 1; i >= 0; i--) { R.push(fr[i]); A.push(-ft[i]); }
    pushArc(R, A, fr[0], -ft[0], ft[0], tol, false, false);
    for (let i = 0; i < n; i++) { R.push(fr[i]); A.push(ft[i]); }
    pushArc(R, A, fr[n - 1], ft[n - 1], pitch - ft[n - 1], tol, false, false);
  }
  // drop coincident neighbours (zero tip land), including across the tooth boundary
  const r2 = [], a2 = [];
  for (let i = 0; i < R.length; i++) {
    const j = i + 1 < R.length ? i + 1 : 0, aj = j ? A[j] : A[0] + pitch;
    if (hypot(R[i] * cos(A[i]) - R[j] * cos(aj), R[i] * sin(A[i]) - R[j] * sin(aj)) > 1e-9) { r2.push(R[i]); a2.push(A[i]); }
  }
  return { r: Float64Array.from(r2), a: Float64Array.from(a2), Z, pitch, prof };
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

/** Loop whose section at distance dz from the nearest face comes from a tooth template. */
function toothLoop(T, ring, Rc_of_dz) {
  const M = T.r.length * T.Z, cache = new Map();
  const at = (dz) => {
    const Rc = Rc_of_dz(dz);
    const key = Rc === null ? "base" : Rc;
    if (cache.has(key)) return cache.get(key);
    const S = Rc === null ? T : clampTemplate(T, Rc, ring);
    const r = new Float64Array(M), a = new Float64Array(M), m = T.r.length;
    for (let k = 0; k < T.Z; k++) for (let i = 0; i < m; i++) { r[k * m + i] = S.r[i]; a[k * m + i] = S.a[i] + k * T.pitch; }
    const out = { r, a };
    cache.set(key, out);
    return out;
  };
  return { M, at };
}

/** Plain loop {r,a} with a radial clamp (exact for circles; flats of polygons become arcs). */
function radialLoop(L, clamp) {
  const M = L.r.length;
  return { M, at: (dz) => ({ r: L.r.map((v) => clamp(v, dz)), a: L.a }) };
}

/** External gear outline, CCW, tooth 0 centred on +x (no chamfer). */
export function externalLoop(prof, tol, flankTol) { return toothLoop(toothTemplate(prof, tol, flankTol, false), false, () => null).at(1); }
/** Toothed hole of the ring, CCW, ring tooth 0 centred on +x (no chamfer). */
export function ringHoleLoop(prof, tol, flankTol) { return toothLoop(toothTemplate(prof, tol, flankTol, true), true, () => null).at(1); }

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
 * loops: [{loop:{M, at(dz)->{r,a}}, zs, twist(z)->angle, hole:bool}], first loop is the outer boundary.
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
      const tw = L.twist(z), { r, a } = L.loop.at(min(z, H - z));
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
export function buildBearing(p) {
  const T0 = performance.now();
  const H = p.H, ch = p.chamfer ?? 0.3, tol = p.surface_tol ?? 0.005, dev = p.mesh_dev ?? 0.01;
  const flankTol = dev * 0.25;
  const g = pm.derive(p);
  const prof = pm.buildProfiles(p, g);
  const T1 = performance.now();
  const d = g.d;
  const { f: twist, hs } = pm.helixTwist(g, p.beta, H, p.reversals);
  const ph = pm.phasing(g);
  const leg = (k) => abs(twist(hs)[k] - twist(0)[k]);
  const zero = () => 0, ident = (r) => r;
  const holeClamp = (rh, c) => (c > 0 ? (r, dz) => (dz < c ? max(r, rh + c - dz) : r) : ident);
  const odClamp = (R, c) => (c > 0 ? (r, dz) => (dz < c ? min(r, R - c + dz) : r) : ident);
  const fixedZ = (c) => mergeZ([0, H], chamferSections(H, c));
  // chamfer cone radius at distance dz from a face (null = no chamfer at this section)
  const extRc = (ra, c) => (dz) => (c > 0 && dz < c ? ra - c + dz : null);
  const intRc = (ri, c) => (dz) => (c > 0 && dz < c ? ri + c - dz : null);

  // ---- sun
  const sp = prof.sun;
  const sch = ch > 0 ? min(ch, 0.5 * (sp.ra - sp.rf)) : 0;
  const sunLoops = [{
    loop: toothLoop(toothTemplate(sp, dev, flankTol, false), false, extRc(sp.ra, sch)), twist: (z) => twist(z)[0],
    zs: mergeZ(helixSections(H, hs, leg(0), sp.ra, tol), chamferSections(H, sch)), hole: false,
  }];
  if (p.sun_bore_shape !== "None" && p.ID > 0) {
    sunLoops.push({ loop: radialLoop(boreLoop(p.sun_bore_shape, p.ID, d, p.sun_bore_flat ?? 0.4, dev), holeClamp(p.ID / 2 + d, ch)),
      twist: zero, zs: fixedZ(ch), hole: true });
  }
  const sun = buildBody(sunLoops, H);

  // ---- ring
  const rp_ = prof.ring, R = p.OD / 2.0;
  const c2 = ch > 0 ? min(ch, 0.45 * (R - rp_.ro)) : 0;
  const ring = buildBody([
    { loop: radialLoop(circleLoop(R, dev), odClamp(R, c2)), twist: zero, zs: fixedZ(c2), hole: false },
    { loop: toothLoop(toothTemplate(rp_, dev, flankTol, true), true, intRc(rp_.ri, ch)), twist: (z) => twist(z)[2] + ph.ring_rot,
      zs: mergeZ(helixSections(H, hs, leg(2), rp_.ro, tol), chamferSections(H, ch)), hole: true },
  ], H);

  // ---- planet (one body, N placements)
  const pp = prof.planet;
  const pch = ch > 0 ? min(ch, 0.5 * (pp.ra - pp.rf)) : 0;
  const plLoops = [{
    loop: toothLoop(toothTemplate(pp, dev, flankTol, false), false, extRc(pp.ra, pch)), twist: (z) => twist(z)[1],
    zs: mergeZ(helixSections(H, hs, leg(1), pp.ra, tol), chamferSections(H, pch)), hole: false,
  }];
  if (p.planet_bore_d > 0) {
    const bch = min(ch, 0.2);
    plLoops.push({ loop: radialLoop(boreLoop(p.planet_bore_shape, p.planet_bore_d, d, 0.4, dev), holeClamp(p.planet_bore_d / 2 + d, bch)),
      twist: zero, zs: fixedZ(bch), hole: true });
  }
  const planet = buildBody(plLoops, H);
  const placements = ph.orbit.map((th, i) => ({ x: g.a * cos(th), y: g.a * sin(th), rot: ph.spins[i], orbit: th }));
  const T2 = performance.now();
  return { g, prof, phasing: ph, ring, sun, planet, placements, ms: { profiles: T1 - T0, mesh: T2 - T1 } };
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
