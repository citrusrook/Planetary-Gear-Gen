# Planetary Bearing — project notes for Claude Code

Read `HANDOFF.md` first. It has the full context, the math conventions, the gotchas, and the Step 2 plan.

## Commands
- `pip install -r requirements.txt`
- `python -m pytest -q tests`: 21 tests, about 30 s. They must pass before and after any change to `core/pb_math.py`.
- `python tools/make_fixtures.py`: regenerate the golden JSON. Only do this when you change the geometry or solver on purpose, and say so in the commit message.
- `python tools/install_freecad.py`: push the generator into FreeCAD's Mod folder (Windows: `%APPDATA%\FreeCAD\v1-1`).
- `python tools/analyze_reference.py reference/micro-gear_ring_22.stl`

## Rules
- `core/pb_math.py` is the **source of truth** for gear math. The FreeCAD object and any web/JS port must match it, checked against `fixtures/`.
- Keep `core/` free of FreeCAD imports (numpy only).
- In FreeCAD, never sweep the gears with `Part.makeLoft`. Use `twisted_loft()` (explicit ruled faces), because loft re-pairs edges and skews the teeth.
- Tooth-count invariants must always hold: `Zr == Zs + 2*Zp` and `(Zs+Zr) % N == 0`.
- Units are mm and degrees in the parameter dict, radians inside the math.
- The user is Isaac. He prints on a Bambu P1S, uses FreeCAD 1.1 on Windows, and his default pressure angle is 22°.

## Current task
Step 2: a web app that lets the user adjust every parameter, auto-corrects dependent values (same lock semantics as `solve()`), shows the report, previews in 3D, and exports a print-ready STL. See HANDOFF.md §7.
