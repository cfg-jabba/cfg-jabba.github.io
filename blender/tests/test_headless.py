"""Headless smoke test for the Marble Allstars Tools add-on.

Run with the `bpy` pip module (python -m pip install bpy) or with Blender itself:

    python tests/test_headless.py
    blender --background --python tests/test_headless.py

It builds a small level (floor, ramp, gap, landing pad), registers the add-on
and drives every non-interactive operator plus the play-mode physics class.
"""

import math
import os
import re
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import marble_allstars_tools as addon  # noqa: E402
from marble_allstars_tools import level_tools, playtest, props, utils  # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok -", msg)


def make_box(name, location, size, rotation=(0, 0, 0)):
    import bmesh

    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = location
    obj.scale = size
    obj.rotation_euler = Euler([math.radians(a) for a in rotation])
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_level():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 60
    scene.frame_start = 1
    floor = make_box("Floor", (0, 0, -0.5), (20, 20, 1))
    ramp = make_box("Ramp", (0, 12, 1.0), (6, 8, 0.5), rotation=(20, 0, 0))  # rises towards +Y
    pad = make_box("Landing", (0, 26, 2.0), (10, 10, 1))
    wall = make_box("Wall", (0, 31.5, 4.0), (10, 1, 6))
    for obj in (floor, ramp, pad, wall):
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for obj in (floor, ramp, pad, wall):
        obj.select_set(False)
    return scene


def test_presets():
    print("[presets]")
    s = bpy.context.scene.marble_tools
    check(s.preset == "MARBLE_ALLSTARS" and abs(s.gravity - 19.6) < 1e-6, "game preset is the default")
    check(abs(s.accel - 21.6) < 1e-6 and abs(s.jump_speed - 10.3) < 1e-6, "game numbers are the defaults")
    s.preset = "MARBLE_BLAST"
    bpy.ops.marble.apply_preset()
    check(abs(s.gravity - 20.0) < 1e-6 and s.slope_boost == 0.0, "preset applied")
    s.preset = "MARBLE_ALLSTARS"
    bpy.ops.marble.apply_preset()
    for key in props.GAME:
        check(abs(float(getattr(s, key)) - float(props.GAME[key])) < 1e-6, f"GAME[{key}] round-trips")


def test_boxes():
    print("[game boxes]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    ctx.scene.cursor.location = (0.0, 0.0, 0.0)
    bpy.ops.marble.add_game_box(kind="SPAWN")
    spawn = utils.find_spawn(ctx.scene)
    check(spawn is not None and spawn.name == "spawnbox", "spawnbox created")
    check(abs(spawn.location.z - s.marble_radius) < 1e-6, "spawn lifted by the marble radius")

    ctx.scene.cursor.location = (0.0, 5.0, 0.0)
    bpy.ops.marble.add_game_box(kind="TIMER")
    ctx.scene.cursor.location = (0.0, 28.0, 2.5)
    bpy.ops.marble.add_game_box(kind="FINISH")
    bpy.ops.marble.add_game_box(kind="FALL")
    names = {o.name for o in ctx.scene.objects if o.type == "EMPTY"}
    check({"timer-box", "finish-box", "fall-box"} <= names, f"game boxes named for Godot: {sorted(names)}")
    fall = utils.objects_with_role("FALL")[0]
    lo, hi = utils.level_bounds(ctx)
    check(fall.location.z + fall.scale.z < lo.z, "fall-box sits below the level")
    check(fall.scale.x * 2 > (hi.x - lo.x), "fall-box wider than the level")
    finish = utils.objects_with_role("FINISH")[0]
    check(utils.marker_contains(finish, Vector((0.0, 28.0, 3.0))), "point inside finish-box")
    check(not utils.marker_contains(finish, Vector((0.0, 40.0, 3.0))), "point outside finish-box")
    # Untagged empties named by the game's convention are found too.
    extra = bpy.data.objects.new("MyFinishBox", None)
    extra.empty_display_type = "CUBE"
    ctx.scene.collection.objects.link(extra)
    check(extra in utils.objects_with_role("FINISH"), "name convention picks up untagged finish empties")
    bpy.data.objects.remove(extra)
    # Moving an existing box instead of duplicating.
    ctx.scene.cursor.location = (3.0, 28.0, 2.5)
    bpy.ops.marble.add_game_box(kind="FINISH")
    check(len(utils.objects_with_role("FINISH")) == 1, "second Finish click moves the existing box")


def test_drop():
    print("[drop tester]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    ctx.scene.cursor.location = (0.0, 0.0, 2.0)
    bpy.ops.marble.add_spawn()
    spawn = utils.find_spawn(ctx.scene)
    check((spawn.location - Vector((0, 0, 2.5))).length < 1e-6, "spawn moved to cursor")

    s.sim_frames = 120
    s.launch_speed = 0.0
    s.auto_play = False
    bpy.ops.marble.drop()
    marbles = [o for o in ctx.scene.objects if o.name.startswith("Marble (drop)")]
    check(len(marbles) == 1, "one marble dropped")
    check(marbles[0].rigid_body is not None and marbles[0].rigid_body.type == "ACTIVE", "marble is active rigid body")
    check(abs(marbles[0].rigid_body.mass - s.marble_mass) < 1e-6, "marble uses the game mass")
    check(abs(ctx.scene.gravity.z + s.gravity) < 1e-6, "scene gravity follows the settings")
    check(all(o.rigid_body is not None for o in utils.get_level_objects(ctx)), "level got passive bodies")
    check("stopped at 0." in s.drop_result, f"drop result: {s.drop_result}")
    paths = [o for o in ctx.scene.objects if o.name.startswith("Drop Path")]
    check(len(paths) == 1, "path curve traced")

    s.launch_speed = 12.0
    s.drop_count = 3
    s.drop_spread = 2.0
    s.sim_frames = 180
    bpy.ops.marble.drop()
    marbles = [o for o in ctx.scene.objects if o.name.startswith("Marble (drop)")]
    check(len(marbles) == 3, "three marbles dropped (previous cleared)")
    ends = re.findall(r"end \((-?[\d.]+), (-?[\d.]+), (-?[\d.]+)\)", s.drop_result)
    check(len(ends) == 3, "three result lines")
    ys = sorted(float(e[1]) for e in ends)
    print("   final y positions:", ys)
    check(min(ys) > 5.0, "launched marbles moved forward along +Y")
    speeds = [float(v) for v in re.findall(r"max ([\d.]+) m/s", s.drop_result)]
    check(max(speeds) > 10.0, f"launch speed carried over (max {max(speeds):.1f} m/s)")
    print("   ", s.drop_result.replace("\n", " || "))

    bpy.ops.marble.clear_drops(level_bodies=True)
    check(not [o for o in ctx.scene.objects if o.name.startswith("Marble (drop)")], "drops cleared")
    check(all(o.rigid_body is None for o in utils.get_level_objects(ctx)), "auto rigid bodies removed")


def run_ticks(phys, ticks, move=Vector((0, 0, 0)), jump=False):
    status = None
    for _ in range(ticks):
        status = phys.step(1 / 60, move, jump) or status
    return status


def test_physics():
    print("[play physics]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    bvh, tris = utils.build_level_bvh(ctx)
    check(bvh is not None and tris > 0, f"bvh built with {tris} polygons")

    # --- game defaults on the flat
    params = playtest.params_from_settings(s)
    phys = playtest.MarblePhysics(bvh, s.marble_radius, params)
    phys.reset(Vector((0.0, 0.0, 3.0)))
    run_ticks(phys, 120)
    check(abs(phys.pos.z - s.marble_radius) < 0.02, f"marble rests on floor (z={phys.pos.z:.3f})")
    check(phys.on_ground, "grounded")
    run_ticks(phys, 48, move=Vector((0, 1, 0)))
    check(2.0 < phys.pos.y < 8.0, f"drove forward (y={phys.pos.y:.2f})")
    hs = Vector((phys.vel.x, phys.vel.y, 0)).length
    check(hs <= s.max_speed + 0.5, f"input capped at MAX_SPEED ({hs:.2f} m/s)")

    # Jump from rest: impulse 10.3 m/s, no bonus below 6 m/s momentum.
    phys.reset(Vector((0.0, 0.0, s.marble_radius)))
    run_ticks(phys, 30)
    phys.step(1 / 60, Vector((0, 0, 0)), True)
    vz_rest = phys.vel.z
    check(9.0 < vz_rest + s.gravity / 60 <= s.jump_speed + 0.01, f"jump impulse from rest ({vz_rest:.2f} m/s)")
    check(phys.jumps == 1, "one jump counted")
    run_ticks(phys, 5, jump=True)
    check(phys.jumps == 1, "holding Space does not re-jump in the air")

    # Jump with momentum gets the bonus (game: +4.3 m/s at 18 m/s).
    phys.reset(Vector((0.0, -8.0, s.marble_radius)))
    run_ticks(phys, 30)
    phys.vel = Vector((0.0, 18.0, 0.0))
    phys.step(1 / 60, Vector((0, 0, 0)), True)
    vz_fast = phys.vel.z
    check(vz_fast > vz_rest + 3.5, f"momentum jump bonus applied ({vz_fast:.2f} vs {vz_rest:.2f})")

    # Jump buffer: press slightly before landing still fires on touchdown.
    phys.reset(Vector((0.0, 0.0, s.marble_radius + 0.1)))
    jumps_before = phys.jumps
    phys.step(1 / 60, Vector((0, 0, 0)), True)   # pressed 0.1 m up, lands within the 0.12 s buffer
    phys.step(1 / 60, Vector((0, 0, 0)), False)
    run_ticks(phys, 30)
    check(phys.jumps == jumps_before + 1, f"buffered jump fired on landing ({phys.jumps - jumps_before} jumps)")

    # Rolling contact never bounces; airborne landings do.
    phys.reset(Vector((0.0, 0.0, 6.0)))
    max_after = 0.0
    landed = False
    for _ in range(240):
        phys.step(1 / 60, Vector((0, 0, 0)), False)
        if landed:
            max_after = max(max_after, phys.pos.z)
        elif phys.on_ground:
            landed = True
    check(landed and max_after > s.marble_radius + 0.3, f"airborne landing bounced (rebound to z={max_after:.2f})")

    # Ramp momentum: rolling onto the 20° ramp keeps most of the speed.
    phys.reset(Vector((0.0, 0.0, s.marble_radius)))
    run_ticks(phys, 30)
    phys.vel = Vector((0.0, 12.0, 0.0))
    speed_before = phys.vel.length
    for _ in range(60):
        phys.step(1 / 60, Vector((0, 1, 0)), False)
        if phys.pos.y > 10.0:
            break
    check(phys.on_ground and phys.ground_normal.z < 0.99, f"on the ramp (n.z={phys.ground_normal.z:.2f})")
    check(phys.vel.length > speed_before * 0.85, f"ramp entry kept speed ({phys.vel.length:.1f} of {speed_before:.1f})")

    # Downhill boost: descending the ramp is faster than on stock physics.
    def descend(boost):
        prm = dict(params, slope_boost=boost)
        ph = playtest.MarblePhysics(bvh, s.marble_radius, prm)
        ph.reset(Vector((0.0, 15.0, 3.6)))
        run_ticks(ph, 20)
        run_ticks(ph, 45, move=Vector((0, -1, 0)))
        return ph.vel.length
    check(descend(90.0) > descend(0.0) + 1.0, "downhill boost adds speed on ramps")

    # Kill plane
    phys.reset(Vector((100.0, 100.0, 5.0)))
    status = run_ticks(phys, 600)
    check(status == "FELL", "kill plane reported")
    check(phys.rot.magnitude > 0.99, "rotation quaternion stays normalised")

    # Fall-gravity multiplier / jump cut (off in the game, still available).
    def jump_air_ticks(mult, jump_cut=False, hold=True):
        prm = dict(params, fall_gravity_mult=mult, jump_cut=jump_cut, bounce=0.0)
        ph = playtest.MarblePhysics(bvh, s.marble_radius, prm)
        ph.reset(Vector((0.0, 0.0, s.marble_radius)))
        run_ticks(ph, 30)
        ph.step(1 / 60, Vector((0, 0, 0)), True)
        ticks = 1
        while not ph.on_ground and ticks < 600:
            ph.step(1 / 60, Vector((0, 0, 0)), hold)
            ticks += 1
        return ticks
    plain = jump_air_ticks(1.0)
    heavy = jump_air_ticks(2.0)
    cut = jump_air_ticks(2.0, jump_cut=True, hold=False)
    print(f"   air ticks: normal {plain}, fall x2 {heavy}, fall x2 + jump cut {cut}")
    check(plain > heavy > cut, "heavier fall and jump-cut shorten the jump")

    rot, fwd, right = playtest.camera_basis(0.0, -30.0)
    check((fwd - Vector((0, 1, 0))).length < 1e-6, "yaw 0 looks along +Y")
    check((right - Vector((1, 0, 0))).length < 1e-6, "right is +X")


def test_design():
    print("[level design]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    spawn = utils.find_spawn(ctx.scene)
    spawn.location = (0.0, 0.0, s.marble_radius)
    spawn.rotation_euler = Euler((math.radians(35.0), 0.0, 0.0))  # tilt +Y arrow upward
    s.arc_speed = 10.0
    bpy.ops.marble.jump_arc()
    arcs = [o for o in ctx.scene.objects if o.name.startswith("Jump Arc")]
    check(len(arcs) == 1, "arc curve created")
    check("lands" in s.design_result, f"arc result: {s.design_result}")

    ctx.scene.cursor.location = (0.0, 26.0, 2.5)
    bpy.ops.marble.add_marker(marker_type="TARGET")
    bpy.ops.marble.solve_jump_speed()
    check(s.launch_speed > 5.0, f"solver produced launch speed {s.launch_speed:.2f} m/s")
    origin = utils.marker_center(spawn)
    d = utils.spawn_launch_direction(spawn)
    v = s.launch_speed
    t = (26.0 - origin.y) / (v * d.y)
    z = origin.z + v * d.z * t - 0.5 * s.gravity * t * t
    check(abs(z - (2.5 + s.marble_radius)) < 1e-3, f"solved arc passes through target (z={z:.3f})")
    miss = float(re.search(r"vs target: ([\d.]+) m off", s.design_result).group(1))
    check(miss < 0.5, f"arc preview lands on target within a segment ({miss:.2f} m off)")

    ctx.scene.cursor.location = (0.0, 30.0, 2.5)
    bpy.ops.marble.add_marker(marker_type="CHECKPOINT")
    check(len(utils.objects_with_role("CHECKPOINT")) == 1, "checkpoint marker")

    ramp = bpy.data.objects["Ramp"]
    ctx.view_layer.objects.active = ramp
    bpy.ops.marble.ramp_info()
    check("slope" in s.design_result, f"ramp info: {s.design_result}")
    bpy.ops.marble.level_stats()
    check("polygons" in s.design_result and "fall-box ok" in s.design_result, f"stats: {s.design_result}")

    data = level_tools.settings_to_dict(s)
    check("gravity" in data and "level_collection" not in data, "settings serialise")
    s.gravity = 3.0
    level_tools.dict_to_settings(s, data)
    check(abs(s.gravity - data["gravity"]) < 1e-6, "settings round-trip")

    bpy.ops.marble.clear_design()
    check(not utils.objects_with_role("ARC"), "arcs cleared")

    coll = bpy.data.collections.new("Level")
    ctx.scene.collection.children.link(coll)
    coll.objects.link(bpy.data.objects["Floor"])
    s.level_collection = coll
    check(len(utils.get_level_objects(ctx)) == 1, "level collection restricts geometry")
    s.level_collection = None


PLAYER_GD = """
const ROLL_FORCE   : float = 40.0
const JUMP_IMPULSE : float = 19.0
const JUMP_SPEED_BONUS : float = 8.0   # extra impulse earned at full momentum
const JUMP_BONUS_MIN   : float = 6.0
const JUMP_BONUS_SPAN  : float = 12.0
const MAX_SPEED    : float = 12.0
const AIR_CONTROL  : float = 0.55
const AIR_DRAG     : float = 0.995
const GROUND_DAMP  : float = 0.5
const COAST_DAMP   : float = 0.15
const AIR_DAMP     : float = 0.35
const RAMP_KEEP    : float = 0.985
const FLOW_LIMIT   : float = 0.75
const COYOTE_TIME  : float = 0.12
const JUMP_BUFFER  : float = 0.12
@export var fall_y : float = -12.0
const SLOPE_BOOST  : float = 90.0
const UPHILL_ASSIST : float = 0.8
const ASSIST_MIN_SPEED : float = 10.0
var _jump_released : bool  = true
"""

PLAYER_TSCN = """[gd_scene load_steps=12 format=3]

[sub_resource type="PhysicsMaterial" id="BallPhys"]
friction = 0.85
bounce = 0.52

[sub_resource type="SphereShape3D" id="BallShape"]
radius = 0.5

[node name="Player" type="RigidBody3D"]
mass = 1.85
physics_material_override = SubResource("BallPhys")
gravity_scale = 2.0
linear_damp = 2.0
angular_damp = 0.0
"""

CAMERA_GD = """
@export var h_sensitivity  : float = 0.1
var camrot_h      : float = 0.0
var camrot_v      : float = -30.0
var _zoom_target  : float = 6.0
const FOLLOW_RATE : float = 10.0
"""


def test_godot_sync():
    print("[godot sync]")
    project = level_tools.parse_godot_project(
        "[physics]\n\n3d/physics_engine=\"Jolt Physics\"\n"
    )
    check(project == {}, "project.godot without overrides parses to defaults")
    project = level_tools.parse_godot_project("[physics]\n3d/default_gravity=20.0\ncommon/physics_ticks_per_second=120\n")
    check(project == {"gravity": 20.0, "physics_hz": 120}, "project.godot overrides parsed")

    player = level_tools.parse_gd_numbers(PLAYER_GD)
    check(player["ROLL_FORCE"] == 40.0 and player["fall_y"] == -12.0 and "_jump_released" not in player,
          "player.gd constants parsed")
    tscn = level_tools.parse_player_tscn(PLAYER_TSCN)
    check(tscn == {"friction": 0.85, "bounce": 0.52, "radius": 0.5, "mass": 1.85, "gravity_scale": 2.0,
                   "linear_damp": 2.0}, f"player.tscn parsed: {tscn}")
    camera = level_tools.parse_gd_numbers(CAMERA_GD)
    values = level_tools.godot_to_settings({}, player, tscn, camera)
    for key, expect in props.GAME.items():
        if key in values:
            check(abs(values[key] - expect) < 0.05, f"synced {key} = {values[key]:.3f} (GAME {expect})")
    check(abs(values["gravity"] - 19.6) < 1e-6, "gravity = 9.8 x gravity_scale")
    check(abs(values["air_drag"] - (1 - 0.995 ** 60)) < 1e-9, "air drag converted per second")

    # The operator end-to-end on a temp project folder.
    import tempfile
    folder = tempfile.mkdtemp()
    with open(os.path.join(folder, "project.godot"), "w") as fh:
        fh.write("[physics]\n3d/physics_engine=\"Jolt Physics\"\n")
    with open(os.path.join(folder, "player.gd"), "w") as fh:
        fh.write(PLAYER_GD)
    with open(os.path.join(folder, "player.tscn"), "w") as fh:
        fh.write(PLAYER_TSCN)
    with open(os.path.join(folder, "camera_rig.gd"), "w") as fh:
        fh.write(CAMERA_GD)
    s = bpy.context.scene.marble_tools
    s.gravity = 1.0
    s.accel = 1.0
    bpy.ops.marble.sync_godot(filepath=os.path.join(folder, "project.godot"))
    check(abs(s.gravity - 19.6) < 1e-6 and abs(s.accel - 40 / 1.85) < 1e-6, f"sync operator: {s.sync_result}")


def main():
    build_level()
    addon.register()
    try:
        test_presets()
        test_boxes()
        test_drop()
        test_physics()
        test_design()
        test_godot_sync()
        out = os.path.join(HERE, "demo_level.blend")
        bpy.ops.wm.save_as_mainfile(filepath=out)
        print("saved", out)
    finally:
        addon.unregister()
    print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
