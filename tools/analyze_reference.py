"""Decode a gear-bearing STL: bodies, tooth counts (FFT of radius vs angle), planet orbit, helix phase.
usage: python tools/analyze_reference.py reference/micro-gear_ring_22.stl   (needs trimesh, numpy)"""
import sys
import numpy as np
import trimesh

m = trimesh.load(sys.argv[1])
parts = sorted(m.split(only_watertight=False), key=lambda p: -p.volume)
c = m.bounds.mean(0)[:2]
print("bounds", np.round(m.bounds, 3).tolist(), "bodies", len(parts))


def loops(p, z, cc):
    s = p.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    out = []
    for e in s.discrete:
        d = e[:, :2] - cc
        out.append((np.hypot(*d.T), np.arctan2(d[:, 1], d[:, 0])))
    return out


def teeth(r, a):
    o = np.argsort(a)
    g = np.linspace(-np.pi, np.pi, 20000, endpoint=False)
    rr = np.interp(g, a[o], r[o], period=2 * np.pi)
    F = np.abs(np.fft.rfft(rr - rr.mean()))
    return int(np.argmax(F[2:]) + 2)


zmid = m.bounds[:, 2].mean()
for name, p, cc in (("outer", parts[0], c), ("inner", parts[1], c), ("small", parts[2], parts[2].bounds.mean(0)[:2])):
    for i, (r, a) in enumerate(loops(p, zmid, cc)):
        print(name, "loop", i, "rmin %.3f rmax %.3f teeth %d" % (r.min(), r.max(), teeth(r, a)))
cents = np.array([q.bounds.mean(0)[:2] for q in parts[2:]])
print("small bodies", len(cents), "orbit r %.4f" % np.hypot(*(cents - c).T).mean())
