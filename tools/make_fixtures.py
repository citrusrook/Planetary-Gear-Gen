#!/usr/bin/env python3
"""Write golden JSON fixtures from the Python reference implementation.
Use them to verify a port (JS/TS web app) produces identical geometry/solver output."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "core"))
import pb_math as pm
from defaults import DEFAULTS, DEFAULTS_V1


def _prof(prof):
    return {k: {kk: (vv.tolist() if hasattr(vv, "tolist") else vv) for kk, vv in v.items()} for k, v in prof.items()}


def dump(p, name, extra_solver_cases=()):
    g = pm.derive(p); prof = pm.build_profiles(p, g)
    th, spins, rr = pm.phasing(g)
    tw, hs = pm.helix_twist(g, p["beta"], p["H"], p["reversals"])
    out = dict(
        params=p,
        derived={k: (float(v) if not isinstance(v, int) else v) for k, v in g.items()},
        profiles=_prof(prof),
        phasing=dict(orbit=th, spins=spins, ring_rot=rr),
        twist_samples=[[z, *tw(z)] for z in [i * p["H"] / 20 for i in range(21)]],
        report=pm.report(p, g, prof),
        solver=[],
    )
    if pm.taper_half(p, g["m"]):
        # per-height profiles of the tapered bearing (profile shift x0 + dx(z))
        out["taper_sections"] = []
        for z in [i * p["H"] / 8 for i in range(9)]:
            dx = pm.taper_dx(p, g["m"], z)
            gz = pm.derive(p, dx=dx)
            out["taper_sections"].append(dict(z=z, dx=dx, x=gz["x"], profiles=_prof(pm.build_profiles(p, gz))))
    for over, lock in extra_solver_cases:
        q = dict(p, **over)
        Zs, Zp, Zr, N, notes = pm.solve(q, lock)
        out["solver"].append(dict(input=over, lock=lock, out=dict(Zs=Zs, Zp=Zp, Zr=Zr, N=N), notes=notes))
    path = os.path.join(ROOT, "fixtures", name)
    json.dump(out, open(path, "w"), indent=1)
    print("wrote", path)


if __name__ == "__main__":
    dump(DEFAULTS, "default_profiles.json", [
        (dict(), None), (dict(N=10), "N"), (dict(N=13), "N"), (dict(N=40), "N"),
        (dict(Zr=45), "Zr"), (dict(Zs=25), "Zs"), (dict(Zp=5), "Zp"),
        (dict(hunting=True), None), (dict(OD=50), None), (dict(OD=50, Zp=8), "Zp"),
        (dict(od_tex="Diamond knurl", od_tex_depth=0.3), None), (dict(bore_tex="Dimples", bore_tex_depth=0.6), None),
        (dict(taper=3.0), None), (dict(taper=3.0, taper_mirror=True), "N"),
    ])
    # V1 defaults: the FreeCAD B-rep export of these is the mesh-volume reference
    dump(DEFAULTS_V1, "v1_default_profiles.json", [(dict(), None), (dict(N=25), "N"), (dict(Zs=50), "Zs")])
    big = dict(DEFAULTS, OD=60, ID=8, H=12, N=5, Zp=13, Zs=22, Zr=48, beta=25, reversals=3,
               hunting=True, sun_bore_shape="Hex", planet_bore_d=3.0)
    dump(big, "large_hex_profiles.json")
    # lazy-susan style: big and flat, mirrored taper, knurled OD, dimpled bore
    susan = dict(DEFAULTS, OD=120, ID=90, H=6, N=14, Zp=12, Zs=108, Zr=132, taper=5.0, taper_mirror=True,
                 od_tex="Straight knurl", od_tex_depth=0.3, bore_tex="Ovals", bore_tex_depth=0.3)
    s = pm.solve(susan, None)
    susan.update(Zs=s[0], Zp=s[1], Zr=s[2], N=s[3])
    dump(susan, "taper_susan_profiles.json", [(dict(), None), (dict(taper=8.0), None), (dict(taper_flip=True, N=12), "N")])
