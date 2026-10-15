# Planetary Bearing — project notes for Claude Code

Read `HANDOFF.md` first. It has the full context, the math conventions, the gotchas, and the Step 2 plan.

## Commands
On Linux use `python3` (Debian has no `python`), or `sh tools/setup_venv.sh` and then `. .venv/bin/activate`; Debian blocks system-wide pip.
- `pip install -r requirements.txt`
- `python -m pytest -q tests`: about 76 tests, about 100 s. They must pass before and after any change to `core/pb_math.py`.
- `python tools/make_fixtures.py`: regenerate the golden JSON. Only do this when you change the geometry or solver on purpose, and say so in the commit message.
- `python tools/install_freecad.py [--list] [--dest DIR]`: push the generator into every FreeCAD user folder it finds (Windows `%APPDATA%\FreeCAD[\v1-1]`, Linux `~/.local/share/FreeCAD[/v1-1]`, Flatpak, Snap, macOS). The logic is tested in `tests/test_portability.py`.
- `python tools/analyze_reference.py reference/micro-gear_ring_22.stl`
- `python tools/serve_web.py`: serve the web app at http://localhost:8765/web/ (`/web/tests.html` = JS-port checks against fixtures). Also accepts `PUT /upload/<name>.stl` into `build/`.
- `python -m pytest -q tests/test_stl_export.py`: trimesh checks (bodies, watertight, volumes, slice interference) on every `build/PlanetaryBearing_*.stl` (or `PB_STL=path`). Skipped when there is none.

## Rules
- `core/pb_math.py` is the **source of truth** for gear math. The FreeCAD object and the web port (`web/js/pbmath.js`) must match it, checked against `fixtures/` (`web/tests.html`). Change both together.
- Keep `core/` free of FreeCAD imports (numpy only).
- In FreeCAD, never sweep the gears with `Part.makeLoft`. Use `twisted_loft()` (explicit ruled faces), because loft re-pairs edges and skews the teeth.
- Tooth-count invariants must always hold: `Zr == Zs + 2*Zp` and `(Zs+Zr) % N == 0`.
- Units are mm and degrees in the parameter dict, radians inside the math.
- Keep everything working on both Windows and Debian Linux: use `os.path`, no hard-coded `C:` or `%APPDATA%` paths, `#!/usr/bin/env python3` on scripts, and Python 3.11 syntax (Debian 12). `tests/test_portability.py` checks the 3.11 syntax.
- The user is Isaac. He prints on a Bambu P1S, uses FreeCAD 1.1 on Windows (and Debian Linux), and his default pressure angle is 22°.

## Current task
V2 is done: new defaults, taper with mirror/flip, and textures (HANDOFF.md §7.3). Taper and textures are web-only geometry, but their math (solver limits, report) lives in `core/pb_math.py` like everything else. Open ideas are in §8.
