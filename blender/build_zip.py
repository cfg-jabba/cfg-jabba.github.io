"""Zip the add-on so it can be installed from Blender's Preferences > Add-ons.

    python build_zip.py            -> dist/marble_allstars_tools-<version>.zip
"""

import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
PACKAGE = "marble_allstars_tools"
SRC = os.path.join(HERE, PACKAGE)
DIST = os.path.join(HERE, "dist")


def read_version():
    with open(os.path.join(SRC, "__init__.py"), "r", encoding="utf-8") as fh:
        match = re.search(r'"version":\s*\((\d+),\s*(\d+),\s*(\d+)\)', fh.read())
    return ".".join(match.groups()) if match else "0.0.0"


def main():
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f"{PACKAGE}-{read_version()}.zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(SRC):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for name in files:
                if name.endswith((".pyc", ".pyo")):
                    continue
                path = os.path.join(root, name)
                zf.write(path, os.path.relpath(path, HERE))
    print("wrote", out)


if __name__ == "__main__":
    main()
