"""2D kinematic mesh simulation: no interference, flank gap == PrintExpansion, phasing correct.
Requires shapely."""
import math
import numpy as np
import pytest
import pb_math as pm
from defaults import DEFAULTS

shapely = pytest.importorskip("shapely")
from shapely.geometry import Polygon
from shapely import affinity

CASES = [
    dict(),                                                   # default, Zp even
    dict(Zp=5, Zs=61, N=22),                                  # Zp odd
    dict(Zp=7, Zs=23, N=5, OD=40, ID=8),
    dict(Zp=12, Zs=18, N=4, OD=60, ID=10, alpha=20),
    dict(Zp=9, Zs=15, N=4, OD=40, ID=5),
    dict(Zp=6, Zs=12, N=6, OD=30, ID=5, alpha=25),
]


def simulate(p):
    g = pm.derive(p); prof = pm.build_profiles(p, g)
    th, spins, rr = pm.phasing(g)
    sun = Polygon(pm.external_polygon(prof["sun"])).buffer(0)
    pl = Polygon(pm.external_polygon(prof["planet"])).buffer(0)
    disk = Polygon([(80 * math.cos(a), 80 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 200)])
    ring = affinity.rotate(disk.difference(Polygon(pm.ring_hole_polygon(prof["ring"])).buffer(0)),
                           rr, origin=(0, 0), use_radians=True)
    Zs, Zp, Zr, N = g["Zs"], g["Zp"], g["Zr"], g["N"]
    worst, mind = 0.0, 1e9
    for tc in np.linspace(0, 2 * math.pi / (Zr + Zs) * 2, 19):         # carrier angle, ring fixed
        s = affinity.rotate(sun, tc * (1 + Zr / Zs), origin=(0, 0), use_radians=True)
        for i in range(N):
            q = affinity.rotate(pl, spins[i] + tc * (1 - Zr / Zp), origin=(0, 0), use_radians=True)
            q = affinity.translate(q, g["a"] * math.cos(th[i] + tc), g["a"] * math.sin(th[i] + tc))
            worst = max(worst, q.intersection(s).area, q.intersection(ring).area)
            mind = min(mind, q.distance(s), q.distance(ring))
    return worst, mind, g


@pytest.mark.parametrize("over", CASES)
def test_zero_clearance_is_conjugate(over):
    p = dict(DEFAULTS, expansion=0.0, root_clear=0.0, **over); p["Zr"] = p["Zs"] + 2 * p["Zp"]
    worst, mind, g = simulate(p)
    assert worst < 2e-3 * g["m"] ** 2          # numerical noise only


@pytest.mark.parametrize("over", CASES)
def test_gap_equals_expansion(over):
    e = 0.1
    p = dict(DEFAULTS, expansion=e, root_clear=0.1, **over); p["Zr"] = p["Zs"] + 2 * p["Zp"]
    worst, mind, g = simulate(p)
    assert worst == 0.0
    assert abs(mind - e) < 0.01 * max(1, g["m"])
