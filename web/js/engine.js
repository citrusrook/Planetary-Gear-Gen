// Solve + build + report, shared by the worker and the main-thread fallback.
import * as pm from "./pbmath.js";
import { buildBearing, volume, manifoldCheck } from "./meshgen.js";

export function resolve(p, lock) {
  return pm.solve(p, lock);
}

/** Layouts that cannot be meshed as solids (parts overlap or a bore cuts through the teeth).
 *  The solver's limits (MinWall etc.) are softer; these are the hard physical ones. */
export function geometryErrors(p) {
  const g = pm.derive(p), E = [];
  if (g.rf_s <= 0 || g.rf_p <= 0) E.push("negative root radius (module too small for the clearances)");
  if (p.OD / 2 - g.ro_r <= 0.05) E.push("ring tooth roots break through the OD");
  if (p.sun_bore_shape !== "None" && p.ID > 0 &&
      g.rf_s - pm.boreOuterRadius(p.sun_bore_shape, p.ID, g.d) <= 0.05) E.push("sun bore cuts through the sun teeth");
  if (p.planet_bore_d > 0 && g.rf_p - pm.boreOuterRadius(p.planet_bore_shape, p.planet_bore_d, g.d) <= 0.05)
    E.push("planet bore cuts through the planet teeth");
  if (g.N >= 2 && 2 * g.a * Math.sin(Math.PI / g.N) - 2 * g.ra_p <= 0) E.push("neighbouring planets overlap");
  return E;
}

export function build(p, notes = []) {
  // keep stored tooth counts consistent even if set by hand (same as execute() in FreeCAD)
  if (p.Zs + 2 * p.Zp !== p.Zr || (p.Zs + p.Zr) % p.N) {
    const s = pm.solve(p, null);
    p = { ...p, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N };
    notes = [...notes, ...s.notes];
  }
  const fatal = geometryErrors(p);
  if (fatal.length) {
    const g = pm.derive(p);
    return { p, fatal, report: pm.report(p, g, pm.buildProfiles(p, g), notes), g };
  }
  const B = buildBearing(p);
  const rep = pm.report(p, B.g, B.prof, notes);
  const checks = {};
  for (const k of ["ring", "sun", "planet"]) {
    checks[k] = { ...manifoldCheck(B[k]), volume: volume(B[k]) };
  }
  return {
    p, report: rep, checks, ms: B.ms,
    g: B.g, placements: B.placements, ringRot: B.phasing.ring_rot, ringRo: B.prof.ring.ro,
    ring: B.ring, sun: B.sun, planet: B.planet,
  };
}
