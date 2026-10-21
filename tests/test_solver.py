"""Tooth-count solver behaviour (locks, spacing, hunting tooth, taper / texture limits)."""
from math import gcd
import pb_math as pm
from defaults import DEFAULTS, DEFAULTS_V1


def P(**kw):
    p = dict(DEFAULTS); p.update(kw); return p


def check(res, p):
    Zs, Zp, Zr, N, notes = res
    assert Zr == Zs + 2 * Zp
    assert (Zs + Zr) % N == 0
    ok, why = pm.feasible(dict(p, Zs=Zs, Zp=Zp, Zr=Zr, N=N), Zs, Zp, N)
    assert ok, why
    return res


def test_default_is_feasible():
    Zs, Zp, Zr, N, notes = check(pm.solve(P(), None), P())
    assert (Zs, Zp, Zr, N) == (31, 4, 39, 14) and notes == []
    g = pm.derive(P())
    assert g["m"] >= 0.68 and gcd(Zs, Zp) == 1        # V2: module 0.68+, hunting tooth


def test_v1_defaults_still_solve_to_v1_layout():
    assert pm.solve(DEFAULTS_V1, None)[:4] == (56, 4, 64, 24)


def test_lock_planet_count():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(N=10), "N"), P())
    assert N == 10


def test_impossible_planet_count_releases_lock():
    Zs, Zp, Zr, N, notes = check(pm.solve(P(N=40), "N"), P())
    assert N != 40 and any("Could not keep" in n for n in notes)


def test_lock_ring():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(Zr=45), "Zr"), P())
    assert Zr == 45


def test_lock_planet_teeth():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(Zp=5), "Zp"), P())
    assert Zp == 5


def test_even_wear_forces_hunting_tooth():
    p = P(hunting=True)
    Zs, Zp, Zr, N, _ = check(pm.solve(p, None), p)
    assert gcd(Zs, Zp) == 1 and gcd(Zr, Zp) == 1


def test_reference_bearing_is_rejected_by_rules():
    # micro-gear_ring_22: 48/4x26/56 at OD31.7 ID22 -> planets touch / walls too thin under our limits
    ok, why = pm.feasible(dict(DEFAULTS_V1, N=26, Zs=48, Zp=4, Zr=56), 48, 4, 26, why=True)
    assert not ok


# ---------------------------------------------------------------- V2 taper
def test_taper_dx_shapes():
    p = P(taper=4.0)
    m = pm.derive(p)["m"]
    half = pm.taper_half(p, m)
    H = p["H"]
    assert abs(pm.taper_dx(p, m, 0) - half) < 1e-12 and abs(pm.taper_dx(p, m, H) + half) < 1e-12   # wide at bottom
    f = dict(p, taper_flip=True)
    assert abs(pm.taper_dx(f, m, 0) + half) < 1e-12
    mi = dict(p, taper_mirror=True)
    hm = pm.taper_half(mi, m)
    assert abs(hm - half / 2) < 1e-12
    assert abs(pm.taper_dx(mi, m, H / 2) - hm) < 1e-12 and abs(pm.taper_dx(mi, m, 0) + hm) < 1e-12
    assert abs(pm.taper_dx(mi, m, 1.0) - pm.taper_dx(mi, m, H - 1.0)) < 1e-12                     # symmetric
    assert abs(pm.taper_dx(dict(mi, taper_flip=True), m, H / 2) + hm) < 1e-12


def test_auto_shift_keeps_thin_end_at_undercut_limit():
    p = P(taper=4.0)
    g = pm.derive(p)
    g0 = pm.derive(P())
    lo = pm.derive(p, dx=-pm.taper_half(p, g["m"]))
    assert abs(lo["x"] - g0["x"]) < 1e-12 and g["x"] > g0["x"]


def test_taper_checks_the_wide_end():
    # the taper deepens the ring roots at the wide end -> the default layout gets re-solved
    p = P(taper=2.0)
    assert not pm.feasible(p, 31, 4, 14)[0]
    check(pm.solve(p, None), p)
    # 6 deg on the flanks = ~16 deg cones on tips/roots: impossible in a 31.7 mm bearing
    notes = pm.solve(P(taper=6.0), None)[4]
    assert any("NO compatible" in n for n in notes)


def test_no_taper_is_v1_identical():
    p = P()
    assert pm.taper_profiles(p, pm.derive(p)) is None
    assert pm.derive(p) == pm.derive(p, dx=0.0)


# ---------------------------------------------------------------- V2 textures
def test_texture_depth_counts_against_wall_and_rim():
    base_ok = pm.feasible(P(), 31, 4, 14)[0]
    assert base_ok
    assert not pm.feasible(P(od_tex="Diamond knurl", od_tex_depth=0.3), 31, 4, 14)[0]
    assert pm.feasible(P(od_tex="Diamond knurl", od_tex_depth=0.1), 31, 4, 14)[0]
    assert not pm.feasible(P(bore_tex="Dimples", bore_tex_depth=0.6), 31, 4, 14)[0]
    # bore texture only on Round bores
    assert pm.tex_depth(P(bore_tex="Dimples", sun_bore_shape="Hex"), "bore") == 0.0


def test_texture_layout():
    p = P(od_tex="Dimples", od_tex_pitch=1.5, od_tex_size=1.2)
    lay = pm.tex_layout(p, "od", p["OD"] / 2, 0.3)
    assert lay["n"] == round(3.14159265 * 31.7 / 1.5) and lay["rows"] >= 2
    o = pm.tex_layout(dict(p, od_tex="Ovals", od_tex_aspect=2.5, od_tex_angle=0.0), "od", p["OD"] / 2, 0.3)
    assert abs(o["L"] - 3.0) < 1e-12 and o["rows"] >= 1
