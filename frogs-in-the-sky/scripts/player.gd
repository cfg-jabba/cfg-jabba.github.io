class_name PlayerFrog
extends CharacterBody3D
## The frog you control. Hops, sticky-toe climbs vines, licks snacks with its tongue, croaks.

signal croaked(pos: Vector3)

const SPEED := 4.4
const ACCEL := 26.0
const AIR_ACCEL := 11.0
const AIR_BRAKE := 22.0  # strong air braking when the stick is released = precise landings
const JUMP_V := 9.6
const GRAVITY := 22.0
const FALL_MULT := 1.3
const CLIMB_SPEED := 2.8
const TONGUE_RANGE := 3.2
const GRIP_TIME := 0.8        # seconds of sticky-hand climbing before the frog needs to touch ground
const WALL_SLIDE := 1.1
const INTERACT_RANGE := 2.1

var main: Node
var camera_rig: Node3D
var level: Node3D
var model: FrogModel
var input_enabled := true
var respawn_point := Vector3.ZERO
var carrying_seed := false
var climb_areas := 0
var grip := GRIP_TIME
var clinging := false
var _wall_n := Vector3.ZERO
var _press_t := 0.0
var max_height := 0.0
var sim_jump_held := false  # test hook: lets the headless playtest hold jump

var _coyote := 0.0
var _jump_buf := 0.0
var _jump_cut := false
var _was_floor := true
var _air_time := 0.0
var _hop_phase := 0.0
var _facing := 0.0
var _tongue: MeshInstance3D
var _tongue_busy := false
var _seed_icon: Node3D
var _dust: CPUParticles3D
var _respawning := false


func _ready() -> void:
	collision_layer = 2
	collision_mask = 1 | 4
	floor_max_angle = deg_to_rad(48)
	floor_snap_length = 0.25
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 0.66
	cs.shape = cap
	cs.position.y = 0.33
	add_child(cs)
	set_species(FrogSpecies.get_species(int(Game.data.selected_frog)))
	_tongue = MeshInstance3D.new()
	var tb := BoxMesh.new()
	tb.size = Vector3(0.07, 0.04, 1.0)
	_tongue.mesh = tb
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color("ff7d96")
	tm.roughness = 0.25
	_tongue.material_override = tm
	_tongue.visible = false
	add_child(_tongue)
	_seed_icon = Props.make_seed_mesh()
	_seed_icon.position = Vector3(0, 0.95, 0)
	_seed_icon.visible = false
	add_child(_seed_icon)
	_dust = CPUParticles3D.new()
	_dust.emitting = false
	_dust.one_shot = true
	_dust.amount = 14
	_dust.lifetime = 0.6
	_dust.explosiveness = 0.95
	_dust.direction = Vector3(0, 1, 0)
	_dust.spread = 80
	_dust.initial_velocity_min = 0.6
	_dust.initial_velocity_max = 1.4
	_dust.gravity = Vector3(0, -1.5, 0)
	_dust.scale_amount_min = 0.5
	_dust.scale_amount_max = 1.0
	var dm := BoxMesh.new()
	dm.size = Vector3.ONE * 0.06
	var dmat := StandardMaterial3D.new()
	dmat.albedo_color = Color(0.95, 0.93, 0.88, 0.8)
	dmat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	dm.material = dmat
	_dust.mesh = dm
	add_child(_dust)


func set_species(sp: Dictionary) -> void:
	if model:
		model.queue_free()
	model = FrogModel.create(sp)
	model.rotation.y = _facing
	add_child(model)


func _physics_process(delta: float) -> void:
	if _respawning:
		return
	var focus_mode: bool = main != null and main.focus_mode
	var can_move: bool = input_enabled and not focus_mode
	var input := Vector2.ZERO
	if can_move:
		input = Input.get_vector("move_left", "move_right", "move_forward", "move_back")
	var yaw: float = camera_rig.yaw if camera_rig else 0.0
	var dir := Vector3(input.x, 0, input.y).rotated(Vector3.UP, yaw)
	var on_floor := is_on_floor()
	var climbing := climb_areas > 0 and input.length() > 0.2 and can_move
	# sticky hands: grip rough walls (brick, concrete, wood, stone). Smooth metal is slippery.
	var wall := _grippable_wall(dir)
	var pressing := wall != Vector3.ZERO and can_move and dir.length() > 0.2 and dir.normalized().dot(-wall) > 0.45
	_press_t = _press_t + delta if pressing else 0.0
	var was_clinging := clinging
	clinging = pressing and not climbing and (not on_floor or _press_t > 0.2)
	if clinging:
		_wall_n = wall
		if not was_clinging:
			Sfx.play_at("step", global_position, -6.0, 0.7)
			model.pulse(Vector3(1.15, 0.9, 1.15))

	# horizontal
	var target := dir * SPEED
	var a := ACCEL if on_floor else (AIR_ACCEL if input.length() > 0.1 else AIR_BRAKE)
	velocity.x = move_toward(velocity.x, target.x, a * delta)
	velocity.z = move_toward(velocity.z, target.z, a * delta)

	# vertical
	if on_floor:
		_coyote = 0.12
		_jump_cut = false
	else:
		_coyote -= delta
	if can_move and Input.is_action_just_pressed("jump"):
		_jump_buf = 0.14
	elif _jump_buf > 0.0:
		_jump_buf -= delta
	if on_floor:
		grip = GRIP_TIME
	if climbing:
		velocity.y = move_toward(velocity.y, CLIMB_SPEED * clampf(input.length(), 0.4, 1.0), 30.0 * delta)
		if _jump_buf > 0.0:
			_do_jump(0.8)
	elif clinging:
		if _jump_buf > 0.0:
			# wall jump: kick off the wall
			_do_jump(0.85)
			velocity += _wall_n * 4.5
			clinging = false
		elif grip > 0.0:
			grip -= delta
			velocity.y = move_toward(velocity.y, CLIMB_SPEED, 40.0 * delta)
		else:
			velocity.y = maxf(velocity.y - GRAVITY * delta, -WALL_SLIDE)
		velocity.x -= _wall_n.x * 2.0
		velocity.z -= _wall_n.z * 2.0
	else:
		var g := GRAVITY * (FALL_MULT if velocity.y < 0.0 else 1.0)
		if climb_areas > 0:
			g *= 0.25
			velocity.y = maxf(velocity.y, -2.0)
		velocity.y -= g * delta
		velocity.y = maxf(velocity.y, -30.0)
		if _jump_buf > 0.0 and _coyote > 0.0:
			_do_jump(1.0)
	if not (Input.is_action_pressed("jump") or sim_jump_held) and velocity.y > 2.5 and not _jump_cut and not on_floor and not climbing:
		velocity.y *= 0.55
		_jump_cut = true

	move_and_slide()
	_push_props()

	# landing
	var now_floor := is_on_floor()
	if now_floor and not _was_floor and _air_time > 0.18:
		var k := clampf(_air_time, 0.2, 1.0)
		model.pulse(Vector3(1.0 + 0.35 * k, 1.0 - 0.38 * k, 1.0 + 0.35 * k))
		Sfx.play_at("land", global_position, -6.0 + k * 4.0)
		_dust.restart()
		_dust.emitting = true
		for n in get_tree().get_nodes_in_group("phys_prop"):
			var pp := n as Props.PhysProp
			var to := pp.global_position - global_position
			if to.length() < 1.4:
				pp.knock((to.normalized() * 0.6 + Vector3.UP) * pp.mass * k * 1.5)
		if main and _air_time > 0.7:
			main.shake(0.15 * k)
	_air_time = 0.0 if now_floor else _air_time + delta
	_was_floor = now_floor

	# facing + hop animation (frogs hop instead of walk)
	var hv := Vector2(velocity.x, velocity.z)
	if hv.length() > 0.4:
		_facing = lerp_angle(_facing, atan2(hv.x, hv.y), 1.0 - exp(-12.0 * delta))
	if clinging:
		_facing = atan2(-_wall_n.x, -_wall_n.z)
	model.rotation.y = _facing
	model.rotation.x = lerpf(model.rotation.x, -1.1 if clinging else 0.0, 1.0 - exp(-14.0 * delta))
	if now_floor and hv.length() > 0.5:
		var prev := _hop_phase
		_hop_phase += delta * (5.0 + hv.length() * 1.6)
		model.set_hop(absf(sin(_hop_phase)) * 0.16)
		if floori(prev / PI) != floori(_hop_phase / PI):
			model.pulse(Vector3(1.12, 0.86, 1.12))
			Sfx.play_at("step", global_position, -10.0, 1.2)
	elif now_floor:
		_hop_phase = 0.0
		model.set_hop(lerpf(model.root.position.y, 0.0, 0.3))
	else:
		model.set_hop(0.0)

	if global_position.y > max_height:
		max_height = global_position.y
	if level and global_position.y < level.kill_y:
		respawn()


func _do_jump(mul: float) -> void:
	velocity.y = JUMP_V * mul
	_jump_buf = 0.0
	_coyote = 0.0
	model.pulse(Vector3(0.78, 1.32, 0.78))
	Sfx.play_at("hop", global_position, -4.0, 1.0, 0.1)


func _grippable_wall(dir: Vector3) -> Vector3:
	if dir.length() < 0.2:
		return Vector3.ZERO
	var space := get_world_3d().direct_space_state
	var d := dir.normalized()
	for h in [0.2, 0.5]:
		var from := global_position + Vector3(0, h, 0)
		var q := PhysicsRayQueryParameters3D.create(from, from + d * 0.5, 1)
		q.exclude = [get_rid()]
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			continue
		var n: Vector3 = hit.normal
		if absf(n.y) > 0.35:
			continue
		var col := hit.collider as Node
		if col == null or col.has_meta("slippery"):
			return Vector3.ZERO
		n.y = 0
		return n.normalized()
	return Vector3.ZERO


func _push_props() -> void:
	for i in get_slide_collision_count():
		var c := get_slide_collision(i)
		var b := c.get_collider()
		var d := -c.get_normal()
		d.y = 0
		if d.length() < 0.3:
			continue
		if b is RigidBody3D and b.has_method("push"):
			b.push(d.normalized())
		elif b is Props.PhysProp:
			var hv := Vector2(velocity.x, velocity.z).length()
			var pp := b as Props.PhysProp
			pp.knock(d.normalized() * (0.6 + hv * 0.35) * pp.mass * 0.5, c.get_position() - pp.global_position + Vector3(0, 0.1, 0))


func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled or _respawning:
		return
	if main and main.focus_mode:
		return
	if event.is_action_pressed("jump"):
		_jump_buf = 0.14
	elif event.is_action_pressed("tongue"):
		lick()
	elif event.is_action_pressed("croak"):
		croak()
	elif event.is_action_pressed("interact"):
		var t := nearest_interactable()
		if t:
			t.interact(self)


func nearest_interactable() -> Node3D:
	var best: Node3D = null
	var bd := INTERACT_RANGE
	for n in get_tree().get_nodes_in_group("focusable"):
		var nd := n as Node3D
		if nd == null or not nd.has_method("interact"):
			continue
		if nd.has_method("can_interact") and not nd.can_interact(self):
			continue
		var d := nd.global_position.distance_to(global_position)
		if d < bd:
			bd = d
			best = nd
	return best


func croak() -> void:
	model.croak(2)
	Sfx.play_at("croak%d" % randi_range(1, 3), global_position, -2.0, 1.0, 0.08)
	croaked.emit(global_position)
	# a big croak is a tiny shockwave
	for n in get_tree().get_nodes_in_group("phys_prop"):
		var pp := n as Props.PhysProp
		var to := pp.global_position - global_position
		if to.length() < 2.5:
			pp.knock((to.normalized() + Vector3.UP * 0.6) * pp.mass * (2.5 - to.length()) * 0.9)


func lick() -> void:
	if _tongue_busy:
		return
	_tongue_busy = true
	var mouth := global_position + Vector3(0, 0.3, 0) + Vector3(sin(_facing), 0, cos(_facing)) * 0.3
	var target: Node3D = null
	var bd := TONGUE_RANGE
	for n in get_tree().get_nodes_in_group("tongue_target"):
		var nd := n as Node3D
		if nd == null or not nd.is_inside_tree():
			continue
		var d := nd.global_position.distance_to(mouth)
		if d < bd:
			bd = d
			target = nd
	var end := mouth + Vector3(sin(_facing), 0.1, cos(_facing)) * 1.4
	if target:
		end = target.global_position
		var to := end - global_position
		_facing = atan2(to.x, to.z)
	Sfx.play_at("tongue", global_position, -4.0)
	model.pulse(Vector3(1.1, 0.92, 1.15))
	_t_mouth = mouth
	_t_end = end
	_t_target = target
	_tongue.visible = true
	_tongue_set(0.0)
	var tw := create_tween()
	tw.tween_method(_tongue_set, 0.0, 1.0, 0.09)
	tw.tween_callback(_tongue_hit)
	tw.tween_method(_tongue_set, 1.0, 0.0, 0.12)
	tw.tween_callback(_tongue_done)


var _t_mouth := Vector3.ZERO
var _t_end := Vector3.ZERO
var _t_target: Node3D


func _tongue_set(v: float) -> void:
	var d := _t_end - _t_mouth
	var ln := d.length()
	if ln < 0.01:
		return
	var fwd := d / ln
	var up := Vector3.UP if absf(fwd.y) < 0.98 else Vector3.RIGHT
	var b := Basis.looking_at(fwd, up)
	var k := maxf(v * ln, 0.01)
	_tongue.global_transform = Transform3D(Basis(b.x, b.y, b.z * k), _t_mouth + fwd * v * ln * 0.5)


func _tongue_hit() -> void:
	if _t_target and is_instance_valid(_t_target) and _t_target.has_method("collect"):
		_t_target.collect(self)


func _tongue_done() -> void:
	_tongue.visible = false
	_tongue_busy = false


func give_seed() -> void:
	carrying_seed = true
	_seed_icon.visible = true


func take_seed() -> bool:
	if not carrying_seed:
		return false
	carrying_seed = false
	_seed_icon.visible = false
	return true


func respawn() -> void:
	if _respawning:
		return
	_respawning = true
	Sfx.play("plop", -4.0, 0.8)
	if main:
		main.fade(0.35)
	await get_tree().create_timer(0.35).timeout
	global_position = respawn_point + Vector3(0, 0.4, 0)
	velocity = Vector3.ZERO
	_respawning = false
	model.pulse(Vector3(0.6, 1.4, 0.6))


func _process(_d: float) -> void:
	if _seed_icon.visible:
		_seed_icon.rotation.y += _d * 2.0
