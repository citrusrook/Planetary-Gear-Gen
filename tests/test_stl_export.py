"""Checks an STL exported by the web app (or FreeCAD): bodies, watertightness, volumes and
zero interference between planets and sun / ring on z-slices.

    PB_STL=build/PlanetaryBearing_....stl python -m pytest -q tests/test_stl_export.py

Without PB_STL every build/*.stl is checked (the web dev server's PUT /upload/ saves there).
The tooth counts and expansion are read from the file name tag (..._S56P4x24R64_b30_e0.15.stl).
"""
import glob
import os
import re

import numpy as np
import pytest

trimesh = pytest.importorskip("trimesh")
shapely = pytest.importorskip("shapely")
from shapely.ops import unary_union

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = [os.environ["PB_STL"]] if os.environ.get("PB_STL") else sorted(glob.glob(os.path.join(ROOT, "build", "PlanetaryBearing_*.stl")))
# FreeCAD B-rep export of the defaults (Documents\PlanetaryBearing\..._e0.15.stl), measured with trimesh
FREECAD_DEFAULT = dict(tag="OD31.7_ID22_H5_S56P4x24R64_b30_e0.15", ring=532.31, sun=354.07, planet=12.742)

if not FILES:
    pytest.skip("no exported STL (set PB_STL or upload to build/)", allow_module_level=True)


def parse(path):
    m = re.search(r"OD([\d.]+)_ID([\d.]+)_H([\d.]+)_S(\d+)P(\d+)x(\d+)R(\d+)_b([\d.]+)_e(-?\d+(?:\.\d+)?)", os.path.basename(path))
    OD, ID, H = map(float, m.group(1, 2, 3))
    Zs, Zp, N, Zr = map(int, m.group(4, 5, 6, 7))
    return dict(OD=OD, ID=ID, H=H, Zs=Zs, Zp=Zp, N=N, Zr=Zr, beta=float(m.group(8)), e=float(m.group(9)),
                tag=m.group(0))


def bodies(path):
    mesh = trimesh.load(path, process=True)
    parts = mesh.split(only_watertight=False)
    parts = sorted(parts, key=lambda q: -q.volume)
    return mesh, parts


@pytest.fixture(scope="module", params=FILES, ids=[os.path.basename(f) for f in FILES])
def stl(request):
    info = parse(request.param)
    mesh, parts = bodies(request.param)
    return info, mesh, parts


def test_bodies_and_watertight(stl):
    info, mesh, parts = stl
    assert len(parts) == 2 + info["N"]
    for q in parts:
        assert q.is_watertight and q.is_winding_consistent and q.volume > 0
    pv = [q.volume for q in parts[2:]]
    assert max(pv) - min(pv) < 1e-6 * max(pv) + 1e-6       # identical planets


def test_volumes_match_freecad(stl):
    info, mesh, parts = stl
    if info["tag"] != FREECAD_DEFAULT["tag"]:
        pytest.skip("no FreeCAD reference for this layout")
    # identify by bounding radius: ring is outermost; sun centred
    ring, sun = parts[0], parts[1]
    for got, ref in ((ring.volume, FREECAD_DEFAULT["ring"]), (sun.volume, FREECAD_DEFAULT["sun"]),
                     (parts[2].volume, FREECAD_DEFAULT["planet"])):
        assert abs(got / ref - 1) < 0.01, (got, ref)


def _section(body, z):
    s = body.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None:
        return None
    p2, _ = s.to_2D(to_2D=np.eye(4))
    return unary_union(p2.polygons_full)


def test_no_interference_on_slices(stl):
    info, mesh, parts = stl
    H, e = info["H"], info["e"]
    ring, sun, planets = parts[0], parts[1], parts[2:]
    # mid-legs and the reversal plane, away from the chamfers
    zs = [0.31 * H, 0.5 * H + 1e-3, 0.69 * H]
    worst, mind = 0.0, 1e9
    for z in zs:
        R, S = _section(ring, z), _section(sun, z)
        for q in planets:
            Q = _section(q, z)
            worst = max(worst, Q.intersection(S).area, Q.intersection(R).area)
            mind = min(mind, Q.distance(S), Q.distance(R))
    assert worst < 1e-6, worst
    # transverse flank gap = PrintExpansion (minus chord error of the mesh)
    assert mind > 0.8 * e, mind
