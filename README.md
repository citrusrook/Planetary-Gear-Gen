# Parametric Herringbone Planetary Bearing

This is a print-in-place gear bearing made of a ring, a sun and N planets with herringbone teeth. It is fully parametric. A tooth-count solver keeps the design assemblable with planets equally spaced, and the report shows phasing and wear (hunting-tooth) analysis. It exports STL for printing.

- `core/`: gear math and solver (Python + numpy)
- `freecad/`: FreeCAD 1.x parametric object. Run `PlanetaryBearing.FCMacro` and edit the properties.
- `web/`: browser app (same parameters, solver and report, 3D preview, STL export). No build step.
- `tests/`: verification, including a kinematic interference simulation
- `HANDOFF.md`: full design notes and the next step (web app)

Quick start (FreeCAD): run `python tools/install_freecad.py`, restart FreeCAD, then go to Macro → Macros → `PlanetaryBearing.FCMacro`. To export, set **Export Now** = true and recompute.

Quick start (web): run `python tools/serve_web.py`, then open http://localhost:8765/web/. Edit the parameters on the left; tooth counts are auto-corrected the same way as in FreeCAD. Use **Download STL** for one print-in-place file, or Ring / Sun / Planets for separate files. `http://localhost:8765/web/tests.html` checks the JS port against `fixtures/`.
