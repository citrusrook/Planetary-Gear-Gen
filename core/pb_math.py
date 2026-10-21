"""Pure-math core for the parametric herringbone planetary (gear) bearing.

No FreeCAD imports here so it can be unit-tested anywhere with numpy.
Conventions
  * transverse module m, pressure angle alpha (transverse), helix beta at pitch cylinder
  * Zr = Zs + 2*Zp (concentric), planets equally spaced needs (Zs+Zr) % N == 0
  * S0 profile shift: planet +x, sun -x, ring +x  -> standard centre distances kept
  * expansion e (mm): every mating surface is pulled back by e/2  (total gap e per contact)
  * root clearance c (mm): extra radial gap between a tip and the mating root
  * taper (V2): the profile shift varies linearly with height (beveloid / conical involute teeth),
    x(z) = x0 + dx(z). Every transverse slice is still a standard S0 set (same base circles and
    centre distance), so the mesh stays exact; planets become cones, sun/ring teeth taper to match.
  * surface textures (V2): knurl / dimples / ovals cut into the ring OD and the sun bore; their depth
    counts against the ring wall / sun rim.
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
def derive(p, Zs=None, Zp=None, N=None, dx=0.0):
    """Return dict of derived geometry for parameter dict p (optionally overriding teeth/N).

    dx: extra profile shift for one height of a tapered bearing (see taper_dx); x = x0 + dx."""
    Zs = p["Zs"] if Zs is None else Zs
    Zp = p["Zp"] if Zp is None else Zp
    N = p["N"] if N is None else N
    Zr = Zs + 2 * Zp
    al = math.radians(p["alpha"])
    c = p["root_clear"]
    d = p["expansion"] / 2.0
    z_th = 2.0 / sin(al) ** 2
    # practical (DIN 3960 style) undercut limit: allow slight undercut, Z'min = 5/6 * Zmin
    x_auto = max(0.0, (5.0 / 6.0 * z_th - Zp) / z_th)
    mode = module_mode(p)
    R_out = ring_outer_radius(p)                 # OD/2, or the root of the external teeth
    if mode == "Auto":
        m = (2 * R_out + p["ID"]) / float(Zs + Zr)
    elif mode == "Walls":
        # teeth fill the space between the ring-wall and sun-wall targets (at the taper's wide end)
        R_in = sun_bore_radius(p) + tex_depth(p, "bore") + p.get("sun_wall", 0.8)
        R_o = R_out - tex_depth(p, "od") - p.get("ring_wall", 0.8)
        m = max(1e-3, (R_o - R_in - 2 * (c + d)) / (Zp + 2 + 2 * x_auto))
        for _ in range(4):                       # x at the wide end depends on m through the taper
            xs = (x_auto if p.get("shift_auto", True) else p["shift"]) + 2 * taper_half(p, m, al) * (
                1 if p.get("shift_auto", True) else 0.5)
            m = max(1e-3, (R_o - R_in - 2 * (c + d)) / (Zp + 2 + 2 * xs))
    else:
        m = p["module"]
    if p.get("shift_auto", True):
        # taper: centre the range so the thin end of the planet sits at the practical undercut limit
        x = x_auto + taper_half(p, m, al)
    else:
        x = p["shift"]
    x += dx
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


def bore_outer_radius(shape, dia, comp, p=None):
    """Max radius of a bore (for wall checks). A Spline bore needs p (its teeth / pressure angle)."""
    if shape == "None" or dia <= 0:
        return 0.0
    if shape == "Spline":
        return spline_geometry(p)["ro_r"]
    r = dia / 2.0 + comp
    if shape == "Hex":
        return r / cos(pi / 6)
    if shape == "Square":
        return r * sqrt(2)
    return r


def sun_bore_radius(p):
    return bore_outer_radius(p["sun_bore_shape"], p["ID"], p["expansion"] / 2.0, p)


def module_mode(p):
    """'Auto' | 'Manual' | 'Walls' (older parameter sets only have module_auto)."""
    mm = p.get("module_mode")
    if mm in ("Auto", "Manual", "Walls"):
        return mm
    return "Auto" if p.get("module_auto", True) else "Manual"


def wall_limits(p):
    """(ring_min, ring_max, sun_min, sun_max); max 0 = no limit. Older sets have one min_wall."""
    w = p.get("min_wall", 0.5)
    return (p.get("ring_wall_min", w), p.get("ring_wall_max", 0.0),
            p.get("sun_wall_min", w), p.get("sun_wall_max", 0.0))


TEX_TYPES = ("None", "Straight knurl", "Diagonal knurl", "Diamond knurl", "Dimples", "Ovals", "Raised ovals")


def taper_rate(p, m, al=None):
    """Profile-shift change per mm of height. The taper angle is the lean of the load-carrying
    flanks: a radial shift x*m moves an involute flank along its normal by x*m*sin(alpha), so
    dx/dz = tan(taper) / (m sin(alpha)). Tips and roots lean more: atan(tan(taper)/sin(alpha))."""
    t = p.get("taper", 0.0)
    if not t:
        return 0.0
    al = math.radians(p["alpha"]) if al is None else al
    return tan(math.radians(t)) / (m * sin(al))


def taper_half(p, m, al=None):
    """Half of the profile-shift range caused by the taper: dx(z) spans [-half, +half]."""
    k = taper_rate(p, m, al)
    if not k:
        return 0.0
    return k * p["H"] * (0.25 if p.get("taper_mirror", False) else 0.5)


def taper_dx(p, m, z):
    """Profile-shift offset at height z. Planet radii grow with +dx (sun/ring follow).

    single:   planet wide at the bottom (flip: at the top)
    mirrored: planet fattest at mid-height (flip: thinnest), a double cone that locks both ways"""
    k = taper_rate(p, m)
    if not k:
        return 0.0
    H = p["H"]
    s = (H / 4 - abs(z - H / 2)) if p.get("taper_mirror", False) else (H / 2 - z)
    if p.get("taper_flip", False):
        s = -s
    return k * s


# --------------------------------------------------------------------------
#  V3: spline bore, planet pins, external teeth and gear trains
# --------------------------------------------------------------------------
def spline_geometry(p):
    """Internal involute spline in the sun bore (ID = pitch diameter) and its shaft; S0, x = 0."""
    Z = int(p.get("spline_teeth", 12))
    al = math.radians(p.get("spline_alpha", 30.0))
    m = p["ID"] / Z
    c, d = p["root_clear"], p["expansion"] / 2.0
    rr = m * Z / 2
    g = dict(Z=Z, Zr=Z, m=m, alpha=al, x=0.0, c=c, d=d, rr=rr, rbr=rr * cos(al))
    g["ri_r"] = max(rr - m + d, g["rbr"] * 1.0005)     # internal tip (bore minimum)
    g["ro_r"] = rr + m + c + d                         # internal root (bore maximum)
    g["ra_shaft"] = tip_radius(Z, m, al, 0.0, d, rr + m - d, p.get("tip_land", 0.1))
    g["rf_shaft"] = rr - m - c - d
    return g


def spline_profiles(p):
    """(bore profile like ring_profile, shaft profile like rack_envelope) for the Spline bore."""
    g = spline_geometry(p)
    land = p["tip_land"]
    bore = dict(zip(("r", "t", "ri", "ro"), ring_profile(g, land)), Z=g["Z"])
    r, t, rf, ra = rack_envelope(g["Z"], g["m"], g["alpha"], 0.0, g["c"], g["d"], g["ra_shaft"], land)
    shaft = dict(r=r, t=t, rf=rf, ra=ra, Z=g["Z"])
    return g, bore, shaft


def pin_geometry(p):
    """Captured planet pin: hourglass bore (narrowest at mid-height) around a matching pin."""
    rm = p.get("pin_d", 2.0) / 2.0
    gap, v = p.get("pin_gap", 0.15), p.get("pin_v", 0.4)
    return dict(pin_mid=rm, pin_face=rm + v, bore_mid=rm + gap, bore_face=rm + gap + v, v=v, gap=gap,
                collar=p.get("pin_collar", 0.8), captured=v > gap + 1e-9)


def ring_outer_radius(p):
    """Radius the ring wall is measured to: OD/2, or the root of the external teeth."""
    if not p.get("ext_teeth", False):
        return p["OD"] / 2.0
    return ext_geometry(p)["rf"]


def ext_geometry(p):
    """External teeth on the ring (x = 0 so meshing bearings keep standard centre distances).
    OD is their tip diameter; with ext_z_auto the count is the largest that fits it."""
    m = p.get("ext_module", 1.0)
    al = math.radians(p["alpha"])
    c, d = p["root_clear"], p["expansion"] / 2.0
    if p.get("ext_z_auto", True):
        Z = max(6, int(math.floor((p["OD"] + 2 * d) / m - 2 + 1e-9)))
    else:
        Z = int(p.get("ext_z", 30))
    rp = m * Z / 2
    ra = tip_radius(Z, m, al, 0.0, d, rp + m - d, p.get("tip_land", 0.1))
    return dict(Z=Z, m=m, alpha=al, x=0.0, c=c, d=d, rp=rp, rb=rp * cos(al), ra=ra, rf=rp - m - c - d)


def ext_twist(p, z, rp, hand):
    """Rotation (rad) of external teeth at height z: straight, helical or herringbone (1 reversal).
    hand alternates +1/-1 along a gear train so neighbours mesh."""
    kind = p.get("ext_helix", "Straight")
    if kind == "Straight" or not p.get("ext_beta", 0.0):
        return 0.0
    tb = tan(math.radians(p["ext_beta"]))
    H = p["H"]
    w = z if kind == "Helical" else (z if z <= H / 2 else H - z)
    return hand * tb * w / rp


TRAIN_NAMES = ("A", "B", "C")


def _scaled_counts(pa, q):
    """Starting tooth counts for another bearing q of the train: same module as A and the same
    share of the annulus for the teeth (so the walls scale with the bearing, not the teeth)."""
    ga = derive(pa)
    c, d = pa["root_clear"], pa["expansion"] / 2.0
    W_a = ring_outer_radius(pa) - sun_bore_radius(pa)
    zone_a = ga["ro_r"] - ga["rf_s"]
    W_q = ring_outer_radius(q) - sun_bore_radius(q)
    m = ga["m"]
    Zp = int(round((zone_a / W_a * W_q - 2 * (c + d)) / m - 2 - 2 * ga["x"]))
    Zp = min(LIMITS["Zp_max"], max(LIMITS["Zp_min"], Zp))
    S = (2 * ring_outer_radius(q) + q["ID"]) / m            # Zs + Zr at A's module
    Zs = max(LIMITS["Zs_min"], int(round((S - 2 * Zp) / 2.0)))
    a_q = m * (Zs + Zp) / 2.0
    N = max(1, int(round(pa["N"] * (a_q / ga["a"]) * (pa["Zp"] / float(Zp)))))
    return dict(Zs=Zs, Zp=Zp, Zr=Zs + 2 * Zp, N=N)


def train_layout(p):
    """Bearings of a gear train A -> B (-> C) meshing on their external teeth.

    Ratio A:B = B teeth / A teeth (0 = Auto: B's count comes from B_OD); same for B:C.
    Returns a list of dicts: name, p (full parameter set, tooth counts solved), Ze, cx, cy, rot (rad,
    external teeth at z=0), hand, plus notes."""
    n = {"Single": 1, "A-B": 2, "A-B-C": 3}.get(p.get("train", "Single"), 1)
    out, notes = [], []
    if not p.get("ext_teeth", False) or n == 1:
        return [dict(name="A", p=p, Ze=ext_geometry(p)["Z"] if p.get("ext_teeth") else 0,
                     cx=0.0, cy=0.0, rot=0.0, hand=1)], notes
    me = p["ext_module"]
    d = p["expansion"] / 2.0
    ga = ext_geometry(p)
    out.append(dict(name="A", p=p, Ze=ga["Z"], cx=0.0, cy=0.0, rot=0.0, hand=1))
    prev = out[0]
    phi = 0.0
    for k, key in ((1, "ab"), (2, "bc")):
        if k >= n:
            break
        name = TRAIN_NAMES[k]
        ratio = p.get("ratio_" + key, 0.0)
        ID = p.get(name + "_ID", p["ID"])
        if ratio and ratio > 0:
            Ze = max(6, int(round(prev["Ze"] * ratio)))
            OD = me * (Ze + 2) - 2 * d
        else:
            OD = p.get(name + "_OD", p["OD"])
            Ze = max(6, int(math.floor((OD + 2 * d) / me - 2 + 1e-9)))
        q = dict(p, OD=OD, ID=ID, ext_z_auto=False, ext_z=Ze, train="Single")
        q.update(_scaled_counts(p, q))
        Zs, Zp, Zr, N, nt = solve(q, None)
        q.update(Zs=Zs, Zp=Zp, Zr=Zr, N=N)
        notes += ["%s: %s" % (name, t) for t in nt]
        a = me * (prev["Ze"] + Ze) / 2.0
        if k == 2:
            phi = math.radians(p.get("train_angle", 0.0))
        cx, cy = prev["cx"] + a * cos(phi), prev["cy"] + a * sin(phi)
        # tooth phase: u_prev + u_this = 1/2 (pitches) across the contact line
        pp, pt = 2 * pi / prev["Ze"], 2 * pi / Ze
        u_prev = ((phi - prev["rot"]) / pp) % 1.0
        rot = phi + pi - pt * (0.5 - u_prev)
        out.append(dict(name=name, p=q, Ze=Ze, cx=cx, cy=cy, rot=rot, hand=-prev["hand"], a=a))
        prev = out[-1]
    return out, notes


def taper_mode(p):
    if p.get("taper_mirror", False):
        if p.get("taper_flip", False):
            return "mirrored, planets thinnest at mid-height"
        return "mirrored, planets fattest at mid-height"
    return "single, planets wide at the top" if p.get("taper_flip", False) else "single, planets wide at the bottom"


def tex_depth(p, which):
    """Radial depth a surface texture cuts in ('od' = ring OD, 'bore' = sun bore; Round bores only)."""
    if p.get(which + "_tex", "None") == "None":
        return 0.0
    if which == "bore" and (p.get("sun_bore_shape") != "Round" or p.get("ID", 0) <= 0):
        return 0.0
    if which == "od" and p.get("ext_teeth", False):
        return 0.0
    return max(0.0, p.get(which + "_tex_depth", 0.0))


def tex_layout(p, which, R, chamfer=0.3):
    """Feature count around and rows over the height for a texture on a cylinder of radius R.
    Shared with the web mesh builder. Returns dict(n, rows, pz, ext_z, w, L)."""
    kind = p.get(which + "_tex", "None")
    pitch = max(0.05, p.get(which + "_tex_pitch", 1.0))
    n = max(3, int(round(2 * pi * R / pitch)))
    out = dict(n=n, rows=0, pz=0.0, ext_z=0.0, w=0.0, L=0.0)
    if kind in ("Dimples", "Ovals", "Raised ovals"):
        oval = kind != "Dimples"
        w = max(0.05, p.get(which + "_tex_size", 1.0))
        L = w * max(1.0, p.get(which + "_tex_aspect", 1.0)) if oval else w
        psi = math.radians(p.get(which + "_tex_angle", 0.0)) if oval else 0.0
        ext_z = L * abs(cos(psi)) + w * abs(sin(psi))
        pz = 0.5 * sqrt(3.0) * pitch * ext_z / w
        H = p["H"]
        span = H - 2 * (chamfer + ext_z / 2)
        if span >= 0:
            rows = int(span // pz) + 1
        else:
            rows = 1 if H > ext_z else 0
        out.update(rows=rows, pz=pz, ext_z=ext_z, w=w, L=L)
    return out


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
    half = taper_half(p, g["m"])
    g_hi = derive(p, Zs, Zp, N, dx=half) if half else g     # widest planet / deepest ring root
    g_lo = derive(p, Zs, Zp, N, dx=-half) if half else g    # thinnest planet
    if g["m"] < p.get("min_module", 0.0) - 1e-12:
        reasons.append("module %.3f < min printable module %.3f" % (g["m"], p.get("min_module", 0.0)))
        if not why:
            return False, reasons
    if N >= 2:
        gap = 2 * g["a"] * sin(pi / N) - 2 * g_hi["ra_p"]
        if gap < p["min_planet_gap"] - 1e-9:
            reasons.append("adjacent planet tips gap %.3f < %.3f mm" % (gap, p["min_planet_gap"]))
            if not why:
                return False, reasons
    rw_min, rw_max, sw_min, sw_max = wall_limits(p)
    wall, rim = walls(p, g_hi)
    if module_mode(p) == "Walls":                 # stay within half a module of the targets
        rw_max = min(rw_max, p.get("ring_wall", 0.8) + g["m"] / 2) if rw_max > 0 else p.get("ring_wall", 0.8) + g["m"] / 2
        sw_max = min(sw_max, p.get("sun_wall", 0.8) + g["m"] / 2) if sw_max > 0 else p.get("sun_wall", 0.8) + g["m"] / 2
    for nm, v, lo_, hi_ in (("ring wall", wall, rw_min, rw_max), ("sun rim", rim, sw_min, sw_max)):
        if v < lo_ - 1e-9:
            reasons.append("%s %.3f < %.3f mm" % (nm, v, lo_))
        elif hi_ > 0 and v > hi_ + 1e-9:
            reasons.append("%s %.3f > max %.3f mm" % (nm, v, hi_))
        else:
            continue
        if not why:
            return False, reasons
    if p.get("planet_pins", False):
        prim = g_lo["rf_p"] - pin_geometry(p)["bore_face"]
        if prim < PIN_RIM - 1e-9:
            reasons.append("planet rim around the pin %.3f < %.2f mm (planets too small for pins)" % (prim, PIN_RIM))
            if not why:
                return False, reasons
    if g_hi["rf_s"] <= 0 or g_lo["rf_p"] <= 0:
        reasons.append("negative root radius")
    return (len(reasons) == 0), reasons


PIN_RIM = 0.4


def walls(p, g_hi):
    """(ring wall, sun rim) at the taper's wide end, after textures."""
    wall = ring_outer_radius(p) - g_hi["ro_r"] - tex_depth(p, "od")
    rim = g_hi["rf_s"] - sun_bore_radius(p) - tex_depth(p, "bore")
    return wall, rim


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


def taper_profiles(p, g):
    """Profiles at the taper extremes: (g_lo, prof_lo, g_hi, prof_hi), or None without taper."""
    half = taper_half(p, g["m"])
    if not half:
        return None
    g_lo = derive(p, g["Zs"], g["Zp"], g["N"], dx=-half)
    g_hi = derive(p, g["Zs"], g["Zp"], g["N"], dx=half)
    return g_lo, build_profiles(p, g_lo), g_hi, build_profiles(p, g_hi)


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
    tp = taper_profiles(p, g)
    hi = tp[3] if tp else prof                   # widest planet / deepest roots
    lo = tp[1] if tp else prof
    wall = ring_outer_radius(p) - hi["ring"]["ro"] - tex_depth(p, "od")
    rim = hi["sun"]["rf"] - sun_bore_radius(p) - tex_depth(p, "bore")
    rw_min, rw_max, sw_min, sw_max = wall_limits(p)
    lim = lambda a, b: ("min %.2f" % a) + (", max %.2f" % b if b > 0 else "")
    L.append("Ring wall %.3f mm (%s), sun rim %.3f mm (%s)%s" %
             (wall, lim(rw_min, rw_max), rim, lim(sw_min, sw_max),
              (" - module fitted to wall targets %.2f / %.2f" % (p.get("ring_wall", 0.8), p.get("sun_wall", 0.8)))
              if module_mode(p) == "Walls" else ""))
    if p.get("planet_pins", False):
        pg = pin_geometry(p)
        prim = lo["planet"]["rf"] - pg["bore_face"]
        L.append("Planet rim around the pin bore %.3f mm%s" % (prim, "  (WARNING thin)" if prim < PIN_RIM else ""))
    elif p["planet_bore_d"] > 0:
        prim = lo["planet"]["rf"] - bore_outer_radius(p["planet_bore_shape"], p["planet_bore_d"], g["d"])
        L.append("Planet rim around bore %.3f mm%s" % (prim, "  (WARNING thin)" if prim < 0.4 else ""))
    if N >= 2:
        gap = 2 * g["a"] * sin(pi / N) - 2 * hi["planet"]["ra"]
        L.append("Planet-to-planet tip gap %.3f mm (min %.2f)" % (gap, p["min_planet_gap"]))
    L.append("Clearances: flank gap per contact %.3f mm (%.3f per part), tip-root %.3f + %.3f mm" %
             (p["expansion"], g["d"], g["c"], p["expansion"]))
    if tp:
        L += report_taper(p, g, *tp)
    L += report_texture(p, g)
    L += report_v3(p, g)
    ok, why = feasible(p, Zs, Zp, N, why=True)
    for w in why:
        L.append("WARNING: " + w)
    return L


def report_taper(p, g, g_lo, plo, g_hi, phi):
    L = ["=== Taper ==="]
    L.append("Taper %.1f deg (%s): planet profile shift x %+.3f .. %+.3f, mid-height %+.3f" %
             (p["taper"], taper_mode(p), g_lo["x"], g_hi["x"], g["x"]))
    L.append("Load-carrying flanks lean %.1f deg; tooth tips and roots form cones of %.1f deg" %
             (p["taper"], math.degrees(math.atan(tan(math.radians(p["taper"])) / sin(g["alpha"])))))
    L.append("Planet tip %.4f .. %.4f root %.4f .. %.4f | Sun tip %.4f .. %.4f root %.4f .. %.4f | "
             "Ring tip %.4f .. %.4f root %.4f .. %.4f" %
             (plo["planet"]["ra"], phi["planet"]["ra"], plo["planet"]["rf"], phi["planet"]["rf"],
              phi["sun"]["ra"], plo["sun"]["ra"], phi["sun"]["rf"], plo["sun"]["rf"],
              plo["ring"]["ri"], phi["ring"]["ri"], plo["ring"]["ro"], phi["ring"]["ro"]))
    a_lo, b_lo = contact_ratios(g_lo, plo)
    a_hi, b_hi = contact_ratios(g_hi, phi)
    L.append("Transverse contact ratio thin end / wide end: sun-planet %.3f / %.3f, ring-planet %.3f / %.3f%s" %
             (a_lo, a_hi, b_lo, b_hi, "  (WARNING <1.0)" if min(a_lo, a_hi, b_lo, b_hi) < 1.0 else ""))
    z_th = 2.0 / sin(g["alpha"]) ** 2
    lim_p = (5.0 / 6.0 * z_th - g["Zp"]) / z_th
    lim_s = (5.0 / 6.0 * z_th - g["Zs"]) / z_th
    if g_lo["x"] < lim_p - 1e-9:
        L.append("WARNING: planet undercut at the thin end (x %+.3f < practical limit %+.3f): weaker tooth roots"
                 % (g_lo["x"], lim_p))
    if -g_hi["x"] < lim_s - 1e-9:
        L.append("WARNING: sun undercut where the planets are widest (sun x %+.3f < practical limit %+.3f)"
                 % (-g_hi["x"], lim_s))
    if phi["planet"]["ra"] < g_hi["rp"] + g_hi["m"] * (1 + g_hi["x"]) - g_hi["d"] - 1e-6:
        L.append("Planet tips are truncated (pointed) at the wide end - normal for a strong taper")
    return L


def report_texture(p, g):
    L = []
    for which, label, R in (("od", "Outer (ring OD)", p["OD"] / 2), ("bore", "Inner (sun bore)", p["ID"] / 2 + g["d"])):
        kind = p.get(which + "_tex", "None")
        if kind == "None":
            continue
        if not L:
            L.append("=== Surface texture ===")
        if tex_depth(p, which) == 0.0:
            why = "needs a Round sun bore" if which == "bore" else "the ring has external teeth"
            L.append("%s: %s ignored - %s" % (label, kind, why))
            continue
        lay = tex_layout(p, which, R, surface_chamfer(p, which))
        d = p[which + "_tex_depth"]
        if kind.endswith("knurl"):
            ang = "" if kind == "Straight knurl" else ", helix %.1f deg" % p[which + "_tex_angle"]
            L.append("%s: %s, depth %.3f mm, pitch %.2f mm -> %d around%s" %
                     (label, kind, d, p[which + "_tex_pitch"], lay["n"], ang))
        else:
            if kind == "Dimples":
                size = "%.2f mm" % lay["w"]
            else:
                size = "%.2f x %.2f mm, tilt %.1f deg" % (lay["w"], lay["L"], p[which + "_tex_angle"])
            L.append("%s: %s %s, depth %.3f mm, pitch %.2f mm -> %d around x %d row(s)%s" %
                     (label, kind, size, d, p[which + "_tex_pitch"], lay["n"], lay["rows"],
                      " - surface recessed by the depth, ovals stand up to the nominal size" if kind == "Raised ovals" else ""))
            if lay["rows"] == 0:
                L.append("WARNING: %s are taller than the height between the chamfers - none placed" % kind.lower())
    return L


def surface_chamfer(p, which):
    """Chamfer at the ring OD ('od') or the sun bore ('bore'); older sets have one chamfer."""
    return p.get("ring_od_chamfer" if which == "od" else "sun_bore_chamfer", p.get("chamfer", 0.3))


def report_v3(p, g):
    L = []
    if p.get("sun_bore_shape") == "Spline":
        sg = spline_geometry(p)
        L.append("=== Spline bore ===")
        L.append("Spline %d teeth, module %.4f mm, pressure angle %.1f deg: bore tip %.4f root %.4f | "
                 "shaft tip %.4f root %.4f (gap %.3f per flank), shaft length %.1f mm%s" %
                 (sg["Z"], sg["m"], math.degrees(sg["alpha"]), sg["ri_r"], sg["ro_r"], sg["ra_shaft"],
                  sg["rf_shaft"], p["expansion"], p.get("shaft_length", 15.0),
                  (", centre hole %.2f mm" % p["shaft_bore"]) if p.get("shaft_bore", 0) > 0 else ""))
        if sg["rf_shaft"] - p.get("shaft_bore", 0) / 2 < 0.5:
            L.append("WARNING: shaft wall around its centre hole is thin")
    if p.get("planet_pins", False):
        pg = pin_geometry(p)
        L.append("=== Planet pins (fixed carrier) ===")
        L.append("Captured pin per planet: diameter %.2f at mid-height, %.2f at the faces; hourglass bore %.2f..%.2f "
                 "(radial gap %.2f); collar + %.1f mm stub above the top for the %.1f mm carrier plate (hole fit %+.2f)" %
                 (2 * pg["pin_mid"], 2 * pg["pin_face"], 2 * pg["bore_mid"], 2 * pg["bore_face"], pg["gap"],
                  p.get("carrier_t", 2.0), p.get("carrier_t", 2.0), p.get("carrier_fit", 0.1)))
        if not pg["captured"]:
            L.append("WARNING: pin V depth must exceed the radial gap, or the pins fall out")
        L.append("Carrier fixed: sun:ring = -%d:%d -> ring turns %.4f per sun turn (opposite direction)" %
                 (g["Zr"], g["Zs"], g["Zs"] / g["Zr"]))
    if p.get("ext_teeth", False):
        L += report_train(p)
    return L


def ext_contact_ratio(ga, gb):
    a = ga["rp"] + gb["rp"]
    pb = pi * ga["m"] * cos(ga["alpha"])
    return (sqrt(max(ga["ra"] ** 2 - ga["rb"] ** 2, 0)) + sqrt(max(gb["ra"] ** 2 - gb["rb"] ** 2, 0)) -
            a * sin(ga["alpha"])) / pb


def report_train(p):
    lay, notes = train_layout(p)
    L = ["=== External teeth / gear train ==="]
    L += notes
    style = p.get("ext_helix", "Straight")
    st = style if style == "Straight" else "%s %.1f deg" % (style, p.get("ext_beta", 0.0))
    for b in lay:
        q = b["p"]
        ge = ext_geometry(q)
        gq = derive(q)
        L.append("%s: %d outer teeth (module %.3f, %s%s), tip dia %.3f, ring wall to outer root %.3f mm | "
                 "inside sun %d / planets %d x %d / ring %d, module %.4f" %
                 (b["name"], ge["Z"], ge["m"], st, "" if style == "Straight" else (" right" if b["hand"] > 0 else " left"),
                  2 * ge["ra"], ge["rf"] - gq["ro_r"], q["Zs"], q["Zp"], q["N"], q["Zr"], gq["m"]))
    for x, y in zip(lay, lay[1:]):
        gx, gy = ext_geometry(x["p"]), ext_geometry(y["p"])
        eps = ext_contact_ratio(gx, gy)
        L.append("%s-%s: ratio %d:%d = %.4f (%s turns %.4f per %s turn, opposite direction), centre distance %.3f mm, "
                 "contact ratio %.3f%s" %
                 (x["name"], y["name"], x["Ze"], y["Ze"], y["Ze"] / x["Ze"], y["name"], x["Ze"] / y["Ze"], x["name"],
                  y["a"], eps, "  (WARNING <1.0)" if eps < 1.0 else ""))
    if len(lay) == 3:
        L.append("A-C overall: %d:%d = %.4f, C turns the same way as A" %
                 (lay[0]["Ze"], lay[2]["Ze"], lay[2]["Ze"] / lay[0]["Ze"]))
    if style != "Straight" and len(lay) > 1:
        L.append("Neighbours use opposite helix hands so they mesh")
    return L
