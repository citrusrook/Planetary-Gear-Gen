#!/usr/bin/env python3
"""Copy the generator into FreeCAD's user Mod folder (+ the macro into the Macro folder).

    python3 tools/install_freecad.py              # auto-detect every FreeCAD user dir
    python3 tools/install_freecad.py --list       # only show what would be used
    python3 tools/install_freecad.py --dest DIR   # explicit user data dir (contains Mod/, Macro/)
    python3 tools/install_freecad.py --version v1-1

Most reliable: run it from FreeCAD's Python console (View -> Panels -> Python console),
which knows its own folders whatever the version or packaging (apt, Flatpak, Snap, AppImage):
    import runpy; runpy.run_path("/path/to/planetary-bearing/tools/install_freecad.py", run_name="__main__")

User data dir per platform / FreeCAD version (the Mod and Macro folders live inside it):
  Windows   %APPDATA%\\FreeCAD\\v1-1 (1.1+)          %APPDATA%\\FreeCAD (1.0)
  macOS     ~/Library/Application Support/FreeCAD/v1-1 (1.1+), .../FreeCAD (1.0)
  Linux     $XDG_DATA_HOME/FreeCAD/v1-1 (1.1+)     $XDG_DATA_HOME/FreeCAD (0.20 - 1.0, Debian 12/13 apt)
            ~/.FreeCAD (0.19 and older)
            Flatpak  ~/.var/app/org.freecad.FreeCAD/data/FreeCAD[/v1-1]
            Snap     ~/snap/freecad/common/.local/share/FreeCAD[/v1-1]
            ($XDG_DATA_HOME defaults to ~/.local/share)
"""
import os
import re
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VERSIONED = re.compile(r"^v\d+-\d+$")
FILES = [("core", "pb_math.py"), ("freecad", "PlanetaryBearing.py"), ("freecad", "PlanetaryBearing.FCMacro")]


def bases(platform=sys.platform, home=None, env=None):
    """FreeCAD 'FreeCAD' parent folders for this platform, most common first."""
    home = home or os.path.expanduser("~")
    env = os.environ if env is None else env
    if platform.startswith("win"):
        appdata = env.get("APPDATA") or os.path.join(home, "AppData", "Roaming")
        return [os.path.join(appdata, "FreeCAD")]
    if platform == "darwin":
        return [os.path.join(home, "Library", "Application Support", "FreeCAD")]
    xdg = env.get("XDG_DATA_HOME") or os.path.join(home, ".local", "share")
    return [
        os.path.join(xdg, "FreeCAD"),
        os.path.join(home, ".var", "app", "org.freecad.FreeCAD", "data", "FreeCAD"),   # Flatpak
        os.path.join(home, "snap", "freecad", "common", ".local", "share", "FreeCAD"),  # Snap
        os.path.join(home, ".FreeCAD"),                                                 # <= 0.19
    ]


def detect(platform=sys.platform, home=None, env=None, version=None):
    """Existing FreeCAD user data dirs. A base folder can hold versioned dirs (v1-1, ...: FreeCAD
    1.1+) and/or the base itself is the data dir (FreeCAD <= 1.0). Every one that exists is used,
    since an upgraded machine has both. Returns (dirs, fallback_if_none_exist)."""
    found = []
    for b in bases(platform, home, env):
        if not os.path.isdir(b):
            continue
        vers = sorted(d for d in os.listdir(b) if VERSIONED.match(d) and os.path.isdir(os.path.join(b, d)))
        if version:
            vers = [v for v in vers if v == version]
        found += [os.path.join(b, v) for v in vers]
        legacy = [d for d in ("Mod", "Macro", "user.cfg", "system.cfg") if os.path.exists(os.path.join(b, d))]
        if legacy or not vers:
            found.append(b)
    first = bases(platform, home, env)[0]
    return found, (os.path.join(first, version) if version else first)


def install(data_dir, macro_dir=None, root=ROOT):
    mod = os.path.join(data_dir, "Mod", "PlanetaryBearing")
    mac = macro_dir or os.path.join(data_dir, "Macro")
    os.makedirs(mod, exist_ok=True)
    os.makedirs(mac, exist_ok=True)
    for sub, name in FILES:
        shutil.copy(os.path.join(root, sub, name), mod)
    shutil.copy(os.path.join(root, "freecad", "PlanetaryBearing.FCMacro"), mac)
    with open(os.path.join(mod, "Init.py"), "w") as f:
        f.write("# PlanetaryBearing (folder is added to sys.path by FreeCAD)\n")
    return mod, mac


def _inside_freecad():
    try:
        import FreeCAD as App            # noqa: F401
        return App
    except ImportError:
        return None


def main(argv):
    root = ROOT
    App = _inside_freecad()
    if App is not None:                  # FreeCAD knows its own folders (any version / packaging)
        mod, mac = install(App.getUserAppDataDir(), App.getUserMacroDir(True), root)
        print("installed to", mod, "and", mac, "- restart FreeCAD")
        return
    version = argv[argv.index("--version") + 1] if "--version" in argv else None
    if "--dest" in argv:
        targets = [os.path.expanduser(argv[argv.index("--dest") + 1])]
    else:
        targets, fallback = detect(version=version)
        if not targets:
            print("no FreeCAD user folder found (start FreeCAD once first, or pass --dest); using", fallback)
            targets = [fallback]
    if "--list" in argv:
        print("\n".join(targets))
        return
    for t in targets:
        mod, mac = install(t, root=root)
        print("installed to", mod, "and", mac)
    print("restart FreeCAD (or reload the module), then Macro -> Macros -> PlanetaryBearing.FCMacro")


if __name__ == "__main__":
    main(sys.argv[1:])
