"""Level design helpers: markers, jump arcs, speed solver, ramp info, stats, JSON sync."""

import json
import math
import os

import bpy
from bpy.props import EnumProperty, StringProperty
from mathutils import Vector

from . import utils
from .drop_tester import marker_center
from .props import get_settings

ARC_NAME = "Jump Arc"
MARKER_TYPES = [
    ("CHECKPOINT", "Checkpoint", "Respawn point once touched during a playtest"),
    ("FINISH", "Finish", "Touching this ends the run and records the time"),
    ("TARGET", "Jump Target", "Landing spot used by the launch-speed solver"),
]
SETTINGS_SKIP = {"level_collection", "drop_result", "play_result", "design_result", "is_playing", "preset"}


# --------------------------------------------------------------------------- physics maths
def simulate_arc(origin, velocity, gravity, radius, bvh, max_time, samples):
    """March a projectile until it touches the level (sphere of `radius`) or time runs out."""
    dt = max_time / samples
    pos = origin.copy()
    points = [pos.copy()]
    hit = None
    t = 0.0
    g = Vector((0.0, 0.0, -gravity))
    for i in range(1, samples + 1):
        # Exact ballistic position; segments are chords of the true parabola.
        ti = i * dt
        new_pos = origin + velocity * ti + g * (0.5 * ti * ti)
        if bvh is not None:
            seg = new_pos - pos
            seg_len = seg.length
            if seg_len > 1e-9:
                loc, _n, _i, dist = bvh.ray_cast(pos, seg / seg_len, seg_len + radius)
                if loc is not None and dist - radius <= seg_len:
                    new_pos = pos + seg / seg_len * max(0.0, dist - radius)
                    hit = new_pos.copy()
            if hit is None:
                loc, _n, _i, dist = bvh.find_nearest(new_pos, radius)
                if loc is not None:
                    hit = new_pos.copy()
        t = ti
        pos = new_pos
        points.append(pos.copy())
        if hit is not None:
            break
    return points, hit, t


def solve_launch_speed(origin, direction, target, gravity):
    """Speed needed along unit `direction` to pass through `target`. None if impossible."""
    delta = target - origin
    dh_vec = Vector((delta.x, delta.y, 0.0))
    dist_h = dh_vec.length
    dir_h = Vector((direction.x, direction.y, 0.0))
    dh = dir_h.length
    dz = direction.z
    if dist_h < 1e-6 or dh < 1e-6:
        return None
    # Only the component of horizontal distance along the launch heading counts.
    along = dh_vec.dot(dir_h.normalized())
    if along <= 0.0:
        return None
    denom = dh * (along * dz - delta.z * dh)
    if denom <= 1e-9:
        return None
    v2 = 0.5 * gravity * along * along / denom
    if v2 <= 0.0:
        return None
    return math.sqrt(v2)


# --------------------------------------------------------------------------- operators
class MARBLE_OT_add_marker(bpy.types.Operator):
    bl_idname = "marble.add_marker"
    bl_label = "Add Marker"
    bl_description = "Add a checkpoint, finish or jump-target marker at the 3D cursor"
    bl_options = {"REGISTER", "UNDO"}

    marker_type: EnumProperty(name="Type", items=MARKER_TYPES, default="CHECKPOINT")

    def execute(self, context):
        settings = get_settings(context)
        names = {"CHECKPOINT": "Checkpoint", "FINISH": "Finish", "TARGET": "Jump Target"}
        empty = bpy.data.objects.new(names[self.marker_type], None)
        if self.marker_type == "TARGET":
            empty.empty_display_type = "PLAIN_AXES"
            empty.empty_display_size = max(settings.marble_radius, 0.25)
        else:
            empty.empty_display_type = "SPHERE"
            empty.empty_display_size = settings.marker_radius
            empty["marble_tools_radius"] = settings.marker_radius
        empty.location = context.scene.cursor.location.copy()
        utils.set_role(empty, self.marker_type)
        utils.link_to_tools(context, empty)
        for obj in context.selected_objects:
            obj.select_set(False)
        empty.select_set(True)
        context.view_layer.objects.active = empty
        return {"FINISHED"}


class MARBLE_OT_jump_arc(bpy.types.Operator):
    bl_idname = "marble.jump_arc"
    bl_label = "Preview Jump Arc"
    bl_description = ("Draw the flight path of a marble launched from the spawn along its Y arrow "
                      "at Arc Speed, and report where it lands")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        spawn = utils.get_or_create_spawn(context)
        bvh, _count = utils.build_level_bvh(context)
        radius = settings.marble_radius
        origin = marker_center(spawn, radius)
        direction = utils.spawn_launch_direction(spawn)
        velocity = direction * settings.arc_speed

        points, hit, t = simulate_arc(
            origin, velocity, settings.gravity, radius, bvh, settings.arc_max_time, settings.arc_samples
        )
        for old in utils.objects_with_role("ARC", context.scene):
            utils.remove_objects([old])
        if len(points) > 1:
            curve = utils.make_path_curve(
                context, ARC_NAME, points, radius=max(radius * 0.06, 0.01),
                color=(0.2, 1.0, 0.9, 1.0), role="ARC",
            )
            curve.hide_select = True

        apex = max(p.z for p in points) - origin.z
        end = points[-1]
        horiz = Vector((end.x - origin.x, end.y - origin.y, 0.0)).length
        angle = math.degrees(math.asin(max(-1.0, min(1.0, direction.z))))
        if hit is not None:
            outcome = f"lands after {t:.2f}s"
        else:
            outcome = f"no landing within {settings.arc_max_time:.1f}s"
        result = (f"Arc @ {settings.arc_speed:.1f} m/s, {angle:.0f}° | {outcome} | "
                  f"horizontal {horiz:.2f} m | drop {end.z - origin.z:+.2f} m | apex +{apex:.2f} m")

        targets = utils.objects_with_role("TARGET", context.scene)
        if targets:
            tgt = marker_center(targets[0], radius)
            miss = end - tgt
            miss_h = Vector((miss.x, miss.y, 0.0)).length
            result += f" | vs target: {miss_h:.2f} m off, {miss.z:+.2f} m high"
        settings.design_result = result
        self.report({"INFO"}, result)
        return {"FINISHED"}


class MARBLE_OT_solve_jump_speed(bpy.types.Operator):
    bl_idname = "marble.solve_jump_speed"
    bl_label = "Solve Launch Speed"
    bl_description = ("Compute the launch speed needed to fly from the spawn (along its Y arrow) "
                      "to the Jump Target marker. Sets Arc Speed and Launch Speed to the answer")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        spawn = utils.get_or_create_spawn(context)
        targets = utils.objects_with_role("TARGET", context.scene)
        if not targets:
            self.report({"ERROR"}, "Add a Jump Target marker first (Level Design > Add Marker > Jump Target)")
            return {"CANCELLED"}
        radius = settings.marble_radius
        origin = marker_center(spawn, radius)
        target = marker_center(targets[0], radius)
        direction = utils.spawn_launch_direction(spawn)
        speed = solve_launch_speed(origin, direction, target, settings.gravity)
        if speed is None:
            settings.design_result = ("No solution: point the spawn's Y arrow towards the target and "
                                      "tilt it upward enough to reach the target height")
            self.report({"WARNING"}, settings.design_result)
            return {"CANCELLED"}
        settings.arc_speed = speed
        settings.launch_speed = speed
        angle = math.degrees(math.asin(max(-1.0, min(1.0, direction.z))))
        dist = (target - origin).length
        settings.design_result = (f"Need {speed:.2f} m/s at {angle:.0f}° to reach target "
                                  f"{dist:.2f} m away (gravity {settings.gravity:.1f})")
        self.report({"INFO"}, settings.design_result)
        bpy.ops.marble.jump_arc()
        return {"FINISHED"}


class MARBLE_OT_ramp_info(bpy.types.Operator):
    bl_idname = "marble.ramp_info"
    bl_label = "Ramp Info"
    bl_description = ("Report the slope angle, downhill direction and speed gained for the selected "
                      "faces (Edit Mode) or the whole active mesh (Object Mode)")
    bl_options = {"REGISTER"}

    @classmethod
    def poll(cls, context):
        return context.active_object is not None and context.active_object.type == "MESH"

    def execute(self, context):
        import bmesh

        settings = get_settings(context)
        obj = context.active_object
        mat = obj.matrix_world
        nmat = mat.to_3x3().inverted_safe().transposed()

        if obj.mode == "EDIT":
            bm = bmesh.from_edit_mesh(obj.data)
            faces = [f for f in bm.faces if f.select]
            label = f"{len(faces)} selected faces"
        else:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bm.normal_update()
            faces = list(bm.faces)
            label = f"all {len(faces)} faces of {obj.name}"
            # Closed meshes cancel out, so only look at the surfaces a marble can roll on.
            up_faces = [f for f in faces if (nmat @ f.normal).z > 0.5]  # flatter than 60°
            if up_faces:
                faces = up_faces
                label = f"{len(faces)} upward faces of {obj.name}"
        if not faces:
            self.report({"ERROR"}, "Select at least one face")
            return {"CANCELLED"}

        normal = Vector((0.0, 0.0, 0.0))
        zs = []
        for f in faces:
            normal += (nmat @ f.normal) * f.calc_area()
            zs.extend((mat @ v.co).z for v in f.verts)
        if obj.mode != "EDIT":
            bm.free()
        if normal.length < 1e-9:
            self.report({"ERROR"}, "Faces have no usable normal")
            return {"CANCELLED"}
        normal.normalize()
        if normal.z < 0:
            normal = -normal
        slope = math.degrees(math.acos(max(-1.0, min(1.0, normal.z))))
        down = Vector((0.0, 0.0, -1.0))
        downhill = down - normal * down.dot(normal)
        height = max(zs) - min(zs)
        g = settings.gravity
        v_slide = math.sqrt(2.0 * g * height)
        v_roll = math.sqrt(10.0 / 7.0 * g * height)
        heading = ""
        if downhill.length > 1e-6:
            downhill.normalize()
            heading = f" | downhill heading {math.degrees(math.atan2(downhill.y, downhill.x)):.0f}°"
        result = (f"{label}: slope {slope:.1f}° | height {height:.2f} m{heading} | "
                  f"speed gained from rest: {v_roll:.1f} m/s rolling, {v_slide:.1f} m/s sliding "
                  f"(no friction)")
        settings.design_result = result
        self.report({"INFO"}, result)
        return {"FINISHED"}


class MARBLE_OT_level_stats(bpy.types.Operator):
    bl_idname = "marble.level_stats"
    bl_label = "Level Stats"
    bl_description = "Polygon count, bounds and common physics gotchas for the level geometry"
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = get_settings(context)
        objs = utils.get_level_objects(context)
        if not objs:
            settings.design_result = "No level geometry found"
            self.report({"WARNING"}, settings.design_result)
            return {"CANCELLED"}
        bvh, tri_count = utils.build_level_bvh(context, objs)
        lo, hi = utils.level_bounds(context, objs)
        size = hi - lo
        warnings = []
        for obj in objs:
            s = obj.matrix_world.to_scale()
            if any(v < 0 for v in s):
                warnings.append(f"{obj.name}: negative scale (flipped normals)")
            elif any(abs(v - 1.0) > 1e-4 for v in s):
                warnings.append(f"{obj.name}: unapplied scale")
            if obj.type != "MESH":
                warnings.append(f"{obj.name}: {obj.type.lower()} (drop tester needs meshes)")
        result = (f"{len(objs)} objects, {tri_count} polygons | size {size.x:.1f} x {size.y:.1f} x "
                  f"{size.z:.1f} m | z from {lo.z:.1f} to {hi.z:.1f} (kill z {settings.kill_z:.0f})")
        if warnings:
            result += " | WARN " + "; ".join(warnings[:6])
            if len(warnings) > 6:
                result += f" (+{len(warnings) - 6} more)"
        settings.design_result = result
        self.report({"INFO"}, result)
        return {"FINISHED"}


class MARBLE_OT_clear_design(bpy.types.Operator):
    bl_idname = "marble.clear_design"
    bl_label = "Clear Arcs"
    bl_description = "Remove jump arc previews"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        utils.remove_objects(utils.objects_with_role("ARC", context.scene))
        get_settings(context).design_result = ""
        return {"FINISHED"}


# --------------------------------------------------------------------------- settings sync
def settings_to_dict(settings):
    data = {}
    for prop in settings.bl_rna.properties:
        name = prop.identifier
        if name in SETTINGS_SKIP or name == "rna_type":
            continue
        value = getattr(settings, name)
        if isinstance(value, (int, float, bool, str)):
            data[name] = value
    return data


def dict_to_settings(settings, data):
    applied = 0
    for name, value in data.items():
        if name in SETTINGS_SKIP or not hasattr(settings, name):
            continue
        try:
            setattr(settings, name, value)
            applied += 1
        except (TypeError, ValueError):
            pass
    return applied


class MARBLE_OT_export_settings(bpy.types.Operator):
    bl_idname = "marble.export_settings"
    bl_label = "Export Settings (.json)"
    bl_description = "Save all physics / tool settings to a JSON file (share it with the Godot project)"

    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def invoke(self, context, event):
        if not self.filepath:
            self.filepath = "marble_settings.json"
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        path = self.filepath
        if not path.lower().endswith(".json"):
            path += ".json"
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(settings_to_dict(get_settings(context)), fh, indent=2, sort_keys=True)
        self.report({"INFO"}, f"Saved {os.path.basename(path)}")
        return {"FINISHED"}


class MARBLE_OT_import_settings(bpy.types.Operator):
    bl_idname = "marble.import_settings"
    bl_label = "Import Settings (.json)"
    bl_description = "Load physics / tool settings from a JSON file made by Export Settings"
    bl_options = {"REGISTER", "UNDO"}

    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        try:
            with open(self.filepath, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError) as exc:
            self.report({"ERROR"}, f"Could not read settings: {exc}")
            return {"CANCELLED"}
        if not isinstance(data, dict):
            self.report({"ERROR"}, "Settings file must contain a JSON object")
            return {"CANCELLED"}
        n = dict_to_settings(get_settings(context), data)
        self.report({"INFO"}, f"Applied {n} settings")
        return {"FINISHED"}


def parse_godot_project(text):
    """Pull the physics numbers we care about out of a project.godot file."""
    found = {}
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].strip()
            continue
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"')
        full = f"{section}/{key}" if section else key
        try:
            number = float(value)
        except ValueError:
            continue
        if full == "physics/3d/default_gravity":
            found["gravity"] = number
        elif full == "physics/common/physics_ticks_per_second":
            found["physics_hz"] = int(number)
    return found


class MARBLE_OT_import_godot_project(bpy.types.Operator):
    bl_idname = "marble.import_godot_project"
    bl_label = "Read project.godot"
    bl_description = ("Read gravity and physics tick rate from a Godot project.godot file so the "
                      "playtest uses the same values as the game")
    bl_options = {"REGISTER", "UNDO"}

    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.godot", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        try:
            with open(self.filepath, "r", encoding="utf-8") as fh:
                found = parse_godot_project(fh.read())
        except OSError as exc:
            self.report({"ERROR"}, f"Could not read project: {exc}")
            return {"CANCELLED"}
        settings = get_settings(context)
        applied = dict_to_settings(settings, found)
        if "gravity" not in found:
            settings.gravity = 9.8  # Godot default when the project does not override it
        msg = f"project.godot: gravity {settings.gravity:.2f}, physics {settings.physics_hz} Hz ({applied} overrides)"
        settings.design_result = msg
        self.report({"INFO"}, msg)
        return {"FINISHED"}


CLASSES = (
    MARBLE_OT_add_marker,
    MARBLE_OT_jump_arc,
    MARBLE_OT_solve_jump_speed,
    MARBLE_OT_ramp_info,
    MARBLE_OT_level_stats,
    MARBLE_OT_clear_design,
    MARBLE_OT_export_settings,
    MARBLE_OT_import_settings,
    MARBLE_OT_import_godot_project,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
