class_name GameUI
extends CanvasLayer
## All UI built in code: minimal, airy, white-on-fog. Fully navigable by controller.

var main: Node
var theme_res: Theme
var root: Control
var hud: Control
var snack_label: Label
var level_label: Label
var progress_ring: Control
var prompt_label: Label
var toast_label: Label
var focus_panel: PanelContainer
var focus_title: Label
var focus_body: Label
var focus_hint: Label
var card: VBoxContainer
var card_title: Label
var card_sub: Label
var fade_rect: ColorRect
var menu_layer: Control
var _toast_tw: Tween
var _progress := 0.0
var _menu_stack: Array[String] = []
var _book_preview_vp: SubViewport
var _book_preview_frog: Node3D
var _book_info: Label
var _book_sel := 0

const WHITE := Color(1, 1, 1, 0.95)
const SOFT := Color(1, 1, 1, 0.7)


func _ready() -> void:
	layer = 10
	process_mode = Node.PROCESS_MODE_ALWAYS
	_build_theme()
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.theme = theme_res
	add_child(root)
	_build_hud()
	menu_layer = Control.new()
	menu_layer.set_anchors_preset(Control.PRESET_FULL_RECT)
	menu_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(menu_layer)
	fade_rect = ColorRect.new()
	fade_rect.color = Color(0.95, 0.96, 0.95, 0.0)
	fade_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	fade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(fade_rect)
	Game.device_changed.connect(func(_p: bool) -> void: _refresh_hints())


# ================================================================ theme
func _sb(bg: Color, border: Color = Color(0, 0, 0, 0), bw: int = 0, radius: int = 22) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.border_color = border
	s.set_border_width_all(bw)
	s.set_corner_radius_all(radius)
	s.content_margin_left = 22
	s.content_margin_right = 22
	s.content_margin_top = 10
	s.content_margin_bottom = 10
	s.anti_aliasing = true
	return s


func _build_theme() -> void:
	theme_res = Theme.new()
	theme_res.default_font_size = 24
	var shadow := Color(0.15, 0.2, 0.22, 0.35)
	for t in ["Label", "Button", "CheckButton", "OptionButton"]:
		theme_res.set_color("font_color", t, WHITE)
		theme_res.set_color("font_shadow_color", t, shadow)
		theme_res.set_constant("shadow_offset_x", t, 0)
		theme_res.set_constant("shadow_offset_y", t, 2)
		theme_res.set_constant("shadow_outline_size", t, 6)
	for t in ["Button", "OptionButton", "CheckButton"]:
		theme_res.set_stylebox("normal", t, _sb(Color(1, 1, 1, 0.10)))
		theme_res.set_stylebox("hover", t, _sb(Color(1, 1, 1, 0.22)))
		theme_res.set_stylebox("pressed", t, _sb(Color(1, 1, 1, 0.32)))
		theme_res.set_stylebox("focus", t, _sb(Color(1, 1, 1, 0.0), Color(1, 1, 1, 0.95), 3))
		theme_res.set_stylebox("disabled", t, _sb(Color(1, 1, 1, 0.04)))
		theme_res.set_color("font_hover_color", t, Color.WHITE)
		theme_res.set_color("font_focus_color", t, Color.WHITE)
		theme_res.set_color("font_pressed_color", t, Color.WHITE)
		theme_res.set_color("font_disabled_color", t, Color(1, 1, 1, 0.35))
	theme_res.set_stylebox("panel", "PanelContainer", _sb(Color(0.25, 0.32, 0.34, 0.28), Color(1, 1, 1, 0.25), 1, 28))
	theme_res.set_stylebox("panel", "Panel", _sb(Color(0.25, 0.32, 0.34, 0.28), Color(1, 1, 1, 0.25), 1, 28))
	theme_res.set_stylebox("slider", "HSlider", _sb(Color(1, 1, 1, 0.25), Color(0, 0, 0, 0), 0, 4))
	theme_res.set_stylebox("grabber_area", "HSlider", _sb(Color(1, 1, 1, 0.8), Color(0, 0, 0, 0), 0, 4))
	theme_res.set_stylebox("grabber_area_highlight", "HSlider", _sb(Color(1, 1, 1, 1), Color(0, 0, 0, 0), 0, 4))
	theme_res.set_stylebox("focus", "HSlider", _sb(Color(0, 0, 0, 0), Color(1, 1, 1, 0.9), 2, 8))
	theme_res.set_stylebox("panel", "TabContainer", _sb(Color(0, 0, 0, 0)))
	theme_res.set_stylebox("tab_selected", "TabContainer", _sb(Color(1, 1, 1, 0.25)))
	theme_res.set_stylebox("tab_unselected", "TabContainer", _sb(Color(1, 1, 1, 0.06)))
	theme_res.set_stylebox("tab_hovered", "TabContainer", _sb(Color(1, 1, 1, 0.15)))
	theme_res.set_stylebox("tab_focus", "TabContainer", _sb(Color(0, 0, 0, 0), Color(1, 1, 1, 0.9), 2))
	theme_res.set_color("font_selected_color", "TabContainer", Color.WHITE)
	theme_res.set_color("font_unselected_color", "TabContainer", SOFT)
	theme_res.set_font_size("font_size", "TabContainer", 22)
	var sc := StyleBoxFlat.new()
	sc.bg_color = Color(1, 1, 1, 0.08)
	sc.set_corner_radius_all(6)
	theme_res.set_stylebox("scroll", "VScrollBar", sc)
	var gr := StyleBoxFlat.new()
	gr.bg_color = Color(1, 1, 1, 0.5)
	gr.set_corner_radius_all(6)
	theme_res.set_stylebox("grabber", "VScrollBar", gr)
	theme_res.set_stylebox("grabber_highlight", "VScrollBar", gr)


func _place(c: Control, preset: Control.LayoutPreset, off: Vector2) -> void:
	c.set_anchors_preset(preset)
	c.offset_left = off.x
	c.offset_top = off.y
	c.offset_right = off.x
	c.offset_bottom = off.y


func _label(text: String, size: int = 24, color: Color = WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


# ================================================================ HUD
func _build_hud() -> void:
	hud = Control.new()
	hud.set_anchors_preset(Control.PRESET_FULL_RECT)
	hud.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(hud)
	level_label = _label("", 20, SOFT)
	level_label.position = Vector2(40, 30)
	hud.add_child(level_label)
	var bl := HBoxContainer.new()
	_place(bl, Control.PRESET_BOTTOM_LEFT, Vector2(40, -90))
	bl.add_theme_constant_override("separation", 14)
	hud.add_child(bl)
	var icon := _SnackIcon.new()
	icon.custom_minimum_size = Vector2(44, 44)
	bl.add_child(icon)
	snack_label = _label("0 / 0", 26)
	bl.add_child(snack_label)
	progress_ring = _Ring.new()
	progress_ring.custom_minimum_size = Vector2(70, 70)
	_place(progress_ring, Control.PRESET_BOTTOM_RIGHT, Vector2(-110, -110))
	hud.add_child(progress_ring)
	prompt_label = _label("", 24)
	_place(prompt_label, Control.PRESET_CENTER_BOTTOM, Vector2(-300, -120))
	prompt_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_label.custom_minimum_size = Vector2(600, 40)
	hud.add_child(prompt_label)
	toast_label = _label("", 26)
	_place(toast_label, Control.PRESET_CENTER_TOP, Vector2(-450, 70))
	toast_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	toast_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	toast_label.custom_minimum_size = Vector2(900, 80)
	toast_label.modulate.a = 0.0
	hud.add_child(toast_label)
	focus_panel = PanelContainer.new()
	_place(focus_panel, Control.PRESET_CENTER_RIGHT, Vector2(-520, -120))
	focus_panel.custom_minimum_size = Vector2(460, 0)
	focus_panel.visible = false
	hud.add_child(focus_panel)
	var fv := VBoxContainer.new()
	fv.add_theme_constant_override("separation", 10)
	focus_panel.add_child(fv)
	focus_title = _label("", 32)
	fv.add_child(focus_title)
	focus_body = _label("", 22, SOFT)
	focus_body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	focus_body.custom_minimum_size = Vector2(420, 0)
	fv.add_child(focus_body)
	focus_hint = _label("", 20, SOFT)
	focus_hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	focus_hint.custom_minimum_size = Vector2(420, 0)
	fv.add_child(focus_hint)
	card = VBoxContainer.new()
	_place(card, Control.PRESET_CENTER, Vector2(-500, -140))
	card.custom_minimum_size = Vector2(1000, 200)
	card.alignment = BoxContainer.ALIGNMENT_CENTER
	card.modulate.a = 0.0
	card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	hud.add_child(card)
	card_title = _label("", 72)
	card_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(card_title)
	card_sub = _label("", 26, SOFT)
	card_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	card.add_child(card_sub)


func set_hud_visible(v: bool) -> void:
	hud.visible = v


func set_level_name(n: String) -> void:
	level_label.text = n


func set_snacks(c: int, t: int) -> void:
	snack_label.text = "%d / %d" % [c, t]
	var tw := create_tween()
	snack_label.scale = Vector2(1.25, 1.25)
	tw.tween_property(snack_label, "scale", Vector2.ONE, 0.25)


func set_progress(p: float) -> void:
	_progress = lerpf(_progress, p, 0.1)
	(progress_ring as _Ring).value = _progress


func set_prompt(t: String) -> void:
	prompt_label.text = t


func toast(t: String) -> void:
	toast_label.text = t
	if _toast_tw and _toast_tw.is_running():
		_toast_tw.kill()
	_toast_tw = create_tween()
	_toast_tw.tween_property(toast_label, "modulate:a", 1.0, 0.3)
	_toast_tw.tween_interval(3.2)
	_toast_tw.tween_property(toast_label, "modulate:a", 0.0, 0.8)


func show_level_card(title: String, sub: String) -> void:
	card_title.text = title
	card_sub.text = sub
	var tw := create_tween()
	tw.tween_property(card, "modulate:a", 1.0, 1.2)
	tw.tween_interval(2.4)
	tw.tween_property(card, "modulate:a", 0.0, 1.4)


func show_focus(title: String, body: String, prompt: String, count: int) -> void:
	focus_panel.visible = true
	focus_title.text = title
	focus_body.text = body
	var hint := ""
	if prompt != "":
		hint += "[%s]  %s\n" % [Game.prompt("interact"), prompt]
	if count > 1:
		hint += "[%s]  next   " % Game.prompt("focus_next")
	hint += "[%s]  back" % Game.prompt("focus")
	focus_hint.text = hint


func hide_focus() -> void:
	focus_panel.visible = false


func fade(t: float) -> void:
	var tw := create_tween()
	tw.tween_property(fade_rect, "color:a", 1.0, t)
	tw.tween_property(fade_rect, "color:a", 0.0, t * 1.4)


func _refresh_hints() -> void:
	pass


# ================================================================ menus
func _clear_menu() -> void:
	for c in menu_layer.get_children():
		c.queue_free()


func _panel(width: int = 620) -> VBoxContainer:
	var pc := PanelContainer.new()
	_place(pc, Control.PRESET_CENTER_LEFT, Vector2(80, -320))
	pc.custom_minimum_size = Vector2(width, 0)
	menu_layer.add_child(pc)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	pc.add_child(v)
	return v


func _button(parent: Control, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.custom_minimum_size = Vector2(0, 54)
	b.pressed.connect(func() -> void:
		Sfx.play("ui_select", -2.0)
		cb.call())
	b.focus_entered.connect(func() -> void: Sfx.play("ui_move", -6.0, 1.0, 0.03))
	parent.add_child(b)
	return b


func _focus_first(c: Control) -> void:
	await get_tree().process_frame
	if not is_instance_valid(c):
		return
	for n in c.find_children("*", "Control", true, false):
		var cn := n as Control
		if cn.focus_mode == Control.FOCUS_ALL and cn.is_visible_in_tree():
			cn.grab_focus()
			return


func close_menus() -> void:
	_clear_menu()
	_menu_stack.clear()


func back() -> void:
	if _menu_stack.size() <= 1:
		return
	_menu_stack.pop_back()
	var prev: String = _menu_stack.pop_back()
	match prev:
		"title":
			show_title()
		"pause":
			show_pause()
		_:
			show_title()


func in_menu() -> bool:
	return not _menu_stack.is_empty()


func _unhandled_input(event: InputEvent) -> void:
	if in_menu() and event.is_action_pressed("ui_cancel") and _menu_stack.size() > 1:
		back()
		get_viewport().set_input_as_handled()
	elif in_menu() and _menu_stack.size() == 1 and _menu_stack[0] == "pause" and event.is_action_pressed("ui_cancel"):
		main.resume()
		get_viewport().set_input_as_handled()


func show_title() -> void:
	_clear_menu()
	_menu_stack = ["title"]
	set_hud_visible(false)
	var title := _label("Frogs in the Sky", 96)
	_place(title, Control.PRESET_TOP_LEFT, Vector2(90, 90))
	menu_layer.add_child(title)
	var sub := _label("a chill climb through the overgrown ruins above the clouds", 26, SOFT)
	sub.position = Vector2(96, 210)
	menu_layer.add_child(sub)
	var v := VBoxContainer.new()
	_place(v, Control.PRESET_BOTTOM_LEFT, Vector2(90, -420))
	v.custom_minimum_size = Vector2(420, 0)
	v.add_theme_constant_override("separation", 10)
	menu_layer.add_child(v)
	var cont := int(Game.data.levels_unlocked) > 1
	_button(v, "Continue" if cont else "Play", func() -> void: main.start_level(mini(int(Game.data.levels_unlocked), Levels.DEFS.size()) - 1))
	_button(v, "Levels", show_levels)
	_button(v, "Frog Book", show_book)
	_button(v, "Settings", show_settings)
	_button(v, "Quit", func() -> void: get_tree().quit())
	var ver := _label("v0.1  ·  %d / %d frogs found" % [Game.data.frogs.size(), FrogSpecies.count()], 18, SOFT)
	_place(ver, Control.PRESET_BOTTOM_RIGHT, Vector2(-380, -60))
	menu_layer.add_child(ver)
	_focus_first(v)


func show_pause() -> void:
	_clear_menu()
	_menu_stack = ["pause"]
	var v := _panel(460)
	v.add_child(_label("Paused", 44))
	_button(v, "Resume", func() -> void: main.resume())
	_button(v, "Frog Book", show_book)
	_button(v, "Settings", show_settings)
	_button(v, "Restart Level", func() -> void: main.restart_level())
	_button(v, "Quit to Title", func() -> void: main.quit_to_title())
	_focus_first(v)


func show_levels() -> void:
	_clear_menu()
	_menu_stack.append("levels")
	var v := _panel(640)
	v.add_child(_label("Levels", 44))
	for i in Levels.DEFS.size():
		var d: Dictionary = Levels.DEFS[i]
		var unlocked := i < int(Game.data.levels_unlocked)
		var got: Array = Game.data.collected.get(d.id, [])
		var done: bool = d.id in Game.data.completed
		var txt := "%d.  %s" % [i + 1, d.name] if unlocked else "%d.  ???" % (i + 1)
		if unlocked:
			txt += "    %s%d snacks" % ["✓ " if done else "", got.size()]
		var idx := i
		var b := _button(v, txt, func() -> void: main.start_level(idx))
		b.disabled = not unlocked
	v.add_child(_label("More sky ruins coming soon.", 20, SOFT))
	_button(v, "Back", back)
	_focus_first(v)


func show_book() -> void:
	_clear_menu()
	_menu_stack.append("book")
	var pc := PanelContainer.new()
	pc.set_anchors_preset(Control.PRESET_FULL_RECT)
	pc.offset_left = 60
	pc.offset_right = -60
	pc.offset_top = 60
	pc.offset_bottom = -60
	menu_layer.add_child(pc)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 30)
	pc.add_child(h)
	var left := VBoxContainer.new()
	left.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(left)
	left.add_child(_label("Frog Book  ·  %d / %d" % [Game.data.frogs.size(), FrogSpecies.count()], 40))
	left.add_child(_label("Frogs from around the world. Collect snacks and reach crystal ponds to find more.", 20, SOFT))
	var sc := ScrollContainer.new()
	sc.size_flags_vertical = Control.SIZE_EXPAND_FILL
	left.add_child(sc)
	var grid := GridContainer.new()
	grid.columns = 10
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	sc.add_child(grid)
	for i in FrogSpecies.count():
		var sp := FrogSpecies.get_species(i)
		var have := Game.has_frog(i)
		var b := Button.new()
		b.custom_minimum_size = Vector2(66, 66)
		b.text = str(i + 1)
		b.add_theme_font_size_override("font_size", 16)
		var base: Color = sp.base if have else Color(0.3, 0.33, 0.35, 0.5)
		b.add_theme_stylebox_override("normal", _sb(base, Color(1, 1, 1, 0.3) if i == int(Game.data.selected_frog) else Color(0, 0, 0, 0), 3, 33))
		b.add_theme_stylebox_override("hover", _sb(base.lightened(0.15), Color(1, 1, 1, 0.6), 2, 33))
		b.add_theme_stylebox_override("focus", _sb(Color(0, 0, 0, 0), Color.WHITE, 4, 33))
		var idx := i
		b.focus_entered.connect(func() -> void: _book_select(idx))
		b.mouse_entered.connect(func() -> void: _book_select(idx))
		b.pressed.connect(func() -> void:
			if Game.has_frog(idx):
				Game.data.selected_frog = idx
				Game.save_game()
				Sfx.play("croak2", -4.0)
				if main.player:
					main.player.set_species(FrogSpecies.get_species(idx))
				show_book_refresh())
		grid.add_child(b)
	var right := VBoxContainer.new()
	right.custom_minimum_size = Vector2(520, 0)
	h.add_child(right)
	var svc := SubViewportContainer.new()
	svc.custom_minimum_size = Vector2(520, 420)
	svc.stretch = true
	right.add_child(svc)
	_book_preview_vp = SubViewport.new()
	_book_preview_vp.own_world_3d = true
	_book_preview_vp.transparent_bg = true
	_book_preview_vp.msaa_3d = Viewport.MSAA_4X
	svc.add_child(_book_preview_vp)
	var cam := Camera3D.new()
	cam.position = Vector3(0, 0.55, 1.5)
	cam.rotation_degrees = Vector3(-14, 0, 0)
	cam.fov = 40
	_book_preview_vp.add_child(cam)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-40, 30, 0)
	_book_preview_vp.add_child(light)
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_CLEAR_COLOR
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.85, 0.9, 0.9)
	e.ambient_light_energy = 0.6
	we.environment = e
	_book_preview_vp.add_child(we)
	_book_info = _label("", 24)
	_book_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	right.add_child(_book_info)
	_button(right, "Back", back)
	_book_select(int(Game.data.selected_frog))
	await get_tree().process_frame
	if is_instance_valid(grid) and grid.get_child_count() > 0:
		(grid.get_child(int(Game.data.selected_frog)) as Control).grab_focus()


func show_book_refresh() -> void:
	_menu_stack.pop_back()
	show_book()


func _book_select(i: int) -> void:
	_book_sel = i
	if _book_preview_vp == null or not is_instance_valid(_book_preview_vp):
		return
	if _book_preview_frog and is_instance_valid(_book_preview_frog):
		_book_preview_frog.queue_free()
	var sp := FrogSpecies.get_species(i)
	var have := Game.has_frog(i)
	if have:
		_book_preview_frog = FrogModel.create(sp, 1.6)
		_book_preview_vp.add_child(_book_preview_frog)
		var dir := "#%d  %s\n%s\n" % [i + 1, sp.name, sp.region]
		dir += "\n[%s] choose this frog" % ("A" if Game.using_pad else "Click")
		if i == int(Game.data.selected_frog):
			dir += "  ·  currently climbing"
		_book_info.text = dir
	else:
		_book_preview_frog = null
		_book_info.text = "#%d  ???\nNot found yet.\nHint: from %s" % [i + 1, sp.region]


func _process(delta: float) -> void:
	if _book_preview_frog and is_instance_valid(_book_preview_frog):
		_book_preview_frog.rotation.y += delta * 0.8


# ---------------------------------------------------------------- settings
func show_settings() -> void:
	_clear_menu()
	_menu_stack.append("settings")
	var pc := PanelContainer.new()
	pc.set_anchors_preset(Control.PRESET_FULL_RECT)
	pc.offset_left = 60
	pc.offset_right = -60
	pc.offset_top = 50
	pc.offset_bottom = -50
	menu_layer.add_child(pc)
	var v := VBoxContainer.new()
	pc.add_child(v)
	v.add_child(_label("Settings", 40))
	var tabs := TabContainer.new()
	tabs.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(tabs)
	var s := Game.settings

	var g := _tab(tabs, "Graphics")
	_opt(g, "Quality preset", "quality", [["Low", "low"], ["Medium", "medium"], ["High", "high"], ["Ultra", "ultra"], ["Custom", "custom"]])
	_opt(g, "Window mode", "window_mode", [["Windowed", "windowed"], ["Borderless fullscreen", "borderless"], ["Exclusive fullscreen", "fullscreen"]])
	_check(g, "V-Sync", "vsync")
	_opt(g, "Frame rate limit", "max_fps", [["Unlimited", 0], ["30", 30], ["60", 60], ["120", 120], ["144", 144], ["240", 240]])
	_slider(g, "Render scale", "render_scale", 0.5, 1.0, 0.05)
	_opt(g, "Upscaler", "upscaler", [["Bilinear", "bilinear"], ["AMD FSR 1.0", "fsr1"], ["AMD FSR 2.2", "fsr2"]])
	_opt(g, "Anti-aliasing", "antialiasing", [["Off", "off"], ["FXAA", "fxaa"], ["MSAA 2x", "msaa2"], ["MSAA 4x", "msaa4"], ["TAA", "taa"], ["TAA + MSAA 4x", "taa_msaa"]])
	_opt(g, "Shadows", "shadows", [["Off", 0], ["Low", 1], ["High", 2], ["Ultra (soft, 8K)", 3]])
	_check(g, "Ambient occlusion (SSAO)", "ssao")
	_check(g, "Indirect light (SSIL)", "ssil")
	_check(g, "Global illumination (SDFGI)", "sdfgi")
	_check(g, "Volumetric fog + light shafts", "volumetric_fog")
	_check(g, "Bloom", "glow")
	_opt(g, "Depth of field", "dof", [["Off", "off"], ["Subtle", "subtle"], ["Cinematic", "cinematic"]])
	_slider(g, "Depth of field strength", "dof_strength", 0.2, 2.0, 0.05)
	_check(g, "Tilt-shift diorama blur", "tilt_shift")
	_slider(g, "Foliage density (next level load)", "foliage_density", 0.2, 1.0, 0.05)

	var c := _tab(tabs, "Camera")
	_slider(c, "Field of view", "fov", 35.0, 80.0, 1.0)
	_slider(c, "Look sensitivity", "cam_sensitivity", 0.2, 3.0, 0.05)
	_check(c, "Invert X", "invert_x")
	_check(c, "Invert Y", "invert_y")
	_check(c, "Auto-follow camera", "auto_camera")
	_check(c, "Camera shake", "camera_shake")

	var a := _tab(tabs, "Audio")
	_slider(a, "Master", "vol_master", 0.0, 1.0, 0.01)
	_slider(a, "Music", "vol_music", 0.0, 1.0, 0.01)
	_slider(a, "Ambience (wind, birds, crows)", "vol_ambience", 0.0, 1.0, 0.01)
	_slider(a, "Effects", "vol_sfx", 0.0, 1.0, 0.01)

	var k := _tab(tabs, "Controls")
	var rows := [
		["Move", "WASD / Arrows", "Left stick"], ["Camera", "Mouse", "Right stick"], ["Zoom", "Mouse wheel", "D-pad up/down"],
		["Hop (hold = higher)", "Space", "A"], ["Tongue (grab snacks & seeds)", "F / Left click", "X"],
		["Interact", "E", "Y"], ["Croak", "C", "B"], ["Focus mode", "Tab / Q / Right click", "LT / LB"],
		["Focus: next / previous", "D / A", "RB / D-pad"], ["Pause", "Esc", "Start"],
	]
	for r in rows:
		var hb := HBoxContainer.new()
		var l1 := _label(r[0], 22)
		l1.custom_minimum_size = Vector2(420, 0)
		hb.add_child(l1)
		var l2 := _label(r[1], 22, SOFT)
		l2.custom_minimum_size = Vector2(330, 0)
		hb.add_child(l2)
		hb.add_child(_label(r[2], 22, SOFT))
		k.add_child(hb)
	k.add_child(_label("\nClimb vines by walking into them. Sticky toes do the rest.", 20, SOFT))
	var reset := _button(k, "Reset all progress", func() -> void:
		Game.reset_save()
		toast("Progress reset."))
	reset.custom_minimum_size = Vector2(360, 50)

	var hb2 := HBoxContainer.new()
	v.add_child(hb2)
	_button(hb2, "Back", func() -> void:
		Game.save_settings()
		back())
	_focus_first(tabs)


func _tab(tabs: TabContainer, name: String) -> VBoxContainer:
	var sc := ScrollContainer.new()
	sc.name = name
	sc.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	tabs.add_child(sc)
	var v := VBoxContainer.new()
	v.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	v.add_theme_constant_override("separation", 8)
	sc.add_child(v)
	return v


func _row(parent: Control, label: String) -> HBoxContainer:
	var hb := HBoxContainer.new()
	hb.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var l := _label(label, 22)
	l.custom_minimum_size = Vector2(520, 0)
	hb.add_child(l)
	parent.add_child(hb)
	return hb


func _opt(parent: Control, label: String, key: String, options: Array) -> void:
	var hb := _row(parent, label)
	var ob := OptionButton.new()
	ob.custom_minimum_size = Vector2(380, 48)
	var cur: Variant = Game.settings.get(key)
	for i in options.size():
		ob.add_item(str(options[i][0]), i)
		if str(options[i][1]) == str(cur):
			ob.select(i)
	ob.item_selected.connect(func(i: int) -> void:
		var val: Variant = options[i][1]
		Sfx.play("ui_select", -6.0)
		if key == "quality":
			if val != "custom":
				Game.apply_preset(val)
				show_settings_refresh()
		else:
			Game.set_setting(key, val))
	hb.add_child(ob)


func _check(parent: Control, label: String, key: String) -> void:
	var hb := _row(parent, label)
	var cb := CheckButton.new()
	cb.button_pressed = bool(Game.settings.get(key))
	cb.toggled.connect(func(on: bool) -> void:
		Sfx.play("click", -8.0)
		Game.set_setting(key, on))
	hb.add_child(cb)


func _slider(parent: Control, label: String, key: String, mn: float, mx: float, step: float) -> void:
	var hb := _row(parent, label)
	var sl := HSlider.new()
	sl.min_value = mn
	sl.max_value = mx
	sl.step = step
	sl.value = float(Game.settings.get(key))
	sl.custom_minimum_size = Vector2(320, 40)
	sl.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	var val := _label("%.2f" % sl.value, 20, SOFT)
	val.custom_minimum_size = Vector2(70, 0)
	sl.value_changed.connect(func(v: float) -> void:
		val.text = "%.2f" % v
		Game.set_setting(key, v))
	hb.add_child(sl)
	hb.add_child(val)


func show_settings_refresh() -> void:
	_menu_stack.pop_back()
	show_settings()


# ---------------------------------------------------------------- level complete
func show_complete(level_name: String, snacks: int, total: int, new_frogs: Array, has_next: bool) -> void:
	_clear_menu()
	_menu_stack = ["complete"]
	var v := _panel(640)
	v.add_child(_label("Crystal Pond reached!", 44))
	v.add_child(_label(level_name, 24, SOFT))
	v.add_child(_label("Snacks  %d / %d" % [snacks, total], 26))
	if not new_frogs.is_empty():
		var names: Array = []
		for i in new_frogs:
			names.append(FrogSpecies.get_species(i).name)
		var nl := _label("New frogs: " + ", ".join(names), 22, SOFT)
		nl.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		nl.custom_minimum_size = Vector2(580, 0)
		v.add_child(nl)
	if has_next:
		_button(v, "Next level", func() -> void: main.next_level())
	_button(v, "Replay", func() -> void: main.restart_level())
	_button(v, "Frog Book", show_book)
	_button(v, "Title", func() -> void: main.quit_to_title())
	_focus_first(v)


# ================================================================ little drawn widgets
class _Ring extends Control:
	var value := 0.0:
		set(v):
			value = v
			queue_redraw()

	func _draw() -> void:
		var c := size * 0.5
		var r := minf(size.x, size.y) * 0.5 - 4
		draw_arc(c, r, 0, TAU, 64, Color(1, 1, 1, 0.2), 3.0, true)
		draw_arc(c, r, -PI / 2, -PI / 2 + TAU * value, 64, Color(1, 1, 1, 0.9), 4.0, true)
		var f := ThemeDB.fallback_font
		var t := "%d%%" % roundi(value * 100)
		var ts := f.get_string_size(t, HORIZONTAL_ALIGNMENT_CENTER, -1, 18)
		draw_string(f, c - Vector2(ts.x * 0.5, -6), t, HORIZONTAL_ALIGNMENT_CENTER, -1, 18, Color(1, 1, 1, 0.9))


class _SnackIcon extends Control:
	func _draw() -> void:
		var c := size * 0.5
		draw_arc(c, size.x * 0.5 - 2, 0, TAU, 48, Color(1, 1, 1, 0.5), 2.0, true)
		draw_circle(c + Vector2(0, 3), 7, Color(1, 1, 1, 0.95))
		draw_circle(c + Vector2(-7, -5), 6, Color(1, 1, 1, 0.55))
		draw_circle(c + Vector2(7, -5), 6, Color(1, 1, 1, 0.55))
