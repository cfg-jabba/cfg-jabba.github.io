"""Install Marble Allstars Tools into Blender.

Easiest way (any OS):
  1. Open Blender.
  2. Switch to the Scripting workspace (the tab along the top).
  3. Text > Open, pick this file. Or click New and paste it in.
  4. Press the Run button (the play triangle).
  5. Read the message in the status bar / system console, then press N in the
     3D viewport and open the Marble tab.

It finds the newest marble_allstars_tools-*.zip in your Downloads, on your
Desktop, next to the open .blend or next to this script, removes any older
version of the add-on, installs the zip, enables it and saves your preferences.

If your zip lives somewhere else, put its full path in ZIP_PATH below, e.g.
    ZIP_PATH = r"D:\\stuff\\marble_allstars_tools-0.3.0.zip"

Nothing outside Blender's own add-ons folder is touched, and nothing is deleted
except a previous copy of this add-on.
"""

import glob
import os
import re
import sys

import bpy

ZIP_PATH = ""                       # optional: full path to the zip
MODULE = "marble_allstars_tools"
PATTERN = "marble_allstars_tools-*.zip"


def version_of(path):
    match = re.search(r"-(\d+)\.(\d+)\.(\d+)\.zip$", os.path.basename(path))
    return tuple(int(g) for g in match.groups()) if match else (0, 0, 0)


def search_dirs():
    places = []
    if bpy.data.filepath:
        places.append(os.path.dirname(bpy.data.filepath))
    try:
        places.append(os.path.dirname(os.path.abspath(__file__)))
    except NameError:                # pasted into the text editor, not a file
        pass
    try:
        text = bpy.context.space_data.text
        if text is not None and text.filepath:
            places.append(os.path.dirname(bpy.path.abspath(text.filepath)))
    except AttributeError:
        pass
    places.append(os.getcwd())
    home = os.path.expanduser("~")
    places.extend([os.path.join(home, "Downloads"), os.path.join(home, "Desktop"), home])
    seen = set()
    unique = []
    for place in places:
        if place and place not in seen and os.path.isdir(place):
            seen.add(place)
            unique.append(place)
    return unique


def find_zip():
    if ZIP_PATH:
        if os.path.isfile(ZIP_PATH):
            return ZIP_PATH
        raise FileNotFoundError(f"ZIP_PATH is set but there is no file at {ZIP_PATH}")
    found = []
    for place in search_dirs():
        found.extend(glob.glob(os.path.join(place, PATTERN)))
    if not found:
        raise FileNotFoundError(
            "Could not find " + PATTERN + " in any of:\n  " + "\n  ".join(search_dirs()) +
            "\nDownload the zip, or set ZIP_PATH at the top of this script."
        )
    found.sort(key=version_of)
    return found[-1]


def install(path):
    print(f"[Marble] Installing {path}")
    try:
        bpy.ops.preferences.addon_disable(module=MODULE)
        print("[Marble] Disabled the previous version")
    except Exception:
        pass
    try:
        bpy.ops.preferences.addon_remove(module=MODULE)
        print("[Marble] Removed the previous version")
    except Exception:
        pass

    bpy.ops.preferences.addon_install(filepath=path, overwrite=True)
    bpy.ops.preferences.addon_enable(module=MODULE)
    bpy.ops.wm.save_userpref()

    module = sys.modules.get(MODULE)
    version = ".".join(str(n) for n in module.bl_info["version"]) if module else "?"
    message = f"Marble Allstars Tools {version} installed. Press N in the 3D viewport, Marble tab."
    print(f"[Marble] {message}")
    return message


def main():
    try:
        message = install(find_zip())
    except Exception as exc:                       # noqa: BLE001 - report, never traceback at the user
        message = f"Install failed: {exc}"
        print(f"[Marble] {message}")
    try:
        def draw(self, _context):
            for line in str(message).splitlines():
                self.layout.label(text=line)
        bpy.context.window_manager.popup_menu(draw, title="Marble Allstars Tools", icon="INFO")
    except Exception:
        pass


main()
