"""Tooth-count solver behaviour (locks, spacing, hunting tooth)."""
from math import gcd
import pb_math as pm
from defaults import DEFAULTS


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
    assert (Zs, Zp, Zr, N) == (56, 4, 64, 24) and notes == []


def test_lock_planet_count():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(N=20), "N"), P())
    assert N == 20


def test_impossible_planet_count_releases_lock():
    Zs, Zp, Zr, N, notes = check(pm.solve(P(N=25), "N"), P())
    assert N != 25 and any("Could not keep" in n for n in notes)


def test_lock_ring():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(Zr=70), "Zr"), P())
    assert Zr == 70


def test_lock_planet_teeth():
    Zs, Zp, Zr, N, _ = check(pm.solve(P(Zp=5), "Zp"), P())
    assert Zp == 5


def test_even_wear_forces_hunting_tooth():
    p = P(hunting=True)
    Zs, Zp, Zr, N, _ = check(pm.solve(p, None), p)
    assert gcd(Zs, Zp) == 1 and gcd(Zr, Zp) == 1


def test_reference_bearing_is_rejected_by_rules():
    # micro-gear_ring_22: 48/4x26/56 at OD31.7 ID22 -> planets touch / walls too thin under our limits
    ok, why = pm.feasible(P(N=26, Zs=48, Zp=4, Zr=56), 48, 4, 26, why=True)
    assert not ok
