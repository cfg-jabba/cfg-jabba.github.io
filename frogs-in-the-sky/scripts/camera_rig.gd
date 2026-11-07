class_name CameraRig
extends Node3D
## Third-person diorama camera: slow, floaty, tilt-shift depth of field.
## Focus mode pulls in to a target with a shallow DOF.

var target: Node3D
var cam: Camera3D
var attrs: CameraAttributesPractical
var yaw := 0.7
var pitch := -0.42
var dist := 7.0
var dist_goal := 7.0
var pivot := Vector3.ZERO
var focus_point: Variant = null   # Vector3 when focusing
var orbit_mode := false           # title screen slow orbit
var orbit_center := Vector3.ZERO
var orbit_dist := 18.0
var _shake := 0.0
var _idle := 0.0
var _mouse_delta := Vector2.ZERO


func _ready() -> void:
	cam = Camera3D.new()
	cam.current = true
	cam.near = 0.05
	cam.far = 400.0
	add_child(cam)
	attrs = CameraAttributesPractical.new()
	attrs.dof_blur_far_enabled = true
	attrs.dof_blur_near_enabled = true
	cam.attributes = attrs
	Game.cam_attr = attrs
	process_mode = Node.PROCESS_MODE_ALWAYS


func shake(a: float) -> void:
	if Game.settings.camera_shake:
		_shake = maxf(_shake, a)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_mouse_delta += (event as InputEventMouseMotion).relative


func _process(delta_scaled: float) -> void:
	var delta := delta_scaled / maxf(Engine.time_scale, 0.05)
	if get_tree().paused and not orbit_mode:
		_mouse_delta = Vector2.ZERO
		return
	var sens: float = float(Game.settings.cam_sensitivity)
	var inv_y := -1.0 if Game.settings.invert_y else 1.0
	var inv_x := -1.0 if Game.settings.invert_x else 1.0
	var stick := Vector2(Input.get_axis("cam_left", "cam_right"), Input.get_axis("cam_up", "cam_down"))
	var manual := stick.length() > 0.05 or _mouse_delta.length() > 0.0
	yaw -= (stick.x * 2.4 * delta + _mouse_delta.x * 0.0035) * sens * inv_x
	pitch -= (stick.y * 1.6 * delta + _mouse_delta.y * 0.0030) * sens * inv_y
	_mouse_delta = Vector2.ZERO
	pitch = clampf(pitch, -1.25, 0.25)
	if Input.is_action_just_pressed("zoom_in"):
		dist_goal = clampf(dist_goal - 1.0, 3.0, 14.0)
	if Input.is_action_just_pressed("zoom_out"):
		dist_goal = clampf(dist_goal + 1.0, 3.0, 14.0)

	var fov: float = float(Game.settings.fov)
	var goal_pivot := pivot
	var goal_dist := dist_goal
	if orbit_mode:
		yaw += delta * 0.06
		pitch = lerpf(pitch, -0.32, delta)
		goal_pivot = orbit_center
		goal_dist = orbit_dist
	elif focus_point != null:
		goal_pivot = focus_point
		goal_dist = 3.4
		fov -= 8.0
	elif target:
		goal_pivot = target.global_position + Vector3(0, 0.55, 0)
		# gentle auto-follow behind the frog when moving and not steering the camera
		_idle = 0.0 if manual else _idle + delta
		if Game.settings.auto_camera and _idle > 1.4 and target is CharacterBody3D:
			var v: Vector3 = (target as CharacterBody3D).velocity
			var hv := Vector2(v.x, v.z)
			if hv.length() > 2.0:
				var want := atan2(-v.x, -v.z)
				yaw = lerp_angle(yaw, want, delta * 0.35)
	pivot = pivot.lerp(goal_pivot, 1.0 - exp(-(3.0 if orbit_mode else 7.0) * delta))
	dist = lerpf(dist, goal_dist, 1.0 - exp(-4.0 * delta))
	cam.fov = lerpf(cam.fov, fov, 1.0 - exp(-5.0 * delta))

	var b := Basis.from_euler(Vector3(pitch, yaw, 0))
	var want_pos := pivot + b * Vector3(0, 0, dist)
	# keep the camera out of walls
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(pivot, want_pos, 1)
	var hit := space.intersect_ray(q)
	var actual := dist
	if hit and not orbit_mode:
		actual = maxf(0.6, pivot.distance_to(hit.position) - 0.25)
		want_pos = pivot + b * Vector3(0, 0, actual)
	global_position = want_pos
	global_basis = b
	if _shake > 0.0:
		_shake = maxf(0.0, _shake - delta * 1.5)
		cam.position = Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * _shake * 0.3
	else:
		cam.position = Vector3.ZERO
	Sfx.listener_pos = global_position
	_update_dof(actual)


func _update_dof(focus_dist: float) -> void:
	var mode: String = str(Game.settings.dof)
	if mode == "off":
		attrs.dof_blur_far_enabled = false
		attrs.dof_blur_near_enabled = false
		return
	var strength: float = float(Game.settings.dof_strength)
	attrs.dof_blur_far_enabled = true
	attrs.dof_blur_near_enabled = true
	var amount := 0.06 if mode == "subtle" else 0.11
	var far_start := focus_dist + 6.0
	var far_tr := 14.0
	var near_end := maxf(0.1, focus_dist - 3.0)
	if focus_point != null:
		far_start = focus_dist + 0.9
		far_tr = 3.5
		near_end = maxf(0.1, focus_dist - 1.2)
		amount *= 1.6
	elif orbit_mode:
		far_start = focus_dist + 4.0
		far_tr = 16.0
		near_end = maxf(0.1, focus_dist - 8.0)
	elif not Game.settings.tilt_shift:
		far_start = focus_dist + 20.0
		far_tr = 30.0
	attrs.dof_blur_far_distance = lerpf(attrs.dof_blur_far_distance, far_start, 0.1)
	attrs.dof_blur_far_transition = far_tr
	attrs.dof_blur_near_distance = lerpf(attrs.dof_blur_near_distance, near_end, 0.1)
	attrs.dof_blur_near_transition = 1.5
	attrs.dof_blur_amount = amount * strength
