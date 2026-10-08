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
- **Done, verified (2026-10-08): Step 2, the web app** in `web/`. See §7 for how it is built and verified.

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
tools/serve_web.py       dev server for web/ (+ PUT /upload/*.stl -> build/)
web/                     browser app: js/pbmath.js (port), js/meshgen.js (mesh), js/app.js (UI), tests.html
tests/test_stl_export.py trimesh checks on exported STLs in build/
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
  - Default parameters give volumes within about 1% of ring 532, sun 354, planet 12.74 mm³ (measured on the FreeCAD STL; the earlier "sun 351" was a typo).
  - Port `test_mesh_sim` as a 2D check, or run the Python tests against an exported STL with trimesh.

### 7.1 What was built (2026-10-08)

Plain ES modules, no build step (Node isn't installed on Isaac's PC). three.js 0.160.0 and earcut 2.2.4 load from jsdelivr.

- `web/js/pbmath.js`: line-by-line port of `pb_math.py` (derive, tip_radius, feasible, solve, rack_envelope, ring_profile, phasing, helix_twist, report). `linspace`/`interp` copy numpy's arithmetic. The solver sorts candidates exactly like `np.lexsort((-N, cost))` (ties go to the meshgrid index), so it matches the fixtures exactly.
- `web/js/meshgen.js`: direct mesh. Every loop (gear outline, toothed ring hole, OD circle, bore) has its **own** z sections (helix rule from `twisted_loft`, plus chamfer sections), and the loops only meet at the earcut caps. That keeps the facet count low: 263k for the defaults, against 388k for the FreeCAD export.
  - **Chamfers on teeth are tooth-aware:** the vertices beyond the cone radius Rc are spread over an arc at Rc spanning exactly ±t(Rc), which is where the cone meets the flanks. A plain radial clamp would make the chamfered tips too narrow. Bores and the OD use the radial clamp, which is exact for circles.
  - Sun tip chamfer is limited to `0.5*(ra-rf)`, the same rule FreeCAD uses for planets (it doesn't change the defaults).
  - Earcut drops exactly-collinear points, so `repairDropped()` re-inserts them as a fan. Without it the caps get T-junctions.
  - Flanks are thinned with Douglas–Peucker at `MeshDeviation/4`.
- `web/js/engine.js` (solve/build/checks) runs in `worker.js`, with a main-thread fallback. `geometryErrors()` blocks export when a layout can't be a solid (bore through the teeth, ring roots through the OD, planets overlapping). The solver's "built as-is" case can produce these.
- `web/js/app.js`: FreeCAD property groups and names (shown in tooltips), the same lock and `RESOLVE_TRIGGERS` semantics, toasts for notes, the report, mesh checks, and STL export (all bodies, or Ring / Sun / Planets with the same file-name tag as FreeCAD). Parameters persist in localStorage.
- `web/js/view3d.js`: preview with instanced planets, animation (ring fixed, §4 kinematics), and a mid-height section.

**Verification:**
- `web/tests.html`: 66 checks.
  - Fixtures: derived values, profiles, phasing and twist match with 0 error (twist ≤ 6e-17). Report lines match exactly. All 10 solver cases match, including the notes.
  - Every mesh variant is a closed, consistently oriented manifold: default, large hex, Square, D-Flat, None, no chamfer, spur with hex planet bores.
  - Default volumes: ring 529.9 (−0.45%), sun 355.8 (+0.48%), planet 12.73 (−0.12%) against the FreeCAD STL. Most of the gap is the 0.01 mm chord sag on the OD and bore circles.
- `tests/test_stl_export.py` on browser exports, for the defaults, large hex (5×13T, 3 reversals), odd Zp (61/5×22), and D-flat with hex planet bores at e = 0.12:
  - 2+N watertight bodies each time.
  - Zero overlap on z-slices.
  - Minimum transverse gap 0.147–0.150 at e = 0.15 (FreeCAD STL: 0.143–0.147) and 0.117–0.119 at e = 0.12.

## 8. Open ideas / not done

- Planet carrier or retention features: not needed, the herringbone holds the parts axially.
- An outer grip texture like the reference's 47-bump OD.
- Root fillets: the rack has a sharp tip, so roots are generated by the trochoid of that corner.
- Interference checks inside the FreeCAD Report: currently only done offline or with ad-hoc commands.
- FreeCAD recompute speed (about 40–55 s). Possible fixes: lower `SurfaceTolerance`, or build sun and ring caps from faces instead of booleans.
