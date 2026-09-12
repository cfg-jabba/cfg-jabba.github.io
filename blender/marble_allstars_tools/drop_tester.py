"""Drop Tester: spawn empty + rigid-body marble drop + path tracing.

Uses Blender's built-in Bullet rigid body world, so results match what you see
when scrubbing the timeline. Nothing is written to disk: the point cache stays
in memory and the frame range is capped by the "Sim Frames" setting.
"""

import bpy
from mathutils import Vector

from . import utils
from .props import AUTO_RB_PROP, get_settings

MARBLE_NAME = "Marble (drop)"
PATH_NAME = "Drop Path"
PATH_COLORS = (
    (1.0, 0.35, 0.1, 1.0),
    (0.2, 0.9, 0.3, 1.0),
    (0.3, 0.5, 1.0, 1.0),
    (1.0, 0.9, 0.2, 1.0),
    (0.9, 0.3, 0.9, 1.0),
)


# --------------------------------------------------------------------------- rigid body helpers
def ensure_rigidbody_world(context, settings):
    scene = context.scene
    if scene.rigidbody_world is None:
        with context.temp_override(scene=scene):
            bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.enabled = True
    rbw.substeps_per_frame = settings.substeps
    rbw.solver_iterations = max(rbw.solver_iterations, 10)
    return rbw


def add_rigid_body(context, obj, rb_type):
    """Give `obj` a rigid body of `rb_type` ('ACTIVE' / 'PASSIVE') and return it."""
    if obj.rigid_body is None:
        with context.temp_override(
            object=obj,
            active_object=obj,
            selected_objects=[obj],
            selected_editable_objects=[obj],
            scene=context.scene,
            view_layer=context.view_layer,
        ):
            bpy.ops.rigidbody.object_add(type=rb_type)
    if obj.rigid_body is None:
        raise RuntimeError(f"Could not add a rigid body to '{obj.name}'")
    obj.rigid_body.type = rb_type
    return obj.rigid_body


def remove_rigid_body(context, obj):
    if obj.rigid_body is None:
        return
    with context.temp_override(
        object=obj,
        active_object=obj,
        selected_objects=[obj],
        selected_editable_objects=[obj],
        scene=context.scene,
        view_layer=context.view_layer,
    ):
        bpy.ops.rigidbody.object_remove()


def prepare_level_collisions(context, settings, level_objects):
    """Passive mesh-shape rigid bodies on every level mesh that has none yet."""
    added = 0
    for obj in level_objects:
        if obj.type != "MESH":
            continue
        if obj.rigid_body is None:
            rb = add_rigid_body(context, obj, "PASSIVE")
            obj[AUTO_RB_PROP] = True
            rb.collision_shape = "MESH"
            rb.mesh_source = "FINAL"
            rb.friction = settings.rb_friction
            rb.restitution = settings.rb_bounciness
            added += 1
        elif obj.get(AUTO_RB_PROP, False):
            # Keep our auto bodies in sync with the current settings.
            obj.rigid_body.friction = settings.rb_friction
            obj.rigid_body.restitution = settings.rb_bounciness
    return added


def apply_initial_velocity(obj, velocity, start_frame, fps):
    """Animated-for-three-frames trick so Bullet inherits `velocity` (m/s).

    Bullet only measures a kinematic body's velocity from its second simulated
    frame onwards, so the marble is moved by keyframes for frames
    start..start+2 and released at start+3 with the motion carried over.
    """
    rb = obj.rigid_body
    p0 = obj.location.copy()
    step = velocity / fps
    kinematic_frames = 3

    rb.kinematic = True
    for i in range(kinematic_frames):
        obj.keyframe_insert("rigid_body.kinematic", frame=start_frame + i)
    rb.kinematic = False
    obj.keyframe_insert("rigid_body.kinematic", frame=start_frame + kinematic_frames)

    for i in range(kinematic_frames + 1):
        obj.location = p0 + step * i
        obj.keyframe_insert("location", frame=start_frame + i)
    obj.location = p0

    try:
        action = obj.animation_data.action
        for fcurve in action.fcurves:
            for kp in fcurve.keyframe_points:
                kp.interpolation = "LINEAR"
    except AttributeError:
        pass


def marker_center(marker, radius):
    """Marble centre for a floor-placed marker: local +Z times the marble radius."""
    return marker.matrix_world @ Vector((0.0, 0.0, radius))


def marker_radius(marker):
    return float(marker.get("marble_tools_radius", marker.empty_display_size))


# --------------------------------------------------------------------------- analysis
def analyse_path(points, fps, settings, finish_markers):
    """Return a dict of stats for one marble's recorded positions."""
    speeds = [(points[i] - points[i - 1]).length * fps for i in range(1, len(points))]
    max_speed = max(speeds) if speeds else 0.0
    distance = sum((points[i] - points[i - 1]).length for i in range(1, len(points)))
    max_z = max(p.z for p in points)
    fell_frame = None
    for i, p in enumerate(points):
        if p.z < settings.kill_z:
            fell_frame = i
            break
    finish_frame = None
    for i, p in enumerate(points):
        for marker in finish_markers:
            if (p - marker_center(marker, settings.marble_radius)).length <= marker_radius(marker):
                finish_frame = i
                break
        if finish_frame is not None:
            break
    rest_frame = None
    window = int(fps)
    if len(points) > window:
        for i in range(window, len(points)):
            if (points[i] - points[i - window]).length < settings.marble_radius * 0.05:
                rest_frame = i - window
                break
    return {
        "max_speed": max_speed,
        "distance": distance,
        "max_z": max_z,
        "fell_frame": fell_frame,
        "finish_frame": finish_frame,
        "rest_frame": rest_frame,
        "final": points[-1],
    }


def summarise(results, fps):
    lines = []
    for i, r in enumerate(results):
        tag = f"#{i + 1}"
        if r["finish_frame"] is not None:
            outcome = f"FINISH at {r['finish_frame'] / fps:.2f}s"
        elif r["fell_frame"] is not None:
            outcome = f"fell off at {r['fell_frame'] / fps:.2f}s"
        elif r["rest_frame"] is not None:
            outcome = f"stopped at {r['rest_frame'] / fps:.2f}s"
        else:
            outcome = "still moving at end"
        f = r["final"]
        lines.append(
            f"{tag}: {outcome} | max {r['max_speed']:.1f} m/s | "
            f"travelled {r['distance']:.1f} m | end ({f.x:.1f}, {f.y:.1f}, {f.z:.1f})"
        )
    if len(results) > 1:
        finished = sum(1 for r in results if r["finish_frame"] is not None)
        fell = sum(1 for r in results if r["fell_frame"] is not None)
        lines.insert(0, f"{len(results)} marbles: {finished} finished, {fell} fell off")
    return "\n".join(lines)


# --------------------------------------------------------------------------- operators
class MARBLE_OT_add_spawn(bpy.types.Operator):
    bl_idname = "marble.add_spawn"
    bl_label = "Spawn At Cursor"
    bl_description = ("Create the Marble Spawn empty at the 3D cursor (or move the existing one there). "
                      "Z arrow = up from the floor, Y arrow = launch direction")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        spawn = utils.find_spawn(context.scene)
        if spawn is None:
            spawn = utils.create_spawn(context, context.scene.cursor.location.copy())
        else:
            spawn.location = context.scene.cursor.location.copy()
        for obj in context.selected_objects:
            obj.select_set(False)
        spawn.select_set(True)
        context.view_layer.objects.active = spawn
        return {"FINISHED"}


class MARBLE_OT_spawn_from_active(bpy.types.Operator):
    bl_idname = "marble.spawn_from_active"
    bl_label = "Spawn At Active Object"
    bl_description = "Move the Marble Spawn to the active object's location and rotation"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        return context.active_object is not None and utils.get_role(context.active_object) != "SPAWN"

    def execute(self, context):
        src = context.active_object
        spawn = utils.get_or_create_spawn(context)
        spawn.matrix_world = src.matrix_world.copy()
        spawn.scale = (1.0, 1.0, 1.0)
        return {"FINISHED"}


class MARBLE_OT_select_spawn(bpy.types.Operator):
    bl_idname = "marble.select_spawn"
    bl_label = "Select Spawn"
    bl_description = "Select the Marble Spawn empty so you can move (G) or rotate (R) it"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        spawn = utils.get_or_create_spawn(context)
        for obj in context.selected_objects:
            obj.select_set(False)
        spawn.select_set(True)
        context.view_layer.objects.active = spawn
        return {"FINISHED"}


class MARBLE_OT_drop(bpy.types.Operator):
    bl_idname = "marble.drop"
    bl_label = "Drop Marble"
    bl_description = "Drop one or more rigid-body marbles from the spawn, simulate, and trace the paths"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        scene = context.scene
        fps = scene.render.fps / scene.render.fps_base

        try:
            bpy.ops.screen.animation_cancel(restore_frame=False)
        except RuntimeError:
            pass

        level = [o for o in utils.get_level_objects(context) if o.type == "MESH"]
        if not level:
            self.report({"ERROR"}, "No level meshes found. Set a Level Collection or add some geometry.")
            return {"CANCELLED"}

        spawn = utils.get_or_create_spawn(context)
        if not settings.keep_previous:
            clear_generated(context, marbles=True, paths=True)

        rbw = ensure_rigidbody_world(context, settings)
        prepare_level_collisions(context, settings, level)

        start = scene.frame_start
        end = start + settings.sim_frames
        rbw.point_cache.frame_start = start
        rbw.point_cache.frame_end = end
        if scene.frame_end < end:
            scene.frame_end = end

        radius = settings.marble_radius
        base = marker_center(spawn, radius)
        forward = utils.spawn_launch_direction(spawn)
        right = (spawn.matrix_world.to_3x3() @ Vector((1.0, 0.0, 0.0)))
        right = right.normalized() if right.length > 1e-8 else Vector((1.0, 0.0, 0.0))

        count = settings.drop_count
        if count == 1:
            offsets = [0.0]
        else:
            offsets = [(-0.5 + i / (count - 1)) * settings.drop_spread for i in range(count)]

        marbles = []
        for i, off in enumerate(offsets):
            color = PATH_COLORS[i % len(PATH_COLORS)]
            marble = utils.make_marble_mesh(MARBLE_NAME, radius, color=(0.1, 0.6, 1.0, 1.0))
            utils.link_to_tools(context, marble)
            marble.location = base + right * off
            marble["marble_tools_color"] = color
            rb = add_rigid_body(context, marble, "ACTIVE")
            rb.collision_shape = "SPHERE"
            rb.mass = settings.marble_mass
            rb.friction = settings.rb_friction
            rb.restitution = settings.rb_bounciness
            rb.use_deactivation = False
            rb.use_margin = True
            rb.collision_margin = min(0.04, radius * 0.05)
            if settings.launch_speed > 0.0:
                apply_initial_velocity(marble, forward * settings.launch_speed, start, fps)
            marbles.append(marble)

        # Reset the cache and step the simulation frame by frame, recording positions.
        try:
            with context.temp_override(scene=scene):
                bpy.ops.ptcache.free_bake_all()
        except RuntimeError:
            pass
        scene.frame_set(start)
        paths = {m.name: [] for m in marbles}
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            for m in marbles:
                paths[m.name].append(m.matrix_world.translation.copy())

        finish_markers = utils.objects_with_role("FINISH", scene)
        results = []
        for i, m in enumerate(marbles):
            pts = paths[m.name]
            results.append(analyse_path(pts, fps, settings, finish_markers))
            if settings.trace_path and len(pts) > 1:
                color = PATH_COLORS[i % len(PATH_COLORS)]
                curve = utils.make_path_curve(
                    context, PATH_NAME, pts, radius=max(radius * 0.08, 0.01), color=color
                )
                curve.hide_select = True

        summary = summarise(results, fps)
        settings.drop_result = summary
        for line in summary.splitlines():
            self.report({"INFO"}, line)

        scene.frame_set(start)
        if settings.auto_play:
            try:
                bpy.ops.screen.animation_play()
            except RuntimeError:
                pass
        return {"FINISHED"}


def clear_generated(context, marbles=True, paths=True, level_bodies=False, world=False):
    scene = context.scene
    doomed = []
    if marbles:
        doomed += [o for o in utils.objects_with_role("MARBLE", scene) if o.name.startswith(MARBLE_NAME)]
    if paths:
        doomed += [o for o in utils.objects_with_role("PATH", scene) if o.name.startswith(PATH_NAME)]
    for obj in doomed:
        if obj.rigid_body is not None:
            try:
                remove_rigid_body(context, obj)
            except RuntimeError:
                pass
    utils.remove_objects(doomed)

    if level_bodies:
        for obj in list(scene.objects):
            if obj.get(AUTO_RB_PROP, False):
                try:
                    remove_rigid_body(context, obj)
                except RuntimeError:
                    pass
                del obj[AUTO_RB_PROP]
    if world and scene.rigidbody_world is not None:
        try:
            with context.temp_override(scene=scene):
                bpy.ops.rigidbody.world_remove()
        except RuntimeError:
            pass


class MARBLE_OT_clear_drops(bpy.types.Operator):
    bl_idname = "marble.clear_drops"
    bl_label = "Clear Drops"
    bl_description = "Remove dropped marbles and their paths"
    bl_options = {"REGISTER", "UNDO"}

    level_bodies: bpy.props.BoolProperty(
        name="Also remove auto rigid bodies from level",
        description="Strip the passive rigid bodies this add-on added to your level meshes",
        default=False,
    )
    world: bpy.props.BoolProperty(
        name="Also remove rigid body world",
        default=False,
    )

    def execute(self, context):
        try:
            bpy.ops.screen.animation_cancel(restore_frame=True)
        except RuntimeError:
            pass
        clear_generated(context, marbles=True, paths=True, level_bodies=self.level_bodies,
                        world=self.world)
        get_settings(context).drop_result = ""
        return {"FINISHED"}


CLASSES = (
    MARBLE_OT_add_spawn,
    MARBLE_OT_spawn_from_active,
    MARBLE_OT_select_spawn,
    MARBLE_OT_drop,
    MARBLE_OT_clear_drops,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
