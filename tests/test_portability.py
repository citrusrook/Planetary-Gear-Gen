"""Cross-platform paths: FreeCAD user-dir detection (Linux apt / 1.1 / Flatpak / Snap / Windows / macOS)
and the FreeCAD object's default export folder. Runs on any OS by simulating home folders."""
import os
import sys
import types
import importlib

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import install_freecad as inst  # noqa: E402


def mk(*parts):
    p = os.path.join(*parts)
    os.makedirs(p, exist_ok=True)
    return p


def test_debian_apt_freecad_1_0(tmp_path):
    # Debian 12 (0.20) / 13 (1.0): ~/.local/share/FreeCAD/{Mod,Macro}, no version folder
    base = mk(tmp_path, ".local", "share", "FreeCAD")
    mk(base, "Mod")
    found, _ = inst.detect("linux", str(tmp_path), {})
    assert found == [base]


def test_linux_freecad_1_1_versioned(tmp_path):
    v = mk(tmp_path, ".local", "share", "FreeCAD", "v1-1")
    found, _ = inst.detect("linux", str(tmp_path), {})
    assert found == [v]


def test_linux_upgraded_has_both(tmp_path):
    base = mk(tmp_path, ".local", "share", "FreeCAD")
    mk(base, "Macro")
    v = mk(base, "v1-1")
    found, _ = inst.detect("linux", str(tmp_path), {})
    assert found == [v, base]
    assert inst.detect("linux", str(tmp_path), {}, version="v1-1")[0] == [v, base]


def test_linux_xdg_data_home(tmp_path):
    xdg = mk(tmp_path, "xdg")
    base = mk(xdg, "FreeCAD")
    mk(base, "Mod")
    found, fb = inst.detect("linux", str(tmp_path), {"XDG_DATA_HOME": xdg})
    assert found == [base] and fb == base


def test_flatpak_and_snap(tmp_path):
    fp = mk(tmp_path, ".var", "app", "org.freecad.FreeCAD", "data", "FreeCAD", "v1-1")
    sn = mk(tmp_path, "snap", "freecad", "common", ".local", "share", "FreeCAD")
    mk(sn, "Mod")
    found, _ = inst.detect("linux", str(tmp_path), {})
    assert found == [fp, sn]


def test_nothing_found_falls_back(tmp_path):
    found, fb = inst.detect("linux", str(tmp_path), {})
    assert found == [] and fb == os.path.join(str(tmp_path), ".local", "share", "FreeCAD")
    assert inst.detect("linux", str(tmp_path), {}, version="v1-1")[1].endswith(os.path.join("FreeCAD", "v1-1"))


def test_windows_and_macos(tmp_path):
    ap = mk(tmp_path, "Roaming")
    v = mk(ap, "FreeCAD", "v1-1")
    assert inst.detect("win32", str(tmp_path), {"APPDATA": ap})[0] == [v]
    mac = mk(tmp_path, "Library", "Application Support", "FreeCAD")
    mk(mac, "Mod")
    assert inst.detect("darwin", str(tmp_path), {})[0] == [mac]


def test_install_copies_files(tmp_path):
    mod, mac = inst.install(str(tmp_path / "data"))
    for f in ("pb_math.py", "PlanetaryBearing.py", "PlanetaryBearing.FCMacro", "Init.py"):
        assert os.path.isfile(os.path.join(mod, f))
    assert os.path.isfile(os.path.join(mac, "PlanetaryBearing.FCMacro"))


@pytest.fixture
def pb_module(monkeypatch):
    """Import freecad/PlanetaryBearing.py with stub FreeCAD / Part modules."""
    monkeypatch.setitem(sys.modules, "FreeCAD", types.SimpleNamespace(Vector=lambda *a: a, GuiUp=False))
    monkeypatch.setitem(sys.modules, "Part", types.SimpleNamespace())
    monkeypatch.syspath_prepend(os.path.join(ROOT, "freecad"))
    monkeypatch.syspath_prepend(os.path.join(ROOT, "core"))
    sys.modules.pop("PlanetaryBearing", None)
    return importlib.import_module("PlanetaryBearing")


def _home(monkeypatch, home):
    real = os.path.expanduser
    monkeypatch.setattr(os.path, "expanduser", lambda p: home if p == "~" else real(p))
    monkeypatch.delenv("XDG_CONFIG_HOME", raising=False)


def test_export_dir_linux_xdg(pb_module, monkeypatch, tmp_path):
    home = str(tmp_path)
    _home(monkeypatch, home)
    monkeypatch.setattr(sys, "platform", "linux")
    docs = mk(home, "Dokumente")
    with open(os.path.join(mk(home, ".config"), "user-dirs.dirs"), "w") as f:
        f.write('# written by xdg-user-dirs-update\nXDG_DOCUMENTS_DIR="$HOME/Dokumente"\n')
    assert pb_module.default_export_dir() == os.path.join(docs, "PlanetaryBearing")


def test_export_dir_linux_no_documents(pb_module, monkeypatch, tmp_path):
    home = str(tmp_path)
    _home(monkeypatch, home)
    monkeypatch.setattr(sys, "platform", "linux")
    assert pb_module.default_export_dir() == os.path.join(home, "PlanetaryBearing")
    mk(home, "Documents")
    assert pb_module.default_export_dir() == os.path.join(home, "Documents", "PlanetaryBearing")


def test_export_dir_windows(pb_module, monkeypatch, tmp_path):
    _home(monkeypatch, str(tmp_path))
    monkeypatch.setattr(sys, "platform", "win32")
    assert pb_module.default_export_dir() == os.path.join(str(tmp_path), "Documents", "PlanetaryBearing")


def test_sources_parse_on_python_3_11():
    """Debian 12 ships Python 3.11 (FreeCAD's too): no newer-only syntax in the repo."""
    import ast
    for d in ("core", "freecad", "tools", "tests"):
        for f in os.listdir(os.path.join(ROOT, d)):
            if f.endswith((".py", ".FCMacro")):
                src = open(os.path.join(ROOT, d, f), encoding="utf-8").read()
                ast.parse(src, filename=f, feature_version=(3, 11))
