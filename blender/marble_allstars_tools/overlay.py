"""GPU viewport overlay used by play mode.

Moving a real object every frame tags the dependency graph, which makes Blender
re-evaluate the scene sixty times a second - that is what made play mode crawl on
a heavy level. Drawing the marble, its trail and the HUD straight to the viewport
costs a draw call and nothing else.

Everything here degrades to a no-op when there is no GPU context (background
Blender, the headless tests), so the add-on still imports and registers.
"""

import math

from mathutils import Matrix, Vector

try:  # pragma: no cover - depends on the Blender build
    import blf
    import bpy
    import gpu
    from gpu_extras.batch import batch_for_shader
    _HAVE_GPU = True
except ImportError:  # pragma: no cover
    _HAVE_GPU = False

LIGHT = Vector((0.35, -0.55, 0.75)).normalized()

_handle_3d = None
_handle_2d = None
_state = None          # the live OverlayState, or None when not playing
_sphere_cache = {}     # radius -> (batch, shader)
_line_shader = None


class OverlayState:
    """Everything the draw callbacks need. The operator mutates it in place."""

    def __init__(self, radius, color=(1.0, 0.45, 0.1, 1.0)):
        self.radius = radius
        self.color = color
        self.matrix = Matrix.Identity(4)
        self.trail = []
        self.trail_color = (1.0, 0.6, 0.15, 0.9)
        self.show_marble = True
        self.show_trail = True
        self.show_hud = True
        self.hud_big = ""
        self.hud_small = ""
        self.hud_status = ""
        self.hud_hint = "WASD move   Space jump   mouse look   R respawn   Esc stop"

    def set_transform(self, position, quaternion):
        self.matrix = Matrix.Translation(position) @ quaternion.to_matrix().to_4x4()


# --------------------------------------------------------------------------- batches
def _sphere_batch(radius):
    """A smooth-shaded icosphere baked with a fixed headlight, built once per radius."""
    key = round(radius, 4)
    cached = _sphere_cache.get(key)
    if cached is not None:
        return cached

    import bmesh

    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=radius)
    except TypeError:  # Blender < 3.0 spelled it diameter
        bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=radius)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    bm.normal_update()
    coords = [v.co.copy() for v in bm.verts]
    normals = [v.normal.copy() for v in bm.verts]
    indices = [tuple(loop.vert.index for loop in face.loops) for face in bm.faces]
    bm.free()

    shader = gpu.shader.from_builtin("SMOOTH_COLOR")
    colors = []
    for normal in normals:
        shade = 0.28 + 0.72 * max(0.0, normal.dot(LIGHT))
        colors.append((1.0 * shade, 1.0 * shade, 1.0 * shade, 1.0))
    batch = batch_for_shader(shader, "TRIS", {"pos": coords, "color": colors}, indices=indices)
    _sphere_cache[key] = (batch, shader)
    return batch, shader


def _get_line_shader():
    global _line_shader
    if _line_shader is None:
        _line_shader = gpu.shader.from_builtin("POLYLINE_UNIFORM_COLOR")
    return _line_shader


def clear_cache():
    """Drop cached GPU resources (the marble radius changed, or we unregistered)."""
    global _line_shader
    _sphere_cache.clear()
    _line_shader = None


# --------------------------------------------------------------------------- drawing
def _draw_3d():  # pragma: no cover - needs a viewport
    state = _state
    if state is None:
        return
    try:
        gpu.state.depth_test_set("LESS_EQUAL")
        gpu.state.depth_mask_set(True)
        gpu.state.blend_set("ALPHA")

        if state.show_trail and len(state.trail) > 1:
            shader = _get_line_shader()
            viewport = gpu.state.viewport_get()
            shader.bind()
            shader.uniform_float("viewportSize", (viewport[2], viewport[3]))
            shader.uniform_float("lineWidth", 2.0)
            shader.uniform_float("color", state.trail_color)
            batch = batch_for_shader(shader, "LINE_STRIP", {"pos": state.trail})
            batch.draw(shader)

        if state.show_marble:
            batch, shader = _sphere_batch(state.radius)
            with gpu.matrix.push_pop():
                gpu.matrix.multiply_matrix(state.matrix)
                shader.bind()
                batch.draw(shader)
    except Exception:
        pass
    finally:
        try:
            gpu.state.depth_mask_set(False)
            gpu.state.depth_test_set("NONE")
            gpu.state.blend_set("NONE")
        except Exception:
            pass


def _font_size(font_id, size):  # pragma: no cover
    try:
        blf.size(font_id, size)
    except TypeError:  # Blender 3.x wanted a dpi argument
        blf.size(font_id, size, 72)


def _draw_2d():  # pragma: no cover - needs a viewport
    state = _state
    if state is None or not state.show_hud:
        return
    try:
        region = bpy.context.region
        if region is None:
            return
        scale = bpy.context.preferences.system.ui_scale
        font_id = 0
        x = int(24 * scale)
        top = region.height - int(34 * scale)

        blf.color(font_id, 1.0, 1.0, 1.0, 0.95)
        _font_size(font_id, int(26 * scale))
        blf.position(font_id, x, top, 0)
        blf.draw(font_id, state.hud_big)

        _font_size(font_id, int(13 * scale))
        blf.color(font_id, 0.85, 0.88, 0.95, 0.85)
        blf.position(font_id, x, top - int(22 * scale), 0)
        blf.draw(font_id, state.hud_small)

        if state.hud_status:
            blf.color(font_id, 1.0, 0.85, 0.35, 0.95)
            _font_size(font_id, int(16 * scale))
            blf.position(font_id, x, top - int(46 * scale), 0)
            blf.draw(font_id, state.hud_status)

        _font_size(font_id, int(12 * scale))
        blf.color(font_id, 0.8, 0.8, 0.8, 0.6)
        blf.position(font_id, x, int(18 * scale), 0)
        blf.draw(font_id, state.hud_hint)
    except Exception:
        pass


# --------------------------------------------------------------------------- lifecycle
def available():
    return _HAVE_GPU


def enable(state):
    """Start drawing `state`. Returns True when the overlay actually attached."""
    global _handle_3d, _handle_2d, _state
    if not _HAVE_GPU:
        return False
    disable()
    _state = state
    try:
        _handle_3d = bpy.types.SpaceView3D.draw_handler_add(_draw_3d, (), "WINDOW", "POST_VIEW")
        _handle_2d = bpy.types.SpaceView3D.draw_handler_add(_draw_2d, (), "WINDOW", "POST_PIXEL")
    except Exception:
        _handle_3d = _handle_2d = None
        _state = None
        return False
    return True


def disable():
    global _handle_3d, _handle_2d, _state
    for handle in (_handle_3d, _handle_2d):
        if handle is not None:
            try:
                bpy.types.SpaceView3D.draw_handler_remove(handle, "WINDOW")
            except Exception:
                pass
    _handle_3d = _handle_2d = None
    _state = None


def register():
    pass


def unregister():
    disable()
    clear_cache()
