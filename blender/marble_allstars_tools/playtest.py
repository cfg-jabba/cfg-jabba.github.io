"""Playtest: drive a marble around the level inside the 3D viewport.

The physics is a small fixed-timestep loop (Godot style: 60 ticks/s by default)
written in plain Python on top of mathutils' BVHTree for sphere-vs-level
collision. It is intentionally simple and fully tunable from the sidebar so the
feel can be matched to the real game by copying the numbers over.

Controls (while playing, mouse over the 3D viewport):
    W A S D / arrows   move (relative to the camera)
    Space              jump (hold to bunny-hop)
    Mouse / Q E        look around        PageUp / PageDown  camera pitch
    Wheel              camera distance    R                  respawn
    Esc / Right mouse  stop
"""

import math
import time
import traceback

import bpy
from mathutils import Euler, Quaternion, Vector

from . import utils
from .drop_tester import marker_center, marker_radius
from .props import get_settings

MARBLE_NAME = "Marble (play)"
PATH_NAME = "Play Path"
UP = Vector((0.0, 0.0, 1.0))
MOVE_KEYS = {
    "W": (1.0, 0.0), "UP_ARROW": (1.0, 0.0),
    "S": (-1.0, 0.0), "DOWN_ARROW": (-1.0, 0.0),
    "A": (0.0, -1.0), "LEFT_ARROW": (0.0, -1.0),
    "D": (0.0, 1.0), "RIGHT_ARROW": (0.0, 1.0),
}
MAX_PATH_POINTS = 20000


class MarblePhysics:
    """Sphere character controller against a BVHTree. No Blender objects inside."""

    def __init__(self, bvh, radius, params):
        self.bvh = bvh
        self.radius = radius
        self.p = params
        self.skin = max(0.005, radius * 0.02)
        self.pos = Vector((0.0, 0.0, 0.0))
        self.vel = Vector((0.0, 0.0, 0.0))
        self.rot = Quaternion()
        self.omega = Vector((0.0, 0.0, 0.0))
        self.on_ground = False
        self.ground_normal = UP.copy()
        self.coyote = 0.0
        self.jumping = False
        self.max_speed_seen = 0.0
        self.jumps = 0
        self.air_time = 0.0
        self.max_air_time = 0.0
        self._cos_slope = math.cos(math.radians(params["slope_limit"]))

    def reset(self, pos):
        self.pos = pos.copy()
        self.vel = Vector((0.0, 0.0, 0.0))
        self.omega = Vector((0.0, 0.0, 0.0))
        self.on_ground = False
        self.coyote = 0.0
        self.jumping = False
        self.air_time = 0.0

    def step(self, dt, move_dir, jump, jump_held=None):
        """Advance one physics tick. Returns 'FELL' when below the kill plane.

        `jump` requests a jump this tick; `jump_held` says whether the jump key is
        still down (used for jump-cut). Defaults to the same as `jump`.
        """
        if jump_held is None:
            jump_held = jump
        substeps = max(1, int(self.p["substeps"]))
        sub_dt = dt / substeps
        status = None
        for _ in range(substeps):
            result = self._substep(sub_dt, move_dir, jump, jump_held)
            jump = False
            if result:
                status = result
        return status

    def _gravity_scale(self, jump_held):
        """Heavier gravity while falling (and while rising after an early jump release)."""
        mult = self.p.get("fall_gravity_mult", 1.0)
        if mult <= 1.0 or self.on_ground:
            return 1.0
        if self.vel.z < 0.0:
            return mult
        if self.p.get("jump_cut", False) and self.jumping and not jump_held:
            return mult
        return 1.0

    def _substep(self, dt, move_dir, jump, jump_held=True):
        p = self.p
        # --- player input
        if move_dir.length_squared > 1e-8:
            if self.on_ground:
                n = self.ground_normal
                d = move_dir - n * move_dir.dot(n)
                accel = p["accel"]
            else:
                d = move_dir
                accel = p["air_accel"]
            if d.length_squared > 1e-8:
                d.normalize()
                along = self.vel.dot(d)
                if along < p["max_speed"]:
                    self.vel += d * min(accel * dt, p["max_speed"] - along)

        # --- rolling friction while grounded
        if self.on_ground and p["friction"] > 0.0:
            n = self.ground_normal
            vn = self.vel.dot(n)
            vt = self.vel - n * vn
            self.vel = vt * max(0.0, 1.0 - p["friction"] * dt) + n * vn

        # --- jump
        if jump and (self.on_ground or self.coyote > 0.0):
            n = self.ground_normal if self.on_ground else UP
            jdir = (UP + n).normalized()
            vj = self.vel.dot(jdir)
            if vj < p["jump_speed"]:
                self.vel += jdir * (p["jump_speed"] - vj)
            self.on_ground = False
            self.coyote = 0.0
            self.jumps += 1
            self.jumping = True

        # --- gravity (heavier on the way down so jumps do not float)
        self.vel.z -= p["gravity"] * self._gravity_scale(jump_held) * dt

        # --- integrate with a tunnelling guard for fast movement
        disp = self.vel * dt
        dist = disp.length
        if self.bvh is not None and dist > self.radius * 0.5:
            direction = disp / dist
            loc, _nrm, _idx, hit_dist = self.bvh.ray_cast(self.pos, direction, dist + self.radius)
            if loc is not None:
                travel = max(0.0, hit_dist - self.radius)
                if travel < dist:
                    disp = direction * travel
        self.pos += disp

        # --- resolve contacts (a few nearest-point iterations handle corners)
        self.on_ground = False
        best_normal = None
        if self.bvh is not None:
            for _ in range(4):
                loc, face_normal, _idx, d = self.bvh.find_nearest(self.pos, self.radius + self.skin)
                if loc is None:
                    break
                push = self.pos - loc
                if push.length > 1e-6:
                    n = push.normalized()
                else:
                    n = face_normal if face_normal.dot(UP) >= 0 else -face_normal
                pen = self.radius - d
                if pen > 0.0:
                    self.pos += n * pen
                vn = self.vel.dot(n)
                if vn < 0.0:
                    self.vel -= n * vn * (1.0 + p["bounce"])
                if n.z >= self._cos_slope:
                    self.on_ground = True
                    if best_normal is None or n.z > best_normal.z:
                        best_normal = n
                if pen <= 0.0:
                    break

        if self.on_ground:
            self.ground_normal = best_normal
            self.coyote = 0.1
            self.jumping = False
            if self.air_time > 0.0:
                self.max_air_time = max(self.max_air_time, self.air_time)
            self.air_time = 0.0
        else:
            self.coyote = max(0.0, self.coyote - dt)
            self.air_time += dt

        # --- visual rolling (rolling without slipping on the contact normal)
        if self.on_ground:
            self.omega = self.vel.cross(self.ground_normal) / self.radius
        angle = self.omega.length * dt
        if angle > 1e-9:
            self.rot = Quaternion(self.omega.normalized(), angle) @ self.rot
            self.rot.normalize()

        speed = self.vel.length
        self.max_speed_seen = max(self.max_speed_seen, speed)
        if self.pos.z < p["kill_z"]:
            return "FELL"
        return None


def params_from_settings(settings):
    return {
        "gravity": settings.gravity,
        "fall_gravity_mult": settings.fall_gravity_mult,
        "jump_cut": settings.jump_cut,
        "accel": settings.accel,
        "air_accel": settings.air_accel,
        "max_speed": settings.max_speed,
        "jump_speed": settings.jump_speed,
        "bounce": settings.bounce,
        "friction": settings.friction,
        "slope_limit": settings.slope_limit,
        "substeps": settings.physics_substeps,
        "kill_z": settings.kill_z,
    }


def camera_rotation(yaw, pitch_deg):
    return Euler((math.radians(90.0 + pitch_deg), 0.0, yaw), "XYZ").to_quaternion()


def camera_basis(yaw, pitch_deg):
    rot = camera_rotation(yaw, pitch_deg)
    view_dir = rot @ Vector((0.0, 0.0, -1.0))
    forward = Vector((view_dir.x, view_dir.y, 0.0))
    if forward.length < 1e-6:
        forward = Vector((-math.sin(yaw), math.cos(yaw), 0.0))
    forward.normalize()
    right = forward.cross(UP).normalized()
    return rot, forward, right


class MARBLE_OT_playtest(bpy.types.Operator):
    bl_idname = "marble.playtest"
    bl_label = "Play Level"
    bl_description = ("Drive a marble around the level in the viewport. "
                      "WASD move, Space jump, mouse/QE look, R respawn, Esc stop")
    bl_options = {"REGISTER"}

    _timer = None

    @classmethod
    def poll(cls, context):
        if context.area is None or context.area.type != "VIEW_3D":
            return False
        return not get_settings(context).is_playing

    # ------------------------------------------------------------------ lifecycle
    def invoke(self, context, event):
        settings = get_settings(context)
        # The button lives in the sidebar, so resolve the main viewport region explicitly.
        space = context.space_data
        rv3d = getattr(space, "region_3d", None) or context.region_data
        region = next((r for r in context.area.regions if r.type == "WINDOW"), context.region)
        if rv3d is None or region is None:
            self.report({"ERROR"}, "Start play mode from a 3D viewport")
            return {"CANCELLED"}
        self._done = False

        bvh, tri_count = utils.build_level_bvh(context)
        if bvh is None:
            self.report({"ERROR"}, "No level geometry found. Set a Level Collection or add meshes.")
            return {"CANCELLED"}

        try:
            bpy.ops.screen.animation_cancel(restore_frame=False)
        except RuntimeError:
            pass

        spawn = utils.get_or_create_spawn(context)
        self.radius = settings.marble_radius
        self.start_pos = marker_center(spawn, self.radius)
        self.respawn_pos = self.start_pos.copy()
        fwd = utils.spawn_launch_direction(spawn)
        self.yaw = math.atan2(-fwd.x, fwd.y)
        self.pitch = settings.cam_pitch
        self.cam_distance = settings.cam_distance

        self.phys = MarblePhysics(bvh, self.radius, params_from_settings(settings))
        self.phys.reset(self.start_pos)

        self.marble = self._get_marble(context)
        self.marble.rotation_mode = "QUATERNION"
        self._sync_marble()

        self.checkpoints = utils.objects_with_role("CHECKPOINT", context.scene)
        self.finishes = utils.objects_with_role("FINISH", context.scene)
        self.checkpoint_hit = set()
        self.finish_time = None
        self.deaths = 0
        self.run_time = 0.0
        self.tick_count = 0
        self.path = [self.start_pos.copy()]
        self.keys = set()
        self.status = ""

        self.area = context.area
        self.region = region
        self.rv3d = rv3d
        self.saved_view = (
            self.rv3d.view_location.copy(),
            self.rv3d.view_rotation.copy(),
            self.rv3d.view_distance,
            self.rv3d.view_perspective,
        )
        if self.rv3d.view_perspective == "CAMERA":
            self.rv3d.view_perspective = "PERSP"

        self.last_time = time.perf_counter()
        self.accum = 0.0
        self.dt = 1.0 / settings.physics_hz

        wm = context.window_manager
        self._timer = wm.event_timer_add(self.dt, window=context.window)
        wm.modal_handler_add(self)
        settings.is_playing = True
        self.mouse_look = settings.mouse_look
        if self.mouse_look:
            context.window.cursor_modal_set("NONE")
            self._warp_center(context)
        self._update_view()
        self._hud(context)
        self.report({"INFO"}, f"Play mode: {tri_count} level polygons. Esc to stop.")
        return {"RUNNING_MODAL"}

    def modal(self, context, event):
        settings = get_settings(context)
        try:
            return self._modal(context, event, settings)
        except Exception as exc:  # never leave the viewport in a broken state
            traceback.print_exc()
            self._finish(context, settings)
            self.report({"ERROR"}, f"Play mode stopped: {exc}")
            return {"CANCELLED"}

    def cancel(self, context):
        self._finish(context, get_settings(context))

    # ------------------------------------------------------------------ events
    def _modal(self, context, event, settings):
        etype = event.type
        if event.value == "PRESS" and etype in {"ESC", "RIGHTMOUSE"}:
            self._finish(context, settings)
            return {"FINISHED"}

        if etype == "TIMER":
            self._tick(context, settings)
            return {"RUNNING_MODAL"}

        if etype == "MOUSEMOVE":
            if self.mouse_look:
                self._mouse_look(context, event, settings)
            return {"RUNNING_MODAL"}
        if etype == "INBETWEEN_MOUSEMOVE":
            return {"RUNNING_MODAL"}

        if etype == "WHEELUPMOUSE":
            self.cam_distance = max(0.5, self.cam_distance * 0.9)
            settings.cam_distance = self.cam_distance
            return {"RUNNING_MODAL"}
        if etype == "WHEELDOWNMOUSE":
            self.cam_distance = min(100.0, self.cam_distance / 0.9)
            settings.cam_distance = self.cam_distance
            return {"RUNNING_MODAL"}

        if event.value == "PRESS":
            if etype == "R":
                self._respawn(full_reset=True)
            elif etype == "M":
                self.mouse_look = not self.mouse_look
                if self.mouse_look:
                    context.window.cursor_modal_set("NONE")
                    self._warp_center(context)
                else:
                    context.window.cursor_modal_restore()
            self.keys.add(etype)
        elif event.value == "RELEASE":
            self.keys.discard(etype)
        return {"RUNNING_MODAL"}

    def _mouse_look(self, context, event, settings):
        cx, cy = self._region_center()
        dx = event.mouse_x - cx
        dy = event.mouse_y - cy
        if dx == 0 and dy == 0:
            return
        sens = settings.mouse_sensitivity
        self.yaw -= math.radians(dx * sens)
        self.pitch = max(-85.0, min(85.0, self.pitch + dy * sens))
        self._warp_center(context)
        self._update_view()

    def _region_center(self):
        return (self.region.x + self.region.width // 2, self.region.y + self.region.height // 2)

    def _warp_center(self, context):
        cx, cy = self._region_center()
        context.window.cursor_warp(cx, cy)

    # ------------------------------------------------------------------ simulation
    def _tick(self, context, settings):
        now = time.perf_counter()
        frame_time = min(now - self.last_time, 0.1)
        self.last_time = now
        self.accum += frame_time

        keys = self.keys
        yaw_rate = math.radians(120.0) * frame_time
        if "Q" in keys:
            self.yaw += yaw_rate
        if "E" in keys:
            self.yaw -= yaw_rate
        if "PAGE_UP" in keys:
            self.pitch = min(85.0, self.pitch + 60.0 * frame_time)
        if "PAGE_DOWN" in keys:
            self.pitch = max(-85.0, self.pitch - 60.0 * frame_time)

        _rot, forward, right = camera_basis(self.yaw, self.pitch)
        fwd_amt = 0.0
        right_amt = 0.0
        for key, (f, r) in MOVE_KEYS.items():
            if key in keys:
                fwd_amt += f
                right_amt += r
        move_dir = forward * fwd_amt + right * right_amt
        if move_dir.length > 1.0:
            move_dir.normalize()
        jump = "SPACE" in keys

        stepped = False
        while self.accum >= self.dt:
            self.accum -= self.dt
            self.run_time += self.dt
            self.tick_count += 1
            result = self.phys.step(self.dt, move_dir, jump, jump_held=jump)
            stepped = True
            if result == "FELL":
                self.deaths += 1
                self._respawn(full_reset=False)
                self.status = "Fell off the level!"
            else:
                self._check_markers()
            if settings.record_play_path and self.tick_count % 3 == 0 and len(self.path) < MAX_PATH_POINTS:
                self.path.append(self.phys.pos.copy())

        if stepped:
            self._sync_marble()
            self._update_view()
            self._hud(context)

    def _check_markers(self):
        pos = self.phys.pos
        for cp in self.checkpoints:
            if cp.name in self.checkpoint_hit:
                continue
            if (pos - marker_center(cp, self.radius)).length <= marker_radius(cp):
                self.checkpoint_hit.add(cp.name)
                self.respawn_pos = marker_center(cp, self.radius)
                self.status = f"Checkpoint: {cp.name}"
        if self.finish_time is None:
            for fin in self.finishes:
                if (pos - marker_center(fin, self.radius)).length <= marker_radius(fin):
                    self.finish_time = self.run_time
                    self.status = f"FINISH in {self.finish_time:.2f}s"
                    break

    def _respawn(self, full_reset):
        if full_reset:
            self.respawn_pos = self.start_pos.copy()
            self.checkpoint_hit.clear()
            self.finish_time = None
            self.run_time = 0.0
            self.status = "Reset"
        self.phys.reset(self.respawn_pos)

    def _sync_marble(self):
        self.marble.location = self.phys.pos
        self.marble.rotation_quaternion = self.phys.rot

    def _update_view(self):
        rot, _f, _r = camera_basis(self.yaw, self.pitch)
        self.rv3d.view_rotation = rot
        self.rv3d.view_location = self.phys.pos + Vector((0.0, 0.0, self.p_cam_height()))
        self.rv3d.view_distance = self.cam_distance
        self.area.tag_redraw()

    def p_cam_height(self):
        return get_settings().cam_height

    def _hud(self, context):
        speed = self.phys.vel.length
        hspeed = Vector((self.phys.vel.x, self.phys.vel.y, 0.0)).length
        ground = "ground" if self.phys.on_ground else "air"
        text = (f"PLAY  {speed:5.1f} m/s (h {hspeed:4.1f})  t={self.run_time:6.2f}s  "
                f"deaths {self.deaths}  [{ground}]  {self.status}   "
                "WASD move | Space jump | mouse/QE look | wheel zoom | R reset | M mouse-look | Esc stop")
        try:
            self.area.header_text_set(text)
        except (AttributeError, RuntimeError):
            pass

    # ------------------------------------------------------------------ helpers
    def _get_marble(self, context):
        for obj in utils.objects_with_role("MARBLE", context.scene):
            if obj.name.startswith(MARBLE_NAME) and obj.rigid_body is None:
                if abs(obj.dimensions.x - self.radius * 2.0) > 1e-4:
                    utils.remove_objects([obj])
                    break
                return obj
        marble = utils.make_marble_mesh(MARBLE_NAME, self.radius, color=(1.0, 0.45, 0.1, 1.0))
        utils.link_to_tools(context, marble)
        return marble

    def _finish(self, context, settings):
        if getattr(self, "_done", False):
            return
        self._done = True
        wm = context.window_manager
        if self._timer is not None:
            wm.event_timer_remove(self._timer)
            self._timer = None
        try:
            context.window.cursor_modal_restore()
        except (AttributeError, RuntimeError):
            pass
        try:
            self.area.header_text_set(None)
        except (AttributeError, RuntimeError):
            pass
        if settings.restore_view:
            try:
                loc, rot, dist, persp = self.saved_view
                self.rv3d.view_location = loc
                self.rv3d.view_rotation = rot
                self.rv3d.view_distance = dist
                if persp == "CAMERA":
                    self.rv3d.view_perspective = "CAMERA"
            except (AttributeError, RuntimeError, ReferenceError):
                pass
        settings.is_playing = False

        if settings.record_play_path and len(self.path) > 1:
            for old in utils.objects_with_role("PATH", context.scene):
                if old.name.startswith(PATH_NAME):
                    utils.remove_objects([old])
            curve = utils.make_path_curve(
                context, PATH_NAME, self.path,
                radius=max(self.radius * 0.08, 0.01), color=(1.0, 0.6, 0.1, 1.0),
            )
            curve.hide_select = True

        finish = f"finish {self.finish_time:.2f}s" if self.finish_time is not None else "no finish"
        settings.play_result = (
            f"{self.run_time:.1f}s played | {finish} | deaths {self.deaths} | "
            f"max {self.phys.max_speed_seen:.1f} m/s | jumps {self.phys.jumps} | "
            f"longest air {self.phys.max_air_time:.2f}s"
        )
        try:
            self.area.tag_redraw()
        except (AttributeError, ReferenceError):
            pass


class MARBLE_OT_clear_play(bpy.types.Operator):
    bl_idname = "marble.clear_play"
    bl_label = "Clear Play Objects"
    bl_description = "Remove the play marble and recorded play paths"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        doomed = [o for o in utils.objects_with_role("MARBLE", context.scene) if o.name.startswith(MARBLE_NAME)]
        doomed += [o for o in utils.objects_with_role("PATH", context.scene) if o.name.startswith(PATH_NAME)]
        utils.remove_objects(doomed)
        get_settings(context).play_result = ""
        return {"FINISHED"}


CLASSES = (MARBLE_OT_playtest, MARBLE_OT_clear_play)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
