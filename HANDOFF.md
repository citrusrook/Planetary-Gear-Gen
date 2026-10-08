# Handoff: parametric herringbone planetary bearing

Owner: Isaac. This was built in a Claude session with the FreeCAD MCP connector on 2026-10-08. This file has everything a new session needs to keep going.

---

## 1. Goal

This is a **3D-printable, print-in-place planetary gear bearing**: a ring, a sun and N planets, with herringbone teeth. It is fully parametric. Changing one value updates the values that depend on it, so the design stays assemblable, and the output is a ready-to-print STL.

Parameters the user asked for:

| Param | Name in code (`p` dict / FreeCAD property) | Notes |
|---|---|---|
| OD | `OD` / `OD` | ring outer diameter |
| ID | `ID` / `ID` | **sun bore** size (across flats for hex/square) |
| height | `H` / `Height` | |
| planet count | `N` / `PlanetCount` | equally spaced, always |
| planet teeth | `Zp` / `PlanetTeeth` | min 4 |
| ring teeth | `Zr` / `RingTeeth` | always `Zs + 2*Zp` |
| sun teeth | `Zs` / `SunTeeth` | |
| pressure angle | `alpha` / `PressureAngle` | default **22°** |
| helix angle | `beta` / `HelixAngle` | at pitch cylinder, 0 = spur |
| herringbone reversals | `reversals` / `Reversals` | number of direction changes over the height; 1 = classic V, 0 = plain helical |
| print shrink/expansion | `expansion` / `PrintExpansion` | mm in 0.01 steps. This is the **total gap per contact**; each of the two mating parts is pulled back by `expansion/2` |
| root↔tip clearance | `root_clear` / `RootClearance` | radial, on top of expansion |
| even-wear setting | `hunting` / `EvenWear` | forces gcd(Zs,Zp)=1 |
| bores | `sun_bore_shape` (Round/Hex/Square/D-Flat/None), `planet_bore_d`, `planet_bore_shape` (Round/Hex) | D-flat uses `SunBoreFlat` (fraction of ID, default 0.4) |
| phasing report | `report()` / `Report` | spacing, hunting-tooth or isolated wear paths, mesh timing |

Extra parameters added during the build: `tip_land` (pointed tips are truncated to this land), `min_planet_gap`, `min_wall`, `min_module`, Auto/Manual `module`, Auto/Manual profile `shift`, `EdgeChamfer`, `SurfaceTolerance`, `MeshDeviation`.

## 2. Status

- **Done, verified:** the Python core (`core/pb_math.py`), the FreeCAD FeaturePython object, STL export, and the tests (21 passing).
- **Installed on Isaac's PC:** `%APPDATA%\FreeCAD\v1-1\Mod\PlanetaryBearing\` (FreeCAD 1.1.4, Windows, Python 3.11 with numpy and shapely), plus the macro in `%APPDATA%\FreeCAD\v1-1\Macro\`.
- **Saved outputs on Isaac's PC:** `Documents\PlanetaryBearing\PlanetaryBearing.FCStd` and `PlanetaryBearing_OD31.7_ID22_H5_S56P4x24R64_b30_e0.15.stl`. That STL is 388k facets, watertight, with 26 bodies.
- **NEXT, Step 2 (not started):** a **web app** where the user adjusts these parameters and exports a print-ready STL. See §7.

## 3. Repo layout

```
core/pb_math.py          pure math (numpy only): derive, solver, profiles, phasing, twist, report
core/defaults.py         default parameter dict
freecad/PlanetaryBearing.py   FreeCAD Part::FeaturePython (props, onChanged solver, B-rep build, STL export)
freecad/PlanetaryBearing.FCMacro   creates a bearing in the active doc
tests/                   pytest: solver, 2D kinematic mesh sim (shapely), envelope accuracy, fixtures
fixtures/*.json          golden outputs from the Python reference (for verifying a JS/TS port)
tools/make_fixtures.py   regenerate fixtures
tools/analyze_reference.py   decode a gear-bearing STL (tooth counts by FFT, orbit, etc.)
tools/install_freecad.py copy the generator into FreeCAD's Mod folder
reference/micro-gear_ring_22.stl   the reference bearing that inspired the design
```

## 4. Math and conventions (read before changing the geometry)

- **Transverse module** `m`. Pitch radii are `r = m*Z/2` and the planet orbit is `a = rs + rp`.
- **Concentric:** `Zr = Zs + 2*Zp`.
- **Equal spacing:** `(Zs + Zr) % N == 0`, which is the same as `2*(Zs+Zp) % N == 0`.
- **Auto module:** `m = (OD + ID)/(Zs + Zr)`. This puts the planet orbit at the middle of the annulus and makes the ring wall equal the sun rim. The reference STL uses exactly this rule.
- **Profile shift (S0 scheme):** planet `+x`, sun `-x`, ring `+x`, so the centre distances stay standard.
  - Auto `x = max(0, (5/6*z_th - Zp)/z_th)` with `z_th = 2/sin²α`. This is the practical (DIN-style) undercut limit, which allows slight undercut. For Zp=4 at 22°, x ≈ 0.553.
  - The full theoretical limit was tried first; it made the ring wall too thin.
- **Radii.** `d = expansion/2` and `c = root_clear`.
  - Planet: `ra = rp + m(1+x) - d`, `rf = rp - m(1-x) - c - d`
  - Sun: `ra = rs + m(1-x) - d`, `rf = rs - m(1+x) - c - d`
  - Ring tip (inner): `max(rr - m(1-x) + d, 1.0005*rb_r)`
  - Ring root (outer): `rr + m(1+x) + c + d`
  - External tips are truncated where the top land would be smaller than `tip_land` (`tip_radius()`, analytic involute).
- **External tooth profiles (sun, planets)** come from a **rack-generation envelope** (`rack_envelope`).
  - For each radius r, the code takes the minimum over rack positions φ of the angle where the rack's left flank or tip segment crosses circle r.
  - This gives the exact involute plus the trochoidal undercut. The error against the analytic involute is about 2e-7 mm.
  - The rack is widened by `d/cosα` and deepened by `d`. That equals a normal offset of `d` on the gear surface.
  - Output is polar: `r[]` and half-angle `t[]`.
- **Ring profile:** analytic internal involute.
  - Tooth half-angle `ψ(r) = s_r/(2rr) - invα + inv(α_r) - d/rb_r`, with `s_r = m(π/2 - 2x·tanα)`.
  - The root is capped if the tooth space would become pointed.
- **Phasing (`phasing()`):**
  - Sun tooth 0 is centred on +x.
  - Planet i sits at orbit angle `θi = 2πi/N` with spin `ψ0 + θi*(Zs+Zp)/Zp`, where `ψ0 = π - π/Zp` (a tooth space faces sun tooth 0).
  - Ring rotation is `-(f+0.5)*2π/Zr`, where `f = frac(-ψ0*Zp/2π)`.
  - Verified for even and odd Zp.
- **Herringbone twist (`helix_twist()`):** `s(z) = tanβ * w(z)`, where w is a triangle wave of leg height `hs = H/(reversals+1)`.
  - Sun rotates `+s/rs`, planets `-s/rp` (in their own frame), ring `-s/rr`.
  - The signs were derived from contact-point tangential motion and confirmed by the 3D zero-interference check.
- **Kinematics used in the sim (ring fixed):** sun angle `tc*(1+Zr/Zs)`, planet spin `+tc*(1-Zr/Zp)`, orbit `+tc`.
- **Solver (`solve(p, locked)`):**
  - Enumerates `Zp∈[4,80]`, `Zs∈[6,300]`, and N (all values, or just the locked one).
  - Filters by spacing and the lock.
  - Sorts by cost `8|ΔN| + 2|ΔZr| + |ΔZs| + 3|ΔZp|`, with ties going to more planets.
  - Returns the first candidate that passes `feasible()` (min module, ring wall, sun rim, planet-tip gap, hunting).
  - If nothing passes with the lock, it releases the lock and adds a note. If nothing passes at all, it keeps the inputs and adds a note.
- **Wear report:**
  - `gcd(Zs,Zp) == 1` → hunting tooth. Note `gcd(Zr,Zp) == gcd(Zs,Zp)` always.
  - Otherwise the gcd is the number of isolated wear paths, and gcd=2 is the odd/even case.
  - Mesh timing: the number of distinct values of `frac(i*Zs/N)`. One value means all planets mesh in phase.
- **Contact ratios:** transverse `ε` for sun-planet and ring-planet, plus the helical overlap per leg `hs·tanβ/(πm)`.

## 5. Verification done

- `tests/test_mesh_sim.py` runs the 2D shapely simulation over a rotation for 6 layouts (even and odd Zp, 20/22/25° pressure angle).
  - At zero clearance the overlap is at noise level, about 1e-5 mm², which means the profiles are conjugate and the phasing is correct.
  - With expansion e the minimum distance equals e and the overlap is exactly 0.
- 3D check in FreeCAD:
  - Volume shared by the sun or ring with any planet: **0**.
  - Minimum distance: sun-planet 0.132 and ring-planet 0.131. That is 0.15 × cos(base helix), as expected.
- The exported STL is watertight with 26 bodies. Volumes: ring 532, sun 354, planet 12.7 mm³.
- Another layout also built cleanly: OD 60, hex bore 8, H 12, 3 reversals, 5×13T planets with 3 mm bores, EvenWear on.

## 6. Gotchas learned the hard way

1. **Don't use `Part.makeLoft` for the twisted gears.** OCC's ThruSections "compatible wires" step re-pairs edges between sections when the twist per section is larger than the smallest edge span. On the ring, whose tip and root arcs are tiny, this skewed the teeth and caused 0.4 mm³ of interference.
   - Fix: `twisted_loft()` builds explicit `Part.makeRuledSurface(edge_i@z_j, edge_i@z_j+1)` faces, then Shell, sew and Solid.
2. **Wire closure.** The envelope's first radius is `rf + 1e-6·m`, so the root arc must use `r[0]`, not `rf`. Otherwise the gap is larger than 1e-7 and `Part.Wire` fails with "BRep_API: command not done".
3. **Kink splitting.** Flanks are split into separate B-splines at direction changes over 15° (the undercut/involute junction).
   - Cosine-clustered radius sampling caused false kinks (560 edges on the sun), so sampling is now `linspace**1.3`.
4. **Performance.** The default build takes about 40–55 s in FreeCAD. The main costs are booleans on about 3k faces.
   - All cuts per part are done as one multi-tool `shape.cut([..])`.
   - Chamfers are revolved cut rings: `ext_tip_chamfer_cut`, `hole_chamfer_cut`.
   - The same planet solid is built once and copied with a Placement, because rotation about z commutes with the twist.
5. **Ruled-face sag.** The number of sections per leg is set so that `r(1 - cos(Δφ/2)) ≤ SurfaceTolerance`. The planets need about 13 sections per leg, the sun and ring 2–3.
6. **FeaturePython object.**
   - The solver runs in `onChanged`. A `_busy` flag stops recursion, and changes are skipped while the document is restoring (`'Restore' in obj.State`).
   - Output properties use attribute `8|1` (Output|ReadOnly), so writing them doesn't re-touch the object.
   - `ExportNow` resets itself after exporting.
7. **The reference STL breaks our rules.** At OD 31.7 / ID 22 it has 26 planets × 4T, sun 48, ring 56, m ≈ 0.516. Under our limits that layout is infeasible: neighbouring planet tips would touch and the walls would be about 0.37 mm. It also isn't hunting-tooth: gcd 4, so each planet tooth only meets 12 of the 48 sun teeth.
   - In that envelope the solver picks **24 planets, sun 56, ring 64, m 0.4475**.
   - The reference planets are truncated to about 2.76·m tip radius. We truncate by tip land instead.
8. **Small module plus 0.15 expansion lowers the transverse contact ratio to about 0.84.** The herringbone overlap of about 1.03 per leg makes the total about 1.86, so the report warns but this is acceptable. Suggest expansion 0.10–0.12 for m < 0.5.

## 7. Step 2: web app (next task)

**Requirement:** a browser UI with all the parameters from §1 that live-updates the dependent values (same solver and lock semantics), shows the report, previews in 3D, and exports a print-ready binary STL.

Recommended approach (no OpenCascade needed):

- **Port `core/pb_math.py` to TypeScript.** It is plain arithmetic and loops.
  - The `rack_envelope` vectorization becomes nested loops: about 36 radii × 6000 φ × 2 segments, which is fast in JS.
  - Verify against `fixtures/*.json`: profiles r/t, derived values, phasing, twist samples, solver cases and report lines.
  - Alternative: run the Python core unchanged in **Pyodide** (it only needs numpy). That is the faster path to correctness but has a heavier first load.
- **Build the mesh directly.** No B-rep is needed because every part is a **twisted extrusion of a 2D polygon**.
  - Polygon per part: `external_polygon` / `ring_hole_polygon` (densify the flanks).
  - z sections: same rule as `twisted_loft` (sag ≤ tol), plus extra sections near the faces for chamfers.
  - Side walls: quad strips between consecutive rotated sections. The vertex correspondence is trivial: same index.
  - Caps: triangulate the polygon, with holes for the ring (outer circle + toothed hole) and for bores. Use earcut.
  - **Chamfers in mesh form:** clamp vertex radius per section.
    - External tips: `r' = min(r, ra - ch + dz)`, where dz is the distance to the nearest face.
    - Ring tips: `r' = max(r, ri + ch - dz)`.
    - OD: `min(r, R - ch + dz)`.
    - Bores: `max(r, rb + ch - dz)`.
    - This needs 2–4 extra sections within `ch` of each face.
  - Bores: a hex/square/D-flat/round polygon as a hole in the sun/planet cap, with straight vertical walls (no twist).
  - Output is one binary STL with all bodies (print-in-place), plus an option for separate files. Keep facet count reasonable, about 300–600k.
- **UI:** use the grouped parameter panels from the FreeCAD object ("1 Envelope", "2 Teeth", ...).
  - Number inputs with 0.01 steps for tolerances.
  - Auto-correction notes, shown as toasts and in the report.
  - A three.js preview. Optionally animate the rotation using the kinematics in §4.
  - Put the solver in a web worker if it blocks the UI.
- **Acceptance:**
  - Fixtures match: atol 1e-6 for profiles, exact for the solver.
  - The exported STL is watertight with 1 + 1 + N bodies.
  - Default parameters give volumes within about 1% of ring 532, sun 351, planet 12.75 mm³ (FreeCAD B-rep).
  - Port `test_mesh_sim` as a 2D check, or run the Python tests against an exported STL with trimesh.

## 8. Open ideas / not done

- Planet carrier or retention features: not needed, the herringbone holds the parts axially.
- An outer grip texture like the reference's 47-bump OD.
- Root fillets: the rack has a sharp tip, so roots are generated by the trochoid of that corner.
- Interference checks inside the FreeCAD Report: currently only done offline or with ad-hoc commands.
- FreeCAD recompute speed (about 40–55 s). Possible fixes: lower `SurfaceTolerance`, or build sun and ring caps from faces instead of booleans.
