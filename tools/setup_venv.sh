#!/bin/sh
# Linux / macOS: create .venv with the Python dependencies (tests, STL checks, dev server).
# Debian/Ubuntu block system-wide `pip install` (PEP 668), so a venv is the way to go.
#   sh tools/setup_venv.sh        then   . .venv/bin/activate
set -e
cd "$(dirname "$0")/.."
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found.  Debian/Ubuntu: sudo apt install python3 python3-venv" >&2
  exit 1
fi
if ! python3 -c "import venv, ensurepip" >/dev/null 2>&1; then
  echo "python3 venv support missing.  Debian/Ubuntu: sudo apt install python3-venv" >&2
  exit 1
fi
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt
.venv/bin/python -c "import numpy, shapely, trimesh, pytest; print('deps OK: numpy', numpy.__version__)"
echo "Done. Activate with:  . .venv/bin/activate"
echo "Then:  python -m pytest -q tests   |   python tools/serve_web.py   |   python tools/install_freecad.py"
