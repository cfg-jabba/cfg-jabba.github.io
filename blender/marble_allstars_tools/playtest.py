"""Playtest: drive a marble around the level inside the 3D viewport.

The physics is a small fixed-timestep loop (Godot style: 60 ticks/s by default)
written in plain Python on top of mathutils' BVHTree for sphere-vs-level
collision. It mirrors the rules in the game's player.gd:

* camera-relative WASD force, gated by MAX_SPEED on the ground, weaker in the air
* ground damping that fades to a lighter "coast" damping above the input cap,
  air damping plus horizontal air drag in flight
* jump impulse with a momentum bonus, coyote time and an input buffer
* bounce only on airborne landings, never while rolling
* ramp momentum: when the floor angle changes, speed is re-aimed along the new
  surface instead of being lost (RAMP_KEEP / FLOW_LIMIT)
* downhill boost while descending ramps, uphill assist while fast

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
from .props import get_settings

MARBLE_NAME = "Marble (play)"
PATH_NAME = "Play Path"
UP = Vector((0.0, 0.0, 1.0))
DOWN = Vector((0.0, 0.0, -1.0))
MOVE_KEYS = {
    "W": (1.0, 0.0), "UP_ARROW": (1.0, 0.0),
    "S": (-1.0, 0.0), "DOWN_ARROW": (-1.0, 0.0),
    "A": (0.0, -1.0), "LEFT_ARROW": (0.0, -1.0),
    "D": (0.0, 1.0), "RIGHT_ARROW": (0.0, 1.0),
}
MAX_PATH_POINTS = 20000


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


class MarblePhysics:
    """Sphere controller against a BVHTree, following player.gd. No Blender objects inside."""

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
        self.time_since_grounded = 999.0
        self.jump_buffer = -1.0
        self.jump_released = True
        self.jumping = False
        self.redirect_grace = 0.0
        self.air_time = 0.0
        self.max_speed_seen = 0.0
        self.jumps = 0
        self.max_air_time = 0.0
        self._cos_slope = math.cos(math.radians(params.get("slope_limit", 60.0)))

    def reset(self, pos):
        self.pos = pos.copy()
        self.vel = Vector((0.0, 0.0, 0.0))
        self.omega = Vector((0.0, 0.0, 0.0))
        self.on_ground = False
        self.time_since_grounded = 999.0
        self.jump_buffer = -1.0
        self.jump_released = True
        self.jumping = False
        self.redirect_grace = 0.0
        self.air_time = 0.0

    # ------------------------------------------------------------------ stepping
    def step(self, dt, move_dir, jump_held, **_ignored):
        """Advance one physics tick. Returns 'FELL' when below the kill plane.

        `jump_held` is the current state of the jump key; presses are detected
        inside (with an input buffer), exactly like the game.
        """
        substeps = max(1, int(self.p.get("substeps", 4)))
        sub_dt = dt / substeps
        status = None
        for _ in range(substeps):
            result = self._substep(sub_dt, move_dir, jump_held)
            if result:
                status = result
        return status

    def _gravity_scale(self, jump_held):
        mult = self.p.get("fall_gravity_mult", 1.0)
        if mult <= 1.0 or self.on_ground:
            return 1.0
        if self.vel.z < 0.0:
            return mult
        if self.p.get("jump_cut", False) and self.jumping and not jump_held:
            return mult
        return 1.0

    def _substep(self, dt, move_dir, jump_held):
        p = self.p
        grounded = self.on_ground
        n = self.ground_normal

        # --- downhill boost / uphill assist (player.gd SLOPE_BOOST block)
        boost = p.get("slope_boost", 0.0)
        if grounded and boost > 0.0:
            slope = 1.0 - n.z
            if slope > 0.05:
                ramp_amt = _clamp((n.z - 0.30) / 0.35, 0.0, 1.0)
                down_tan = DOWN - n * DOWN.dot(n)
                if down_tan.length > 0.01 and ramp_amt > 0.0:
                    down_tan.normalize()
                    along = self.vel.dot(down_tan)
                    hsp = Vector((self.vel.x, self.vel.y, 0.0)).length
                    if along > 1.0:
                        self.vel += down_tan * (boost * slope * ramp_amt * dt)
                    elif along < -1.0 and hsp > p.get("assist_min_speed", 10.0):
                        self.vel -= down_tan * (boost * slope * ramp_amt * p.get("uphill_assist", 0.0) * dt)

        # --- player input (horizontal, camera relative; the game applies it flat too)
        if move_dir.length_squared > 1e-8:
            d = Vector((move_dir.x, move_dir.y, 0.0)).normalized()
            if grounded:
                hv = Vector((self.vel.x, self.vel.y, 0.0))
                if hv.dot(d) < p["max_speed"]:
                    self.vel += d * (p["accel"] * dt)
            else:
                self.vel += d * (p["air_accel"] * dt)

        # --- damping (Godot linear_damp semantics: v *= 1 - damp * dt)
        if grounded:
            hs = Vector((self.vel.x, self.vel.y, 0.0)).length
            over = _clamp((hs - p["max_speed"]) / p["max_speed"], 0.0, 1.0)
            damp = p["friction"] + (p.get("coast_friction", p["friction"]) - p["friction"]) * over
            self.vel *= max(0.0, 1.0 - damp * dt)
        else:
            self.vel *= max(0.0, 1.0 - p.get("air_friction", 0.0) * dt)
            drag = max(0.0, 1.0 - p.get("air_drag", 0.0) * dt)
            self.vel.x *= drag
            self.vel.y *= drag

        # --- jump: coyote time + input buffer (player.gd)
        if grounded:
            self.time_since_grounded = 0.0
        else:
            self.time_since_grounded += dt
        self.jump_buffer = max(self.jump_buffer - dt, -1.0)
        if jump_held:
            if self.jump_released:
                self.jump_buffer = p.get("jump_buffer", 0.0) + 1e-6
                self.jump_released = False
        else:
            self.jump_released = True
        can_jump = grounded or self.time_since_grounded < p.get("coyote_time", 0.0)
        if can_jump and self.jump_buffer > 0.0:
            is_wall = n.z < 0.5
            jdir = UP if not is_wall else (UP * 0.88 + n * 0.30).normalized()
            momentum = self.vel.length
            span = max(p.get("jump_bonus_span", 1.0), 1e-6)
            bonus = _clamp((momentum - p.get("jump_bonus_min", 0.0)) / span, 0.0, 1.0) * p.get("jump_bonus", 0.0)
            self.vel += jdir * (p["jump_speed"] + bonus)
            self.jump_buffer = -1.0
            self.time_since_grounded = p.get("coyote_time", 0.0)
            self.redirect_grace = 0.2
            self.jumping = True
            self.jumps += 1
            self.on_ground = False
            grounded = False

        # --- gravity
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
        airborne_landing = self.air_time > 0.05
        self.on_ground = False
        best_normal = None
        if self.bvh is not None:
            for _ in range(4):
                loc, face_normal, _idx, d = self.bvh.find_nearest(self.pos, self.radius + self.skin)
                if loc is None:
                    break
                push = self.pos - loc
                if push.length > 1e-6:
                    cn = push.normalized()
                else:
                    cn = face_normal if face_normal.dot(UP) >= 0 else -face_normal
                pen = self.radius - d
                if pen > 0.0:
                    self.pos += cn * pen
                is_ground = cn.z >= self._cos_slope
                vn = self.vel.dot(cn)
                if vn < 0.0:
                    speed = self.vel.length
                    into = -vn
                    keep = p.get("ramp_keep", 0.0)
                    if (is_ground and keep > 0.0 and self.redirect_grace <= 0.0
                            and speed > 6.0 and into < speed * p.get("flow_limit", 0.0)):
                        # Ramp momentum: re-aim along the surface, keep the speed.
                        v_tan = self.vel + cn * into
                        if v_tan.length > 0.01:
                            self.vel = self.vel.lerp(v_tan.normalized() * speed, keep)
                        vn2 = self.vel.dot(cn)
                        if vn2 < 0.0:
                            self.vel -= cn * vn2
                    else:
                        bounce = p.get("bounce", 0.0) if airborne_landing else 0.0
                        self.vel -= cn * (vn * (1.0 + bounce))
                if is_ground:
                    self.on_ground = True
                    if best_normal is None or cn.z > best_normal.z:
                        best_normal = cn
                if pen <= 0.0:
                    break

        self.redirect_grace = max(0.0, self.redirect_grace - dt)
        if self.on_ground:
            self.ground_normal = best_normal
            self.jumping = False
            if self.air_time > 0.0:
                self.max_air_time = max(self.max_air_time, self.air_time)
            self.air_time = 0.0
        else:
            self.air_time += dt

        # --- visual rolling (rolling without slipping on the contact normal)
        if self.on_ground:
            self.omega = self.vel.cross(self.ground_normal) / self.radius
        angle = self.omega.length * dt
        if angle > 1e-9:
            self.rot = Quaternion(self.omega.normalized(), angle) @ self.rot
            self.rot.normalize()

        self.max_speed_seen = max(self.max_speed_seen, self.vel.length)
        if self.pos.z < p["kill_z"]:
            return "FELL"
        return None


PARAM_NAMES = (
    "gravity", "fall_gravity_mult", "jump_cut", "accel", "air_accel", "max_speed",
    "jump_speed", "jump_bonus", "jump_bonus_min", "jump_bonus_span", "coyote_time",
    "jump_buffer", "friction", "coast_friction", "air_friction", "air_drag", "bounce",
    "ramp_keep", "flow_limit", "slope_boost", "uphill_assist", "assist_min_speed",
    "slope_limit", "kill_z",
)


def params_from_settings(settings):
    params = {name: getattr(settings, name) for name in PARAM_NAMES}
    params["substeps"] = settings.physics_substeps
    return params


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
        self.start_pos = utils.marker_center(spawn, self.radius)
        self.respawn_pos = self.start_pos.copy()
        fwd = utils.spawn_launch_direction(spawn)
        self.yaw = math.atan2(-fwd.x, fwd.y)
        self.pitch = settings.cam_pitch
        self.cam_distance = settings.cam_distance
        self.cam_target = self.start_pos.copy()

        self.phys = MarblePhysics(bvh, self.radius, params_from_settings(settings))
        self.phys.reset(self.start_pos)

        self.marble = self._get_marble(context)
        self.marble.rotation_mode = "QUATERNION"
        self._sync_marble()

        scene = context.scene
        self.checkpoints = utils.objects_with_role("CHECKPOINT", scene)
        self.finishes = utils.objects_with_role("FINISH", scene)
        self.fall_boxes = utils.objects_with_role("FALL", scene)
        self.timer_boxes = utils.objects_with_role("TIMER", scene)
        self.checkpoint_hit = set()
        self.timer_running = not self.timer_boxes
        self.finish_time = None
        self.deaths = 0
        self.run_time = 0.0
        self.tick_count = 0
        self.path = [self.start_pos.copy()]
        self.keys = set()
        self.status = "" if self.timer_running else "Timer starts at the timer-box"

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
        self._update_view(0.0)
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
        self.pitch = max(-75.0, min(70.0, self.pitch + dy * sens))
        self._warp_center(context)
        self._update_view(0.0)

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
            self.pitch = min(70.0, self.pitch + 60.0 * frame_time)
        if "PAGE_DOWN" in keys:
            self.pitch = max(-75.0, self.pitch - 60.0 * frame_time)

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
        jump_held = "SPACE" in keys

        stepped = False
        while self.accum >= self.dt:
            self.accum -= self.dt
            if self.timer_running and self.finish_time is None:
                self.run_time += self.dt
            self.tick_count += 1
            result = self.phys.step(self.dt, move_dir, jump_held)
            stepped = True
            if result == "FELL" or self._in_any(self.fall_boxes):
                self.deaths += 1
                self._respawn(full_reset=False)
                self.status = "Fell off the level!"
            else:
                self._check_markers()
            if settings.record_play_path and self.tick_count % 3 == 0 and len(self.path) < MAX_PATH_POINTS:
                self.path.append(self.phys.pos.copy())

        if stepped:
            self._sync_marble()
            self._update_view(frame_time)
            self._hud(context)

    def _in_any(self, markers):
        pos = self.phys.pos
        return any(utils.marker_contains(m, pos) for m in markers)

    def _check_markers(self):
        pos = self.phys.pos
        if not self.timer_running and self._in_any(self.timer_boxes):
            self.timer_running = True
            self.run_time = 0.0
            self.status = "Timer started"
        for cp in self.checkpoints:
            if cp.name in self.checkpoint_hit:
                continue
            if utils.marker_contains(cp, pos):
                self.checkpoint_hit.add(cp.name)
                self.respawn_pos = utils.marker_center(cp, self.radius)
                self.status = f"Checkpoint: {cp.name}"
        if self.finish_time is None and self._in_any(self.finishes):
            self.finish_time = self.run_time
            self.status = f"FINISH in {self.finish_time:.2f}s"

    def _respawn(self, full_reset):
        if full_reset:
            self.respawn_pos = self.start_pos.copy()
            self.checkpoint_hit.clear()
            self.finish_time = None
            self.run_time = 0.0
            self.timer_running = not self.timer_boxes
            self.status = "Reset"
        self.phys.reset(self.respawn_pos)
        self.cam_target = self.phys.pos.copy()

    def _sync_marble(self):
        self.marble.location = self.phys.pos
        self.marble.rotation_quaternion = self.phys.rot

    def _update_view(self, frame_time):
        settings = get_settings()
        rate = settings.cam_follow_rate
        target = self.phys.pos + Vector((0.0, 0.0, settings.cam_height))
        if rate <= 0.0 or frame_time <= 0.0:
            self.cam_target = target
        else:
            t = min(1.0, rate * frame_time)
            self.cam_target = self.cam_target.lerp(target, t)
        rot, _f, _r = camera_basis(self.yaw, self.pitch)
        self.rv3d.view_rotation = rot
        self.rv3d.view_location = self.cam_target
        self.rv3d.view_distance = self.cam_distance
        self.area.tag_redraw()

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
            f"{self.run_time:.1f}s on the clock | {finish} | deaths {self.deaths} | "
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
