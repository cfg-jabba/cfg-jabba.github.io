extends Node
## Global: settings, save data, input map, graphics + audio application.

signal settings_changed
signal device_changed(using_pad: bool)

const SETTINGS_PATH := "user://settings.cfg"
const SAVE_PATH := "user://save.cfg"

var using_pad := false
var env: Environment
var cam_attr: CameraAttributesPractical
var sun: DirectionalLight3D

var settings: Dictionary = {
	"quality": "ultra",
	"window_mode": "borderless",
	"vsync": true,
	"max_fps": 0,
	"render_scale": 1.0,
	"upscaler": "bilinear",
	"antialiasing": "taa",
	"shadows": 3,
	"ssao": true,
	"ssil": true,
	"sdfgi": true,
	"volumetric_fog": true,
	"glow": true,
	"dof": "cinematic",
	"dof_strength": 1.0,
	"tilt_shift": true,
	"foliage_density": 1.0,
	"fov": 50.0,
	"cam_sensitivity": 1.0,
	"invert_y": false,
	"invert_x": false,
	"camera_shake": true,
	"auto_camera": true,
	"vol_master": 0.8,
	"vol_music": 0.55,
	"vol_ambience": 0.8,
	"vol_sfx": 0.75,
}

const PRESETS := {
	"low": {"shadows": 0, "ssao": false, "ssil": false, "sdfgi": false, "volumetric_fog": false, "glow": true,
		"antialiasing": "fxaa", "foliage_density": 0.35, "render_scale": 0.75, "dof": "off"},
	"medium": {"shadows": 1, "ssao": true, "ssil": false, "sdfgi": false, "volumetric_fog": false, "glow": true,
		"antialiasing": "fxaa", "foliage_density": 0.6, "render_scale": 1.0, "dof": "subtle"},
	"high": {"shadows": 2, "ssao": true, "ssil": false, "sdfgi": false, "volumetric_fog": true, "glow": true,
		"antialiasing": "taa", "foliage_density": 0.85, "render_scale": 1.0, "dof": "cinematic"},
	"ultra": {"shadows": 3, "ssao": true, "ssil": true, "sdfgi": true, "volumetric_fog": true, "glow": true,
		"antialiasing": "taa", "foliage_density": 1.0, "render_scale": 1.0, "dof": "cinematic"},
}

var data: Dictionary = {
	"levels_unlocked": 1,
	"frogs": [0, 1, 2],
	"selected_frog": 0,
	"snacks_total": 0,
	"collected": {},
	"completed": [],
}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_setup_input()
	_setup_audio_buses()
	load_settings()
	load_save()
	apply_settings()


func _input(event: InputEvent) -> void:
	var pad := event is InputEventJoypadButton or (event is InputEventJoypadMotion and absf((event as InputEventJoypadMotion).axis_value) > 0.45)
	var kb := event is InputEventKey or event is InputEventMouseButton or (event is InputEventMouseMotion and (event as InputEventMouseMotion).relative.length() > 3.0)
	if pad and not using_pad:
		using_pad = true
		device_changed.emit(true)
	elif kb and using_pad:
		using_pad = false
		device_changed.emit(false)


# ---------------------------------------------------------------- input
func _key(k: Key) -> InputEventKey:
	var e := InputEventKey.new()
	e.physical_keycode = k
	return e


func _joyb(b: JoyButton) -> InputEventJoypadButton:
	var e := InputEventJoypadButton.new()
	e.button_index = b
	return e


func _joya(a: JoyAxis, v: float) -> InputEventJoypadMotion:
	var e := InputEventJoypadMotion.new()
	e.axis = a
	e.axis_value = v
	return e


func _mouse(b: MouseButton) -> InputEventMouseButton:
	var e := InputEventMouseButton.new()
	e.button_index = b
	return e


func _act(action: String, events: Array, dz: float = 0.25) -> void:
	if not InputMap.has_action(action):
		InputMap.add_action(action, dz)
	for e in events:
		InputMap.action_add_event(action, e)


func _setup_input() -> void:
	_act("move_forward", [_key(KEY_W), _key(KEY_UP), _joya(JOY_AXIS_LEFT_Y, -1.0)], 0.2)
	_act("move_back", [_key(KEY_S), _key(KEY_DOWN), _joya(JOY_AXIS_LEFT_Y, 1.0)], 0.2)
	_act("move_left", [_key(KEY_A), _key(KEY_LEFT), _joya(JOY_AXIS_LEFT_X, -1.0)], 0.2)
	_act("move_right", [_key(KEY_D), _key(KEY_RIGHT), _joya(JOY_AXIS_LEFT_X, 1.0)], 0.2)
	_act("cam_left", [_joya(JOY_AXIS_RIGHT_X, -1.0)], 0.15)
	_act("cam_right", [_joya(JOY_AXIS_RIGHT_X, 1.0)], 0.15)
	_act("cam_up", [_joya(JOY_AXIS_RIGHT_Y, -1.0)], 0.15)
	_act("cam_down", [_joya(JOY_AXIS_RIGHT_Y, 1.0)], 0.15)
	_act("zoom_in", [_mouse(MOUSE_BUTTON_WHEEL_UP), _joyb(JOY_BUTTON_DPAD_UP)])
	_act("zoom_out", [_mouse(MOUSE_BUTTON_WHEEL_DOWN), _joyb(JOY_BUTTON_DPAD_DOWN)])
	_act("jump", [_key(KEY_SPACE), _joyb(JOY_BUTTON_A)])
	_act("tongue", [_key(KEY_F), _mouse(MOUSE_BUTTON_LEFT), _joyb(JOY_BUTTON_X)])
	_act("interact", [_key(KEY_E), _joyb(JOY_BUTTON_Y)])
	_act("croak", [_key(KEY_C), _joyb(JOY_BUTTON_B)])
	_act("focus", [_key(KEY_TAB), _key(KEY_Q), _mouse(MOUSE_BUTTON_RIGHT), _joya(JOY_AXIS_TRIGGER_LEFT, 1.0), _joyb(JOY_BUTTON_LEFT_SHOULDER)], 0.4)
	_act("focus_prev", [_key(KEY_A), _key(KEY_LEFT), _joyb(JOY_BUTTON_DPAD_LEFT)])
	_act("focus_next", [_key(KEY_D), _key(KEY_RIGHT), _joyb(JOY_BUTTON_DPAD_RIGHT), _joyb(JOY_BUTTON_RIGHT_SHOULDER)])
	_act("pause", [_key(KEY_ESCAPE), _key(KEY_P), _joyb(JOY_BUTTON_START)])
	# controller-friendly menus
	_act("ui_left", [_joya(JOY_AXIS_LEFT_X, -1.0)], 0.5)
	_act("ui_right", [_joya(JOY_AXIS_LEFT_X, 1.0)], 0.5)
	_act("ui_up", [_joya(JOY_AXIS_LEFT_Y, -1.0)], 0.5)
	_act("ui_down", [_joya(JOY_AXIS_LEFT_Y, 1.0)], 0.5)


func prompt(action: String) -> String:
	var pad := {
		"jump": "A", "tongue": "X", "interact": "Y", "croak": "B", "focus": "LT", "focus_next": "RB",
		"pause": "Start", "zoom_in": "D-pad", "move": "L-stick", "camera": "R-stick",
	}
	var kb := {
		"jump": "Space", "tongue": "F / LMB", "interact": "E", "croak": "C", "focus": "Tab / RMB", "focus_next": "A/D",
		"pause": "Esc", "zoom_in": "Wheel", "move": "WASD", "camera": "Mouse",
	}
	return str((pad if using_pad else kb).get(action, action))


# ---------------------------------------------------------------- audio
func _setup_audio_buses() -> void:
	for b in ["Music", "Ambience", "SFX"]:
		if AudioServer.get_bus_index(b) == -1:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, b)
			AudioServer.set_bus_send(i, "Master")
	# Soft dreamy space on SFX + ambience; a gentle low-pass + limiter on Master so nothing is ever harsh.
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.6
	rev.damping = 0.7
	rev.wet = 0.12
	rev.dry = 1.0
	AudioServer.add_bus_effect(AudioServer.get_bus_index("SFX"), rev)
	var lp := AudioEffectLowPassFilter.new()
	lp.cutoff_hz = 7500.0
	AudioServer.add_bus_effect(0, lp)
	var lim := AudioEffectLimiter.new()
	lim.ceiling_db = -1.5
	lim.threshold_db = -6.0
	AudioServer.add_bus_effect(0, lim)


func _set_vol(bus: String, v: float) -> void:
	var i := AudioServer.get_bus_index(bus)
	if i >= 0:
		AudioServer.set_bus_volume_db(i, linear_to_db(maxf(v, 0.0001)))
		AudioServer.set_bus_mute(i, v <= 0.001)


# ---------------------------------------------------------------- settings
func apply_preset(name: String) -> void:
	if PRESETS.has(name):
		var p: Dictionary = PRESETS[name]
		for k in p:
			settings[k] = p[k]
	settings["quality"] = name
	apply_settings()


func set_setting(key: String, value: Variant) -> void:
	settings[key] = value
	if key in ["shadows", "ssao", "ssil", "sdfgi", "volumetric_fog", "glow", "antialiasing", "foliage_density", "render_scale", "dof"]:
		settings["quality"] = "custom"
	apply_settings()


func apply_settings() -> void:
	var s := settings
	var vp := get_viewport()
	# anti-aliasing
	vp.msaa_3d = Viewport.MSAA_DISABLED
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	vp.use_taa = false
	match str(s.antialiasing):
		"fxaa":
			vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
		"msaa2":
			vp.msaa_3d = Viewport.MSAA_2X
		"msaa4":
			vp.msaa_3d = Viewport.MSAA_4X
		"taa":
			vp.use_taa = true
		"taa_msaa":
			vp.use_taa = true
			vp.msaa_3d = Viewport.MSAA_4X
	vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2 if s.upscaler == "fsr2" else (Viewport.SCALING_3D_MODE_FSR if s.upscaler == "fsr1" else Viewport.SCALING_3D_MODE_BILINEAR)
	vp.scaling_3d_scale = float(s.render_scale)
	vp.mesh_lod_threshold = 0.5 if int(s.shadows) >= 3 else 1.0
	# shadows
	var sh := int(s.shadows)
	var sizes := [1024, 2048, 4096, 8192]
	RenderingServer.directional_shadow_atlas_set_size(sizes[clampi(sh, 0, 3)], true)
	var q := [RenderingServer.SHADOW_QUALITY_HARD, RenderingServer.SHADOW_QUALITY_SOFT_LOW, RenderingServer.SHADOW_QUALITY_SOFT_HIGH, RenderingServer.SHADOW_QUALITY_SOFT_ULTRA]
	RenderingServer.directional_soft_shadow_filter_set_quality(q[clampi(sh, 0, 3)])
	RenderingServer.positional_soft_shadow_filter_set_quality(q[clampi(sh, 0, 3)])
	if sun:
		sun.shadow_enabled = sh > 0
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS if sh >= 2 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
		sun.light_angular_distance = 1.2 if sh >= 2 else 0.0
	if env:
		env.ssao_enabled = bool(s.ssao)
		env.ssil_enabled = bool(s.ssil)
		env.sdfgi_enabled = bool(s.sdfgi)
		env.volumetric_fog_enabled = bool(s.volumetric_fog)
		env.glow_enabled = bool(s.glow)
	RenderingServer.environment_set_ssao_quality(RenderingServer.ENV_SSAO_QUALITY_ULTRA if sh >= 3 else RenderingServer.ENV_SSAO_QUALITY_MEDIUM, true, 0.5, 2, 50, 300)
	# window / frame pacing
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED if s.vsync else DisplayServer.VSYNC_DISABLED)
	Engine.max_fps = int(s.max_fps)
	if DisplayServer.get_name() != "headless":
		match str(s.window_mode):
			"windowed":
				if DisplayServer.window_get_mode() != DisplayServer.WINDOW_MODE_WINDOWED:
					DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_WINDOWED)
			"borderless":
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_FULLSCREEN)
			"fullscreen":
				DisplayServer.window_set_mode(DisplayServer.WINDOW_MODE_EXCLUSIVE_FULLSCREEN)
	# audio
	_set_vol("Master", float(s.vol_master))
	_set_vol("Music", float(s.vol_music))
	_set_vol("Ambience", float(s.vol_ambience))
	_set_vol("SFX", float(s.vol_sfx))
	settings_changed.emit()


func save_settings() -> void:
	var cf := ConfigFile.new()
	for k in settings:
		cf.set_value("settings", k, settings[k])
	cf.save(SETTINGS_PATH)


func load_settings() -> void:
	var cf := ConfigFile.new()
	if cf.load(SETTINGS_PATH) != OK:
		return
	for k in settings.keys():
		if cf.has_section_key("settings", k):
			settings[k] = cf.get_value("settings", k)


# ---------------------------------------------------------------- save data
func save_game() -> void:
	var cf := ConfigFile.new()
	for k in data:
		cf.set_value("save", k, data[k])
	cf.save(SAVE_PATH)


func load_save() -> void:
	var cf := ConfigFile.new()
	if cf.load(SAVE_PATH) != OK:
		return
	for k in data.keys():
		if cf.has_section_key("save", k):
			data[k] = cf.get_value("save", k)


func has_frog(i: int) -> bool:
	return i in data.frogs


func unlock_next_frogs(n: int) -> Array:
	var got: Array = []
	for i in FrogSpecies.count():
		if got.size() >= n:
			break
		if not has_frog(i):
			data.frogs.append(i)
			got.append(i)
	return got


func reset_save() -> void:
	data = {"levels_unlocked": 1, "frogs": [0, 1, 2], "selected_frog": 0, "snacks_total": 0, "collected": {}, "completed": []}
	save_game()
