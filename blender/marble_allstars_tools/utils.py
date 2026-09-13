"""Shared helpers: collections, tagging, level geometry and BVH building."""

import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .props import AUTO_RB_PROP, ROLE_PROP

TOOLS_COLLECTION = "Marble Tools"
SPAWN_NAME = "Marble Spawn"
GEOMETRY_TYPES = {"MESH", "CURVE", "SURFACE", "FONT", "META"}


# --------------------------------------------------------------------------- collections
def get_tools_collection(context):
    """Collection that holds everything this add-on generates."""
    scene = context.scene
    coll = bpy.data.collections.get(TOOLS_COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(TOOLS_COLLECTION)
    if coll.name not in scene.collection.children:
        # It might be linked somewhere else in another scene; link here too.
        try:
            scene.collection.children.link(coll)
        except RuntimeError:
            pass
    return coll


def link_to_tools(context, obj):
    coll = get_tools_collection(context)
    for other in list(obj.users_collection):
        if other is not coll:
            other.objects.unlink(obj)
    if obj.name not in coll.objects:
        coll.objects.link(obj)
    return obj


def set_role(obj, role):
    obj[ROLE_PROP] = role


def get_role(obj):
    try:
        return obj.get(ROLE_PROP, "")
    except (AttributeError, ReferenceError):
        return ""


def objects_with_role(role, scene=None):
    scene = scene or bpy.context.scene
    return [obj for obj in scene.objects if get_role(obj) == role]


def remove_objects(objs):
    """Delete objects and their mesh/curve data when no longer used."""
    datas = []
    for obj in objs:
        if obj.data is not None:
            datas.append(obj.data)
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except ReferenceError:
            pass
    for data in datas:
        try:
            if data.users == 0:
                if isinstance(data, bpy.types.Mesh):
                    bpy.data.meshes.remove(data)
                elif isinstance(data, bpy.types.Curve):
                    bpy.data.curves.remove(data)
        except ReferenceError:
            pass


# --------------------------------------------------------------------------- spawn
def find_spawn(scene=None):
    spawns = objects_with_role("SPAWN", scene)
    if spawns:
        return spawns[0]
    return None


def create_spawn(context, location):
    settings = context.scene.marble_tools
    empty = bpy.data.objects.new(SPAWN_NAME, None)
    empty.empty_display_type = "ARROWS"
    empty.empty_display_size = max(settings.marble_radius * 2.0, 0.25)
    empty.location = location
    set_role(empty, "SPAWN")
    link_to_tools(context, empty)
    return empty


def get_or_create_spawn(context):
    spawn = find_spawn(context.scene)
    if spawn is None:
        spawn = create_spawn(context, context.scene.cursor.location.copy())
    return spawn


def spawn_launch_direction(spawn):
    """Launch direction = spawn empty's local +Y axis (the green arrow)."""
    direction = spawn.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    if direction.length < 1e-8:
        return Vector((0.0, 1.0, 0.0))
    return direction.normalized()


# --------------------------------------------------------------------------- level geometry
def _collection_objects_recursive(coll):
    seen = set()
    result = []

    def walk(c):
        for obj in c.objects:
            if obj.name not in seen:
                seen.add(obj.name)
                result.append(obj)
        for child in c.children:
            walk(child)

    walk(coll)
    return result


def get_level_objects(context):
    """Geometry objects that make up the level (never our own generated objects)."""
    settings = context.scene.marble_tools
    if settings.level_collection is not None:
        candidates = _collection_objects_recursive(settings.level_collection)
    else:
        candidates = list(context.scene.objects)

    tools = bpy.data.collections.get(TOOLS_COLLECTION)
    level = []
    for obj in candidates:
        if obj.type not in GEOMETRY_TYPES:
            continue
        if get_role(obj):
            continue
        if tools is not None and obj.name in tools.objects:
            continue
        if settings.level_collection is None:
            # Skip hidden objects when we are guessing the level from the whole scene.
            try:
                if not obj.visible_get(view_layer=context.view_layer):
                    continue
            except (TypeError, RuntimeError):
                pass
        level.append(obj)
    return level


def build_level_bvh(context, objects=None):
    """Build one world-space BVHTree from all level geometry (modifiers applied).

    Returns (bvh, triangle_count). bvh is None when the level has no geometry.
    """
    if objects is None:
        objects = get_level_objects(context)
    depsgraph = context.evaluated_depsgraph_get()

    verts = []
    polys = []
    offset = 0
    for obj in objects:
        eval_obj = obj.evaluated_get(depsgraph)
        try:
            mesh = eval_obj.to_mesh()
        except RuntimeError:
            continue
        if mesh is None:
            continue
        try:
            if len(mesh.vertices) == 0 or len(mesh.polygons) == 0:
                continue
            mat = eval_obj.matrix_world
            try:
                import numpy as np

                count = len(mesh.vertices)
                buf = np.empty(count * 3, dtype=np.float32)
                mesh.vertices.foreach_get("co", buf)
                co = buf.reshape(count, 3).astype(np.float64)
                m = np.array(mat.to_3x3(), dtype=np.float64)
                t = np.array(mat.translation, dtype=np.float64)
                world = co @ m.T + t
                verts.extend(map(tuple, world))
            except ImportError:  # pragma: no cover - numpy ships with Blender
                verts.extend((mat @ v.co)[:] for v in mesh.vertices)
            for poly in mesh.polygons:
                polys.append([i + offset for i in poly.vertices])
            offset += len(mesh.vertices)
        finally:
            eval_obj.to_mesh_clear()

    if not polys:
        return None, 0
    bvh = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    return bvh, len(polys)


def level_bounds(context, objects=None):
    if objects is None:
        objects = get_level_objects(context)
    lo = Vector((math.inf,) * 3)
    hi = Vector((-math.inf,) * 3)
    found = False
    for obj in objects:
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
            found = True
    if not found:
        return None, None
    return lo, hi


# --------------------------------------------------------------------------- curves
def make_path_curve(context, name, points, radius=0.05, color=(1.0, 0.3, 0.1, 1.0), role="PATH"):
    """Create a poly curve object through `points` (list of Vector)."""
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for i, p in enumerate(points):
        spline.points[i].co = (p.x, p.y, p.z, 1.0)
    obj = bpy.data.objects.new(name, curve)
    obj.color = color
    mat = get_material(name.split(" ")[0] + " Path", color)
    curve.materials.append(mat)
    set_role(obj, role)
    link_to_tools(context, obj)
    return obj


def get_material(name, color):
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.diffuse_color = color
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is not None:
            bsdf.inputs["Base Color"].default_value = color
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = color
                bsdf.inputs["Emission Strength"].default_value = 0.5
    return mat


def make_marble_mesh(name, radius, color=(0.1, 0.6, 1.0, 1.0)):
    """A UV sphere mesh object (no rigid body yet)."""
    import bmesh

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=radius)
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.color = color
    mesh.materials.append(get_material("Marble Ball", color))
    set_role(obj, "MARBLE")
    return obj


def fmt(value, digits=2):
    return f"{value:.{digits}f}"


def has_auto_rb(obj):
    return bool(obj.get(AUTO_RB_PROP, False))
