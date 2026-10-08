"""Copy the generator into FreeCAD's user Mod folder (+ macro). Run with normal Python or inside FreeCAD.
usage: python tools/install_freecad.py [--version v1-1]"""
import os, shutil, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ver = sys.argv[sys.argv.index("--version") + 1] if "--version" in sys.argv else "v1-1"
if os.name == "nt":
    base = os.path.join(os.environ["APPDATA"], "FreeCAD", ver)
elif sys.platform == "darwin":
    base = os.path.expanduser("~/Library/Application Support/FreeCAD/" + ver)
else:
    base = os.path.expanduser("~/.local/share/FreeCAD/" + ver)
mod = os.path.join(base, "Mod", "PlanetaryBearing")
mac = os.path.join(base, "Macro")
os.makedirs(mod, exist_ok=True); os.makedirs(mac, exist_ok=True)
shutil.copy(os.path.join(ROOT, "core", "pb_math.py"), mod)
shutil.copy(os.path.join(ROOT, "freecad", "PlanetaryBearing.py"), mod)
shutil.copy(os.path.join(ROOT, "freecad", "PlanetaryBearing.FCMacro"), mod)
shutil.copy(os.path.join(ROOT, "freecad", "PlanetaryBearing.FCMacro"), mac)
open(os.path.join(mod, "Init.py"), "w").write("# PlanetaryBearing (folder is added to sys.path by FreeCAD)\n")
print("installed to", mod, "and", mac, "- restart FreeCAD or reload modules")
