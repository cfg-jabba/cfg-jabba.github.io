"""Run replays: every playtest is baked into a keyframed ghost marble.

The ghosts are ordinary animated objects, so watching your attempts back is just
Blender's own timeline playback - scrub, loop, render, whatever. With Race Ghosts
on they all start on the same frame so the attempts run side by side.
"""

import bpy
from bpy.props import StringProperty
from mathutils import Vector

from . import utils
from .props import get_settings

RUN_INDEX = "marble_run_index"
RUN_TIME = "marble_run_time"
RUN_DEATHS = "marble_run_deaths"
RUN_FINISHED = "marble_run_finished"
RUN_SPEED = "marble_run_max_speed"

PALETTE = (
    (1.00, 0.45, 0.10, 1.0),
    (0.25, 0.75, 1.00, 1.0),
    (0.35, 0.90, 0.40, 1.0),
    (1.00, 0.85, 0.20, 1.0),
    (0.90, 0.35, 0.85, 1.0),
    (0.30, 1.00, 0.85, 1.0),
    (1.00, 0.30, 0.35, 1.0),
    (0.65, 0.55, 1.00, 1.0),
)


# --------------------------------------------------------------------------- helpers
def scene_fps(scene):
    return scene.render.fps / scene.render.fps_base


def all_runs(scene=None):
    """Recorded runs, oldest first."""
    scene = scene or bpy.context.scene
    runs = utils.objects_with_role("RUN", scene)
    return sorted(runs, key=lambda o: o.get(RUN_INDEX, 0))


def next_run_index(scene):
    runs = all_runs(scene)
    return max((r.get(RUN_INDEX, 0) for r in runs), default=0) + 1


def action_fcurves(obj):
    """The object's fcurves, on both the classic and the 4.4+ slotted action layout."""
    anim = obj.animation_data
    if anim is None or anim.action is None:
        return []
    action = anim.action
    curves = list(action.fcurves)
    if curves:
        return curves
    try:  # Blender 4.4+ layered actions
        slot = anim.action_slot
        for layer in action.layers:
            for strip in layer.strips:
                bag = strip.channelbag(slot)
                if bag is not None:
                    curves.extend(bag.fcurves)
    except (AttributeError, TypeError, RuntimeError):
        pass
    return curves


def _fill_curve(fcurve, frames, values):
    """Bulk-write a whole fcurve. keyframe_insert per sample is far too slow."""
    points = fcurve.keyframe_points
    count = len(frames)
    if len(points) < count:
        points.add(count - len(points))
    flat = []
    for frame, value in zip(frames, values):
        flat.extend((frame, value))
    points.foreach_set("co", flat)
    points.foreach_set("interpolation", [1] * count)   # 1 = LINEAR
    fcurve.update()


def run_frame_range(obj):
    frames = [p.co[0] for fc in action_fcurves(obj) for p in fc.keyframe_points]
    if not frames:
        return None, None
    return min(frames), max(frames)


def shift_run(obj, delta):
    if abs(delta) < 1e-6:
        return
    for fcurve in action_fcurves(obj):
        points = fcurve.keyframe_points
        count = len(points)
        if not count:
            continue
        buf = [0.0] * (count * 2)
        points.foreach_get("co", buf)
        for i in range(count):
            buf[i * 2] += delta
        points.foreach_set("co", buf)
        fcurve.update()


# --------------------------------------------------------------------------- baking
def bake_run(context, samples, meta):
    """Turn [(location, quaternion), ...] sampled at scene fps into a ghost marble."""
    if len(samples) < 2:
        return None
    settings = get_settings(context)
    scene = context.scene
    index = next_run_index(scene)
    color = PALETTE[(index - 1) % len(PALETTE)]

    label = f"Run {index}"
    if meta.get("finished"):
        label += f" ({meta['time']:.2f}s)"
    else:
        label += f" ({meta['time']:.1f}s, DNF)"

    ghost = utils.make_marble_mesh(label, settings.marble_radius * 0.98, color=color)
    ghost.name = label
    ghost.rotation_mode = "QUATERNION"
    # Its own material, or every ghost would share the one the marble mesh ships with.
    ghost.data.materials.clear()
    ghost.data.materials.append(utils.get_material(f"Marble Run {index}", color))
    utils.set_role(ghost, "RUN")
    ghost[RUN_INDEX] = index
    ghost[RUN_TIME] = float(meta.get("time", 0.0))
    ghost[RUN_DEATHS] = int(meta.get("deaths", 0))
    ghost[RUN_FINISHED] = bool(meta.get("finished", False))
    ghost[RUN_SPEED] = float(meta.get("max_speed", 0.0))
    utils.link_to_tools(context, ghost, "RUN")

    start = scene.frame_start
    if not settings.align_runs:
        for other in all_runs(scene):
            if other is ghost:
                continue
            _lo, hi = run_frame_range(other)
            if hi is not None:
                start = max(start, int(hi) + int(scene_fps(scene) * 0.5))

    frames = [start + i for i in range(len(samples))]
    location, quaternion = samples[0]
    ghost.location = location
    ghost.rotation_quaternion = quaternion
    ghost.keyframe_insert("location", frame=start)
    ghost.keyframe_insert("rotation_quaternion", frame=start)

    curves = {(fc.data_path, fc.array_index): fc for fc in action_fcurves(ghost)}
    for axis in range(3):
        fcurve = curves.get(("location", axis))
        if fcurve is not None:
            _fill_curve(fcurve, frames, [s[0][axis] for s in samples])
    for axis in range(4):
        fcurve = curves.get(("rotation_quaternion", axis))
        if fcurve is not None:
            _fill_curve(fcurve, frames, [s[1][axis] for s in samples])

    if scene.frame_end < frames[-1]:
        scene.frame_end = int(frames[-1]) + 1

    # Keep the list short so the viewport does not fill up with ghosts.
    runs = all_runs(scene)
    if len(runs) > settings.keep_runs:
        utils.remove_objects(runs[: len(runs) - settings.keep_runs])
    return ghost


# --------------------------------------------------------------------------- operators
class MARBLE_OT_play_runs(bpy.types.Operator):
    bl_idname = "marble.play_runs"
    bl_label = "Watch Replays"
    bl_description = "Rewind to the first frame and play the timeline so the recorded runs run"

    def execute(self, context):
        scene = context.scene
        runs = all_runs(scene)
        if not runs:
            self.report({"WARNING"}, "No runs recorded yet - play the level first")
            return {"CANCELLED"}
        starts = [run_frame_range(r)[0] for r in runs]
        starts = [f for f in starts if f is not None]
        scene.frame_set(int(min(starts)) if starts else scene.frame_start)
        try:
            bpy.ops.screen.animation_cancel(restore_frame=False)
        except RuntimeError:
            pass
        try:
            bpy.ops.screen.animation_play()
        except RuntimeError:
            self.report({"WARNING"}, "Press Space in the timeline to play")
        return {"FINISHED"}


class MARBLE_OT_realign_runs(bpy.types.Operator):
    bl_idname = "marble.realign_runs"
    bl_label = "Re-align Replays"
    bl_description = ("Re-stack the recorded runs: all starting together (Race Ghosts on) "
                      "or one after another")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        scene = context.scene
        runs = all_runs(scene)
        if not runs:
            return {"CANCELLED"}
        cursor = scene.frame_start
        gap = int(scene_fps(scene) * 0.5)
        last = scene.frame_start
        for run in runs:
            lo, hi = run_frame_range(run)
            if lo is None:
                continue
            target = scene.frame_start if settings.align_runs else cursor
            shift_run(run, target - lo)
            length = hi - lo
            cursor = target + length + gap
            last = max(last, target + length)
        if scene.frame_end < last:
            scene.frame_end = int(last) + 1
        mode = "racing together" if settings.align_runs else "back to back"
        self.report({"INFO"}, f"{len(runs)} runs {mode}")
        return {"FINISHED"}


class MARBLE_OT_solo_run(bpy.types.Operator):
    bl_idname = "marble.solo_run"
    bl_label = "Solo"
    bl_description = "Show only this run. Click again to show them all"
    bl_options = {"REGISTER", "UNDO"}

    name: StringProperty()

    def execute(self, context):
        runs = all_runs(context.scene)
        target = bpy.data.objects.get(self.name)
        if target is None:
            return {"CANCELLED"}
        others_hidden = all(r.hide_viewport for r in runs if r is not target)
        for run in runs:
            run.hide_viewport = False if others_hidden else (run is not target)
        return {"FINISHED"}


class MARBLE_OT_delete_run(bpy.types.Operator):
    bl_idname = "marble.delete_run"
    bl_label = "Delete Run"
    bl_description = "Remove this recorded run"
    bl_options = {"REGISTER", "UNDO"}

    name: StringProperty()

    def execute(self, context):
        obj = bpy.data.objects.get(self.name)
        if obj is None:
            return {"CANCELLED"}
        utils.remove_objects([obj])
        return {"FINISHED"}


class MARBLE_OT_clear_runs(bpy.types.Operator):
    bl_idname = "marble.clear_runs"
    bl_label = "Clear Replays"
    bl_description = "Delete every recorded run"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        runs = all_runs(context.scene)
        utils.remove_objects(runs)
        self.report({"INFO"}, f"Removed {len(runs)} runs")
        return {"FINISHED"}


CLASSES = (
    MARBLE_OT_play_runs,
    MARBLE_OT_realign_runs,
    MARBLE_OT_solo_run,
    MARBLE_OT_delete_run,
    MARBLE_OT_clear_runs,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
