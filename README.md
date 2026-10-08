# Parametric Herringbone Planetary Bearing

This is a print-in-place gear bearing made of a ring, a sun and N planets with herringbone teeth. It is fully parametric. A tooth-count solver keeps the design assemblable with planets equally spaced, and the report shows phasing and wear (hunting-tooth) analysis. It exports STL for printing.

- `core/`: gear math and solver (Python + numpy)
- `freecad/`: FreeCAD 1.x parametric object. Run `PlanetaryBearing.FCMacro` and edit the properties.
- `tests/`: verification, including a kinematic interference simulation
- `HANDOFF.md`: full design notes and the next step (web app)

Quick start (FreeCAD): run `python tools/install_freecad.py`, restart FreeCAD, then go to Macro → Macros → `PlanetaryBearing.FCMacro`. To export, set **Export Now** = true and recompute.
