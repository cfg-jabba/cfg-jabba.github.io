class_name Levels
extends RefCounted
## Level definitions. Each builder composes a floating diorama on a Level node.
## Units: 1 = one metre-ish. Frog jumps ~2.2 up and ~4 across.

const DEFS := [
	{
		"id": "overpass", "name": "The Overpass", "subtitle": "Where the highway ran out of road.",
		"sky_top": "9cc6be", "horizon": "d6e8e0", "fog": "c4ddd4", "sun": "fff0d8", "sun_energy": 1.15,
		"ambient": "b8d8d0", "sun_rot": Vector3(-48, 35, 0), "frog_reward": 3,
	},
	{
		"id": "rooftop", "name": "Rooftop Cistern", "subtitle": "Turn the water on. Float up.",
		"sky_top": "c4a6d8", "horizon": "f2cad8", "fog": "e8c6d6", "sun": "ffe0d0", "sun_energy": 1.0,
		"ambient": "e0c0d8", "sun_rot": Vector3(-30, -60, 0), "frog_reward": 3,
	},
	{
		"id": "busstop", "name": "Last Bus Stop", "subtitle": "Two plates. One crate. One very large friend.",
		"sky_top": "e4c48c", "horizon": "f4e2b4", "fog": "ecd8ac", "sun": "fff0c8", "sun_energy": 1.2,
		"ambient": "f0dcb0", "sun_rot": Vector3(-38, 140, 0), "frog_reward": 4,
	},
]


static func build(l: Level, index: int) -> void:
	l.def = DEFS[index]
	l.level_index = index
	l.rng.seed = 1000 + index * 77
	match index:
		0:
			_overpass(l)
		1:
			_rooftop(l)
		2:
			_busstop(l)


# ====================================================================== 1. THE OVERPASS
static func _overpass(l: Level) -> void:
	l.spawn = Vector3(-6, 0.05, 4)
	l.top_y = 13.0
	l.kill_y = -10.0
	l.center = Vector3(-2, 5, -2)

	# ground: a chunk of road floating in the sky
	l.slab(-9, -1, -6.5, 8, 0, 6.5, "asphalt")
	l.island(-9, -6.5, 8, 6.5, -1, 11)
	for i in 7:
		l.box(Vector3(-8 + i * 2.4, 0.004, 1.6), Vector3(1.2, 0.01, 0.16), l.mat("white"), false)
	l.checkpoint(l.spawn)

	# rubble steps -> brick ledge
	l.slab(-4, 0, -1.5, -2, 1, 0.5, "concrete")
	l.slab(-2.6, 0, -3.6, 0, 2, -1.2, "concrete")
	l.slab(0, 0, -6.5, 8, 3, -3, "brick")
	l.checkpoint(Vector3(1.0, 3, -5.8))
	l.car(Vector3(6.7, 3, -4.75), 0.0, Color("6a8ea8"))
	l.inspect(Vector3(6.7, 4.2, -4.75), "Rusty Hatchback", "Somebody's commute, frozen forever. Moss has the keys now.")

	# PUZZLE 1: push the crate onto the plate -> the big road sign falls into a ramp
	# the board's top surface passes through the pivot, so the low end sits flush with the ledge
	var pivot := Vector3(3.6, 3.0, -4.6)
	var run := pivot.x - (-1.0)
	var L := Vector2(run, 3.5).length() + 0.3
	var up := Transform3D(Basis(Vector3(0, 0, 1), deg_to_rad(-90)), pivot)
	var down := Transform3D(Basis(Vector3(0, 0, 1), -atan2(3.5, run)), pivot)
	var ramp := l.mover(up, down, 2.2)
	ramp.latch = true
	l.body_box(ramp, Vector3(-L * 0.5, -0.1, 0), Vector3(L, 0.2, 1.7), l.mat("sign_green"))
	var stripe := l.box(Vector3(-L * 0.5, 0.005, 0), Vector3(L * 0.8, 0.012, 0.12), l.mat_color(Color("f2f2e8")), false, ramp)
	stripe.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	l.box(Vector3(-L * 0.25, 0.005, 0.45), Vector3(L * 0.3, 0.012, 0.1), l.mat_color(Color("f2f2e8")), false, ramp)
	var ins := Props.Inspectable.new()
	ins.label = "Giant Road Sign"
	ins.text = "EXIT 12 - SKY. It's leaning... it could fall if something triggered it."
	ins.position = Vector3(-L * 0.5, 0.3, 0)
	ramp.add_child(ins)
	l.plate(Vector3(5.0, 0, 2.0), [ramp])
	l.crate(Vector3(1.5, 0.5, 2.0))
	l.inspect(Vector3(5.0, 0.3, 3.4), "Hint", "A plate by the road and a sign up on the ledge. They're wired together.")

	# middle deck
	l.slab(-8, 5.5, -6.5, -1, 6.5, -0.5, "concrete")
	l.guardrail(Vector3(-8, 6.5, -0.6), Vector3(-1.2, 6.5, -0.6))
	l.checkpoint(Vector3(-3.0, 6.5, -2.0))
	l.vine_curtain(Vector3(-1.1, 5.6, -6.4), Vector3(-1.1, 5.6, -0.6), 9, 1.0, 3.0)
	l.vine_curtain(Vector3(-7.9, 5.6, -0.6), Vector3(-1.2, 5.6, -0.6), 10, 1.0, 3.5, true)

	# traffic light holding the seed
	l.box(Vector3(-1.6, 7.3, -1.0), Vector3(0.14, 1.6, 0.14), l.mat("metal"), false)
	l.box(Vector3(-1.6, 8.1, -1.4), Vector3(0.12, 0.12, 0.9), l.mat("metal"), false)
	l.box(Vector3(-1.6, 7.9, -1.85), Vector3(0.36, 0.9, 0.36), l.mat_color(Color("2a3a30")), false)
	l.box(Vector3(-1.6, 8.15, -1.66), Vector3(0.18, 0.18, 0.04), l.mat_emit(Color("ff9a7a"), 1.5), false)
	l.seed_pickup(Vector3(-2.2, 8.45, -1.9))

	# PUZZLE 2: plant the seed at the pillar, climb the vine
	l.slab(-8, 6.5, -6.5, -5, 12, -3, "concrete")
	l.soil(Vector3(-4.5, 6.5, -4.75), 13.0, Vector3(1, 0, 0))
	l.inspect(Vector3(-5.1, 9.0, -3.2), "Graffiti", "'FROGS WAS HERE'. Fair enough.")

	# top deck: crystal pond + the snack dish
	l.slab(-12.5, 12, -8.5, -5, 13, -0.5, "asphalt")
	l.island(-12.5, -8.5, -5, -0.5, 12, 4)
	l.guardrail(Vector3(-12.4, 13, -0.6), Vector3(-5.4, 13, -0.6))
	l.checkpoint(Vector3(-6.0, 13, -7.6))
	l.crystal_pond(Vector3(-9.6, 13, -5.4), 1.3)
	l.snack_dish(Vector3(-7.0, 13, -1.9))
	l.streetlight(Vector3(-12.0, 13, -1.2), PI * 0.25)
	l.vine_curtain(Vector3(-12.4, 12.1, -0.6), Vector3(-5.1, 12.1, -0.6), 12, 1.5, 4.5, true)
	l.vine_curtain(Vector3(-12.4, 12.1, -8.4), Vector3(-12.4, 12.1, -0.6), 8, 2.0, 5.0, true)

	# snacks along the climb
	for p in [Vector3(-5, 0.6, 2.5), Vector3(-3, 1.6, -0.5), Vector3(-1.3, 2.6, -2.4), Vector3(2, 3.6, -5.5),
			Vector3(6.9, 5.0, -4.75), Vector3(1.5, 5.0, -4.6), Vector3(-3.2, 7.1, -3.5), Vector3(-4.5, 9.5, -4.75),
			Vector3(-4.5, 11.5, -4.75), Vector3(-11.5, 13.6, -2.0), Vector3(-7.0, 14.5, -1.9)]:
		l.snack(p)

	# life: frogs, crows, lights
	l.npc(Vector3(-7.4, 14.0, -2.1))
	l.npc(Vector3(-6.7, 14.0, -1.7))
	l.npc(Vector3(-11.6, 13, -7.6))
	l.npc(Vector3(-7.6, 13, -7.8))
	l.npc(Vector3(-8, 0, 5.4), 7)
	l.crow(Vector3(-5.0, 7.15, -0.6))
	l.crow(Vector3(6.5, 4.55, -4.6))
	l.crow(Vector3(-10.5, 13.65, -0.6))
	l.streetlight(Vector3(7.2, 0, 5.6), -PI * 0.75)
	l.cone(Vector3(2.5, 0, 4.8))
	l.cone(Vector3(3.3, 0, 5.4))
	l.tire(Vector3(-7.8, 0, -4.8))
	l.tire(Vector3(-7.9, 0.18, -4.7))
	l.sign_board(Vector3(7.5, 4.6, -6.2), 0.0, Vector2(2.4, 1.2))

	# foliage, some of it grows in as you climb higher
	l.foliage(-9, 3, -6, 6.5, 0, 40, [0, 1, 5])
	l.foliage(-9, -6.5, -5, -2, 0, 30, [0, 1, 6, 2])
	l.foliage(5, 3.5, 8, 6.5, 0, 25, [0, 1, 7])
	l.bush(Vector3(-8.2, 0, -1.0), 0.6)
	l.bush(Vector3(7.4, 3, -3.4), 0.5)
	l.grows(l.foliage(0.2, -6.4, 4, -3.2, 3, 40, [0, 1, 2, 3]), 2.5)
	l.grows(l.foliage(-4.8, -6.4, -1.2, -0.8, 6.5, 50, [0, 2, 3, 5, 6]), 6.0)
	l.grows(l.foliage(-12.4, -8.4, -5.2, -0.8, 13, 70, [0, 1, 2, 3, 5, 7]), 11.5)
	l.grows(l.sapling(Vector3(-11.6, 13, -3.6), 1.6), 12.0)
	l.grows(l.vine_curtain(Vector3(0.1, 2.9, -3.0), Vector3(7.9, 2.9, -3.0), 14, 0.8, 2.6, true), 3.5)
	l.grows(l.bush(Vector3(-7.6, 6.5, -2.4), 0.7, Color("6a9a3a")), 7.0)
	l.grows(l.sapling(Vector3(-1.6, 3, -5.8), 1.4), 4.0)


# ====================================================================== 2. ROOFTOP CISTERN
static func _rooftop(l: Level) -> void:
	l.spawn = Vector3(5, 0.05, 5)
	l.top_y = 14.0
	l.kill_y = -10.0
	l.center = Vector3(-3, 6, -6)

	l.slab(-9, -1, -8, 8, 0, 8, "tile")
	l.island(-9, -8, 8, 8, -1, 10)
	l.checkpoint(l.spawn)
	l.guardrail(Vector3(-8.8, 0, 7.9), Vector3(7.9, 0, 7.9))
	l.guardrail(Vector3(7.9, 0, -7.9), Vector3(7.9, 0, 7.9))

	# the cistern shaft: a lift you ride on floating water
	l.slab(-6.5, 0, -6.5, -6, 8, -2.5, "brick")
	l.slab(-6, 0, -6.5, -3, 8, -6, "brick")
	l.slab(-6, 0, -3, -3, 8, -2.5, "brick")
	l.slab(-3, 0, -6.5, -2.5, 8, -5, "brick")
	l.slab(-3, 0, -4, -2.5, 8, -2.5, "brick")
	l.slab(-3, 1.7, -5, -2.5, 8, -4, "brick")
	l.inspect(Vector3(-2.3, 1.0, -4.5), "Cistern Door", "A dry water tower. The pipes still work... probably.")
	var water := MeshInstance3D.new()
	var wb := BoxMesh.new()
	wb.size = Vector3(2.98, 1.0, 2.98)
	water.mesh = wb
	var wm := ShaderMaterial.new()
	wm.shader = preload("res://shaders/water.gdshader")
	wm.set_shader_parameter("alpha_v", 0.55)
	water.material_override = wm
	water.position = Vector3(-4.5, 0.0, -4.5)
	water.scale = Vector3(1, 0.01, 1)
	l.add_child(water)
	var raft := l.mover(Transform3D(Basis(), Vector3(-4.5, -0.15, -4.5)), Transform3D(Basis(), Vector3(-4.5, 7.85, -4.5)), 6.0)
	l.body_box(raft, Vector3.ZERO, Vector3(2.9, 0.3, 2.9), l.mat("wood"))
	for i in 5:
		l.body_box(raft, Vector3(-1.2 + i * 0.6, 0.16, 0), Vector3(0.08, 0.02, 2.8), l.mat_color(Color("6a4a2e")))
	raft.progress_cb = func(k: float) -> void:
		var h := lerpf(-0.15, 7.85, k)
		water.scale.y = maxf(0.01, h)
		water.position.y = h * 0.5 - 0.02
		if randf() < 0.05:
			Sfx.play_at("water_rise", water.global_position, -10.0)
	raft.solve_sound = false
	l.valve(Vector3(-1.15, 0.55, 0), PI * 0.5, [raft], raft)
	l.valve(Vector3(-2.05, 0.7, -5.75), PI * 0.5, [raft])
	l.inspect(Vector3(-2.2, 0.4, -6.4), "Hint", "Turn the valve, hop on the raft. Turn the one on the raft to ride it.")

	# housing roof (y=8)
	l.slab(-9, 0, -8, -6.5, 8, -1, "brick")
	l.checkpoint(Vector3(-7.8, 8, -6.8))
	l.slab(-8.8, 8, -2.6, -7.6, 8.6, -1.4, "metal")
	l.seed_pickup(Vector3(-8.2, 9.3, -2.0))
	l.vine_curtain(Vector3(-8.9, 7.9, -1.1), Vector3(-6.6, 7.9, -1.1), 8, 1.5, 4.0, true)
	l.vine_curtain(Vector3(-8.9, 7.9, -7.9), Vector3(-8.9, 7.9, -1.1), 8, 2.0, 5.0)

	# rotating billboard bridge over the gap
	var rot := l.rotator(Vector3(-7.5, 7.9, -10.6), 90.0)
	l.body_box(rot, Vector3.ZERO, Vector3(1.7, 0.2, 6.7), l.mat_color(Color("e8e0d0"), 0.2))
	l.body_box(rot, Vector3(0, 0.11, 0), Vector3(1.2, 0.02, 5.6), l.mat_color(Color("d86a8a")))
	l.box(Vector3(-7.5, 2.0, -10.6), Vector3(0.22, 11.6, 0.22), l.mat("metal"), false)
	l.inspect(Vector3(-7.2, 8.3, -8.4), "Hint", "That billboard spins on its pole. Focus on it to turn it.")

	# tower + chimney
	l.slab(-10, -4, -17.2, -5, 8, -13.2, "brick")
	l.island(-10, -17.2, -5, -13.2, -4, 5)
	l.checkpoint(Vector3(-6.0, 8, -14.0))
	l.slab(-9.5, 8, -17, -7.5, 13, -15, "brick")
	l.soil(Vector3(-8.5, 8, -14.4), 14.0, Vector3(0, 0, 1))
	l.slab(-11, 13, -19.5, -6, 14, -15, "concrete")
	l.crystal_pond(Vector3(-8.5, 14, -17.4), 1.2)
	l.snack_dish(Vector3(-10.2, 14, -15.8))
	l.vine_curtain(Vector3(-10.9, 13.1, -15.1), Vector3(-6.1, 13.1, -15.1), 10, 1.5, 4.0, true)
	l.streetlight(Vector3(-6.4, 14, -19.0), PI, Color("ffc8e0"))

	for p in [Vector3(3, 0.6, 3), Vector3(0, 0.6, 0), Vector3(-1.5, 0.6, -4.5), Vector3(-4.5, 3.0, -4.5), Vector3(-4.5, 6.0, -4.5),
			Vector3(-7.6, 8.6, -5), Vector3(-7.5, 8.6, -10.6), Vector3(-6, 8.6, -14.5), Vector3(-8.5, 10.5, -14.6),
			Vector3(-8.5, 12.5, -14.6), Vector3(-6.6, 14.6, -19.0), Vector3(-10.2, 15.5, -15.8)]:
		l.snack(p)

	# rooftop clutter
	l.slab(2, 0, -6, 4, 1.2, -4.6, "metal")
	l.slab(4.5, 0, -6, 6.5, 1.2, -4.6, "metal")
	l.inspect(Vector3(3, 1.4, -5.3), "AC Units", "Humming for no one since forever.")
	l.slab(2, 0, 1, 6, 0.5, 2.2, "wood")
	l.foliage(2.1, 1.1, 5.9, 2.1, 0.5, 30, [2, 3, 5, 7])
	l.slab(-1, 0, 5, 3, 0.5, 6.2, "wood")
	l.foliage(-0.9, 5.1, 2.9, 6.1, 0.5, 30, [4, 2, 0])
	l.foliage(-8.5, 0, -2, 7.5, 0, 50, [0, 1, 5, 6])
	l.foliage(-1.5, -7.5, 7.5, -1, 0, 40, [0, 1, 6])
	for i in 6:
		l.box(Vector3(-8 + i * 2.8, 2.6 + sin(i) * 0.1, 7.6), Vector3(0.1, 0.1, 0.1), l.mat_emit(Color("ffd8a8"), 3.0), false)
	l.npc(Vector3(-10.4, 15.0, -15.9))
	l.npc(Vector3(-10.0, 15.0, -15.6))
	l.npc(Vector3(-6.6, 14, -16.0))
	l.npc(Vector3(-10.4, 14, -18.8))
	l.npc(Vector3(6.4, 0, 3.0), 21)
	l.crow(Vector3(3, 1.2, -5.3))
	l.crow(Vector3(-8.0, 8.6, -2.0))
	l.crow(Vector3(-6.0, 14.0, -15.2))
	l.grows(l.foliage(-8.9, -7.9, -6.6, -1.1, 8, 40, [0, 2, 3, 6]), 7.5)
	l.grows(l.foliage(-9.9, -17.1, -5.1, -13.3, 8, 40, [0, 1, 3, 7]), 8.5)
	l.grows(l.foliage(-10.9, -19.4, -6.1, -15.1, 14, 60, [0, 2, 3, 5]), 12.5)
	l.grows(l.sapling(Vector3(-6.5, 14, -15.6), 1.5), 13.0)
	l.grows(l.vine_curtain(Vector3(-6.4, 7.9, -6.4), Vector3(-6.4, 7.9, -2.6), 6, 1.0, 3.0, true), 4.0)


# ====================================================================== 3. LAST BUS STOP
static func _busstop(l: Level) -> void:
	l.spawn = Vector3(6, 0.05, 6)
	l.top_y = 12.0
	l.kill_y = -10.0
	l.center = Vector3(0, 4, -4)

	l.slab(-9, -1, -12.5, 9, 0, 9, "asphalt")
	l.island(-9, -12.5, 9, 9, -1, 11)
	l.checkpoint(l.spawn)
	for i in 6:
		l.box(Vector3(0.0, 0.004, 7.5 - i * 2.4), Vector3(0.16, 0.01, 1.2), l.mat("hazard"), false)

	# fence + gate (needs BOTH plates pressed)
	l.slab(-9, 0, -1.2, -1.5, 3.8, -0.8, "rust")
	l.slab(1.5, 0, -1.2, 9, 3.8, -0.8, "rust")
	var gate := l.mover(Transform3D(Basis(), Vector3(0, 1.9, -1.0)), Transform3D(Basis(), Vector3(0, 5.8, -1.0)), 1.6)
	gate.required = 2
	l.body_box(gate, Vector3.ZERO, Vector3(3.0, 3.8, 0.3), l.mat("hazard"))
	var gi := Props.Inspectable.new()
	gi.label = "Heavy Gate"
	gi.text = "Two plates, two locks. It needs weight on both at the same time."
	gate.add_child(gi)
	l.plate(Vector3(-3.5, 0, 2.5), [gate])
	l.plate(Vector3(3.5, 0, 2.5), [gate])
	l.crate(Vector3(-5.5, 0.5, 4.5))
	var b := l.buddy(Vector3(3.8, 0.1, 6.6), 9)
	b.rotation.y = PI
	l.inspect(Vector3(1.8, 0.4, 3.6), "Hint", "Croak near your big friend to make it follow. Croak again to make it wait.")

	# bus shelter (seed on its roof)
	for x in [-7.0, -3.0]:
		l.slab(x - 0.1, 0, 6.8, x + 0.1, 2.4, 7.0, "metal")
	l.slab(-7.2, 2.4, 4.6, -2.8, 2.6, 7.4, "metal")
	l.slab(-6.5, 0, 6.6, -3.5, 0.5, 7.2, "wood")
	l.slab(-2.6, 0, 3.9, -1.8, 1.0, 4.7, "metal")
	l.inspect(Vector3(-2.2, 1.2, 4.3), "Bin", "A frog-sized step up to the shelter roof.")
	l.seed_pickup(Vector3(-5.0, 3.15, 5.8))
	l.sign_board(Vector3(-1.9, 2.2, 7.4), 0.0, Vector2(0.7, 0.7), Color("2a6ab0"))
	l.box(Vector3(-1.9, 1.0, 7.35), Vector3(0.08, 2.0, 0.08), l.mat("metal"), true)
	l.vending_machine(Vector3(7.8, 0, 3.0), -PI * 0.5)

	# stairs of rubble behind the fence
	l.slab(-6.5, 0, -3.6, -4.5, 1.2, -1.6, "concrete")
	l.slab(-8.5, 0, -5.4, -6.5, 2.4, -3.4, "concrete")
	l.slab(-8.5, 0, -7.8, -6.5, 3.6, -5.8, "brick")
	l.slab(-6.2, 0, -10.5, -4.2, 4.8, -8.5, "brick")
	l.slab(-3.2, 0, -10.5, -1.2, 6.0, -8.5, "concrete")
	l.checkpoint(Vector3(-2.2, 6.0, -9.5))
	l.slab(-4, 0, -8, 4, 9, -4, "brick")
	l.inspect(Vector3(0, 3, -3.9), "Old Tower", "Nine floors of nothing. The view from the top is for crows.")

	# spinning plank to the chimney stack
	var rot := l.rotator(Vector3(1.4, 5.9, -9.5), 90.0)
	l.body_box(rot, Vector3.ZERO, Vector3(6.7, 0.2, 1.7), l.mat("wood"))
	l.box(Vector3(1.4, 2.9, -9.5), Vector3(0.22, 5.8, 0.22), l.mat("metal"), false)
	l.slab(4.0, 0, -11, 6.5, 6.0, -8.5, "brick")
	l.checkpoint(Vector3(5.6, 6.0, -9.0))
	l.slab(4.0, 0, -12.5, 6.5, 11, -11, "brick")
	l.soil(Vector3(5.25, 6.0, -10.55), 12.0, Vector3(0, 0, 1))
	l.slab(3, 11, -15.5, 8.5, 12, -11, "concrete")
	l.island(3, -15.5, 8.5, -11, 11, 4)
	l.crystal_pond(Vector3(5.75, 12, -13.4), 1.2)
	l.snack_dish(Vector3(7.7, 12, -11.8))
	l.vine_curtain(Vector3(3.1, 11.1, -11.1), Vector3(8.4, 11.1, -11.1), 10, 1.5, 4.0, true)

	# a bus that gave up
	var bus := Node3D.new()
	bus.position = Vector3(7.0, 0, -4.2)
	l.add_child(bus)
	l.box(Vector3(0, 1.2, 0), Vector3(2.4, 2.4, 5.0), l.mat_color(Color("e8b030"), 0.35), true, bus)
	l.box(Vector3(0, 1.6, 0), Vector3(2.42, 0.7, 4.4), l.mat_color(Color("2a3a44"), 0.0, 0.5), false, bus)
	l.inspect(Vector3(7.0, 2.6, -4.2), "Route 100", "Final stop: The Clouds. No refunds.")

	for p in [Vector3(4, 0.6, 4), Vector3(0, 0.6, 4.5), Vector3(-4, 3.2, 5.5), Vector3(0, 0.6, -2.6),
			Vector3(-7.5, 3.0, -4.4), Vector3(-5.2, 5.4, -9.5), Vector3(1.4, 6.6, -9.5), Vector3(5.2, 6.6, -9.0),
			Vector3(5.25, 8.5, -10.7), Vector3(5.25, 10.5, -10.7), Vector3(3.8, 12.6, -14.6), Vector3(7.7, 13.5, -11.8)]:
		l.snack(p)

	l.npc(Vector3(7.4, 13.0, -11.9))
	l.npc(Vector3(8.0, 13.0, -11.6))
	l.npc(Vector3(3.6, 12, -12.0))
	l.npc(Vector3(8.0, 12, -15.0))
	l.npc(Vector3(-4.8, 0.5, 6.9), 6)
	l.crow(Vector3(-5.0, 2.6, 5.0))
	l.crow(Vector3(-2.0, 9.0, -6.0))
	l.crow(Vector3(7.0, 2.4, -3.0))
	l.streetlight(Vector3(8.4, 0, 8.4), -PI * 0.75, Color("ffe0a0"))
	l.streetlight(Vector3(-8.4, 0, -11.8), PI * 0.25, Color("ffe0a0"))
	l.cone(Vector3(1.4, 0, 0.0))
	l.cone(Vector3(-1.6, 0, 0.2))
	l.tire(Vector3(-8.0, 0, 1.0))
	l.foliage(-9, 0, -2, 4, 0, 35, [4, 0, 1])
	l.foliage(2, 4, 9, 9, 0, 40, [4, 4, 0, 5])
	l.foliage(-9, -12.4, 9, -1.4, 0, 70, [4, 0, 1, 6])
	l.grows(l.foliage(-8.4, -7.7, -6.6, -3.5, 3.6, 25, [2, 3, 0]), 3.0)
	l.grows(l.foliage(4.1, -10.9, 6.4, -8.6, 6, 20, [0, 2, 7]), 5.5)
	l.grows(l.foliage(3.1, -15.4, 8.4, -11.1, 12, 60, [0, 2, 3, 5, 4]), 10.5)
	l.grows(l.vine_curtain(Vector3(-3.9, 8.9, -3.9), Vector3(3.9, 8.9, -3.9), 16, 2.0, 6.0, true), 4.0)
	l.grows(l.sapling(Vector3(4.0, 12, -14.8), 1.8), 11.0)
