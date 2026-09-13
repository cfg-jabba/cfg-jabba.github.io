"""Ramp Lab: mark a ramp face, fly it at a range of speeds, get the numbers back.

Everything here runs the real play-mode physics (MarblePhysics), so a ramp's
reported launch matches what you feel when you drive it. The flat-ground limits
use a synthetic plane instead of the level, so they are the same numbers whatever
scene you have open - the grammar you design gaps and ledges against.
"""

import math

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

from . import runs, utils
from .playtest import MarblePhysics, params_from_settings
from .props import get_settings

RAMP_ARC_NAME = "Ramp Arc"
REACH_NAME = "Reach Arc"
UP = Vector((0.0, 0.0, 1.0))
DOWN = Vector((0.0, 0.0, -1.0))

RAMP_BASE = "marble_ramp_base"
RAMP_UP = "marble_ramp_up"
RAMP_NORMAL = "marble_ramp_normal"


# --------------------------------------------------------------------------- geometry
def selected_face_data(context, obj):
    """World-space verts and area-weighted normal of the ramp faces.

    Edit Mode uses the selected faces; Object Mode uses every face flatter than
    60 degrees (the surfaces a marble can actually roll on).
    """
    import bmesh

    mat = obj.matrix_world
    nmat = mat.to_3x3().inverted_safe().transposed()
    owned = False
    if obj.mode == "EDIT":
        bm = bmesh.from_edit_mesh(obj.data)
        faces = [f for f in bm.faces if f.select]
        label = f"{len(faces)} selected faces"
    else:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.normal_update()
        owned = True
        faces = [f for f in bm.faces if (nmat @ f.normal).z > 0.5]
        label = f"{obj.name}"
    if not faces:
        if owned:
            bm.free()
        return None, None, "no faces"

    normal = Vector((0.0, 0.0, 0.0))
    verts = []
    seen = set()
    for face in faces:
        normal += (nmat @ face.normal) * face.calc_area()
        for vert in face.verts:
            if vert.index not in seen:
                seen.add(vert.index)
                verts.append(mat @ vert.co)
    if owned:
        bm.free()
    if normal.length < 1e-9:
        return None, None, "faces cancel out"
    normal.normalize()
    if normal.z < 0.0:
        normal = -normal
    return verts, normal, label


def ramp_frame(verts, normal):
    """Base point, exit point and up-slope direction of a ramp surface."""
    down_tan = DOWN - normal * DOWN.dot(normal)
    if down_tan.length < 1e-4:
        return None
    up_dir = -down_tan.normalized()
    projections = [v.dot(up_dir) for v in verts]
    lo, hi = min(projections), max(projections)
    span = max(hi - lo, 1e-6)
    band = span * 0.12

    def centroid(keep):
        picked = [v for v, p in zip(verts, projections) if keep(p)]
        total = Vector((0.0, 0.0, 0.0))
        for v in picked:
            total += v
        return total / len(picked)

    base = centroid(lambda p: p <= lo + band)
    top = centroid(lambda p: p >= hi - band)
    slope = math.degrees(math.acos(max(-1.0, min(1.0, normal.z))))
    return {"base": base, "top": top, "up": up_dir, "normal": normal,
            "slope": slope, "length": span}


def flat_bvh(size=2000.0):
    """A single huge quad at z=0, so reach numbers do not depend on the open scene."""
    half = size * 0.5
    verts = [(-half, -half, 0.0), (half, -half, 0.0), (half, half, 0.0), (-half, half, 0.0)]
    return BVHTree.FromPolygons(verts, [[0, 1, 2, 3]], all_triangles=False, epsilon=0.0)


# --------------------------------------------------------------------------- simulation
def fly(bvh, radius, params, start, velocity, hz=60, max_time=8.0, hold=None):
    """Run the marble from `start` at `velocity` until it lands after leaving the ground."""
    phys = MarblePhysics(bvh, radius, params)
    phys.reset(start)
    phys.vel = velocity.copy()
    move = Vector((0.0, 0.0, 0.0))
    if hold is not None:
        flat = Vector((hold.x, hold.y, 0.0))
        if flat.length > 1e-6:
            move = flat.normalized()

    dt = 1.0 / hz
    path = [start.copy()]
    grounded_once = False
    launch = None
    launch_time = 0.0
    launch_speed = 0.0
    apex = start.z
    elapsed = 0.0
    while elapsed < max_time:
        phys.step(dt, move, False)
        elapsed += dt
        path.append(phys.pos.copy())
        # touched_ground, not on_ground: a bouncy landing can end the tick airborne.
        if phys.touched_ground:
            grounded_once = True
            if launch is not None:
                horizontal = Vector((phys.pos.x - launch.x, phys.pos.y - launch.y, 0.0)).length
                return {"path": path, "launch": launch, "landing": phys.pos.copy(),
                        "distance": horizontal, "height": apex - launch.z,
                        "airtime": elapsed - launch_time, "exit_speed": launch_speed,
                        "landed": True}
        elif grounded_once and launch is None and phys.vel.z > 0.2:
            launch = phys.pos.copy()
            launch_time = elapsed
            launch_speed = phys.vel.length
            apex = launch.z
        if launch is not None:
            apex = max(apex, phys.pos.z)
        if phys.pos.z < params["kill_z"]:
            break
    if launch is None:
        return {"path": path, "launch": None, "landed": False}
    horizontal = Vector((path[-1].x - launch.x, path[-1].y - launch.y, 0.0)).length
    return {"path": path, "launch": launch, "landing": path[-1], "distance": horizontal,
            "height": apex - launch.z, "airtime": elapsed - launch_time,
            "exit_speed": launch_speed, "landed": False}


def marble_limits(params, radius, hz=60):
    """Standing jump, running jump and top speed on flat ground."""
    bvh = flat_bvh()
    dt = 1.0 / hz
    forward = Vector((0.0, 1.0, 0.0))
    out = {}

    def settle(phys, ticks=30):
        for _ in range(ticks):
            phys.step(dt, Vector((0.0, 0.0, 0.0)), False)

    def jump_stats(phys, move):
        start = phys.pos.copy()
        phys.step(dt, move, True)          # one tap of the jump key
        apex = phys.pos.z
        air = dt
        for _ in range(int(hz * 8)):
            phys.step(dt, move, False)
            apex = max(apex, phys.pos.z)
            air += dt
            if phys.touched_ground:
                break
        travel = Vector((phys.pos.x - start.x, phys.pos.y - start.y, 0.0)).length
        return apex - start.z, travel, air

    phys = MarblePhysics(bvh, radius, params)
    phys.reset(Vector((0.0, 0.0, radius)))
    settle(phys)
    height, _travel, air = jump_stats(phys, Vector((0.0, 0.0, 0.0)))
    out["standing_height"] = height
    out["standing_air"] = air

    phys = MarblePhysics(bvh, radius, params)
    phys.reset(Vector((0.0, 0.0, radius)))
    settle(phys)
    for _ in range(int(hz * 5)):           # run up to the natural top speed
        phys.step(dt, forward, False)
    out["top_speed"] = Vector((phys.vel.x, phys.vel.y, 0.0)).length
    height, travel, air = jump_stats(phys, forward)
    out["run_height"] = height
    out["run_distance"] = travel
    out["run_air"] = air
    return out


# --------------------------------------------------------------------------- drawing
def clear_role(scene, role, prefix=None):
    doomed = [o for o in utils.objects_with_role(role, scene)
              if prefix is None or o.name.startswith(prefix)]
    utils.remove_objects(doomed)


def draw_trajectory(context, name, path, color, radius):
    if len(path) < 2:
        return None
    curve = utils.make_path_curve(context, name, path, radius=max(radius * 0.05, 0.01),
                                  color=color, role="ARC")
    curve.hide_select = True
    return curve


# --------------------------------------------------------------------------- operators
class MARBLE_OT_mark_ramp(bpy.types.Operator):
    bl_idname = "marble.mark_ramp"
    bl_label = "Mark Ramp"
    bl_description = ("Mark the selected faces (Edit Mode) or the active mesh's rollable faces "
                      "as a ramp, then fly it at a range of speeds and report the numbers")
    bl_options = {"REGISTER", "UNDO"}

    analyse: bpy.props.BoolProperty(name="Analyse Now", default=True)

    @classmethod
    def poll(cls, context):
        return context.active_object is not None and context.active_object.type == "MESH"

    def execute(self, context):
        settings = get_settings(context)
        obj = context.active_object
        verts, normal, label = selected_face_data(context, obj)
        if verts is None:
            self.report({"ERROR"}, f"Could not read a ramp surface ({label})")
            return {"CANCELLED"}
        frame = ramp_frame(verts, normal)
        if frame is None:
            settings.ramp_result = "That surface is flat - a ramp needs a slope"
            self.report({"WARNING"}, settings.ramp_result)
            return {"CANCELLED"}

        marker = bpy.data.objects.new(f"Ramp {obj.name}", None)
        marker.empty_display_type = "SINGLE_ARROW"
        marker.empty_display_size = max(settings.marble_radius * 4.0, 1.0)
        marker.location = frame["top"] + frame["normal"] * settings.marble_radius
        marker.rotation_mode = "QUATERNION"
        marker.rotation_quaternion = UP.rotation_difference(frame["up"])
        marker[RAMP_BASE] = list(frame["base"])
        marker[RAMP_UP] = list(frame["up"])
        marker[RAMP_NORMAL] = list(frame["normal"])
        marker["marble_ramp_slope"] = frame["slope"]
        utils.set_role(marker, "RAMP")
        utils.link_to_tools(context, marker, "BOX")

        settings.ramp_result = (f"Marked {label}: slope {frame['slope']:.1f}°, "
                                f"{frame['length']:.1f} m long")
        if self.analyse:
            return bpy.ops.marble.analyse_ramps()
        self.report({"INFO"}, settings.ramp_result)
        return {"FINISHED"}


class MARBLE_OT_analyse_ramps(bpy.types.Operator):
    bl_idname = "marble.analyse_ramps"
    bl_label = "Analyse Ramps"
    bl_description = ("Fly every marked ramp at a range of entry speeds using the play-mode "
                      "physics, draw the trajectories and report distance, height and airtime")
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = get_settings(context)
        scene = context.scene
        markers = utils.objects_with_role("RAMP", scene)
        if not markers:
            self.report({"ERROR"}, "Select a ramp face and click Mark Ramp first")
            return {"CANCELLED"}
        bvh, _count = utils.build_level_bvh(context)
        if bvh is None:
            self.report({"ERROR"}, "No level geometry to launch off")
            return {"CANCELLED"}

        params = params_from_settings(settings)
        radius = settings.marble_radius
        clear_role(scene, "ARC", RAMP_ARC_NAME)

        steps = max(1, settings.ramp_speed_steps)
        lo = min(settings.ramp_min_speed, settings.ramp_max_speed)
        hi = max(settings.ramp_min_speed, settings.ramp_max_speed)
        speeds = [lo] if steps == 1 else [lo + (hi - lo) * i / (steps - 1) for i in range(steps)]

        lines = []
        best_distance = 0.0
        best_height = 0.0
        for marker in markers:
            base = Vector(marker.get(RAMP_BASE, (0.0, 0.0, 0.0)))
            up_dir = Vector(marker.get(RAMP_UP, (0.0, 1.0, 0.0)))
            normal = Vector(marker.get(RAMP_NORMAL, (0.0, 0.0, 1.0)))
            if up_dir.length < 1e-6:
                continue
            up_dir.normalize()
            start = base + up_dir * (radius * 1.5) + normal * radius
            slope = marker.get("marble_ramp_slope", 0.0)
            lines.append(f"{marker.name} ({slope:.0f}°)")
            for i, speed in enumerate(speeds):
                result = fly(bvh, radius, params, start, up_dir * speed,
                             hz=settings.physics_hz, max_time=8.0, hold=up_dir)
                color = runs.PALETTE[i % len(runs.PALETTE)]
                draw_trajectory(context, f"{RAMP_ARC_NAME} {speed:.0f}", result["path"], color, radius)
                if result["launch"] is None:
                    lines.append(f"  {speed:4.1f} m/s: never leaves the ramp")
                    continue
                best_distance = max(best_distance, result["distance"])
                best_height = max(best_height, result["height"])
                tail = "" if result["landed"] else " (still falling)"
                lines.append(f"  {speed:4.1f} m/s in, {result['exit_speed']:4.1f} out: "
                             f"{result['distance']:5.1f} m across, {result['height']:4.1f} m up, "
                             f"{result['airtime']:4.2f} s air{tail}")

        lines.insert(0, f"Max jump {best_distance:.1f} m across, {best_height:.1f} m high")
        settings.ramp_result = "\n".join(lines)
        self.report({"INFO"}, lines[0])
        return {"FINISHED"}


class MARBLE_OT_marble_limits(bpy.types.Operator):
    bl_idname = "marble.marble_limits"
    bl_label = "Marble Limits"
    bl_description = ("Measure what the marble can do on flat ground: top speed, standing jump "
                      "height, and how far and high a full-speed running jump goes. "
                      "These are the numbers to size gaps and ledges against")
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = get_settings(context)
        params = params_from_settings(settings)
        limits = marble_limits(params, settings.marble_radius, hz=settings.physics_hz)
        settings.limits_result = (
            f"Top speed {limits['top_speed']:.1f} m/s\n"
            f"Standing jump {limits['standing_height']:.2f} m high, {limits['standing_air']:.2f} s air\n"
            f"Running jump {limits['run_distance']:.1f} m across, {limits['run_height']:.2f} m high, "
            f"{limits['run_air']:.2f} s air\n"
            f"So: gaps under {limits['run_distance']:.1f} m and ledges under "
            f"{limits['run_height']:.2f} m are reachable without a ramp"
        )
        self.report({"INFO"}, f"Running jump {limits['run_distance']:.1f} m across, "
                              f"{limits['run_height']:.2f} m high")

        # Draw the full-speed jump from the spawn so the reach is visible in the level.
        scene = context.scene
        clear_role(scene, "ARC", REACH_NAME)
        spawn = utils.find_spawn(scene)
        bvh, _count = utils.build_level_bvh(context)
        if spawn is not None and bvh is not None:
            direction = utils.spawn_launch_direction(spawn)
            flat = Vector((direction.x, direction.y, 0.0))
            if flat.length > 1e-6:
                flat.normalize()
                start = utils.marker_center(spawn) + flat * 0.0
                velocity = flat * limits["top_speed"] + UP * 0.0
                result = fly(bvh, settings.marble_radius, params, start, velocity,
                             hz=settings.physics_hz, max_time=8.0, hold=flat)
                draw_trajectory(context, REACH_NAME, result["path"], (0.3, 1.0, 0.5, 1.0),
                                settings.marble_radius)
        return {"FINISHED"}


class MARBLE_OT_clear_ramps(bpy.types.Operator):
    bl_idname = "marble.clear_ramps"
    bl_label = "Clear Ramps"
    bl_description = "Remove ramp markers and their trajectories"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        scene = context.scene
        clear_role(scene, "RAMP")
        clear_role(scene, "ARC", RAMP_ARC_NAME)
        clear_role(scene, "ARC", REACH_NAME)
        get_settings(context).ramp_result = ""
        return {"FINISHED"}


CLASSES = (
    MARBLE_OT_mark_ramp,
    MARBLE_OT_analyse_ramps,
    MARBLE_OT_marble_limits,
    MARBLE_OT_clear_ramps,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
