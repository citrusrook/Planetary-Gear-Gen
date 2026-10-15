# Parametric Herringbone Planetary Bearing

This is a print-in-place gear bearing made of a ring, a sun and N planets with herringbone teeth. It is fully parametric. A tooth-count solver keeps the design assemblable with planets equally spaced, and the report shows phasing and wear (hunting-tooth) analysis. It exports STL for printing.

- `core/`: gear math and solver (Python + numpy)
- `freecad/`: FreeCAD parametric object. Run `PlanetaryBearing.FCMacro` and edit the properties.
- `web/`: browser app (same parameters, solver and report, 3D preview, STL export). No build step.
- `tests/`: verification, including a kinematic interference simulation
- `HANDOFF.md`: full design notes

Works on Windows, Linux (Debian/Ubuntu tested paths) and macOS. On Windows use `python`; on Linux/macOS use `python3` (or `python` inside the venv).

## Web app

```
python3 tools/serve_web.py            # then open http://localhost:8765/web/
python3 tools/serve_web.py --host 0.0.0.0   # reachable from other machines on a trusted LAN
```

V2 adds:
- a **taper** for lazy-susan / thrust bearings: the planets become cones like tapered rollers. **Mirror** makes a double taper; **Flip** reverses its direction.
- **surface textures** on the ring OD and the sun bore: straight, diagonal or diamond knurl, dimples or oval reliefs.

Both are under "3 Herringbone & taper" and "6 Surface texture". The report explains the limits; larger planets (8+ teeth) handle bigger taper angles.

Only the Python standard library is needed to serve it. It runs in any current browser (Firefox ESR, Chromium, Chrome, Edge) and loads three.js and earcut from jsdelivr, so it needs internet. Edit the parameters on the left; tooth counts are auto-corrected the same way as in FreeCAD. Use **Download STL** for one print-in-place file, or Ring / Sun / Planets for separate files. `http://localhost:8765/web/tests.html` checks the JS port against `fixtures/`.

## FreeCAD

```
python3 tools/install_freecad.py --list   # show the FreeCAD user folders it found
python3 tools/install_freecad.py          # install into all of them
```

Restart FreeCAD, then go to Macro → Macros → `PlanetaryBearing.FCMacro`. To export, set **Export Now** = true and recompute. STLs go to `<Documents>/PlanetaryBearing` (on Linux the XDG Documents folder).

The installer finds Windows (`%APPDATA%\FreeCAD`), macOS, and on Linux the Debian/Ubuntu apt packages (`~/.local/share/FreeCAD`, FreeCAD 0.20–1.0), FreeCAD 1.1+ (`.../FreeCAD/v1-1`), Flatpak and Snap. Start FreeCAD once first so its folder exists. If it still picks the wrong place, run it from FreeCAD's own Python console (View → Panels → Python console), which always knows the right folder:

```
import runpy; runpy.run_path("/path/to/planetary-bearing/tools/install_freecad.py", run_name="__main__")
```

or pass `--dest <FreeCAD user data dir>`. Debian's FreeCAD needs numpy in its Python: `sudo apt install freecad python3-numpy`.

## Tests and tools (Python dependencies)

Windows:

```
python -m pip install -r requirements.txt
python -m pytest -q tests
```

Debian / Ubuntu (system-wide `pip install` is blocked there, so use a venv):

```
sudo apt install python3 python3-venv
sh tools/setup_venv.sh
. .venv/bin/activate
python -m pytest -q tests
```
