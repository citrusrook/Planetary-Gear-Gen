"""Parametric herringbone planetary (gear) bearing for FreeCAD 1.x

Create:   import PlanetaryBearing; PlanetaryBearing.create()
          (or run the PlanetaryBearing.FCMacro)
Edit any property in the Property panel - tooth counts / planet count are
auto-corrected for compatibility (the property you just edited is held fixed
if possible). Read the 'Report' property for phasing / wear / mesh checks.
Set 'Export Now' = true (or 'Export On Recompute') to write STL files.
"""
import math
import os

import FreeCAD as App
import Part

import pb_math as pm

V = App.Vector

SUN_BORES = ["Round", "Hex", "Square", "D-Flat", "None"]
PLANET_BORES = ["Round", "Hex"]

# (type, name, group, doc, default)
PROPS = [
    ("App::PropertyLength", "OD", "1 Envelope", "Outer diameter of the ring", 31.7),
    ("App::PropertyLength", "ID", "1 Envelope", "Inner (sun bore) diameter. Hex/Square = across flats", 22.0),
    ("App::PropertyLength", "Height", "1 Envelope", "Bearing height", 5.0),

    ("App::PropertyIntegerConstraint", "PlanetCount", "2 Teeth", "Number of planets (equally spaced)", (24, 1, 120, 1)),
    ("App::PropertyIntegerConstraint", "PlanetTeeth", "2 Teeth", "Planet tooth count", (4, 4, 80, 1)),
    ("App::PropertyIntegerConstraint", "SunTeeth", "2 Teeth", "Sun tooth count", (56, 6, 300, 1)),
    ("App::PropertyIntegerConstraint", "RingTeeth", "2 Teeth", "Ring (internal) tooth count = Sun + 2*Planet", (64, 14, 460, 1)),
    ("App::PropertyFloatConstraint", "PressureAngle", "2 Teeth", "Pressure angle (deg)", (22.0, 10.0, 35.0, 0.5)),

    ("App::PropertyFloatConstraint", "HelixAngle", "3 Herringbone", "Helix angle at pitch cylinder (deg). 0 = spur", (30.0, 0.0, 60.0, 1.0)),
    ("App::PropertyIntegerConstraint", "Reversals", "3 Herringbone", "How many times the helix reverses over the height (1 = classic V, 0 = plain helical)", (1, 0, 50, 1)),

    ("App::PropertyFloatConstraint", "PrintExpansion", "4 Print tolerance", "Total flank gap per contact in mm (0.01 steps). Each of the 2 mating parts is pulled back by half. Also enlarges bores by half", (0.15, -0.5, 1.0, 0.01)),
    ("App::PropertyFloatConstraint", "RootClearance", "4 Print tolerance", "Radial clearance tooth tip -> mating root in mm (separate from PrintExpansion)", (0.15, 0.0, 1.0, 0.01)),
    ("App::PropertyFloatConstraint", "EdgeChamfer", "4 Print tolerance", "45 deg chamfer on tooth tips, OD and bore edges (top & bottom). Helps elephant foot / print-in-place", (0.3, 0.0, 2.0, 0.05)),
    ("App::PropertyFloatConstraint", "TipLand", "4 Print tolerance", "Minimum tooth top land in mm - pointed tips are truncated to this", (0.1, 0.0, 1.0, 0.01)),

    ("App::PropertyEnumeration", "SunBoreShape", "5 Bores", "Sun bore shape (size = ID)", SUN_BORES),
    ("App::PropertyFloatConstraint", "SunBoreFlat", "5 Bores", "D-Flat: distance from centre to flat as fraction of ID (0.4 = 5mm shaft w/ 4.5 flat)", (0.4, 0.05, 0.5, 0.01)),
    ("App::PropertyFloatConstraint", "PlanetBoreDiameter", "5 Bores", "Planet bore diameter (0 = solid planets). Hex = across flats", (0.0, 0.0, 100.0, 0.05)),
    ("App::PropertyEnumeration", "PlanetBoreShape", "5 Bores", "Planet bore shape", PLANET_BORES),

    ("App::PropertyBool", "EvenWear", "6 Phasing & wear", "Force hunting-tooth combos (gcd(sun,planet)=1) so every tooth meets every mating tooth", False),

    ("App::PropertyEnumeration", "ModuleMode", "7 Advanced", "Auto = planets centred in OD/ID annulus, module=(OD+ID)/(Zs+Zr)", ["Auto", "Manual"]),
    ("App::PropertyFloat", "Module", "7 Advanced", "Transverse module (used when ModuleMode = Manual; shows computed value otherwise)", 0.5),
    ("App::PropertyEnumeration", "ProfileShiftMode", "7 Advanced", "Auto = planet shift to avoid undercut (S0 scheme: sun -x, ring +x)", ["Auto", "Manual"]),
    ("App::PropertyFloat", "ProfileShift", "7 Advanced", "Planet profile shift coefficient x", 0.0),
    ("App::PropertyFloatConstraint", "MinPlanetGap", "7 Advanced", "Minimum gap between neighbouring planet tips (mm)", (0.3, 0.0, 5.0, 0.05)),
    ("App::PropertyFloatConstraint", "MinWall", "7 Advanced", "Minimum ring wall / sun rim (mm)", (0.5, 0.0, 10.0, 0.05)),
    ("App::PropertyFloatConstraint", "MinModule", "7 Advanced", "Smallest module the solver may use (mm)", (0.4, 0.05, 10.0, 0.05)),
    ("App::PropertyFloatConstraint", "SurfaceTolerance", "7 Advanced", "Max helix approximation error for lofts (mm)", (0.005, 0.0005, 0.05, 0.0005)),

    ("App::PropertyPath", "ExportFolder", "8 Export", "Folder for STL export", ""),
    ("App::PropertyBool", "ExportNow", "8 Export", "Set true -> exports STL(s) on recompute, then resets", False),
    ("App::PropertyBool", "ExportOnRecompute", "8 Export", "Export STL(s) on every recompute", False),
    ("App::PropertyBool", "ExportSeparateParts", "8 Export", "Also export ring / sun / planets as separate STLs", False),
    ("App::PropertyFloatConstraint", "MeshDeviation", "8 Export", "STL linear deflection (mm)", (0.01, 0.001, 0.2, 0.001)),
]
OUT_PROPS = [
    ("App::PropertyStringList", "Report", "6 Phasing & wear", "Compatibility, phasing, wear and mesh report"),
    ("App::PropertyString", "LastExport", "8 Export", "Last exported file"),
    ("App::PropertyFloat", "OrbitDiameter", "9 Computed", "Planet orbit (carrier) diameter"),
    ("App::PropertyFloat", "RatioSunToCarrier", "9 Computed", "Ring fixed: sun turns per carrier turn"),
]
LOCKS = {"PlanetCount": "N", "RingTeeth": "Zr", "SunTeeth": "Zs", "PlanetTeeth": "Zp"}
RESOLVE_TRIGGERS = set(LOCKS) | {"OD", "ID", "PressureAngle", "PrintExpansion", "RootClearance", "TipLand",
                                 "SunBoreShape", "EvenWear", "ModuleMode", "Module", "ProfileShiftMode",
                                 "ProfileShift", "MinPlanetGap", "MinWall", "MinModule"}


def _val(q):
    return q.Value if hasattr(q, "Value") else q


class PlanetaryBearing:
    def __init__(self, obj):
        self._busy = True
        obj.Proxy = self
        for typ, name, grp, doc, dflt in PROPS:
            if name not in obj.PropertiesList:
                obj.addProperty(typ, name, grp, doc)
                setattr(obj, name, dflt)
        for typ, name, grp, doc in OUT_PROPS:
            if name not in obj.PropertiesList:
                obj.addProperty(typ, name, grp, doc, 8 | 1)   # Output | ReadOnly
        obj.ExportFolder = os.path.join(os.path.expanduser("~"), "Documents", "PlanetaryBearing")
        self.notes = []
        self._busy = False

    # ---- persistence -------------------------------------------------------
    def dumps(self):
        return None

    def loads(self, state):
        self._busy = False
        self.notes = []

    # ---- parameters --------------------------------------------------------
    def params(self, obj):
        return dict(
            OD=_val(obj.OD), ID=_val(obj.ID) if obj.SunBoreShape != "None" else _val(obj.ID),
            H=_val(obj.Height), N=obj.PlanetCount, Zp=obj.PlanetTeeth, Zs=obj.SunTeeth, Zr=obj.RingTeeth,
            alpha=obj.PressureAngle, beta=obj.HelixAngle, reversals=obj.Reversals,
            expansion=obj.PrintExpansion, root_clear=obj.RootClearance, hunting=obj.EvenWear,
            min_planet_gap=obj.MinPlanetGap, min_wall=obj.MinWall, min_module=obj.MinModule,
            module_auto=(obj.ModuleMode == "Auto"), module=obj.Module,
            shift_auto=(obj.ProfileShiftMode == "Auto"), shift=obj.ProfileShift, tip_land=obj.TipLand,
            sun_bore_shape=obj.SunBoreShape, planet_bore_d=obj.PlanetBoreDiameter,
            planet_bore_shape=obj.PlanetBoreShape,
        )

    def onChanged(self, obj, prop):
        if getattr(self, "_busy", True) or "Restore" in obj.State:
            return
        if prop not in RESOLVE_TRIGGERS:
            return
        try:
            self.resolve(obj, LOCKS.get(prop))
        except Exception as e:  # never break the property editor
            App.Console.PrintError("PlanetaryBearing solver: %s\n" % e)

    def resolve(self, obj, lock):
        p = self.params(obj)
        Zs, Zp, Zr, N, notes = pm.solve(p, lock)
        self._busy = True
        try:
            for name, v in (("PlanetTeeth", Zp), ("SunTeeth", Zs), ("RingTeeth", Zr), ("PlanetCount", N)):
                if getattr(obj, name) != v:
                    setattr(obj, name, v)
        finally:
            self._busy = False
        self.notes = notes
        for n in notes:
            App.Console.PrintWarning("PlanetaryBearing: %s\n" % n)

    # ---- geometry ----------------------------------------------------------
    def execute(self, obj):
        p = self.params(obj)
        # make sure the stored values are consistent even if set by script
        if (p["Zs"] + 2 * p["Zp"] != p["Zr"]) or (p["Zs"] + p["Zr"]) % p["N"]:
            self.resolve(obj, None)
            p = self.params(obj)
        g = pm.derive(p)
        prof = pm.build_profiles(p, g)
        parts = build_parts(p, g, prof, obj.EdgeChamfer, obj.SunBoreFlat, obj.SurfaceTolerance)
        obj.Shape = Part.makeCompound([parts["ring"], parts["sun"]] + parts["planets"])
        rep = pm.report(p, g, prof, getattr(self, "notes", []))
        self.notes = []
        obj.Report = rep
        obj.OrbitDiameter = 2 * g["a"]
        obj.RatioSunToCarrier = 1 + g["Zr"] / g["Zs"]
        if obj.ModuleMode == "Auto":
            self._busy = True
            obj.Module = round(g["m"], 6)
            self._busy = False
        if obj.ProfileShiftMode == "Auto":
            self._busy = True
            obj.ProfileShift = round(g["x"], 6)
            self._busy = False
        self._colour(obj, parts)
        if obj.ExportNow or obj.ExportOnRecompute:
            self.export(obj, parts, g)
            if obj.ExportNow:
                self._busy = True
                obj.ExportNow = False
                self._busy = False

    def _colour(self, obj, parts):
        if not App.GuiUp:
            return
        try:
            cols = ([(0.80, 0.80, 0.85)] * len(parts["ring"].Faces) +
                    [(0.95, 0.60, 0.15)] * len(parts["sun"].Faces))
            for q in parts["planets"]:
                cols += [(0.25, 0.55, 0.90)] * len(q.Faces)
            obj.ViewObject.DiffuseColor = cols
        except Exception:
            pass

    def export(self, obj, parts, g):
        import MeshPart
        folder = obj.ExportFolder or os.path.join(os.path.expanduser("~"), "Documents", "PlanetaryBearing")
        os.makedirs(folder, exist_ok=True)
        tag = "OD%g_ID%g_H%g_S%dP%dx%dR%d_b%g_e%g" % (
            _val(obj.OD), _val(obj.ID), _val(obj.Height), g["Zs"], g["Zp"], g["N"], g["Zr"],
            obj.HelixAngle, obj.PrintExpansion)
        dev = obj.MeshDeviation

        def write(shape, name):
            mesh = MeshPart.meshFromShape(Shape=shape, LinearDeflection=dev, AngularDeflection=0.2, Relative=False)
            path = os.path.join(folder, name)
            mesh.write(path)
            return path, mesh.CountFacets

        path, nf = write(Part.makeCompound([parts["ring"], parts["sun"]] + parts["planets"]),
                         "PlanetaryBearing_%s.stl" % tag)
        msgs = ["%s (%d facets)" % (path, nf)]
        if obj.ExportSeparateParts:
            msgs.append(write(parts["ring"], "Ring_%s.stl" % tag)[0])
            msgs.append(write(parts["sun"], "Sun_%s.stl" % tag)[0])
            msgs.append(write(Part.makeCompound(parts["planets"]), "Planets_%s.stl" % tag)[0])
        obj.LastExport = path
        App.Console.PrintMessage("PlanetaryBearing exported:\n  " + "\n  ".join(msgs) + "\n")


# --------------------------------------------------------------------------
#  B-rep construction
# --------------------------------------------------------------------------
def _split_kinks(pts, deg=15.0):
    """Split a polyline at sharp direction changes (trochoid/involute junction)."""
    out, cur = [], [pts[0]]
    for i in range(1, len(pts) - 1):
        cur.append(pts[i])
        a = pts[i] - pts[i - 1]
        b = pts[i + 1] - pts[i]
        na, nb = a.Length, b.Length
        if na > 1e-9 and nb > 1e-9:
            c = max(-1.0, min(1.0, a.dot(b) / (na * nb)))
            if math.degrees(math.acos(c)) > deg and len(cur) >= 2:
                out.append(cur)
                cur = [pts[i]]
    cur.append(pts[-1])
    out.append(cur)
    return out


def _curve_edges(pts):
    edges = []
    for seg in _split_kinks(pts):
        # drop near-duplicate points
        clean = [seg[0]]
        for q in seg[1:]:
            if (q - clean[-1]).Length > 1e-7:
                clean.append(q)
        if len(clean) < 2:
            continue
        if len(clean) == 2:
            edges.append(Part.LineSegment(clean[0], clean[1]).toShape())
        else:
            c = Part.BSplineCurve()
            c.interpolate(clean)
            edges.append(c.toShape())
    return edges


def _arc(r, a0, a1):
    if abs(a1 - a0) < 1e-9:
        return []
    am = 0.5 * (a0 + a1)
    return [Part.Arc(V(r * math.cos(a0), r * math.sin(a0), 0), V(r * math.cos(am), r * math.sin(am), 0),
                     V(r * math.cos(a1), r * math.sin(a1), 0)).toShape()]


def _pol(r, a):
    return V(r * math.cos(a), r * math.sin(a), 0)


def external_wire(prof):
    Z, r, t, rf = prof["Z"], prof["r"], prof["t"], prof["rf"]
    pitch = 2 * math.pi / Z
    right = [_pol(ri, -ti) for ri, ti in zip(r, t)]
    left = [_pol(ri, ti) for ri, ti in zip(r[::-1], t[::-1])]
    tooth = _curve_edges(right) + _arc(r[-1], -t[-1], t[-1]) + _curve_edges(left) + _arc(r[0], t[0], pitch - t[0])
    edges = []
    for k in range(Z):
        for e in tooth:
            ee = e.copy()
            ee.rotate(V(0, 0, 0), V(0, 0, 1), math.degrees(k * pitch))
            edges.append(ee)
    return Part.Wire(edges)


def ring_wire(prof):
    Z, r, t = prof["Z"], prof["r"], prof["t"]
    pitch = 2 * math.pi / Z
    up = [_pol(ri, ti) for ri, ti in zip(r, t)]
    down = [_pol(ri, pitch - ti) for ri, ti in zip(r[::-1], t[::-1])]
    tooth = _arc(r[0], -t[0], t[0]) + _curve_edges(up) + _arc(r[-1], t[-1], pitch - t[-1]) + _curve_edges(down)
    edges = []
    for k in range(Z):
        for e in tooth:
            ee = e.copy()
            ee.rotate(V(0, 0, 0), V(0, 0, 1), math.degrees(k * pitch))
            edges.append(ee)
    return Part.Wire(edges)


def twisted_loft(wire, H, twist_fn, hs, rmax, tol, base_rot=0.0):
    """Solid swept along z with the section rotated by twist_fn(z) (+base_rot), radians.

    Built from explicit ruled faces (edge i of section j -> edge i of section j+1) and
    sewn, instead of Part.makeLoft: OCC's loft re-pairs edges of the many-tooth wires
    ('compatible wires' origin search) and silently skews the teeth.
    Ruled-face sag is kept below `tol` (mm) by the number of sections per leg.
    """
    legs = max(1, int(round(H / hs)))
    twist_leg = abs(twist_fn(hs) - twist_fn(0.0))
    dphi = 2 * math.acos(max(-1.0, 1 - tol / max(rmax, 1e-6)))
    k = max(1, int(math.ceil(twist_leg / max(dphi, 1e-6)))) if twist_leg > 1e-12 else 1
    zs = []
    for L in range(legs):
        for j in range(k):
            zs.append(L * hs + hs * j / k)
    zs.append(H)
    base = wire.OrderedEdges
    secs = []
    for z in zs:
        ang = math.degrees(twist_fn(z) + base_rot)
        es = []
        for e in base:
            c = e.copy()
            c.rotate(V(0, 0, 0), V(0, 0, 1), ang)
            c.translate(V(0, 0, z))
            es.append(c)
        secs.append(es)
    faces = [Part.makeRuledSurface(ea, eb) for A, B in zip(secs[:-1], secs[1:]) for ea, eb in zip(A, B)]
    faces.append(Part.Face(Part.Wire(secs[0])))
    faces.append(Part.Face(Part.Wire(secs[-1])))
    sh = Part.Shell(faces)
    sh.sewShape()
    so = Part.Solid(sh)
    if so.Volume < 0:
        so.reverse()
    return so


def _revolve(pts_rz):
    pts = [V(r, 0, z) for r, z in pts_rz]
    w = Part.makePolygon(pts + [pts[0]])
    return Part.Face(w).revolve(V(0, 0, 0), V(0, 0, 1), 360)


def ext_tip_chamfer_cut(ra, ch, H):
    """Two rings that remove a 45deg chamfer from external tooth tips at both faces."""
    e = 0.01
    R = ra + 1.0
    b = _revolve([(ra - ch - e, -e), (R, -e), (R, ch + e), (ra + e, ch + e)])
    t = _revolve([(ra + e, H - ch - e), (R, H - ch - e), (R, H + e), (ra - ch - e, H + e)])
    return [b, t]


def hole_chamfer_cut(rh, ch, H):
    """Solids that remove a 45deg chamfer from a hole edge of radius rh at both faces."""
    e = 0.01
    b = _revolve([(0, -e), (rh + ch + e, -e), (rh - e, ch + e), (0, ch + e)])
    t = _revolve([(0, H - ch - e), (rh - e, H - ch - e), (rh + ch + e, H + e), (0, H + e)])
    return [b, t]


def bore_solid(shape, dia, comp, H, flat_frac=0.4):
    e = 0.05
    r = dia / 2.0 + comp
    if shape == "Round":
        return Part.makeCylinder(r, H + 2 * e, V(0, 0, -e))
    if shape in ("Hex", "Square"):
        n = 6 if shape == "Hex" else 4
        R = r / math.cos(math.pi / n)
        pts = [V(R * math.cos(2 * math.pi * i / n + (math.pi / n if n == 4 else 0)),
                 R * math.sin(2 * math.pi * i / n + (math.pi / n if n == 4 else 0)), -e) for i in range(n)]
        return Part.Face(Part.makePolygon(pts + [pts[0]])).extrude(V(0, 0, H + 2 * e))
    if shape == "D-Flat":
        cyl = Part.makeCylinder(r, H + 2 * e, V(0, 0, -e))
        fx = flat_frac * dia + comp
        box = Part.makeBox(2 * r, 4 * r, H + 4 * e, V(fx, -2 * r, -2 * e))
        return cyl.cut(box)
    return None


def build_parts(p, g, prof, ch, flat_frac, tol):
    H = p["H"]
    d = g["d"]
    twist, hs = pm.helix_twist(g, p["beta"], H, p["reversals"])
    th, spins, ring_rot = pm.phasing(g)

    # ---------------- sun  (one multi-tool boolean)
    sp = prof["sun"]
    sun = twisted_loft(external_wire(sp), H, lambda z: twist(z)[0], hs, sp["ra"], tol)
    tools = []
    if ch > 0:
        tools += ext_tip_chamfer_cut(sp["ra"], ch, H)
    if p["sun_bore_shape"] != "None" and p["ID"] > 0:
        tools.append(bore_solid(p["sun_bore_shape"], p["ID"], d, H, flat_frac))
        if ch > 0:
            tools += hole_chamfer_cut(p["ID"] / 2 + d, ch, H)
    if tools:
        sun = sun.cut(tools)
    sun = sun.Solids[0] if sun.Solids else sun

    # ---------------- ring
    rp_ = prof["ring"]
    R = p["OD"] / 2.0
    c2 = min(ch, 0.45 * (R - rp_["ro"])) if ch > 0 else 0
    if c2 > 0:
        body = _revolve([(0, 0), (R - c2, 0), (R, c2), (R, H - c2), (R - c2, H), (0, H)])
    else:
        body = Part.makeCylinder(R, H)
    hole = twisted_loft(ring_wire(rp_), H, lambda z: twist(z)[2], hs, rp_["ro"], tol, base_rot=ring_rot)
    tools = [hole] + (hole_chamfer_cut(rp_["ri"], ch, H) if ch > 0 else [])
    ring = body.cut(tools)
    ring = ring.Solids[0] if ring.Solids else ring

    # ---------------- planet (one, then copies)
    pp = prof["planet"]
    pl = twisted_loft(external_wire(pp), H, lambda z: twist(z)[1], hs, pp["ra"], tol)
    pch = min(ch, 0.5 * (pp["ra"] - pp["rf"])) if ch > 0 else 0
    tools = ext_tip_chamfer_cut(pp["ra"], pch, H) if pch > 0 else []
    if p["planet_bore_d"] > 0:
        tools.append(bore_solid(p["planet_bore_shape"], p["planet_bore_d"], d, H))
        bch = min(ch, 0.2)
        if bch > 0:
            tools += hole_chamfer_cut(p["planet_bore_d"] / 2 + d, bch, H)
    if tools:
        pl = pl.cut(tools)
    pl = pl.Solids[0] if pl.Solids else pl
    planets = []
    for a, s in zip(th, spins):
        q = pl.copy()
        q.Placement = App.Placement(V(g["a"] * math.cos(a), g["a"] * math.sin(a), 0),
                                    App.Rotation(V(0, 0, 1), math.degrees(s)))
        planets.append(q)
    return dict(ring=ring, sun=sun, planets=planets)


# --------------------------------------------------------------------------
def create(doc=None, name="PlanetaryBearing"):
    doc = doc or App.ActiveDocument or App.newDocument("PlanetaryBearing")
    obj = doc.addObject("Part::FeaturePython", name)
    PlanetaryBearing(obj)
    if App.GuiUp:
        obj.ViewObject.Proxy = 0
    obj.Proxy.resolve(obj, None)
    doc.recompute()
    return obj
