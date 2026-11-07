extends Node
## Headless playtest: drives the real player with simulated input to prove every puzzle is solvable.
## Run: godot --headless --path . res://tests/test_runner.tscn

var main: Node
var fails := 0


func _ready() -> void:
	# isolated save so running tests never wipes a player's real progress
	Game.save_path = "user://test_save.cfg"
	Game.reset_save()
	Game.settings.auto_camera = false
	main = load("res://scripts/main.gd").new()
	add_child(main)
	await wait(0.5)
	await test_overpass()
	await test_rooftop()
	await test_busstop()
	await test_ui()
	print("\n==== RESULT: %s (%d failures) ====" % ["PASS" if fails == 0 else "FAIL", fails])
	get_tree().quit(1 if fails else 0)


func wait(t: float) -> void:
	await get_tree().create_timer(t, true, true).timeout


func check(cond: bool, what: String) -> void:
	print(("  ok   " if cond else "  FAIL ") + what)
	if not cond:
		fails += 1


func hold(actions: Array, t: float, jump_at: float = -1.0) -> void:
	for a in actions:
		_send(a, true)
	if jump_at >= 0.0:
		await wait(jump_at)
		_jump(true)
		await wait(maxf(0.0, t - jump_at))
		_jump(false)
	else:
		await wait(t)
	for a in actions:
		_send(a, false)


func _jump(on: bool) -> void:
	# Godot drops action_press() states when an InputEventAction is parsed, so drive jump through the player's buffer.
	var p: PlayerFrog = main.player
	p.sim_jump_held = on
	if on:
		p._jump_buf = 0.14


func _send(action: String, on: bool) -> void:
	if on:
		Input.action_press(action)
	else:
		Input.action_release(action)


## Jump and steer toward a landing point like a player would; returns once landed.
func hop(target: Vector3) -> void:
	var p: PlayerFrog = main.player
	_jump(true)
	var t := 0.0
	var airborne := false
	while t < 2.0:
		var d := Vector2(target.x - p.global_position.x, target.z - p.global_position.z)
		_steer(d.normalized() if d.length() > 0.2 else Vector2.ZERO)
		await wait(1.0 / 60.0)
		t += 1.0 / 60.0
		if not p.is_on_floor():
			airborne = true
		elif airborne:
			break
	_steer(Vector2.ZERO)
	_jump(false)
	await wait(0.2)


func walk_to(target: Vector3, max_t: float = 4.0) -> void:
	var p: PlayerFrog = main.player
	var t := 0.0
	while t < max_t:
		var d := Vector2(target.x - p.global_position.x, target.z - p.global_position.z)
		if d.length() < 0.25:
			break
		_steer(d.normalized())
		await wait(1.0 / 60.0)
		t += 1.0 / 60.0
	_steer(Vector2.ZERO)
	await wait(0.2)


func _steer(v: Vector2) -> void:
	# camera yaw is 0, so +x = move_right and -z = move_forward
	for a in ["move_left", "move_right", "move_forward", "move_back"]:
		Input.action_release(a)
	if v.x > 0.01:
		Input.action_press("move_right", v.x)
	elif v.x < -0.01:
		Input.action_press("move_left", -v.x)
	if v.y > 0.01:
		Input.action_press("move_back", v.y)
	elif v.y < -0.01:
		Input.action_press("move_forward", -v.y)


func place(p: Vector3) -> void:
	var pl: PlayerFrog = main.player
	pl.global_position = p
	pl.velocity = Vector3.ZERO
	await wait(0.4)


func start(i: int) -> void:
	main.start_level(i)
	await wait(1.0)
	main.rig.yaw = 0.0  # move_right = +x, move_forward = -z


func pos() -> Vector3:
	return main.player.global_position


func find(cls: Variant) -> Array:
	var out: Array = []
	for c in main.level.get_children():
		if is_instance_of(c, cls):
			out.append(c)
	return out


func test_overpass() -> void:
	print("\n-- Level 1: The Overpass")
	await start(0)
	var lv: Level = main.level
	# jump test: from ground onto step 1 (top y=1)
	await place(lv.spawn)
	await walk_to(Vector3(-3, 0, 1.6))
	await hop(Vector3(-3, 1, -0.5))
	check(pos().y > 0.9, "hop onto rubble step (y=%.2f)" % pos().y)
	await hop(Vector3(-1.4, 2, -2.3))
	check(pos().y > 1.9, "hop onto second step (y=%.2f)" % pos().y)
	await hop(Vector3(1.0, 3, -4.5))
	check(pos().y > 2.9, "hop onto brick ledge (y=%.2f)" % pos().y)
	await walk_to(Vector3(3.6, 3.0, -5.9))
	await hop(Vector3(5.4, 3.95, -5.0))
	check(pos().y > 3.8, "hop onto the wrecked car (y=%.2f)" % pos().y)
	# sticky hands: walk into the concrete step and climb it without jumping
	await place(Vector3(-1.3, 0.1, 0.3))
	await walk_to(Vector3(-1.3, 2.0, -2.4), 2.5)
	check(pos().y > 1.9, "sticky hands climbed a concrete wall (y=%.2f)" % pos().y)
	# physics junk gets knocked around
	var cone: Node3D = null
	for c in get_tree().get_nodes_in_group("phys_prop"):
		if (c as Node3D).global_position.distance_to(Vector3(2.5, 0, 4.8)) < 0.5:
			cone = c
	var c0 := cone.global_position
	await place(Vector3(0.8, 0.1, 4.8))
	await walk_to(Vector3(4.0, 0, 4.8), 1.5)
	await wait(0.6)
	check(cone.global_position.distance_to(c0) > 0.15 or absf(cone.rotation.x) + absf(cone.rotation.z) > 0.5, "bumped a traffic cone over (moved %.2f)" % cone.global_position.distance_to(c0))
	# crate -> plate -> ramp
	var crate: Node3D = find(Props.Crate)[0]
	await place(Vector3(0.4, 0.1, 2.0))
	var t := 0.0
	_send("move_right", true)
	while crate.global_position.x < 4.9 and t < 6.0:
		await wait(0.05)
		t += 0.05
	_send("move_right", false)
	await wait(0.4)
	check(crate.global_position.x > 4.4, "crate pushed onto plate (x=%.2f)" % crate.global_position.x)
	var ramp: Props.Mover = null
	for m in find(Props.Mover):
		ramp = m
	check(ramp.active, "plate triggered the road-sign ramp")
	await wait(2.6)
	await place(Vector3(4.4, 3.2, -3.4))
	await walk_to(Vector3(4.2, 3.0, -4.6))
	await walk_to(Vector3(-2.5, 6.5, -4.6), 4.0)
	await wait(0.3)
	check(pos().y > 6.3, "walked up ramp to middle deck (y=%.2f, x=%.2f)" % [pos().y, pos().x])
	# seed via tongue
	await place(Vector3(-2.2, 6.6, -1.6))
	main.player.lick()
	await wait(0.5)
	check(main.player.carrying_seed, "licked up the seed")
	# plant + climb
	await place(Vector3(-4.0, 6.6, -4.75))
	var soil: Props.SoilPlot = find(Props.SoilPlot)[0]
	soil.interact(main.player)
	check(soil.planted, "planted seed in soft soil")
	await wait(1.0)
	await hold(["move_left"], 4.5)
	await wait(0.4)
	check(pos().y > 12.8, "climbed the vine to the top deck (y=%.2f)" % pos().y)
	check(lv.progress() > 0.95, "height progress ~100%% (%.2f)" % lv.progress())
	await place(Vector3(-9.6, 13.6, -5.4))
	await wait(0.5)
	check(lv.is_complete, "reached the crystal pond")
	await wait(3.5)


func test_rooftop() -> void:
	print("\n-- Level 2: Rooftop Cistern")
	await start(1)
	var lv: Level = main.level
	var raft: Props.Mover = find(Props.Mover)[0]
	var valves: Array = []
	for n in get_tree().get_nodes_in_group("focusable"):
		if n is Props.Valve:
			valves.append(n)
	check(valves.size() == 2, "two valves")
	# walk through the door onto the raft
	await place(Vector3(-1.5, 0.1, -4.5))
	await hold(["move_left"], 1.6)
	await wait(0.2)
	check(pos().x < -3.2, "walked through cistern door onto raft (x=%.2f)" % pos().x)
	var raft_valve: Node = null
	for v in valves:
		if v.get_parent() == raft:
			raft_valve = v
	raft_valve.interact(main.player)
	await wait(6.8)
	check(raft.active and raft.global_position.y > 7.7, "raft floated up (y=%.2f)" % raft.global_position.y)
	check(pos().y > 7.7, "frog rode the raft up (y=%.2f)" % pos().y)
	await hold(["move_left"], 0.55)
	await wait(0.3)
	check(pos().x < -6.3 and pos().y > 7.8, "stepped onto housing roof (x=%.2f y=%.2f)" % [pos().x, pos().y])
	await place(Vector3(-8.2, 8.7, -1.9))
	await hold(["move_forward"], 0.3, 0.0)
	await wait(0.6)
	if not main.player.carrying_seed:
		main.player.lick()
		await wait(0.5)
	check(main.player.carrying_seed, "got the rooftop seed")
	var rot: Props.Rotator = find(Props.Rotator)[0]
	rot.interact(main.player)
	await wait(1.0)
	await place(Vector3(-7.5, 8.2, -8.5))
	await hold(["move_forward"], 1.6)
	await wait(0.3)
	check(pos().z < -13.0 and pos().y > 7.8, "crossed the spun billboard (z=%.2f y=%.2f)" % [pos().z, pos().y])
	var soil: Props.SoilPlot = find(Props.SoilPlot)[0]
	await place(Vector3(-8.5, 8.2, -14.2))
	soil.interact(main.player)
	await wait(1.0)
	await hold(["move_forward"], 4.0)
	await wait(0.3)
	check(pos().y > 13.8, "climbed chimney vine (y=%.2f)" % pos().y)
	await place(Vector3(-8.5, 14.6, -17.4))
	await wait(0.5)
	check(lv.is_complete, "reached the crystal pond")
	await wait(3.5)


func test_busstop() -> void:
	print("\n-- Level 3: Last Bus Stop")
	await start(2)
	var lv: Level = main.level
	var gate: Props.Mover = find(Props.Mover)[0]
	var buddy: Props.Buddy = null
	for n in lv.npcs:
		if n is Props.Buddy:
			buddy = n
	# seed: bin -> shelter roof
	await place(Vector3(-0.8, 0.1, 4.3))
	await hop(Vector3(-2.2, 1, 4.3))
	check(pos().y > 0.9, "hopped onto bin (y=%.2f)" % pos().y)
	await hop(Vector3(-3.6, 2.6, 5.2))
	check(pos().y > 2.5, "hopped onto shelter roof (y=%.2f)" % pos().y)
	await place(Vector3(-5.0, 2.8, 5.8))
	await wait(0.3)
	check(main.player.carrying_seed, "picked up seed on the roof")
	# buddy follows to plate 2
	await place(Vector3(3.8, 0.1, 5.5))
	main.player.croak()
	await wait(0.6)
	check(buddy.following, "buddy follows after a croak")
	await walk_to(Vector3(3.5, 0, 1.6))
	await wait(1.5)
	main.player.croak()
	await wait(0.6)
	check(not buddy.following, "buddy waits after second croak")
	await wait(1.5)
	check(Vector2(buddy.global_position.x - 3.5, buddy.global_position.z - 2.5).length() < 0.5, "buddy sat on plate B (d=%.2f)" % buddy.global_position.distance_to(Vector3(3.5, 0, 2.5)))
	# push crate onto plate A: crate (-5.5, 4.5) -> plate (-3.5, 2.5)
	var crate: Node3D = find(Props.Crate)[0]
	await place(Vector3(-5.5, 0.1, 5.6))
	_send("move_forward", true)
	var t := 0.0
	while crate.global_position.z > 2.6 and t < 5.0:
		await wait(0.05)
		t += 0.05
	_send("move_forward", false)
	await place(Vector3(-6.6, 0.1, crate.global_position.z))
	_send("move_right", true)
	t = 0.0
	while crate.global_position.x < -3.6 and t < 5.0:
		await wait(0.05)
		t += 0.05
	_send("move_right", false)
	await wait(0.4)
	check(crate.global_position.distance_to(Vector3(-3.5, 0.5, 2.5)) < 0.9, "crate on plate A (%s)" % str(crate.global_position))
	await wait(1.8)
	check(gate.active, "gate opened with both plates held")
	await place(Vector3(0, 0.1, 1.0))
	await walk_to(Vector3(0, 0, -2.6))
	check(pos().z < -1.6, "walked through the gate (z=%.2f)" % pos().z)
	# smooth metal fence is slippery: no climbing over
	await place(Vector3(-4.0, 0.1, 0.0))
	await walk_to(Vector3(-4.0, 0, -2.5), 2.0)
	check(pos().y < 1.0 and pos().z > -1.0, "slippery fence can't be climbed (y=%.2f)" % pos().y)
	await place(Vector3(0, 0.1, -2.6))
	# the rubble staircase, by real jumps
	await walk_to(Vector3(-5.5, 0, -0.8 - 0.6))
	await hop(Vector3(-5.5, 1.2, -2.8))
	check(pos().y > 1.1, "stair 1 (y=%.2f)" % pos().y)
	await hop(Vector3(-7.5, 2.4, -4.4))
	check(pos().y > 2.3, "stair 2 (y=%.2f)" % pos().y)
	await hop(Vector3(-7.5, 3.6, -6.8))
	check(pos().y > 3.5, "stair 3 (y=%.2f)" % pos().y)
	await hop(Vector3(-5.2, 4.8, -9.5))
	check(pos().y > 4.7, "stair 4 (y=%.2f)" % pos().y)
	await hop(Vector3(-2.2, 6.0, -9.5))
	check(pos().y > 5.9, "stair 5 (y=%.2f)" % pos().y)
	var rot: Props.Rotator = find(Props.Rotator)[0]
	rot.interact(main.player)
	await wait(1.0)
	await place(Vector3(-1.6, 6.1, -9.5))
	await hold(["move_right"], 1.8)
	await wait(0.3)
	check(pos().x > 4.0 and pos().y > 5.8, "crossed plank to chimney stack (x=%.2f y=%.2f)" % [pos().x, pos().y])
	var soil: Props.SoilPlot = find(Props.SoilPlot)[0]
	await place(Vector3(5.25, 6.2, -10.2))
	soil.interact(main.player)
	check(soil.planted, "planted the seed")
	await wait(1.0)
	await hold(["move_forward"], 4.0)
	await wait(0.3)
	check(pos().y > 11.8, "climbed to the pond platform (y=%.2f)" % pos().y)
	await place(Vector3(5.75, 12.6, -13.4))
	await wait(0.5)
	check(lv.is_complete, "reached the crystal pond")
	await wait(1.0)


func test_ui() -> void:
	print("\n-- Menus, settings, focus mode")
	var ui: GameUI = main.ui
	ui.show_title()
	await wait(0.2)
	ui.show_settings()
	await wait(0.2)
	for preset in ["low", "medium", "high", "ultra"]:
		Game.apply_preset(preset)
	check(Game.settings.quality == "ultra" and Game.settings.sdfgi == true, "quality presets apply")
	Game.set_setting("dof", "subtle")
	check(Game.settings.quality == "custom", "changing an option switches preset to custom")
	Game.apply_preset("ultra")
	ui.show_settings_refresh()
	await wait(0.2)
	ui.back()
	ui.show_book()
	await wait(0.3)
	ui._book_select(1)
	ui._book_select(57)
	await wait(0.2)
	check(ui._book_info.text != "", "frog book shows info")
	ui.back()
	ui.show_levels()
	await wait(0.2)
	await start(0)
	main._enter_focus()
	await wait(0.3)
	check(main.focus_mode and main.rig.focus_point != null, "focus mode targets something")
	main._cycle(1)
	main._cycle(1)
	await wait(0.2)
	main._exit_focus()
	check(not main.focus_mode and is_equal_approx(Engine.time_scale, 1.0), "focus mode exits cleanly")
	main.pause()
	await wait(0.2)
	check(get_tree().paused and ui.in_menu(), "pause menu")
	main.resume()
	ui.show_complete("Test", 3, 11, [5, 6], true)
	await wait(0.2)
	check(ui.in_menu(), "level complete panel")
	ui.close_menus()
