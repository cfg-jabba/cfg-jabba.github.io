"""Level design helpers: game boxes, markers, jump arcs, speed solver, ramp info,
stats, and syncing the physics numbers from the Godot project."""

import json
import math
import os
import re

import bpy
from bpy.props import EnumProperty, StringProperty
from mathutils import Vector

from . import utils
from .props import get_settings
from .utils import marker_center

ARC_NAME = "Jump Arc"
TUTORIAL_URL = "https://github.com/cfg-jabba/cfg-jabba.github.io/blob/main/blender/TUTORIAL.md"
MARKER_TYPES = [
    ("CHECKPOINT", "Checkpoint", "Respawn point once touched during a playtest"),
    ("TARGET", "Jump Target", "Landing spot used by the launch-speed solver"),
]
GAME_BOX_TYPES = [
    ("SPAWN", "Spawn", "spawnbox: where the marble starts (its origin is the marble centre)"),
    ("TIMER", "Timer", "timer-box: the run clock starts when the marble enters it"),
    ("FINISH", "Finish", "finish-box: entering it ends the run"),
    ("FALL", "Fall", "fall-box: a slab under the level that respawns the marble (auto-sized)"),
]
SETTINGS_SKIP = {"level_collection", "drop_result", "play_result", "design_result", "sync_result",
                 "ramp_result", "limits_result", "is_playing", "preset",
                 "show_dev", "show_dev_arcs", "show_dev_boxes", "show_dev_runs"}


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


def _select_only(context, obj):
    for other in context.selected_objects:
        other.select_set(False)
    obj.select_set(True)
    context.view_layer.objects.active = obj


# --------------------------------------------------------------------------- game boxes
class MARBLE_OT_add_game_box(bpy.types.Operator):
    bl_idname = "marble.add_game_box"
    bl_label = "Add Game Box"
    bl_description = ("Add (or move) one of the zones the game wires by name: spawnbox, timer-box, "
                      "finish-box, fall-box. Sized so Godot's zone = scale x 2")
    bl_options = {"REGISTER", "UNDO"}

    kind: EnumProperty(name="Kind", items=GAME_BOX_TYPES, default="FINISH")

    def execute(self, context):
        settings = get_settings(context)
        scene = context.scene
        cursor = scene.cursor.location.copy()

        if self.kind == "SPAWN":
            bpy.ops.marble.add_spawn()
            self.report({"INFO"}, "spawnbox placed at the cursor (marble centre)")
            return {"FINISHED"}

        existing = utils.objects_with_role(self.kind, scene)
        if self.kind == "FALL":
            lo, hi = utils.level_bounds(context)
            if lo is None:
                location = cursor + Vector((0.0, 0.0, -10.0))
                half = Vector((60.0, 60.0, 5.0))
            else:
                margin = 20.0
                half = Vector(((hi.x - lo.x) * 0.5 + margin, (hi.y - lo.y) * 0.5 + margin, 5.0))
                location = Vector(((lo.x + hi.x) * 0.5, (lo.y + hi.y) * 0.5, lo.z - 10.0 - half.z))
            note = f"fall-box under the level, top at z={location.z + half.z:.1f}"
        else:
            h = settings.box_size * 0.5
            half = Vector((h, h, h))
            location = cursor + Vector((0.0, 0.0, h))
            note = f"{utils.GAME_BOX_NAMES[self.kind]} at the cursor, {settings.box_size:.1f} m"

        if existing:
            box = existing[0]
            box.location = location
            box.scale = half
            if box.type == "EMPTY":
                box.empty_display_type = "CUBE"
                box.empty_display_size = 1.0
            box[utils.BOX_PROP] = True
        else:
            box = utils.create_game_box(context, self.kind, location, half)
        _select_only(context, box)
        self.report({"INFO"}, note)
        return {"FINISHED"}


class MARBLE_OT_add_marker(bpy.types.Operator):
    bl_idname = "marble.add_marker"
    bl_label = "Add Marker"
    bl_description = "Add a checkpoint or jump-target marker at the 3D cursor"
    bl_options = {"REGISTER", "UNDO"}

    marker_type: EnumProperty(name="Type", items=MARKER_TYPES, default="CHECKPOINT")

    def execute(self, context):
        settings = get_settings(context)
        names = {"CHECKPOINT": "Checkpoint", "TARGET": "Jump Target"}
        empty = bpy.data.objects.new(names[self.marker_type], None)
        if self.marker_type == "TARGET":
            empty.empty_display_type = "PLAIN_AXES"
            empty.empty_display_size = max(settings.marble_radius, 0.25)
            empty.location = context.scene.cursor.location.copy() + Vector((0.0, 0.0, settings.marble_radius))
        else:
            empty.empty_display_type = "SPHERE"
            empty.empty_display_size = settings.marker_radius
            empty["marble_tools_radius"] = settings.marker_radius
            empty.location = context.scene.cursor.location.copy() + Vector((0.0, 0.0, settings.marble_radius))
        utils.set_role(empty, self.marker_type)
        utils.link_to_tools(context, empty, "BOX")
        _select_only(context, empty)
        return {"FINISHED"}


class MARBLE_OT_add_cosmetic(bpy.types.Operator):
    bl_idname = "marble.add_cosmetic"
    bl_label = "Add Cosmetic"
    bl_description = ("Add a cosmetic pickup anchor at the 3D cursor, auto-numbered cosmetic1, "
                      "cosmetic2, ... which is what the level script spawns pickups on")
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        name = utils.next_cosmetic_name(context.scene)
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "SPHERE"
        empty.empty_display_size = max(settings.marble_radius, 0.25)
        empty.location = context.scene.cursor.location.copy() + Vector((0.0, 0.0, settings.cosmetic_height))
        utils.set_role(empty, "COSMETIC")
        utils.link_to_tools(context, empty, "BOX")
        _select_only(context, empty)
        self.report({"INFO"}, f"{name} placed {settings.cosmetic_height:.1f} m above the cursor")
        return {"FINISHED"}


class MARBLE_OT_toggle_dev(bpy.types.Operator):
    bl_idname = "marble.toggle_dev"
    bl_label = "Toggle Dev Tools"
    bl_description = "Show or hide everything this add-on generates (arcs, paths, boxes, replays)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = get_settings(context)
        settings.show_dev = not settings.show_dev
        return {"FINISHED"}


# --------------------------------------------------------------------------- jumps
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
            self.report({"ERROR"}, "Add a Jump Target marker first (Level Design > Markers > Target)")
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


# --------------------------------------------------------------------------- inspect
class MARBLE_OT_ramp_info(bpy.types.Operator):
    bl_idname = "marble.ramp_info"
    bl_label = "Ramp Info"
    bl_description = ("Report the slope angle, downhill direction and speed gained for the selected "
                      "faces (Edit Mode) or the rollable faces of the active mesh (Object Mode)")
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
        wall = " | WALL (steeper than slope limit)" if slope > settings.slope_limit else ""
        result = (f"{label}: slope {slope:.1f}°{wall} | height {height:.2f} m{heading} | "
                  f"speed gained from rest: {v_roll:.1f} m/s rolling, {v_slide:.1f} m/s sliding "
                  f"(no friction)")
        settings.design_result = result
        self.report({"INFO"}, result)
        return {"FINISHED"}


class MARBLE_OT_level_stats(bpy.types.Operator):
    bl_idname = "marble.level_stats"
    bl_label = "Level Stats"
    bl_description = "Polygon count, bounds, which game boxes exist, and common physics gotchas"
    bl_options = {"REGISTER"}

    def execute(self, context):
        settings = get_settings(context)
        scene = context.scene
        objs = utils.get_level_objects(context)
        if not objs:
            settings.design_result = "No level geometry found"
            self.report({"WARNING"}, settings.design_result)
            return {"CANCELLED"}
        _bvh, tri_count = utils.build_level_bvh(context, objs)
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
        boxes = []
        for kind in ("SPAWN", "TIMER", "FINISH", "FALL"):
            have = utils.objects_with_role(kind, scene)
            boxes.append(f"{utils.GAME_BOX_NAMES[kind]} {'ok' if have else 'MISSING'}")
        result = (f"{len(objs)} objects, {tri_count} polygons | size {size.x:.1f} x {size.y:.1f} x "
                  f"{size.z:.1f} m | z from {lo.z:.1f} to {hi.z:.1f} | " + ", ".join(boxes))
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


class MARBLE_OT_open_tutorial(bpy.types.Operator):
    bl_idname = "marble.open_tutorial"
    bl_label = "Open Tutorial"
    bl_description = "Open the step-by-step tutorial in your browser"

    def execute(self, context):
        bpy.ops.wm.url_open(url=TUTORIAL_URL)
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
    bl_description = "Save all physics / tool settings to a JSON file"

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


# --- Godot project parsing ---------------------------------------------------
GD_NUMBER_RE = re.compile(
    r"^\s*(?:@export\s+)?(?:const|var)\s+(\w+)\s*:\s*(?:float|int)\s*=\s*(-?\d+(?:\.\d+)?)",
    re.MULTILINE,
)


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


def parse_gd_numbers(text):
    """All `const NAME : float = 1.0` / `var name : float = 2.0` numbers in a GDScript file."""
    return {name: float(value) for name, value in GD_NUMBER_RE.findall(text)}


def parse_player_tscn(text):
    """Mass, gravity scale, material and sphere radius from a player.tscn."""
    out = {}
    sections = re.split(r"^\[", text, flags=re.MULTILINE)
    for section in sections:
        header, _, body = section.partition("\n")
        props = {}
        for line in body.splitlines():
            if "=" in line and not line.startswith("["):
                key, _, value = line.partition("=")
                try:
                    props[key.strip()] = float(value.strip())
                except ValueError:
                    pass
        if 'type="PhysicsMaterial"' in header and "friction" not in out:
            out.update({k: props[k] for k in ("friction", "bounce") if k in props})
        elif 'type="SphereShape3D"' in header and "radius" not in out:
            if "radius" in props:
                out["radius"] = props["radius"]
        elif 'type="RigidBody3D"' in header:
            out.update({k: props[k] for k in ("mass", "gravity_scale", "linear_damp") if k in props})
    return out


def godot_to_settings(project, player, tscn, camera):
    """Map the game's numbers onto add-on settings (see props.GAME for the derivation)."""
    out = {}
    hz = int(project.get("physics_hz", 60))
    out["physics_hz"] = hz
    mass = float(tscn.get("mass", 1.0)) or 1.0
    out["marble_mass"] = mass
    out["gravity"] = float(project.get("gravity", 9.8)) * float(tscn.get("gravity_scale", 1.0))
    if "radius" in tscn:
        out["marble_radius"] = tscn["radius"]
    if "friction" in tscn:
        out["rb_friction"] = tscn["friction"]
    if "bounce" in tscn:
        out["rb_bounciness"] = tscn["bounce"]
        out["bounce"] = tscn["bounce"]

    p = player
    if "ROLL_FORCE" in p:
        out["accel"] = p["ROLL_FORCE"] / mass
        out["air_accel"] = out["accel"] * p.get("AIR_CONTROL", 1.0)
    if "MAX_SPEED" in p:
        out["max_speed"] = p["MAX_SPEED"]
    if "JUMP_IMPULSE" in p:
        out["jump_speed"] = p["JUMP_IMPULSE"] / mass
    if "JUMP_SPEED_BONUS" in p:
        out["jump_bonus"] = p["JUMP_SPEED_BONUS"] / mass
    direct = {
        "JUMP_BONUS_MIN": "jump_bonus_min", "JUMP_BONUS_SPAN": "jump_bonus_span",
        "GROUND_DAMP": "friction", "COAST_DAMP": "coast_friction", "AIR_DAMP": "air_friction",
        "RAMP_KEEP": "ramp_keep", "FLOW_LIMIT": "flow_limit", "SLOPE_BOOST": "slope_boost",
        "UPHILL_ASSIST": "uphill_assist", "ASSIST_MIN_SPEED": "assist_min_speed",
        "COYOTE_TIME": "coyote_time", "JUMP_BUFFER": "jump_buffer",
    }
    for src, dst in direct.items():
        if src in p:
            out[dst] = p[src]
    if "AIR_DRAG" in p:
        out["air_drag"] = 1.0 - p["AIR_DRAG"] ** hz   # per-frame multiplier -> per-second loss

    c = camera
    if "camrot_v" in c:
        out["cam_pitch"] = c["camrot_v"]
    if "_zoom_target" in c:
        out["cam_distance"] = c["_zoom_target"]
    if "h_sensitivity" in c:
        out["mouse_sensitivity"] = c["h_sensitivity"]
    if "FOLLOW_RATE" in c:
        out["cam_follow_rate"] = c["FOLLOW_RATE"]
    out["fall_gravity_mult"] = 1.0
    out["jump_cut"] = False
    return out


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return None


class MARBLE_OT_sync_godot(bpy.types.Operator):
    bl_idname = "marble.sync_godot"
    bl_label = "Sync from Godot Project"
    bl_description = ("Pick the game's project.godot: reads gravity and tick rate from it, then the "
                      "marble numbers from player.gd / player.tscn and the camera from camera_rig.gd "
                      "in the same folder, and applies them all")
    bl_options = {"REGISTER", "UNDO"}

    filepath: StringProperty(subtype="FILE_PATH")
    filter_glob: StringProperty(default="*.godot", options={"HIDDEN"})

    def invoke(self, context, event):
        context.window_manager.fileselect_add(self)
        return {"RUNNING_MODAL"}

    def execute(self, context):
        text = _read(self.filepath)
        if text is None:
            self.report({"ERROR"}, f"Could not read {self.filepath}")
            return {"CANCELLED"}
        folder = os.path.dirname(self.filepath)
        project = parse_godot_project(text)
        used = ["project.godot"]

        player = {}
        gd = _read(os.path.join(folder, "player.gd"))
        if gd is not None:
            player = parse_gd_numbers(gd)
            used.append("player.gd")
        tscn = {}
        ts = _read(os.path.join(folder, "player.tscn"))
        if ts is not None:
            tscn = parse_player_tscn(ts)
            used.append("player.tscn")
        camera = {}
        cam = _read(os.path.join(folder, "camera_rig.gd"))
        if cam is not None:
            camera = parse_gd_numbers(cam)
            used.append("camera_rig.gd")

        values = godot_to_settings(project, player, tscn, camera)
        settings = get_settings(context)
        applied = dict_to_settings(settings, values)
        msg = (f"Synced {applied} settings from {', '.join(used)} | gravity {settings.gravity:.1f} | "
               f"accel {settings.accel:.1f} | max {settings.max_speed:.1f} | jump {settings.jump_speed:.1f}"
               f"+{settings.jump_bonus:.1f} | mass {settings.marble_mass:.2f} r {settings.marble_radius:.2f}")
        if gd is None:
            msg += " | player.gd not found next to project.godot"
        settings.sync_result = msg
        self.report({"INFO"}, msg)
        return {"FINISHED"}


CLASSES = (
    MARBLE_OT_add_game_box,
    MARBLE_OT_add_marker,
    MARBLE_OT_add_cosmetic,
    MARBLE_OT_toggle_dev,
    MARBLE_OT_jump_arc,
    MARBLE_OT_solve_jump_speed,
    MARBLE_OT_ramp_info,
    MARBLE_OT_level_stats,
    MARBLE_OT_clear_design,
    MARBLE_OT_open_tutorial,
    MARBLE_OT_export_settings,
    MARBLE_OT_import_settings,
    MARBLE_OT_sync_godot,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
