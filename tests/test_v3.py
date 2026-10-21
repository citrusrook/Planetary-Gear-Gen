"""V3: wall limits / Fit-walls module, flank-angle taper, spline bore, planet pins,
external teeth and gear trains (incl. a 2D kinematic check of the external meshes)."""
import math
import numpy as np
import pytest
import pb_math as pm
from defaults import DEFAULTS, DEFAULTS_V2

shapely = pytest.importorskip("shapely")
from shapely.geometry import Polygon
from shapely import affinity


def P(**kw):
    p = dict(DEFAULTS); p.update(kw); return p


def solved(p):
    Zs, Zp, Zr, N, notes = pm.solve(p, None)
    q = dict(p, Zs=Zs, Zp=Zp, Zr=Zr, N=N)
    assert pm.feasible(q, Zs, Zp, N)[0], pm.feasible(q, Zs, Zp, N, why=True)
    return q


def test_v3_defaults():
    assert DEFAULTS["root_clear"] == 0.08 and DEFAULTS["expansion"] == 0.1 and DEFAULTS["min_module"] == 0.5
    q = solved(P())
    assert (q["Zs"], q["Zp"], q["Zr"], q["N"]) == (31, 4, 39, 14)
    assert DEFAULTS_V2["root_clear"] == 0.1


def test_old_parameter_sets_still_work():
    # FreeCAD object passes min_wall / module_auto
    p = {k: v for k, v in P().items() if k not in ("ring_wall_min", "sun_wall_min", "module_mode")}
    p.update(min_wall=0.5, module_auto=True)
    assert pm.module_mode(p) == "Auto" and pm.wall_limits(p)[:3:2] == (0.5, 0.5)
    assert pm.solve(p, None)[:4] == (31, 4, 39, 14)


def test_taper_angle_is_the_flank_angle():
    p = P(OD=60, ID=30, H=8, Zp=10, Zs=60, Zr=80, N=14, taper=2.0)
    g = pm.derive(p)
    al = math.radians(p["alpha"])
    k = pm.taper_rate(p, g["m"])
    # a shift dx moves the flank along its normal by dx*m*sin(alpha): lean = atan(k*m*sin(alpha))
    assert abs(math.degrees(math.atan(k * g["m"] * math.sin(al))) - 2.0) < 1e-9
    # measured on the generated profiles: the flank point at the pitch circle moves sideways (along
    # the arc) by dx*m*tan(alpha) per side; along its normal that is dx*m*sin(alpha)
    dz = 1.0
    pr0 = pm.build_profiles(p, pm.derive(p, dx=0.0))["planet"]
    pr1 = pm.build_profiles(p, pm.derive(p, dx=k * dz))["planet"]
    rp = g["rp"]
    t0, t1 = np.interp(rp, pr0["r"], pr0["t"]), np.interp(rp, pr1["r"], pr1["t"])
    normal = (t1 - t0) * rp * math.cos(al)
    assert abs(math.degrees(math.atan(normal / dz)) - 2.0) < 0.05


def test_wall_limits_separate():
    q = solved(P(ring_wall_max=0.7))
    wall, rim = pm.walls(q, pm.derive(q))
    assert 0.5 <= wall <= 0.7 and rim >= 0.5
    q = solved(P(sun_wall_min=1.0))
    wall, rim = pm.walls(q, pm.derive(q))
    assert rim >= 1.0 and wall >= 0.5


def test_fit_walls_module():
    q = solved(P(module_mode="Walls", ring_wall=1.2, sun_wall=0.6))
    g = pm.derive(q)
    wall, rim = pm.walls(q, g)
    assert abs(wall - 1.2) <= g["m"] / 2 + 1e-9 and abs(rim - 0.6) <= g["m"] / 2 + 1e-9
    # the teeth fill the zone exactly: ring wall + sun rim = targets
    assert abs((wall + rim) - 1.8) < 1e-9


def test_spline_bore_and_shaft_clear():
    p = P(sun_bore_shape="Spline", ID=10.0, spline_teeth=12)
    sg, bore, shaft = pm.spline_profiles(p)
    assert abs(sg["m"] - 10.0 / 12) < 1e-12 and sg["ro_r"] > sg["ri_r"]
    assert abs(pm.sun_bore_radius(p) - sg["ro_r"]) < 1e-12
    hole = Polygon(pm.ring_hole_polygon(bore)).buffer(0)
    disk = Polygon([(8 * math.cos(a), 8 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 200)])
    sun = disk.difference(hole)
    sh = affinity.rotate(Polygon(pm.external_polygon(shaft)).buffer(0), math.pi / sg["Z"], origin=(0, 0), use_radians=True)
    assert sh.intersection(sun).area == 0.0
    assert abs(sh.distance(sun) - p["expansion"]) < 0.01


def test_planet_pins_force_bigger_planets():
    p = P(OD=60, ID=20, H=8, planet_pins=True, pin_d=3.0)
    q = solved(p)
    g = pm.derive(q)
    pg = pm.pin_geometry(q)
    assert pg["captured"] and g["rf_p"] - pg["bore_face"] >= pm.PIN_RIM - 1e-9
    assert q["Zp"] > 4                               # 4-tooth planets cannot hold a 3 mm pin


def mesh_pair(ga, gb, rot_a, rot_b, a, prof_a, prof_b, steps=13):
    A = Polygon(pm.external_polygon(prof_a)).buffer(0)
    B = Polygon(pm.external_polygon(prof_b)).buffer(0)
    worst, mind = 0.0, 1e9
    for t in np.linspace(0, 2 * math.pi / ga["Z"] * 2, steps):
        qa = affinity.rotate(A, rot_a + t, origin=(0, 0), use_radians=True)
        qb = affinity.rotate(B, rot_b - t * ga["Z"] / gb["Z"], origin=(0, 0), use_radians=True)
        qb = affinity.translate(qb, a, 0)
        worst = max(worst, qa.intersection(qb).area)
        mind = min(mind, qa.distance(qb))
    return worst, mind


def ext_prof(q):
    ge = pm.ext_geometry(q)
    r, t, rf, ra = pm.rack_envelope(ge["Z"], ge["m"], ge["alpha"], 0.0, ge["c"], ge["d"], ge["ra"], q["tip_land"])
    return ge, dict(r=r, t=t, rf=rf, ra=ra, Z=ge["Z"])


@pytest.mark.parametrize("train", [dict(train="A-B", ratio_ab=1.5), dict(train="A-B-C", ratio_ab=0.0, B_OD=26, B_ID=10, ratio_bc=2.0, C_ID=18, train_angle=70)])
def test_train_external_meshes(train):
    p = P(OD=40, ID=20, ext_teeth=True, ext_module=1.0, **train)
    lay, notes = pm.train_layout(p)
    assert len(lay) == {"A-B": 2, "A-B-C": 3}[p["train"]]
    if p.get("ratio_ab"):
        assert lay[1]["Ze"] == round(lay[0]["Ze"] * 1.5)
    for x, y in zip(lay, lay[1:]):
        gx, px = ext_prof(x["p"])
        gy, py = ext_prof(y["p"])
        dxy = (y["cx"] - x["cx"], y["cy"] - x["cy"])
        a = math.hypot(*dxy)
        assert abs(a - (gx["rp"] + gy["rp"])) < 1e-9
        phi = math.atan2(dxy[1], dxy[0])
        # rotate the pair so the centre line is +x
        worst, mind = mesh_pair(gx, gy, x["rot"] - phi, y["rot"] - phi, a, px, py)
        assert worst == 0.0 and abs(mind - p["expansion"]) < 0.01, (worst, mind)
        assert y["hand"] == -x["hand"]
    for b in lay:
        q = b["p"]
        assert pm.feasible(q, q["Zs"], q["Zp"], q["N"])[0]


def test_ext_teeth_wall_measured_to_outer_root():
    q = solved(P(OD=40, ID=20, ext_teeth=True, ext_module=1.0))
    ge = pm.ext_geometry(q)
    wall, rim = pm.walls(q, pm.derive(q))
    assert abs(wall - (ge["rf"] - pm.derive(q)["ro_r"])) < 1e-12 and wall >= 0.5
    assert pm.tex_depth(dict(q, od_tex="Diamond knurl"), "od") == 0.0     # no OD texture on teeth
