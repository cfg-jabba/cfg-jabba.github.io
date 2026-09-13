"""Marble Allstars Tools - Blender add-on for testing marble levels.

Three tools in one add-on (all live in the 3D View sidebar, "Marble" tab):

* Drop Tester   - place a spawn empty, drop a rigid-body marble, trace its path.
* Playtest      - drive a marble around the level inside the viewport with
                  WASD + mouse, using a small Godot-style fixed-step physics
                  loop written in pure Python (no external modules).
* Level Design  - jump-arc preview, required-launch-speed solver, ramp angle
                  read-outs, checkpoints / finish markers, level stats,
                  and JSON import/export of the physics settings so the numbers
                  can be kept in sync with the Godot project.
"""

bl_info = {
    "name": "Marble Allstars Tools",
    "author": "Clipper Studio Co",
    "version": (0, 1, 1),
    "blender": (4, 0, 0),
    "location": "3D View > Sidebar (N) > Marble",
    "description": "Drop-test, playtest and design marble levels inside Blender",
    "category": "3D View",
    "doc_url": "https://github.com/cfg-jabba/cfg-jabba.github.io/tree/main/blender",
}

import importlib

from . import props, utils, drop_tester, playtest, level_tools, ui

_MODULES = (props, utils, drop_tester, playtest, level_tools, ui)


def register():
    # Reload sub-modules when the add-on is re-enabled from the same session
    # (handy while iterating on the code inside Blender).
    for mod in _MODULES:
        importlib.reload(mod)
    for mod in _MODULES:
        if hasattr(mod, "register"):
            mod.register()


def unregister():
    for mod in reversed(_MODULES):
        if hasattr(mod, "unregister"):
            mod.unregister()
