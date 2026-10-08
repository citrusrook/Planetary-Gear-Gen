#!/usr/bin/env python3
"""Write golden JSON fixtures from the Python reference implementation.
Use them to verify a port (JS/TS web app) produces identical geometry/solver output."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "core"))
import pb_math as pm
from defaults import DEFAULTS


def dump(p, name, extra_solver_cases=()):
    g = pm.derive(p); prof = pm.build_profiles(p, g)
    th, spins, rr = pm.phasing(g)
    tw, hs = pm.helix_twist(g, p["beta"], p["H"], p["reversals"])
    out = dict(
        params=p,
        derived={k: (float(v) if not isinstance(v, int) else v) for k, v in g.items()},
        profiles={k: {kk: (vv.tolist() if hasattr(vv, "tolist") else vv) for kk, vv in v.items()}
                  for k, v in prof.items()},
        phasing=dict(orbit=th, spins=spins, ring_rot=rr),
        twist_samples=[[z, *tw(z)] for z in [i * p["H"] / 20 for i in range(21)]],
        report=pm.report(p, g, prof),
        solver=[],
    )
    for over, lock in extra_solver_cases:
        q = dict(p, **over)
        Zs, Zp, Zr, N, notes = pm.solve(q, lock)
        out["solver"].append(dict(input=over, lock=lock, out=dict(Zs=Zs, Zp=Zp, Zr=Zr, N=N), notes=notes))
    path = os.path.join(ROOT, "fixtures", name)
    json.dump(out, open(path, "w"), indent=1)
    print("wrote", path)


if __name__ == "__main__":
    dump(DEFAULTS, "default_profiles.json", [
        (dict(), None), (dict(N=20), "N"), (dict(N=25), "N"), (dict(N=40), "N"),
        (dict(Zr=70), "Zr"), (dict(Zs=50), "Zs"), (dict(Zp=5), "Zp"),
        (dict(hunting=True), None), (dict(OD=50), None), (dict(OD=50, Zp=8), "Zp"),
    ])
    big = dict(DEFAULTS, OD=60, ID=8, H=12, N=5, Zp=13, Zs=22, Zr=48, beta=25, reversals=3,
               hunting=True, sun_bore_shape="Hex", planet_bore_d=3.0)
    dump(big, "large_hex_profiles.json")
