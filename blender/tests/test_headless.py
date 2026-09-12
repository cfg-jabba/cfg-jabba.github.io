"""Headless smoke test for the Marble Allstars Tools add-on.

Run with the `bpy` pip module (python -m pip install bpy) or with Blender itself:

    python tests/test_headless.py
    blender --background --python tests/test_headless.py

It builds a small level (floor, ramp, gap, landing pad), registers the add-on
and drives every non-interactive operator plus the play-mode physics class.
"""

import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import marble_allstars_tools as addon  # noqa: E402
from marble_allstars_tools import level_tools, playtest, utils  # noqa: E402


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("  ok -", msg)


def make_box(name, location, size, rotation=(0, 0, 0)):
    mesh = bpy.data.meshes.new(name)
    import bmesh

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
    # Apply scale so rigid bodies behave (also exercised by level_stats warnings otherwise).
    for obj in (floor, ramp, pad, wall):
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for obj in (floor, ramp, pad, wall):
        obj.select_set(False)
    return scene


def test_drop():
    print("[drop tester]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    ctx.scene.cursor.location = (0.0, 0.0, 2.0)
    bpy.ops.marble.add_spawn()
    spawn = utils.find_spawn(ctx.scene)
    check(spawn is not None and (spawn.location - Vector((0, 0, 2))).length < 1e-6, "spawn created at cursor")

    s.sim_frames = 120
    s.launch_speed = 0.0
    s.auto_play = False
    bpy.ops.marble.drop()
    marbles = [o for o in ctx.scene.objects if o.name.startswith("Marble (drop)")]
    check(len(marbles) == 1, "one marble dropped")
    check(marbles[0].rigid_body is not None and marbles[0].rigid_body.type == "ACTIVE", "marble is active rigid body")
    check(all(o.rigid_body is not None for o in utils.get_level_objects(ctx)), "level got passive bodies")
    check("stopped at 0." in s.drop_result, f"drop result: {s.drop_result}")
    paths = [o for o in ctx.scene.objects if o.name.startswith("Drop Path")]
    check(len(paths) == 1, "path curve traced")

    # Launched forward along +Y at 12 m/s the marble should travel a good distance.
    s.launch_speed = 12.0
    s.drop_count = 3
    s.drop_spread = 2.0
    s.sim_frames = 180
    bpy.ops.marble.drop()
    marbles = [o for o in ctx.scene.objects if o.name.startswith("Marble (drop)")]
    check(len(marbles) == 3, "three marbles dropped (previous cleared)")
    # The operator rewinds to the start frame, so read the recorded results instead.
    import re

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


def test_physics():
    print("[play physics]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    bvh, tris = utils.build_level_bvh(ctx)
    check(bvh is not None and tris > 0, f"bvh built with {tris} polygons")
    phys = playtest.MarblePhysics(bvh, s.marble_radius, playtest.params_from_settings(s))
    phys.reset(Vector((0.0, 0.0, 3.0)))
    for _ in range(120):
        phys.step(1 / 60, Vector((0, 0, 0)), False)
    check(abs(phys.pos.z - s.marble_radius) < 0.02, f"marble rests on floor (z={phys.pos.z:.3f})")
    check(phys.on_ground, "grounded")

    # Drive forward for 0.8s on the flat: should move along +Y and not exceed max speed.
    for _ in range(48):
        phys.step(1 / 60, Vector((0, 1, 0)), False)
    check(4.0 < phys.pos.y < 8.0, f"drove forward (y={phys.pos.y:.2f})")
    check(phys.vel.length <= s.max_speed + 0.5, f"speed capped ({phys.vel.length:.2f} m/s)")

    # Jump
    z0 = phys.pos.z
    phys.step(1 / 60, Vector((0, 0, 0)), True)
    for _ in range(15):
        phys.step(1 / 60, Vector((0, 0, 0)), False)
    check(phys.pos.z > z0 + 0.3 and phys.jumps == 1, f"jumped (z={phys.pos.z:.2f})")

    # Keep driving up the ramp to the pad; we should end up higher than the floor.
    for _ in range(60 * 6):
        phys.step(1 / 60, Vector((0, 1, 0)), False)
    print(f"   after ramp: pos=({phys.pos.x:.2f}, {phys.pos.y:.2f}, {phys.pos.z:.2f}) max speed {phys.max_speed_seen:.2f}")
    check(phys.pos.z > 1.0, "climbed the ramp and landed on the pad")
    check(phys.pos.y < 31.0, "wall stopped the marble")

    # Kill plane
    phys.reset(Vector((100.0, 100.0, 5.0)))
    status = None
    for _ in range(60 * 10):
        status = phys.step(1 / 60, Vector((0, 0, 0)), False) or status
    check(status == "FELL", "kill plane reported")
    check(phys.rot.magnitude > 0.99, "rotation quaternion stays normalised")

    # Camera helpers
    rot, fwd, right = playtest.camera_basis(0.0, -20.0)
    check((fwd - Vector((0, 1, 0))).length < 1e-6, "yaw 0 looks along +Y")
    check((right - Vector((1, 0, 0))).length < 1e-6, "right is +X")


def test_design():
    print("[level design]")
    ctx = bpy.context
    s = ctx.scene.marble_tools
    spawn = utils.find_spawn(ctx.scene)
    spawn.location = (0.0, 0.0, 0.0)
    spawn.rotation_euler = Euler((math.radians(35.0), 0.0, 0.0))  # tilt +Y arrow upward
    s.arc_speed = 10.0  # lands back on the floor (15 m/s would fly under the floating pad)
    bpy.ops.marble.jump_arc()
    arcs = [o for o in ctx.scene.objects if o.name.startswith("Jump Arc")]
    check(len(arcs) == 1, "arc curve created")
    check("lands" in s.design_result, f"arc result: {s.design_result}")

    ctx.scene.cursor.location = (0.0, 26.0, 2.5)
    bpy.ops.marble.add_marker(marker_type="TARGET")
    bpy.ops.marble.solve_jump_speed()
    check(s.launch_speed > 5.0, f"solver produced launch speed {s.launch_speed:.2f} m/s")
    # Verify analytically: launching at that speed passes through the target.
    origin = level_tools.marker_center(spawn, s.marble_radius)
    d = utils.spawn_launch_direction(spawn)
    v = s.launch_speed
    t = (26.0 - origin.y) / (v * d.y)
    z = origin.z + v * d.z * t - 0.5 * s.gravity * t * t
    check(abs(z - (2.5 + s.marble_radius)) < 1e-3, f"solved arc passes through target (z={z:.3f})")
    check("0.0" in s.design_result.split("vs target:")[-1], f"arc preview lands on target: {s.design_result}")

    ctx.scene.cursor.location = (0.0, 30.0, 2.5)
    bpy.ops.marble.add_marker(marker_type="FINISH")
    bpy.ops.marble.add_marker(marker_type="CHECKPOINT")
    check(len(utils.objects_with_role("FINISH")) == 1, "finish marker")

    ramp = bpy.data.objects["Ramp"]
    ctx.view_layer.objects.active = ramp
    bpy.ops.marble.ramp_info()
    check("slope" in s.design_result, f"ramp info: {s.design_result}")
    bpy.ops.marble.level_stats()
    check("polygons" in s.design_result, f"stats: {s.design_result}")

    data = level_tools.settings_to_dict(s)
    check("gravity" in data and "level_collection" not in data, "settings serialise")
    s.gravity = 3.0
    level_tools.dict_to_settings(s, data)
    check(abs(s.gravity - data["gravity"]) < 1e-6, "settings round-trip")
    found = level_tools.parse_godot_project(
        "[physics]\n\n3d/default_gravity=20.0\ncommon/physics_ticks_per_second=120\n"
    )
    check(found == {"gravity": 20.0, "physics_hz": 120}, "project.godot parsing")

    bpy.ops.marble.clear_design()
    check(not utils.objects_with_role("ARC"), "arcs cleared")

    # Level collection filtering
    coll = bpy.data.collections.new("Level")
    ctx.scene.collection.children.link(coll)
    coll.objects.link(bpy.data.objects["Floor"])
    s.level_collection = coll
    check(len(utils.get_level_objects(ctx)) == 1, "level collection restricts geometry")
    s.level_collection = None


def test_presets():
    print("[presets]")
    s = bpy.context.scene.marble_tools
    s.preset = "MARBLE_BLAST"
    bpy.ops.marble.apply_preset()
    check(abs(s.gravity - 20.0) < 1e-6, "preset applied")
    s.preset = "GODOT"
    bpy.ops.marble.apply_preset()


def main():
    build_level()
    addon.register()
    try:
        test_presets()
        test_drop()
        test_physics()
        test_design()
        # Save a demo file next to the tests so it can be opened in Blender.
        out = os.path.join(HERE, "demo_level.blend")
        bpy.ops.wm.save_as_mainfile(filepath=out)
        print("saved", out)
    finally:
        addon.unregister()
    print("ALL TESTS PASSED")


if __name__ == "__main__":
    main()
