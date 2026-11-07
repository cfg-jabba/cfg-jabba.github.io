class_name Props
extends RefCounted
## Interactive objects + small voxel models used by levels.
## "focusable" group members implement: focus_label(), focus_text(), focus_prompt(player), interact(player).


# ------------------------------------------------------------ small voxel models
static func make_bug(kind: int = 0) -> Node3D:
	var n := Node3D.new()
	var v := {}
	var vs := 0.05
	match kind:
		0: # fat fly
			Voxel.fill_box(v, Vector3i(-1, 0, -2), Vector3i(1, 2, 1), Color("2a2f3a"))
			v[Vector3i(-1, 2, 2)] = Color("c0302a")
			v[Vector3i(1, 2, 2)] = Color("c0302a")
			Voxel.fill_box(v, Vector3i(-1, 0, 2), Vector3i(1, 1, 2), Color("3a4250"))
		1: # cricket
			Voxel.fill_box(v, Vector3i(-1, 0, -3), Vector3i(1, 1, 2), Color("7a8a3a"))
			v[Vector3i(0, 2, 2)] = Color("5a6a2a")
			v[Vector3i(-2, 1, -2)] = Color("5a6a2a")
			v[Vector3i(2, 1, -2)] = Color("5a6a2a")
			v[Vector3i(-2, 2, -3)] = Color("5a6a2a")
			v[Vector3i(2, 2, -3)] = Color("5a6a2a")
		_: # glow beetle
			Voxel.fill_box(v, Vector3i(-1, 0, -2), Vector3i(1, 1, 1), Color("3a6ad0"))
			Voxel.fill_box(v, Vector3i(-1, 0, -2), Vector3i(1, 0, -1), Color("f2e070"))
	var body := Voxel.mesh_instance(v, vs, Vector3(-0.5, -1.0, -0.5) * vs)
	n.add_child(body)
	if kind == 0:
		for s in [-1, 1]:
			var w := MeshInstance3D.new()
			var q := QuadMesh.new()
			q.size = Vector2(0.14, 0.09)
			w.mesh = q
			var m := StandardMaterial3D.new()
			m.albedo_color = Color(0.9, 0.95, 1.0, 0.45)
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
			m.emission_enabled = true
			m.emission = Color(0.6, 0.7, 0.8)
			w.material_override = m
			w.rotation_degrees = Vector3(-90, 0, 0)
			w.position = Vector3(0.09 * s, 0.1, -0.02)
			w.name = "Wing%d" % (s + 1)
			n.add_child(w)
	var glow := OmniLight3D.new()
	glow.light_color = Color("fff2b0")
	glow.light_energy = 0.5
	glow.omni_range = 1.4
	glow.shadow_enabled = false
	n.add_child(glow)
	return n


static func make_seed_mesh() -> Node3D:
	var v := {}
	var vs := 0.055
	Voxel.fill_box(v, Vector3i(-1, 0, -1), Vector3i(1, 2, 1), Color("a8743a"))
	v[Vector3i(0, 3, 0)] = Color("8a5a2a")
	v[Vector3i(0, 4, 0)] = Color("7ac04a")
	v[Vector3i(1, 5, 0)] = Color("8ad05a")
	v[Vector3i(-1, 5, 0)] = Color("8ad05a")
	var mi := Voxel.mesh_instance(v, vs, Vector3(-0.5, 0, -0.5) * vs)
	var n := Node3D.new()
	n.add_child(mi)
	return n


static func make_crow_mesh() -> Node3D:
	var v := {}
	var vs := 0.05
	var blk := Color("22232a")
	var blk2 := Color("2e3038")
	Voxel.fill_box(v, Vector3i(-1, 2, -3), Vector3i(1, 4, 2), blk)       # body
	Voxel.fill_box(v, Vector3i(-1, 4, 2), Vector3i(1, 6, 4), blk2)       # head
	v[Vector3i(0, 5, 5)] = Color("3a3a40")                               # beak
	v[Vector3i(0, 5, 6)] = Color("3a3a40")
	v[Vector3i(-1, 5, 4)] = Color("e8e0c0")
	v[Vector3i(1, 5, 4)] = Color("e8e0c0")
	Voxel.fill_box(v, Vector3i(-1, 3, -6), Vector3i(1, 3, -4), blk2)     # tail
	v[Vector3i(-1, 0, 0)] = Color("4a4a50")
	v[Vector3i(1, 0, 0)] = Color("4a4a50")
	v[Vector3i(-1, 1, 0)] = Color("4a4a50")
	v[Vector3i(1, 1, 0)] = Color("4a4a50")
	var n := Node3D.new()
	n.add_child(Voxel.mesh_instance(v, vs, Vector3(-0.5, 0, -0.5) * vs))
	for s in [-1, 1]:
		var wv := {}
		Voxel.fill_box(wv, Vector3i(0, 0, -3), Vector3i(3, 0, 1), blk)
		var w := Voxel.mesh_instance(wv, vs, Vector3(0, 0, -0.5) * vs)
		var piv := Node3D.new()
		piv.name = "WingL" if s < 0 else "WingR"
		piv.position = Vector3(0.05 * s, 0.2, 0)
		piv.scale = Vector3(s, 1, 1)
		piv.add_child(w)
		n.add_child(piv)
	return n


# ------------------------------------------------------------ Snack (collectible)
class Snack extends Area3D:
	var level: Node
	var id := ""
	var kind := 0
	var model: Node3D
	var _t := 0.0
	var collected := false

	func _ready() -> void:
		add_to_group("tongue_target")
		collision_layer = 0
		collision_mask = 2
		var cs := CollisionShape3D.new()
		var sh := SphereShape3D.new()
		sh.radius = 0.42
		cs.shape = sh
		add_child(cs)
		model = Props.make_bug(kind)
		add_child(model)
		_t = randf() * 10.0
		body_entered.connect(_on_body)

	func _process(d: float) -> void:
		_t += d
		model.position = Vector3(sin(_t * 1.3) * 0.12, sin(_t * 2.2) * 0.1, cos(_t * 1.1) * 0.12)
		model.rotation.y = _t * 1.5
		var w1 := model.get_node_or_null("Wing0")
		var w2 := model.get_node_or_null("Wing2")
		if w1:
			(w1 as Node3D).rotation.z = sin(_t * 60.0) * 0.6
		if w2:
			(w2 as Node3D).rotation.z = -sin(_t * 60.0) * 0.6

	func _on_body(b: Node3D) -> void:
		if b is PlayerFrog:
			collect(b)

	func collect(_by: Node = null) -> void:
		if collected:
			return
		collected = true
		remove_from_group("tongue_target")
		Sfx.play_at("snack", global_position, -2.0)
		if level:
			level.on_snack(self)
		var tw := create_tween()
		tw.tween_property(self, "scale", Vector3.ONE * 0.01, 0.15)
		tw.tween_callback(queue_free)


# ------------------------------------------------------------ Seed pickup
class SeedPickup extends Area3D:
	var level: Node
	var model: Node3D
	var _t := 0.0
	var taken := false

	func _ready() -> void:
		add_to_group("tongue_target")
		add_to_group("focusable")
		collision_layer = 0
		collision_mask = 2
		var cs := CollisionShape3D.new()
		var sh := SphereShape3D.new()
		sh.radius = 0.45
		cs.shape = sh
		add_child(cs)
		model = Props.make_seed_mesh()
		model.scale = Vector3.ONE * 1.6
		add_child(model)
		var l := OmniLight3D.new()
		l.light_color = Color("d8ffb0")
		l.light_energy = 0.8
		l.omni_range = 2.0
		add_child(l)
		body_entered.connect(func(b: Node3D) -> void:
			if b is PlayerFrog:
				collect(b))

	func _process(d: float) -> void:
		_t += d
		model.position.y = sin(_t * 2.0) * 0.08
		model.rotation.y = _t

	func focus_label() -> String:
		return "Glowing Seed"

	func focus_text() -> String:
		return "Something wants to grow. Lick it up and plant it in soft soil."

	func focus_prompt(_p: Node) -> String:
		return ""

	func can_interact(_p: Node) -> bool:
		return false

	func interact(_p: Node) -> void:
		pass

	func collect(by: Node = null) -> void:
		if taken:
			return
		var p := by as PlayerFrog
		if p == null:
			return
		if p.carrying_seed:
			if level:
				level.toast("Your frog is already holding a seed.")
			return
		taken = true
		remove_from_group("tongue_target")
		remove_from_group("focusable")
		p.give_seed()
		Sfx.play_at("seed", global_position, -2.0)
		if level:
			level.toast("Got a seed! Find soft soil to plant it.")
		queue_free()


# ------------------------------------------------------------ Soil plot -> grows a climbable vine
class SoilPlot extends Node3D:
	var level: Node
	var grow_height := 6.0
	var wall_normal := Vector3(1, 0, 0)  # direction from the wall towards the player side
	var width := 1.4
	var planted := false
	var _marker: MeshInstance3D

	func _ready() -> void:
		add_to_group("focusable")
		var v := {}
		for x in range(-3, 4):
			for z in range(-3, 4):
				if absi(x) + absi(z) <= 4:
					v[Vector3i(x, 0, z)] = Color("5a3e26").lightened(Voxel.hash3(x, 0, z) * 0.12)
		var mi := Voxel.mesh_instance(v, 0.12, Vector3(-0.5, -0.5, -0.5) * 0.12)
		add_child(mi)
		_marker = MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.36
		tm.outer_radius = 0.42
		_marker.mesh = tm
		var m := StandardMaterial3D.new()
		m.albedo_color = Color(0.85, 1.0, 0.75, 0.6)
		m.emission_enabled = true
		m.emission = Color(0.6, 0.9, 0.5)
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_marker.material_override = m
		_marker.position.y = 0.08
		add_child(_marker)

	func _process(d: float) -> void:
		if _marker and not planted:
			var k := 1.0 + sin(Time.get_ticks_msec() * 0.004) * 0.08
			_marker.scale = Vector3(k, 1, k)

	func focus_label() -> String:
		return "Soft Soil" if not planted else "Climbing Vine"

	func focus_text() -> String:
		return "Damp, dark and full of worms. Perfect for a seed." if not planted else "Sticky toes can climb this."

	func can_interact(p: Node) -> bool:
		return not planted

	func focus_prompt(p: Node) -> String:
		if planted:
			return ""
		return "Plant seed" if (p as PlayerFrog).carrying_seed else "Needs a seed"

	func interact(p: Node) -> void:
		if planted:
			return
		var pf := p as PlayerFrog
		if not pf.take_seed():
			Sfx.play("click", -8.0, 0.7)
			if level:
				level.toast("Soft soil. A seed would grow here.")
			return
		planted = true
		_marker.queue_free()
		_marker = null
		Sfx.play_at("grow", global_position, 0.0)
		Sfx.play("solve", -6.0)
		if level:
			level.grow_vine(self)


# ------------------------------------------------------------ Crate (pushable, heavy)
class Crate extends RigidBody3D:
	var level: Node
	var _push_t := 0.0
	var _push_dir := Vector3.ZERO

	func _ready() -> void:
		add_to_group("weight")
		collision_layer = 4
		collision_mask = 1 | 2 | 4
		mass = 4.0
		lock_rotation = true
		linear_damp = 2.0
		var pm := PhysicsMaterial.new()
		pm.friction = 1.0
		physics_material_override = pm
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(0.96, 0.96, 0.96)
		cs.shape = sh
		add_child(cs)

	func push(dir: Vector3) -> void:
		# snap pushes to the dominant axis: Zelda-style block pushing
		if absf(dir.x) > absf(dir.z):
			_push_dir = Vector3(signf(dir.x), 0, 0)
		else:
			_push_dir = Vector3(0, 0, signf(dir.z))
		_push_t = 0.12

	func _physics_process(d: float) -> void:
		if _push_t > 0.0:
			_push_t -= d
			linear_velocity.x = _push_dir.x * 1.7
			linear_velocity.z = _push_dir.z * 1.7
			if randf() < d * 6.0:
				Sfx.play_at("stone", global_position, -18.0, 1.6)
		else:
			linear_velocity.x = move_toward(linear_velocity.x, 0, d * 12.0)
			linear_velocity.z = move_toward(linear_velocity.z, 0, d * 12.0)
		if level and global_position.y < level.kill_y and level.has_method("reset_crate"):
			level.reset_crate(self)


# ------------------------------------------------------------ Mechanism: tweened moving body
class Mover extends AnimatableBody3D:
	var level: Node
	var from_xf := Transform3D.IDENTITY
	var to_xf := Transform3D.IDENTITY
	var duration := 1.4
	var required := 1
	var latch := false            # stays open once opened
	var solve_sound := true
	var progress_cb: Callable
	var active := false
	var _inputs := {}
	var _tw: Tween
	var _k := 0.0
	var _solved_once := false

	func _ready() -> void:
		sync_to_physics = true
		transform = from_xf

	func set_input(src: Object, on: bool) -> void:
		_inputs[src.get_instance_id()] = on
		var n := 0
		for k in _inputs:
			if _inputs[k]:
				n += 1
		set_active(n >= required or (latch and active))

	func toggle() -> void:
		set_active(not active)

	func set_active(on: bool) -> void:
		if on == active:
			return
		active = on
		if _tw and _tw.is_running():
			_tw.kill()
		_tw = create_tween()
		var span := absf((1.0 if on else 0.0) - _k)
		_tw.tween_method(_apply, _k, 1.0 if on else 0.0, maxf(0.05, duration * span)).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
		Sfx.play_at("stone", global_position, -6.0, 0.9)
		if on and solve_sound and not _solved_once:
			_solved_once = true
			Sfx.play("solve", -4.0)

	func _apply(k: float) -> void:
		_k = k
		transform = from_xf.interpolate_with(to_xf, k)
		if progress_cb.is_valid():
			progress_cb.call(k)


# ------------------------------------------------------------ Pressure plate
class PressurePlate extends Area3D:
	var level: Node
	var targets: Array = []
	var pressed := false
	var _bodies := {}
	var _top: MeshInstance3D

	func _ready() -> void:
		add_to_group("focusable")
		collision_layer = 0
		collision_mask = 2 | 4
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = Vector3(1.1, 0.5, 1.1)
		cs.shape = sh
		cs.position.y = 0.25
		add_child(cs)
		var rim := MeshInstance3D.new()
		var rb := BoxMesh.new()
		rb.size = Vector3(1.3, 0.06, 1.3)
		rim.mesh = rb
		rim.material_override = level.mat("rust")
		rim.position.y = 0.03
		add_child(rim)
		_top = MeshInstance3D.new()
		var tb := BoxMesh.new()
		tb.size = Vector3(1.0, 0.12, 1.0)
		_top.mesh = tb
		var m := StandardMaterial3D.new()
		m.albedo_color = Color("d8c070")
		m.emission_enabled = true
		m.emission = Color("ffd870")
		m.emission_energy_multiplier = 0.25
		m.roughness = 0.5
		_top.material_override = m
		_top.position.y = 0.1
		add_child(_top)
		body_entered.connect(_on_enter)
		body_exited.connect(_on_exit)

	func _counts(b: Node) -> bool:
		return b is PlayerFrog or b.is_in_group("weight")

	func _on_enter(b: Node3D) -> void:
		if _counts(b):
			_bodies[b.get_instance_id()] = true
			_update()

	func _on_exit(b: Node3D) -> void:
		if _bodies.erase(b.get_instance_id()):
			_update()

	func _update() -> void:
		var now := not _bodies.is_empty()
		if now == pressed:
			return
		pressed = now
		Sfx.play_at("click", global_position, -2.0, 0.8 if pressed else 1.0)
		var tw := create_tween()
		tw.tween_property(_top, "position:y", 0.04 if pressed else 0.1, 0.12)
		(_top.material_override as StandardMaterial3D).emission_energy_multiplier = 1.4 if pressed else 0.25
		for t in targets:
			t.set_input(self, pressed)

	func focus_label() -> String:
		return "Pressure Plate"

	func focus_text() -> String:
		return "It clicks under weight. Something heavy could hold it down."

	func can_interact(_p: Node) -> bool:
		return false

	func focus_prompt(_p: Node) -> String:
		return ""

	func interact(_p: Node) -> void:
		pass


# ------------------------------------------------------------ Valve wheel (toggles mechanisms)
class Valve extends Node3D:
	var level: Node
	var targets: Array = []
	var label := "Rusty Valve"
	var text := "Turn it and something, somewhere, gurgles."
	var _wheel: Node3D

	func _ready() -> void:
		add_to_group("focusable")
		_wheel = Node3D.new()
		add_child(_wheel)
		var v := {}
		for a in 16:
			var ang := a / 16.0 * TAU
			v[Vector3i(roundi(cos(ang) * 4), roundi(sin(ang) * 4), 0)] = Color("b8402a")
		for i in range(-4, 5):
			v[Vector3i(i, 0, 0)] = Color("a8382a")
			v[Vector3i(0, i, 0)] = Color("a8382a")
		_wheel.add_child(Voxel.mesh_instance(v, 0.07, Vector3(-0.5, -0.5, -0.5) * 0.07))
		var post := MeshInstance3D.new()
		var pb := BoxMesh.new()
		pb.size = Vector3(0.14, 0.14, 0.4)
		post.mesh = pb
		post.material_override = level.mat("rust")
		post.position.z = -0.2
		add_child(post)

	func focus_label() -> String:
		return label

	func focus_text() -> String:
		return text

	func can_interact(_p: Node) -> bool:
		return true

	func focus_prompt(_p: Node) -> String:
		return "Turn valve"

	func interact(_p: Node) -> void:
		Sfx.play_at("valve", global_position, 0.0)
		var tw := create_tween()
		tw.tween_property(_wheel, "rotation:z", _wheel.rotation.z + PI, 0.8).set_trans(Tween.TRANS_SINE)
		for t in targets:
			t.toggle()


# ------------------------------------------------------------ Rotatable plank / sign
class Rotator extends AnimatableBody3D:
	var level: Node
	var label := "Fallen Billboard"
	var text := "Balanced on a pole. A little push would spin it around."
	var step_deg := 90.0
	var _busy := false
	var _angle := 0.0

	func _ready() -> void:
		add_to_group("focusable")
		sync_to_physics = true
		_angle = rotation.y

	func focus_label() -> String:
		return label

	func focus_text() -> String:
		return text

	func can_interact(_p: Node) -> bool:
		return not _busy

	func focus_prompt(_p: Node) -> String:
		return "Rotate"

	func interact(_p: Node) -> void:
		if _busy:
			return
		_busy = true
		_angle += deg_to_rad(step_deg)
		Sfx.play_at("stone", global_position, -4.0, 1.3)
		var tw := create_tween()
		tw.tween_property(self, "rotation:y", _angle, 0.7).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_callback(func() -> void: _busy = false)


# ------------------------------------------------------------ Inspectable flavour object
class Inspectable extends Node3D:
	var label := ""
	var text := ""

	func _ready() -> void:
		add_to_group("focusable")

	func focus_label() -> String:
		return label

	func focus_text() -> String:
		return text

	func can_interact(_p: Node) -> bool:
		return false

	func focus_prompt(_p: Node) -> String:
		return ""

	func interact(_p: Node) -> void:
		pass


# ------------------------------------------------------------ Trigger volumes
class Trigger extends Area3D:
	var size := Vector3.ONE
	var on_enter: Callable
	var once := false
	var _done := false

	func _ready() -> void:
		collision_layer = 0
		collision_mask = 2
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		add_child(cs)
		body_entered.connect(func(b: Node3D) -> void:
			if b is PlayerFrog and not (once and _done):
				_done = true
				on_enter.call(b))


# ------------------------------------------------------------ Climb zone (vines)
class ClimbZone extends Area3D:
	var size := Vector3.ONE

	func _ready() -> void:
		collision_layer = 0
		collision_mask = 2
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		add_child(cs)
		body_entered.connect(func(b: Node3D) -> void:
			if b is PlayerFrog:
				(b as PlayerFrog).climb_areas += 1)
		body_exited.connect(func(b: Node3D) -> void:
			if b is PlayerFrog:
				(b as PlayerFrog).climb_areas = maxi(0, (b as PlayerFrog).climb_areas - 1))


# ------------------------------------------------------------ NPC frogs
class NPCFrog extends Node3D:
	var species: Dictionary
	var model: FrogModel
	var player: Node3D
	var _t := 0.0
	var _hop := 0.0
	var _celebrate := 0.0
	var _base_y := 0.0

	func _ready() -> void:
		model = FrogModel.create(species, randf_range(0.85, 1.15))
		add_child(model)
		_t = randf_range(1.0, 5.0)
		_base_y = position.y
		rotation.y = randf() * TAU

	func _process(d: float) -> void:
		_t -= d
		if _celebrate > 0.0:
			_celebrate -= d
			_hop += d * 9.0
			model.set_hop(absf(sin(_hop)) * 0.35)
			rotation.y += d * 2.0
			return
		if _hop > 0.0:
			_hop -= d * 4.0
			model.set_hop(sin(clampf(1.0 - _hop, 0.0, 1.0) * PI) * 0.22)
		elif _t <= 0.0:
			_t = randf_range(2.0, 7.0)
			if player and player.global_position.distance_to(global_position) < 6.0:
				var to := player.global_position - global_position
				rotation.y = atan2(to.x, to.z)
			else:
				rotation.y += randf_range(-1.0, 1.0)
			_hop = 1.0
			model.pulse(Vector3(0.85, 1.2, 0.85))

	func hear_croak(pos: Vector3) -> void:
		if pos.distance_to(global_position) > 14.0:
			return
		await get_tree().create_timer(randf_range(0.25, 1.0)).timeout
		if not is_inside_tree():
			return
		model.croak(randi_range(1, 3))
		Sfx.play_at("croak%d" % randi_range(1, 3), global_position, -7.0, 1.0 / model.scale.x, 0.12)

	func celebrate() -> void:
		_celebrate = randf_range(2.0, 3.5)
		hear_croak(global_position)


class Buddy extends CharacterBody3D:
	var species: Dictionary
	var model: FrogModel
	var player: Node3D
	var level: Node
	var following := false
	var _hop := 0.0

	func _ready() -> void:
		add_to_group("weight")
		add_to_group("focusable")
		collision_layer = 4
		collision_mask = 1 | 4
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = 0.32
		cap.height = 0.7
		cs.shape = cap
		cs.position.y = 0.35
		add_child(cs)
		model = FrogModel.create(species, 1.15)
		add_child(model)

	func focus_label() -> String:
		return "%s (Buddy)" % species.get("name", "Frog")

	func focus_text() -> String:
		return "A heavy-set frog. Croak nearby to call it; croak again to make it wait."

	func can_interact(_p: Node) -> bool:
		return false

	func focus_prompt(_p: Node) -> String:
		return ""

	func interact(_p: Node) -> void:
		pass

	func hear_croak(pos: Vector3) -> void:
		if pos.distance_to(global_position) > 7.0:
			return
		following = not following
		if not following:
			_sit_on_nearby_plate()
		await get_tree().create_timer(0.35).timeout
		model.croak(3 if following else 1)
		Sfx.play_at("croak3", global_position, -3.0, 0.8)
		if level:
			level.toast("Your buddy is following you!" if following else "Your buddy will wait right here.")

	var _goal: Variant = null

	## Buddies love pressure plates: told to wait near one, they hop onto it.
	func _sit_on_nearby_plate() -> void:
		var best: Node3D = null
		var bd := 2.6
		for n in get_tree().get_nodes_in_group("focusable"):
			if n is Props.PressurePlate:
				var d := (n as Node3D).global_position.distance_to(global_position)
				if d < bd:
					bd = d
					best = n
		if best:
			_goal = best.global_position

	func _physics_process(d: float) -> void:
		velocity.y -= 22.0 * d
		var hv := Vector3.ZERO
		if following and player:
			var to := player.global_position - global_position
			to.y = 0
			if to.length() > 1.5:
				hv = to.normalized() * minf(3.8, to.length() * 2.0)
		elif _goal != null:
			var tg: Vector3 = _goal
			var to2 := tg - global_position
			to2.y = 0
			if to2.length() > 0.12:
				hv = to2.normalized() * minf(3.0, to2.length() * 4.0)
			else:
				_goal = null
		velocity.x = move_toward(velocity.x, hv.x, 18.0 * d)
		velocity.z = move_toward(velocity.z, hv.z, 18.0 * d)
		move_and_slide()
		if is_on_floor():
			velocity.y = 0.0
		var h2 := Vector2(velocity.x, velocity.z)
		if h2.length() > 0.3:
			model.rotation.y = lerp_angle(model.rotation.y, atan2(h2.x, h2.y), 0.2)
			_hop += d * 9.0
			model.set_hop(absf(sin(_hop)) * 0.18)
		else:
			model.set_hop(0.0)
		if level and global_position.y < level.kill_y:
			global_position = level.spawn + Vector3(1.5, 1, 0)
			velocity = Vector3.ZERO


# ------------------------------------------------------------ Crows: perch, flee when you get close
class Crow extends Node3D:
	var player: Node3D
	var model: Node3D
	var _home := Vector3.ZERO
	var _state := 0   # 0 perched, 1 flying away, 2 returning
	var _t := 0.0
	var _vel := Vector3.ZERO
	var _peck := 2.0

	func _ready() -> void:
		model = Props.make_crow_mesh()
		add_child(model)
		_home = global_position
		rotation.y = randf() * TAU

	func _process(d: float) -> void:
		_t += d
		var wl := model.get_node("WingL") as Node3D
		var wr := model.get_node("WingR") as Node3D
		match _state:
			0:
				wl.rotation.z = 0.0
				wr.rotation.z = 0.0
				_peck -= d
				if _peck <= 0.0:
					_peck = randf_range(1.5, 5.0)
					var tw := create_tween()
					tw.tween_property(model, "rotation:x", 0.5, 0.12)
					tw.tween_property(model, "rotation:x", 0.0, 0.15)
					if randf() < 0.3:
						rotation.y += randf_range(-1.2, 1.2)
				if player and player.global_position.distance_to(global_position) < 3.0:
					_state = 1
					_t = 0.0
					var away := global_position - player.global_position
					away.y = 0
					_vel = away.normalized() * 4.0 + Vector3(0, 3.0, 0)
					rotation.y = atan2(_vel.x, _vel.z)
					Sfx.play_at("flap", global_position, -2.0)
					if randf() < 0.6:
						Sfx.play_at("crow%d" % randi_range(1, 2), global_position, -8.0)
			1:
				wl.rotation.z = sin(_t * 22.0) * 0.9
				wr.rotation.z = sin(_t * 22.0) * 0.9
				global_position += _vel * d
				_vel.y += d * 0.5
				if _t > 6.0:
					_state = 2
					_t = 0.0
					visible = false
			2:
				if _t > 12.0 and (player == null or player.global_position.distance_to(_home) > 6.0):
					global_position = _home
					visible = true
					_state = 0
