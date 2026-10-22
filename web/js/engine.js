// Solve + build + report, shared by the worker and the main-thread fallback.
import * as pm from "./pbmath.js";
import { buildTrain, volume, manifoldCheck } from "./meshgen.js";

export function resolve(p, lock) {
  return pm.solve(p, lock);
}

/** Layouts that cannot be meshed as solids (parts overlap or a bore cuts through the teeth).
 *  The solver's limits (wall minimums etc.) are softer; these are the hard physical ones. */
export function geometryErrors(p, label = "") {
  const g = pm.derive(p), E = [];
  const pre = label ? label + ": " : "";
  const half = pm.taperHalf(p, g.m);
  const hi = half ? pm.derive(p, null, null, null, half) : g;     // widest planet / deepest roots
  const lo = half ? pm.derive(p, null, null, null, -half) : g;    // thinnest planet
  const odT = pm.texDepth(p, "od"), boreT = pm.texDepth(p, "bore");
  if (hi.rf_s <= 0 || lo.rf_p <= 0) E.push("negative root radius (module too small for the clearances" + (half ? " or taper too strong)" : ")"));
  if (pm.ringOuterRadius(p) - hi.ro_r - odT <= 0.05)
    E.push(p.ext_teeth ? "outer teeth cut through to the inner ring teeth" : odT ? "OD texture cuts through to the ring tooth roots" : "ring tooth roots break through the OD");
  if (p.sun_bore_shape !== "None" && p.ID > 0 && hi.rf_s - pm.sunBoreRadius(p) - boreT <= 0.05)
    E.push(boreT ? "bore texture cuts through to the sun tooth roots" : "sun bore cuts through the sun teeth");
  if (p.planet_pins) {
    if (lo.rf_p - pm.pinGeometry(p).bore_face <= 0.05) E.push("planets too small for the pins (more planet teeth or a thinner pin)");
    if (pm.pinGeometry(p).pin_mid <= 0.3) E.push("pin too thin");
  } else if (p.planet_bore_d > 0 && lo.rf_p - pm.boreOuterRadius(p.planet_bore_shape, p.planet_bore_d, g.d) <= 0.05)
    E.push("planet bore cuts through the planet teeth");
  if (p.sun_bore_shape === "Spline" && pm.splineGeometry(p).rf_shaft - (p.shaft_bore ?? 0) / 2 <= 0.05) E.push("spline shaft centre hole too big");
  if (g.N >= 2 && 2 * g.a * Math.sin(Math.PI / g.N) - 2 * hi.ra_p <= 0) E.push("neighbouring planets overlap");
  if (E.length) {
    // say how much room the teeth have and roughly how much the smallest layout needs
    const [rw, , sw] = pm.wallLimits(p);
    const room = pm.ringOuterRadius(p) - pm.sunBoreRadius(p) - odT - boreT;
    const al = p.alpha * Math.PI / 180, zth = 2 / Math.sin(al) ** 2, x4 = Math.max(0, (5 / 6 * zth - 4) / zth);
    const need = rw + sw + 2 * (p.root_clear + p.expansion / 2) + (p.min_module ?? 0.5) * (4 + 2 + 2 * x4);
    if (room < need)
      E.push(`only ${room.toFixed(2)} mm between the bore and the ${p.ext_teeth ? "outer tooth roots" : "OD"}; the smallest layout needs about ${need.toFixed(2)} mm - ` +
        `make the OD bigger or the bore smaller${p.ext_teeth ? ", or lower the outer module" : ""}`);
  }
  return E.map((e) => pre + e);
}

export function build(p, notes = []) {
  // keep stored tooth counts consistent even if set by hand (same as execute() in FreeCAD)
  if (p.Zs + 2 * p.Zp !== p.Zr || (p.Zs + p.Zr) % p.N) {
    const s = pm.solve(p, null);
    p = { ...p, Zs: s.Zs, Zp: s.Zp, Zr: s.Zr, N: s.N };
    notes = [...notes, ...s.notes];
  }
  const lay = pm.trainLayout(p);
  const multi = lay.bearings.length > 1;
  const fatal = lay.bearings.flatMap((b) => geometryErrors(b.p, multi ? b.name : ""));
  const g = pm.derive(p);
  if (fatal.length) return { p, fatal, report: pm.report(p, g, pm.buildProfiles(p, g), notes), g };
  const T = buildTrain(p);
  const A = T.bearings[0].B;
  const rep = pm.report(p, A.g, A.prof, notes);
  // checks once per distinct body (planets / pins share one body)
  const checks = T.parts.map((pt) => ({ name: pt.name, bearing: pt.bearing, count: pt.inst.length,
    ...manifoldCheck(pt.body), volume: volume(pt.body) }));
  const half = pm.taperHalf(p, A.g.m);
  const walls = pm.walls(p, half ? pm.derive(p, null, null, null, half) : A.g);
  return {
    p, report: rep, checks, ms: A.ms, g: A.g, multi, walls,
    placements: A.placements, ringRot: A.phasing.ring_rot, ringRo: A.ringRoMax, profileSets: A.profileSets,
    parts: T.parts, bearings: T.bearings.map((b) => ({ name: b.name, cx: b.cx, cy: b.cy, Ze: b.Ze, g: b.B.g, Rmax: b.B.Rmax })),
  };
}
