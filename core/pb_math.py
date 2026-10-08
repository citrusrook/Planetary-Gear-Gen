"""Pure-math core for the parametric herringbone planetary (gear) bearing.

No FreeCAD imports here so it can be unit-tested anywhere with numpy.
Conventions
  * transverse module m, pressure angle alpha (transverse), helix beta at pitch cylinder
  * Zr = Zs + 2*Zp (concentric), planets equally spaced needs (Zs+Zr) % N == 0
  * S0 profile shift: planet +x, sun -x, ring +x  -> standard centre distances kept
  * expansion e (mm): every mating surface is pulled back by e/2  (total gap e per contact)
  * root clearance c (mm): extra radial gap between a tip and the mating root
"""
import math
from math import gcd, pi, tan, cos, sin, acos, sqrt

import numpy as np


def inv(a):
    return tan(a) - a


def lcm(a, b):
    return a * b // gcd(a, b)


# --------------------------------------------------------------------------
#  Basic geometry derived from the parameters
# --------------------------------------------------------------------------
def derive(p, Zs=None, Zp=None, N=None):
    """Return dict of derived geometry for parameter dict p (optionally overriding teeth/N)."""
    Zs = p["Zs"] if Zs is None else Zs
    Zp = p["Zp"] if Zp is None else Zp
    N = p["N"] if N is None else N
    Zr = Zs + 2 * Zp
    al = math.radians(p["alpha"])
    c = p["root_clear"]
    d = p["expansion"] / 2.0
    if p.get("module_auto", True):
        m = (p["OD"] + p["ID"]) / float(Zs + Zr)
    else:
        m = p["module"]
    if p.get("shift_auto", True):
        # practical (DIN 3960 style) limit: allow slight undercut, Z'min = 5/6 * Zmin
        z_th = 2.0 / sin(al) ** 2
        x = max(0.0, (5.0 / 6.0 * z_th - Zp) / z_th)
    else:
        x = p["shift"]
    rs, rp, rr = m * Zs / 2, m * Zp / 2, m * Zr / 2
    a = rs + rp
    g = dict(Zs=Zs, Zp=Zp, Zr=Zr, N=N, m=m, x=x, alpha=al, c=c, d=d,
             rs=rs, rp=rp, rr=rr, a=a,
             rbs=rs * cos(al), rbp=rp * cos(al), rbr=rr * cos(al))
    # nominal radii (before pointed-tip truncation)
    g["ra_p"] = rp + m * (1 + x) - d
    g["rf_p"] = rp - m * (1 - x) - c - d
    g["ra_s"] = rs + m * (1 - x) - d
    g["rf_s"] = rs - m * (1 + x) - c - d
    g["ra_p"] = tip_radius(Zp, m, al, x, d, g["ra_p"], p.get("tip_land", 0.1))
    g["ra_s"] = tip_radius(Zs, m, al, -x, d, g["ra_s"], p.get("tip_land", 0.1))
    g["ri_r"] = max(rr - m * (1 - x) + d, g["rbr"] * 1.0005)  # ring tip (inner)
    g["ro_r"] = rr + m * (1 + x) + c + d                       # ring root (outer)
    return g


def tip_radius(Z, m, al, x, d, ra_nom, land):
    """Tip radius of an external involute tooth, truncated where the top land would be < land."""
    rp = m * Z / 2.0
    rb = rp * cos(al)
    c0 = (pi / 2 + 2 * x * tan(al)) / Z + inv(al) - d / rb

    def excess(r):
        return c0 - inv(acos(min(1.0, rb / r))) - land / (2 * r)
    if excess(ra_nom) >= 0:
        return ra_nom
    lo, hi = max(rb, 1e-9), ra_nom
    if excess(lo) < 0:
        return lo
    for _ in range(60):
        mid = 0.5 * (lo + hi)
        if excess(mid) >= 0:
            lo = mid
        else:
            hi = mid
    return lo


def bore_outer_radius(shape, dia, comp):
    """Max radius of a bore (for wall checks)."""
    if shape == "None" or dia <= 0:
        return 0.0
    r = dia / 2.0 + comp
    if shape == "Hex":
        return r / cos(pi / 6)
    if shape == "Square":
        return r * sqrt(2)
    return r


# --------------------------------------------------------------------------
#  Tooth-count solver
# --------------------------------------------------------------------------
LIMITS = dict(Zp_min=4, Zp_max=80, Zs_min=6, Zs_max=300, N_min=1, N_max=120)
WEIGHTS = dict(N=8.0, Zr=2.0, Zs=1.0, Zp=3.0)


def feasible(p, Zs, Zp, N, why=False):
    """Hard constraints. Returns (ok, reasons)."""
    reasons = []
    Zr = Zs + 2 * Zp
    if (Zs + Zr) % N:
        reasons.append("(Zs+Zr)=%d not divisible by N=%d -> planets cannot be equally spaced" % (Zs + Zr, N))
        if not why:
            return False, reasons
    if p.get("hunting", False) and gcd(Zs, Zp) != 1:
        reasons.append("gcd(Zs,Zp)=%d != 1 -> not hunting-tooth (uneven wear)" % gcd(Zs, Zp))
        if not why:
            return False, reasons
    g = derive(p, Zs, Zp, N)
    if g["m"] < p.get("min_module", 0.0) - 1e-12:
        reasons.append("module %.3f < min printable module %.3f" % (g["m"], p.get("min_module", 0.0)))
        if not why:
            return False, reasons
    if N >= 2:
        gap = 2 * g["a"] * sin(pi / N) - 2 * g["ra_p"]
        if gap < p["min_planet_gap"] - 1e-9:
            reasons.append("adjacent planet tips gap %.3f < %.3f mm" % (gap, p["min_planet_gap"]))
            if not why:
                return False, reasons
    wall = p["OD"] / 2 - g["ro_r"]
    if wall < p["min_wall"] - 1e-9:
        reasons.append("ring wall %.3f < %.3f mm" % (wall, p["min_wall"]))
        if not why:
            return False, reasons
    rim = g["rf_s"] - bore_outer_radius(p["sun_bore_shape"], p["ID"], g["d"])
    if rim < p["min_wall"] - 1e-9:
        reasons.append("sun rim %.3f < %.3f mm" % (rim, p["min_wall"]))
        if not why:
            return False, reasons
    if g["rf_s"] <= 0 or g["rf_p"] <= 0:
        reasons.append("negative root radius")
    return (len(reasons) == 0), reasons


def solve(p, locked=None):
    """Find the closest compatible (Zs, Zp, N) to the current values.

    locked: one of 'N', 'Zr', 'Zs', 'Zp' or None. The locked quantity is held
    fixed if at all possible; otherwise the lock is released and a note added.
    Returns (Zs, Zp, Zr, N, notes)
    """
    Zs0, Zp0, N0 = p["Zs"], p["Zp"], p["N"]
    Zr0 = p["Zr"]
    notes = []
    L = LIMITS
    W = WEIGHTS

    # candidate grid
    Zp_rng = np.arange(L["Zp_min"], L["Zp_max"] + 1)
    Zs_rng = np.arange(L["Zs_min"], L["Zs_max"] + 1)

    def run(lock):
        if lock == "N":
            Ns = np.array([N0])
        else:
            Ns = np.arange(L["N_min"], L["N_max"] + 1)
        ZP, ZS, NN = np.meshgrid(Zp_rng, Zs_rng, Ns, indexing="ij")
        ZP, ZS, NN = ZP.ravel(), ZS.ravel(), NN.ravel()
        ZR = ZS + 2 * ZP
        mask = ((ZS + ZR) % NN) == 0
        if lock == "Zr":
            mask &= ZR == Zr0
        elif lock == "Zs":
            mask &= ZS == Zs0
        elif lock == "Zp":
            mask &= ZP == Zp0
        ZP, ZS, NN, ZR = ZP[mask], ZS[mask], NN[mask], ZR[mask]
        cost = (W["N"] * np.abs(NN - N0) + W["Zr"] * np.abs(ZR - Zr0) +
                W["Zs"] * np.abs(ZS - Zs0) + W["Zp"] * np.abs(ZP - Zp0))
        # tie-break: prefer more planets, then smaller teeth change
        order = np.lexsort((-NN, cost))
        for i in order[:20000]:
            ok, _ = feasible(p, int(ZS[i]), int(ZP[i]), int(NN[i]))
            if ok:
                return int(ZS[i]), int(ZP[i]), int(NN[i])
        return None

    res = run(locked)
    if res is None and locked is not None:
        notes.append("Could not keep %s=%s: no combination with it gives equal spacing while meeting "
                     "MinModule / MinWall / MinPlanetGap - released it." %
                     (locked, {"N": N0, "Zr": Zr0, "Zs": Zs0, "Zp": Zp0}[locked]))
        res = run(None)
    if res is None:
        notes.append("NO compatible combination found near current values - geometry built as-is, check report.")
        return Zs0, Zp0, Zs0 + 2 * Zp0, N0, notes
    Zs, Zp, N = res
    Zr = Zs + 2 * Zp
    ch = []
    for k, a, b in (("Planets", N0, N), ("Ring", Zr0, Zr), ("Sun", Zs0, Zs), ("Planet teeth", Zp0, Zp)):
        if a != b:
            ch.append("%s %d->%d" % (k, a, b))
    if ch:
        notes.append("Auto-adjusted for compatibility: " + ", ".join(ch))
    return Zs, Zp, Zr, N, notes


# --------------------------------------------------------------------------
#  Tooth profiles
# --------------------------------------------------------------------------
def rack_envelope(Z, m, al, x, c, d, ra_target, land_min, n_r=36, n_phi=6000):
    """External gear tooth generated by a (shifted, expanded) rack.

    Returns (r, t, rf, ra): radii and half-tooth angles of the flank (sorted by r),
    the root radius and effective tip radius (truncated if the tooth would be pointed).
    Exact for involute part and the trochoidal undercut.
    """
    rp = m * Z / 2.0
    p = pi * m
    ta = tan(al)
    vt = -(m + c + d)                 # rack tip (deepest)
    vtop = m * (2.5 + abs(x))         # well above the gear tip
    rf = rp + x * m + vt

    def half(v):
        return max(p / 4 + d / cos(al) + v * ta, 0.0)

    u0 = p / 2.0
    A = np.array([u0 - half(vt), vt])
    B = np.array([u0 - half(vtop), vtop])
    C = np.array([u0 + half(vt), vt])
    segs = [(A, B), (A, C)]

    R = rp + x * m
    span = ra_target + p
    phis = np.linspace((u0 - span) / rp, (u0 + span) / rp, n_phi)
    ra_lim = ra_target
    # near-uniform radii, slightly denser at the root fillet (avoids sampling noise -> false kinks)
    s = np.linspace(0, 1, n_r) ** 1.3
    rs_ = rf + 1e-6 * m + (ra_lim - rf - 1e-6 * m) * s
    best = np.full(rs_.shape, np.inf)
    for P0, P1 in segs:
        dd = P1 - P0
        # fixed-frame start point for each phi
        Ax = P0[0] - rp * phis
        Ay = np.full_like(phis, R + P0[1])
        dx, dy = dd
        aa = dx * dx + dy * dy
        bb = 2 * (Ax * dx + Ay * dy)                     # (nphi,)
        cc = Ax * Ax + Ay * Ay                            # (nphi,)
        disc = bb[:, None] ** 2 - 4 * aa * (cc[:, None] - rs_[None, :] ** 2)
        ok = disc >= 0
        sq = np.sqrt(np.where(ok, disc, 0))
        for sgn in (-1, 1):
            t = (-bb[:, None] + sgn * sq) / (2 * aa)
            v = ok & (t >= 0) & (t <= 1)
            X = Ax[:, None] + t * dx
            Y = Ay[:, None] + t * dy
            th = np.arctan2(X, Y) + phis[:, None]       # clockwise from +y, gear frame
            th = np.where(v & (th > -pi / Z) & (th < pi), th, np.inf)
            best = np.minimum(best, th.min(axis=0))
    r = rs_
    t = best
    # radii above where the rack never reaches are full material up to tip: should not happen
    if not np.all(np.isfinite(t)):
        # rack doesn't reach (e.g. huge negative shift) - fall back to analytic involute
        fin = np.isfinite(t)
        t = np.where(fin, t, np.interp(r, r[fin], t[fin]))
    # pointed-tip truncation
    land = land_min / (2 * r)
    bad = np.where(t < land)[0]
    ra = ra_target
    if len(bad):
        i = bad[0]
        if i == 0:
            ra = r[0] + 1e-3
        else:
            # interpolate where t == land
            f = (t[i - 1] - land[i - 1]) / ((t[i - 1] - land[i - 1]) - (t[i] - land[i]))
            ra = r[i - 1] + f * (r[i] - r[i - 1])
        # resample up to ra
        rr = rf + 1e-6 * m + (ra - rf - 1e-6 * m) * s
        t = np.interp(rr, r, t)
        r = rr
    return r, t, rf, ra


def ring_profile(g, land_min, n_r=24):
    """Internal ring tooth (material) half-angle psi(r) from inner tip to outer root."""
    m, al, x, d = g["m"], g["alpha"], g["x"], g["d"]
    Zr, rr, rb = g["Zr"], g["rr"], g["rbr"]
    s_r = m * (pi / 2 - 2 * x * tan(al))
    ri, ro = g["ri_r"], g["ro_r"]

    def psi(r):
        ar = acos(min(1.0, rb / r))
        return s_r / (2 * rr) - inv(al) + inv(ar) - d / rb

    # cap root if tooth space becomes pointed
    rs_ = np.linspace(ri, ro, 400)
    sp = np.array([pi / Zr - psi(r) for r in rs_])
    land = land_min / (2 * rs_)
    bad = np.where(sp < land)[0]
    if len(bad):
        ro = rs_[max(bad[0] - 1, 1)]
    s = 0.5 - 0.5 * np.cos(np.linspace(0, pi, n_r))
    r = ri + (ro - ri) * s
    t = np.array([psi(v) for v in r])
    return r, t, ri, ro


def build_profiles(p, g):
    """Compute all 2D profiles. Returns dict with planet/sun/ring flank data."""
    land = p["tip_land"]
    m = g["m"]
    out = {}
    rP, tP, rfP, raP = rack_envelope(g["Zp"], m, g["alpha"], g["x"], g["c"], g["d"], g["ra_p"], land)
    rS, tS, rfS, raS = rack_envelope(g["Zs"], m, g["alpha"], -g["x"], g["c"], g["d"], g["ra_s"], land)
    rR, tR, riR, roR = ring_profile(g, land)
    out["planet"] = dict(r=rP, t=tP, rf=rfP, ra=raP, Z=g["Zp"])
    out["sun"] = dict(r=rS, t=tS, rf=rfS, ra=raS, Z=g["Zs"])
    out["ring"] = dict(r=rR, t=tR, ri=riR, ro=roR, Z=g["Zr"])
    return out


def external_polygon(prof, rot=0.0, arc_pts=6):
    """Closed polygon (Nx2) of an external gear; tooth 0 centred on +x axis, rotated by rot."""
    Z, r, t, rf = prof["Z"], prof["r"], prof["t"], prof["rf"]
    pts = []
    for k in range(Z):
        g0 = 2 * pi * k / Z + rot
        # right flank (going up, negative side) - CCW boundary: start at root, go up the -t side
        for ri, ti in zip(r, t):
            pts.append((ri * cos(g0 - ti), ri * sin(g0 - ti)))
        a0, a1 = g0 - t[-1], g0 + t[-1]
        for a in np.linspace(a0, a1, arc_pts)[1:-1]:
            pts.append((r[-1] * cos(a), r[-1] * sin(a)))
        for ri, ti in zip(r[::-1], t[::-1]):
            pts.append((ri * cos(g0 + ti), ri * sin(g0 + ti)))
        a0, a1 = g0 + t[0], g0 + 2 * pi / Z - t[0]
        for a in np.linspace(a0, a1, arc_pts)[1:-1]:
            pts.append((rf * cos(a), rf * sin(a)))
    return np.array(pts)


def ring_hole_polygon(prof, rot=0.0, arc_pts=6):
    """Closed polygon of the ring's toothed hole (CCW). Ring tooth 0 centred on +x."""
    Z, r, t = prof["Z"], prof["r"], prof["t"]
    pts = []
    for k in range(Z):
        g0 = 2 * pi * k / Z + rot
        g1 = g0 + 2 * pi / Z
        for a in np.linspace(g0 - t[0], g0 + t[0], arc_pts)[1:]:
            pts.append((r[0] * cos(a), r[0] * sin(a)))
        for ri, ti in zip(r[1:], t[1:]):
            pts.append((ri * cos(g0 + ti), ri * sin(g0 + ti)))
        for a in np.linspace(g0 + t[-1], g1 - t[-1], arc_pts)[1:-1]:
            pts.append((r[-1] * cos(a), r[-1] * sin(a)))
        for ri, ti in zip(r[::-1][:-1], t[::-1][:-1]):
            pts.append((ri * cos(g1 - ti), ri * sin(g1 - ti)))
    return np.array(pts)


# --------------------------------------------------------------------------
#  Assembly phasing
# --------------------------------------------------------------------------
def phasing(g):
    """Planet orbit angles and spin angles so that every planet meshes.

    Sun tooth 0 centred on +x. Planet i at orbit angle th_i = 2*pi*i/N.
    Returns (orbit_angles, planet_spins, ring_rot).
    """
    Zs, Zp, Zr, N = g["Zs"], g["Zp"], g["Zr"], g["N"]
    psi0 = pi - pi / Zp            # tooth space of planet 0 faces sun tooth 0
    th = [2 * pi * i / N for i in range(N)]
    spins = [psi0 + t * (Zs + Zp) / Zp for t in th]
    # ring: phase of planet-0 tooth at its local angle 0 (facing ring)
    f = ((0 - psi0) * Zp / (2 * pi)) % 1.0
    ring_rot = -(f + 0.5) * 2 * pi / Zr
    return th, spins, ring_rot


def helix_twist(g, beta_deg, H, reversals):
    """Return function z -> (sun_rot, planet_rot, ring_rot) twist angles (radians)."""
    tb = tan(math.radians(beta_deg))
    S = reversals + 1
    hs = H / S

    def w(z):
        q = z % (2 * hs)
        return q if q <= hs else 2 * hs - q

    def f(z):
        s = tb * w(z)
        return s / g["rs"], -s / g["rp"], -s / g["rr"]
    return f, hs


# --------------------------------------------------------------------------
#  Report
# --------------------------------------------------------------------------
def contact_ratios(g, prof):
    al, m = g["alpha"], g["m"]
    pb = pi * m * cos(al)
    raP, raS, riR = prof["planet"]["ra"], prof["sun"]["ra"], prof["ring"]["ri"]
    rbP, rbS, rbR = g["rbp"], g["rbs"], g["rbr"]
    a = g["a"]
    e_sp = (sqrt(max(raS ** 2 - rbS ** 2, 0)) + sqrt(max(raP ** 2 - rbP ** 2, 0)) - a * sin(al)) / pb
    e_rp = (sqrt(max(raP ** 2 - rbP ** 2, 0)) - sqrt(max(riR ** 2 - rbR ** 2, 0)) + a * sin(al)) / pb
    return e_sp, e_rp


def report(p, g, prof, notes=()):
    Zs, Zp, Zr, N = g["Zs"], g["Zp"], g["Zr"], g["N"]
    m = g["m"]
    L = []
    L += list(notes)
    L.append("=== Teeth / layout ===")
    L.append("Sun %d  Planet %d x %d  Ring %d   (Zr = Zs + 2*Zp)" % (Zs, Zp, N, Zr))
    L.append("Module (transverse) %.4f mm, normal module %.4f mm, pressure angle %.1f deg" %
             (m, m * cos(math.radians(p["beta"])), p["alpha"]))
    L.append("Profile shift x: planet %+.3f, sun %+.3f, ring %+.3f" % (g["x"], -g["x"], g["x"]))
    L.append("Planet orbit radius %.4f mm, orbit diameter %.4f mm" % (g["a"], 2 * g["a"]))
    sp_ok = (Zs + Zr) % N == 0
    L.append("Equal spacing: (Zs+Zr)/N = %d/%d = %s -> %s" %
             (Zs + Zr, N, ("%d" % ((Zs + Zr) // N)) if sp_ok else "%.3f" % ((Zs + Zr) / N),
              "OK, every planet 360/%d = %.4f deg" % (N, 360.0 / N) if sp_ok else "NOT POSSIBLE"))
    L.append("Gear ratios: ring fixed -> sun:carrier = %.4f : 1 ; sun fixed -> ring:carrier = %.4f : 1" %
             (1 + Zr / Zs, 1 + Zs / Zr))
    L.append("=== Phasing / wear ===")
    gsp = gcd(Zs, Zp)
    grp = gcd(Zr, Zp)
    for nm, Za, gg in (("Sun-Planet", Zs, gsp), ("Ring-Planet", Zr, grp)):
        if gg == 1:
            L.append("%s: gcd(%d,%d)=1 -> HUNTING TOOTH: every planet tooth meets every %s tooth; "
                     "full cycle every %d engagements, then repeats" %
                     (nm, Za, Zp, nm.split('-')[0].lower(), lcm(Za, Zp)))
        else:
            kind = " (odd teeth only meet odd, even only even)" if gg == 2 else ""
            L.append("%s: gcd(%d,%d)=%d -> %d ISOLATED wear paths%s: each planet tooth only meets %d of %d %s teeth; "
                     "pattern repeats every %d engagements" %
                     (nm, Za, Zp, gg, gg, kind, Za // gg, Za, nm.split('-')[0].lower(), lcm(Za, Zp)))
    ph = sorted(set(round((i * Zs / N) % 1.0, 6) for i in range(N)))
    if len(ph) == 1:
        L.append("Planet mesh timing: all %d planets mesh IN PHASE (same instant)" % N)
    else:
        L.append("Planet mesh timing: %d distinct mesh phases (sequential meshing, smoother), step %.4f tooth" %
                 (len(ph), ph[1] - ph[0]))
    L.append("Even-wear enforcement: %s" % ("ON" if p.get("hunting") else "OFF"))
    L.append("=== Mesh quality ===")
    e_sp, e_rp = contact_ratios(g, prof)
    tb = tan(math.radians(p["beta"]))
    hs = p["H"] / (p["reversals"] + 1)
    e_b = hs * tb / (pi * m)
    L.append("Transverse contact ratio: sun-planet %.3f, ring-planet %.3f%s" %
             (e_sp, e_rp, "  (WARNING <1.0)" if min(e_sp, e_rp) < 1.0 else ""))
    L.append("Overlap (helical) ratio per herringbone leg %.3f -> total sun-planet %.3f, ring-planet %.3f" %
             (e_b, e_sp + e_b, e_rp + e_b))
    L.append("Herringbone: helix %.1f deg, %d reversal(s) -> %d legs of %.3f mm" %
             (p["beta"], p["reversals"], p["reversals"] + 1, hs))
    L.append("=== Radii (mm) ===")
    pl, su, ri = prof["planet"], prof["sun"], prof["ring"]
    L.append("Planet tip %.4f%s root %.4f | Sun tip %.4f%s root %.4f | Ring tip %.4f root %.4f" %
             (pl["ra"], " (truncated, pointed)" if pl["ra"] < g["ra_p"] - 1e-6 else "", pl["rf"],
              su["ra"], " (truncated, pointed)" if su["ra"] < g["ra_s"] - 1e-6 else "", su["rf"],
              ri["ri"], ri["ro"]))
    wall = p["OD"] / 2 - ri["ro"]
    rim = su["rf"] - bore_outer_radius(p["sun_bore_shape"], p["ID"], g["d"])
    L.append("Ring wall %.3f mm, sun rim %.3f mm (min %.2f)" % (wall, rim, p["min_wall"]))
    if p["planet_bore_d"] > 0:
        prim = pl["rf"] - bore_outer_radius(p["planet_bore_shape"], p["planet_bore_d"], g["d"])
        L.append("Planet rim around bore %.3f mm%s" % (prim, "  (WARNING thin)" if prim < 0.4 else ""))
    if N >= 2:
        gap = 2 * g["a"] * sin(pi / N) - 2 * pl["ra"]
        L.append("Planet-to-planet tip gap %.3f mm (min %.2f)" % (gap, p["min_planet_gap"]))
    L.append("Clearances: flank gap per contact %.3f mm (%.3f per part), tip-root %.3f + %.3f mm" %
             (p["expansion"], g["d"], g["c"], p["expansion"]))
    ok, why = feasible(p, Zs, Zp, N, why=True)
    for w in why:
        L.append("WARNING: " + w)
    return L
