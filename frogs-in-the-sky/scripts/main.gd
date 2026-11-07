extends Node
## Orchestrates world, environment, levels, player, camera, focus mode and menus.

var world: Node3D
var env: Environment
var sky_mat: ProceduralSkyMaterial
var sun: DirectionalLight3D
var rig: CameraRig
var ui: GameUI
var level: Level
var player: PlayerFrog
var level_index := 0
var state := "title"     # title | playing | paused | complete
var focus_mode := false
var _focus_targets: Array = []
var _focus_i := 0
var _marker: MeshInstance3D
var _complete_info := {}


func _ready() -> void:
	_build_world()
	ui = GameUI.new()
	ui.main = self
	add_child(ui)
	var start := clampi(int(Game.data.levels_unlocked) - 1, 0, Levels.DEFS.size() - 1)
	load_level(start, true)
	ui.show_title()
	Sfx.start_ambience()
	Game.apply_settings()


func _build_world() -> void:
	world = Node3D.new()
	world.name = "World"
	add_child(world)
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky_mat = ProceduralSkyMaterial.new()
	sky_mat.sun_angle_max = 20.0
	sky_mat.sky_curve = 0.12
	sky.sky_material = sky_mat
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.75
	env.ambient_light_energy = 1.0
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.ssao_radius = 1.4
	env.ssao_intensity = 2.0
	env.ssao_power = 1.6
	env.ssao_detail = 0.6
	env.ssil_radius = 4.0
	env.ssil_intensity = 0.8
	env.sdfgi_use_occlusion = true
	env.sdfgi_cascades = 4
	env.sdfgi_min_cell_size = 0.15
	env.sdfgi_energy = 0.9
	env.glow_intensity = 0.55
	env.glow_strength = 0.9
	env.glow_bloom = 0.08
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.glow_hdr_threshold = 0.9
	env.fog_enabled = true
	env.fog_density = 0.012
	env.fog_aerial_perspective = 0.35
	env.fog_sky_affect = 0.6
	env.fog_height = -4.0
	env.fog_height_density = 0.12
	env.volumetric_fog_density = 0.012
	env.volumetric_fog_anisotropy = 0.55
	env.volumetric_fog_length = 48.0
	env.volumetric_fog_detail_spread = 1.5
	env.volumetric_fog_ambient_inject = 0.35
	env.volumetric_fog_sky_affect = 0.2
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.04
	env.adjustment_contrast = 1.02
	var we := WorldEnvironment.new()
	we.environment = env
	world.add_child(we)
	sun = DirectionalLight3D.new()
	sun.shadow_enabled = true
	sun.shadow_blur = 1.2
	sun.directional_shadow_max_distance = 60.0
	sun.light_volumetric_fog_energy = 1.4
	world.add_child(sun)
	Game.env = env
	Game.sun = sun
	rig = CameraRig.new()
	world.add_child(rig)
	_marker = MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.55
	tm.outer_radius = 0.62
	tm.rings = 32
	_marker.mesh = tm
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(1, 1, 1, 0.7)
	mm.emission_enabled = true
	mm.emission = Color(1, 1, 0.95)
	mm.emission_energy_multiplier = 1.5
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.no_depth_test = true
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_marker.material_override = mm
	_marker.visible = false
	world.add_child(_marker)


func _apply_palette(d: Dictionary) -> void:
	var top := Color(d.sky_top)
	var hor := Color(d.horizon)
	sky_mat.sky_top_color = top
	sky_mat.sky_horizon_color = hor
	sky_mat.ground_horizon_color = hor
	sky_mat.ground_bottom_color = Color(d.fog).darkened(0.05)
	sky_mat.sun_angle_max = 25.0
	env.fog_light_color = Color(d.fog)
	env.volumetric_fog_albedo = Color(d.fog).lightened(0.2)
	env.ambient_light_color = Color(d.ambient)
	sun.light_color = Color(d.sun)
	sun.light_energy = float(d.sun_energy)
	sun.rotation_degrees = d.sun_rot


# ================================================================ level flow
func load_level(i: int, title_mode: bool = false) -> void:
	_exit_focus()
	if level:
		level.queue_free()
		world.remove_child(level)
	if player:
		player.queue_free()
		world.remove_child(player)
	level_index = i
	level = Level.new()
	Levels.build(level, i)
	world.add_child(level)
	_apply_palette(level.def)
	player = PlayerFrog.new()
	player.main = self
	player.camera_rig = rig
	world.add_child(player)
	player.global_position = level.spawn
	level.attach_player(player)
	level.completed.connect(_on_level_complete)
	level.snack_changed.connect(func(c: int, t: int) -> void: ui.set_snacks(c, t))
	level.toast_requested.connect(func(t: String) -> void: ui.toast(t))
	ui.set_snacks(level.snack_count, level.snack_total)
	ui.set_level_name(level.def.name)
	rig.target = player
	var to_c := level.center - level.spawn
	rig.yaw = atan2(-to_c.x, -to_c.z)
	rig.pitch = -0.38
	rig.pivot = level.spawn + Vector3(0, 0.6, 0)
	rig.orbit_center = level.center
	rig.orbit_mode = title_mode
	player.input_enabled = not title_mode
	Game.apply_settings()


func start_level(i: int) -> void:
	get_tree().paused = false
	Engine.time_scale = 1.0
	ui.close_menus()
	ui.fade(0.4)
	await get_tree().create_timer(0.4).timeout
	load_level(i, false)
	state = "playing"
	ui.set_hud_visible(true)
	ui.show_level_card(level.def.name, level.def.subtitle)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func next_level() -> void:
	start_level(mini(level_index + 1, Levels.DEFS.size() - 1))


func restart_level() -> void:
	start_level(level_index)


func quit_to_title() -> void:
	get_tree().paused = false
	Engine.time_scale = 1.0
	state = "title"
	ui.fade(0.4)
	await get_tree().create_timer(0.4).timeout
	load_level(level_index, true)
	ui.show_title()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func pause() -> void:
	if state != "playing":
		return
	_exit_focus()
	state = "paused"
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_pause()


func resume() -> void:
	ui.close_menus()
	get_tree().paused = false
	state = "playing"
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _on_level_complete() -> void:
	state = "complete"
	_exit_focus()
	player.input_enabled = false
	var d := level.def
	var newly: Array = []
	if not (d.id in Game.data.completed):
		Game.data.completed.append(d.id)
		newly = Game.unlock_next_frogs(int(d.frog_reward))
	Game.data.levels_unlocked = maxi(int(Game.data.levels_unlocked), mini(level_index + 2, Levels.DEFS.size()))
	Game.save_game()
	Sfx.play("complete", -2.0)
	rig.orbit_center = level.center + Vector3(0, 2, 0)
	await get_tree().create_timer(1.2).timeout
	rig.orbit_mode = true
	await get_tree().create_timer(2.0).timeout
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.show_complete(d.name, level.snack_count, level.snack_total, newly, level_index + 1 < Levels.DEFS.size())


func shake(a: float) -> void:
	rig.shake(a)


func fade(t: float) -> void:
	ui.fade(t)


# ================================================================ input + focus mode
func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("pause"):
		if state == "playing":
			pause()
		elif state == "paused" and ui._menu_stack.size() == 1:
			resume()
		get_viewport().set_input_as_handled()
		return
	if state != "playing":
		return
	if event.is_action_pressed("focus"):
		if focus_mode:
			_exit_focus()
		else:
			_enter_focus()
		get_viewport().set_input_as_handled()
		return
	if focus_mode:
		if event.is_action_pressed("focus_next"):
			_cycle(1)
		elif event.is_action_pressed("focus_prev"):
			_cycle(-1)
		elif event.is_action_pressed("interact") or event.is_action_pressed("jump"):
			_focus_interact()
		elif event.is_action_pressed("ui_cancel"):
			_exit_focus()
		get_viewport().set_input_as_handled()


func _enter_focus() -> void:
	_focus_targets.clear()
	for n in get_tree().get_nodes_in_group("focusable"):
		var nd := n as Node3D
		if nd and nd.is_inside_tree() and nd.is_visible_in_tree() and nd.global_position.distance_to(player.global_position) < 16.0:
			_focus_targets.append(nd)
	if _focus_targets.is_empty():
		ui.toast("Nothing interesting nearby.")
		return
	var pp := player.global_position
	_focus_targets.sort_custom(func(a: Node3D, b: Node3D) -> bool:
		return a.global_position.distance_to(pp) < b.global_position.distance_to(pp))
	focus_mode = true
	_focus_i = 0
	Engine.time_scale = 0.4
	Sfx.play("whoosh", -6.0, 0.8)
	_show_focus()


func _exit_focus() -> void:
	if not focus_mode:
		return
	focus_mode = false
	Engine.time_scale = 1.0
	rig.focus_point = null
	_marker.visible = false
	ui.hide_focus()
	Sfx.play("whoosh", -8.0, 1.1)


func _cycle(d: int) -> void:
	_focus_i = posmod(_focus_i + d, _focus_targets.size())
	Sfx.play("ui_move", -6.0)
	_show_focus()


func _current_target() -> Node3D:
	if _focus_targets.is_empty():
		return null
	var t: Node3D = _focus_targets[_focus_i]
	if not is_instance_valid(t) or not t.is_inside_tree():
		_focus_targets.remove_at(_focus_i)
		if _focus_targets.is_empty():
			return null
		_focus_i = _focus_i % _focus_targets.size()
		return _current_target()
	return t


func _show_focus() -> void:
	var t := _current_target()
	if t == null:
		_exit_focus()
		return
	rig.focus_point = t.global_position
	var prompt: String = t.focus_prompt(player) if t.has_method("focus_prompt") else ""
	ui.show_focus(t.focus_label(), t.focus_text(), prompt, _focus_targets.size())


func _focus_interact() -> void:
	var t := _current_target()
	if t == null:
		return
	if t.has_method("can_interact") and t.can_interact(player):
		t.interact(player)
	elif t.has_method("focus_prompt") and t.focus_prompt(player) != "":
		t.interact(player)
	await get_tree().create_timer(0.15).timeout
	if focus_mode:
		_show_focus()


func _process(delta: float) -> void:
	if level == null or player == null:
		return
	if state == "playing":
		ui.set_progress(level.progress())
		if focus_mode:
			var t := _current_target()
			if t:
				rig.focus_point = t.global_position
				_marker.visible = true
				_marker.global_position = t.global_position + Vector3(0, 0.05, 0)
				_marker.rotation.y += delta * 3.0
				var k := 1.0 + sin(Time.get_ticks_msec() * 0.006) * 0.08
				_marker.scale = Vector3(k, k, k)
			ui.set_prompt("")
		else:
			var n := player.nearest_interactable()
			if n:
				var p: String = n.focus_prompt(player)
				ui.set_prompt("[%s]  %s" % [Game.prompt("interact"), p] if p != "" else "")
			else:
				ui.set_prompt("")
