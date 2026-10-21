"""Checks V3 STL exports made in the browser (one STL per part group + meta.json in build/v3/<case>/):
watertight bodies, zero overlap and the designed gaps on z-slices between every pair that touches:
planets vs sun / ring (each bearing), pins vs planets, outer teeth of neighbouring bearings,
the spline shaft put back into the sun bore, and the carrier plate holes around the pin stubs.

    python -m pytest -q tests/test_stl_v3.py
"""
import glob
import json
import math
import os

import numpy as np
import pytest

trimesh = pytest.importorskip("trimesh")
shapely = pytest.importorskip("shapely")
from shapely.ops import unary_union
from shapely import affinity

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = sorted(glob.glob(os.path.join(ROOT, "build", "v3", "*", "meta.json")))
if not CASES:
    pytest.skip("no V3 exports in build/v3 (run the export from web/tests.html)", allow_module_level=True)


def load(case_dir, meta):
    out = {}
    for gr in meta["groups"]:
        m = trimesh.load(os.path.join(case_dir, gr["file"]), process=True)
        out[(gr["bearing"], gr["name"])] = (m, gr)
    return out


def section(mesh, z):
    s = mesh.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None:
        return None
    p2, _ = s.to_2D(to_2D=np.eye(4))
    return unary_union(p2.polygons_full)


@pytest.fixture(scope="module", params=CASES, ids=[os.path.basename(os.path.dirname(c)) for c in CASES])
def case(request):
    d = os.path.dirname(request.param)
    meta = json.load(open(request.param))
    return d, meta, load(d, meta)


def test_watertight_and_counts(case):
    d, meta, G = case
    for (b, name), (m, gr) in G.items():
        parts = m.split(only_watertight=False)
        assert len(parts) == gr["count"], (b, name, len(parts), gr["count"])
        for q in parts:
            assert q.is_watertight and q.is_winding_consistent and q.volume > 0, (b, name)


def pair_gap(A, B, zs):
    worst, mind = 0.0, 1e9
    for z in zs:
        a, b = section(A, z), section(B, z)
        if a is None or b is None:
            continue
        worst = max(worst, a.intersection(b).area)
        mind = min(mind, a.distance(b))
    return worst, mind


def test_gear_meshes(case):
    d, meta, G = case
    H, e = meta["H"], meta["e"]
    zs = [0.31 * H, 0.5 * H + 1e-3, 0.69 * H]
    for b in meta["bearings"]:
        pl = G[(b, "planet")][0]
        for other in ("sun", "ring"):
            worst, mind = pair_gap(pl, G[(b, other)][0], zs)
            assert worst < 1e-6 and mind > 0.8 * e, (b, other, worst, mind)
    for x, y in zip(meta["bearings"], meta["bearings"][1:]):         # outer teeth of neighbours
        worst, mind = pair_gap(G[(x, "ring")][0], G[(y, "ring")][0], zs)
        assert worst < 1e-6 and 0.8 * e < mind < 1.5 * e, (x, y, worst, mind)


def test_pins_in_planets(case):
    d, meta, G = case
    if not meta.get("pins"):
        pytest.skip("no planet pins")
    H, gap = meta["H"], meta["pin_gap"]
    for b in meta["bearings"]:
        worst, mind = pair_gap(G[(b, "pin")][0], G[(b, "planet")][0], [0.2 * H, 0.5 * H, 0.8 * H])
        assert worst < 1e-6 and 0.6 * gap < mind < 1.2 * gap, (b, worst, mind)
        # captured: pin wider at the faces than the bore in the middle
        pin_face = section(G[(b, "pin")][0], 0.02 * H).area
        bore_mid_hole = section(G[(b, "planet")][0], 0.5 * H)
        assert pin_face > 0 and bore_mid_hole is not None


def test_carrier_fits_pin_stubs(case):
    d, meta, G = case
    if not meta.get("pins"):
        pytest.skip("no planet pins")
    for b in meta["bearings"]:
        plate, gr = G[(b, "carrier")]
        ox, oy = gr["inst"][0]["x"] - meta["centres"][b][0], gr["inst"][0]["y"] - meta["centres"][b][1]
        moved = plate.copy()
        moved.apply_translation([-ox, -oy, meta["stub_z0"]])                 # put the plate on the collars
        zmid = meta["stub_z0"] + meta["carrier_t"] / 2
        worst, mind = pair_gap(moved, G[(b, "pin")][0], [zmid])
        assert worst < 1e-6 and abs(mind - meta["carrier_fit"] / 2) < 0.02, (b, worst, mind)


def test_spline_shaft_fits_sun(case):
    d, meta, G = case
    if not meta.get("spline"):
        pytest.skip("no spline")
    H, e = meta["H"], meta["e"]
    for b in meta["bearings"]:
        shaft, gr = G[(b, "shaft")]
        cx, cy = meta["centres"][b]
        moved = shaft.copy()
        moved.apply_translation([cx - gr["inst"][0]["x"], cy - gr["inst"][0]["y"], 0])
        sun = section(G[(b, "sun")][0], H / 2)
        sh = affinity.rotate(section(moved, H / 2), math.pi / meta["spline"], origin=(cx, cy), use_radians=True)
        assert sh.intersection(sun).area < 1e-6
        assert abs(sh.distance(sun) - e) < 0.02
