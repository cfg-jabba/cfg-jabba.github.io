class_name FrogModel
extends Node3D
## Procedural cute voxel frog. Big glossy eyes, blush cheeks, a throat sac that puffs when croaking.

const VS := 0.064

var species: Dictionary
var root: Node3D          # squash/stretch + hop offset pivot
var body: MeshInstance3D
var eyes: Array[Node3D] = []
var throat: MeshInstance3D
var squash := Vector3.ONE
var _blink_t := 2.0
var _blinking := 0.0
var _croak_tw: Tween


static func create(sp: Dictionary, scale_mul: float = 1.0) -> FrogModel:
	var f := FrogModel.new()
	f.species = sp
	f.scale = Vector3.ONE * scale_mul
	f._build()
	return f


func _build() -> void:
	root = Node3D.new()
	add_child(root)
	var sp := species
	var seed_v: int = int(sp.get("index", 0)) * 31 + 7
	var pattern: String = sp.get("pattern", "solid")
	var base: Color = sp.get("base", Color("6cbf3a"))
	var accent: Color = sp.get("accent", Color.WHITE)
	var belly: Color = sp.get("belly", Color("f2f0d8"))
	var round_body := pattern == "round"
	var vox := {}
	var ry := 3.4 if round_body else 3.0
	var rx := 5.4 if round_body else 5.2
	for x in range(-6, 7):
		for y in range(0, 9):
			for z in range(-6, 7):
				var bx := x / rx
				var by := (y - 2.8) / ry
				var bz := (z + 0.3) / 4.8
				var hx := x / 4.5
				var hy := (y - 4.0) / 2.5
				var hz := (z - 2.2) / 3.4
				if bx * bx + by * by + bz * bz <= 1.0 or hx * hx + hy * hy + hz * hz <= 1.0:
					vox[Vector3i(x, y, z)] = _pattern_color(x, y, z, pattern, base, accent, belly, seed_v)
	# legs: chunky back thighs, toes, little front arms
	for s in [-1, 1]:
		var leg := base.darkened(0.06)
		if pattern == "legs_blue":
			leg = accent
		Voxel.fill_box(vox, Vector3i(5 * s, 0, -4), Vector3i(6 * s, 2, -1), leg)
		Voxel.fill_box(vox, Vector3i(5 * s, 0, -1), Vector3i(6 * s, 0, 1), leg.lightened(0.05))
		vox[Vector3i(6 * s, 0, 2)] = leg.lightened(0.15)
		vox[Vector3i(5 * s, 0, 2)] = leg.lightened(0.15)
		Voxel.fill_box(vox, Vector3i(3 * s, 0, 4), Vector3i(4 * s, 1, 4), leg)
		vox[Vector3i(3 * s, 0, 5)] = leg.lightened(0.15)
		vox[Vector3i(4 * s, 0, 5)] = leg.lightened(0.15)
		if pattern == "hairy":
			for z in range(-3, 2):
				vox[Vector3i(7 * s, 1, z)] = accent
		if pattern == "horned":
			vox[Vector3i(3 * s, 7, 2)] = accent.lightened(0.1)
			vox[Vector3i(3 * s, 8, 2)] = accent.lightened(0.2)
	# face details: smile, blush, nostrils
	var mouth := base.darkened(0.55)
	for x in range(-3, 4):
		var my := 3 if absi(x) < 3 else 4
		var fz := _front_z(vox, x, my)
		if fz > -99:
			vox[Vector3i(x, my, fz)] = mouth
	for s in [-1, 1]:
		var cz := _front_z(vox, 4 * s, 4)
		if cz > -99:
			vox[Vector3i(4 * s, 4, cz)] = base.lerp(Color("ff8fa0"), 0.6)
		var nz := _front_z(vox, s, 5)
		if nz > -99:
			vox[Vector3i(s, 5, nz)] = base.darkened(0.4)
	body = Voxel.mesh_instance(vox, VS, Vector3(-0.5, 0, -0.5) * VS)
	body.name = "Body"
	root.add_child(body)
	# eyes
	for s in [-1, 1]:
		var pivot := Node3D.new()
		pivot.position = Vector3(2.6 * s, 6.3, 2.6) * VS
		root.add_child(pivot)
		var ev := {}
		var eye_col: Color = sp.get("eye", Color("d8a630"))
		for x in range(-2, 3):
			for y in range(-2, 3):
				for z in range(-2, 3):
					var d := Vector3(x, y, z).length()
					if d > 2.15:
						continue
					var c := base
					if z >= 0:
						c = eye_col
						if z >= 1 and absi(x) <= 1 and y <= 1 and y >= -1:
							c = Color("101010")
					if pattern == "mask" and z < 0 and y <= 0:
						c = accent
					ev[Vector3i(x, y, z)] = c
		# sparkle highlights make them cute
		ev[Vector3i(-1 * s, 1, 2)] = Color.WHITE
		ev[Vector3i(0, 1, 2)] = Color("101010")
		ev[Vector3i(1 * s, -1, 2)] = Color("e8e8e8")
		var em := Voxel.mesh_instance(ev, VS * 0.92, Vector3(-0.5, -0.5, -0.5) * VS * 0.92)
		pivot.add_child(em)
		eyes.append(pivot)
	# throat sac
	throat = MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = VS * 2.4
	sm.height = VS * 4.0
	sm.radial_segments = 12
	sm.rings = 6
	throat.mesh = sm
	var tm := StandardMaterial3D.new()
	tm.albedo_color = belly.lerp(Color("ffd8e0"), 0.35)
	tm.roughness = 0.3
	tm.subsurf_scatter_enabled = false
	throat.material_override = tm
	throat.position = Vector3(0, 2.4, 4.6) * VS
	throat.scale = Vector3.ONE * 0.01
	root.add_child(throat)
	if pattern == "sparkle":
		var l := OmniLight3D.new()
		l.light_color = Color("f8d8ff")
		l.light_energy = 0.6
		l.omni_range = 1.2
		l.position = Vector3(0, 0.4, 0)
		root.add_child(l)


func _front_z(vox: Dictionary, x: int, y: int) -> int:
	for z in range(8, -8, -1):
		if vox.has(Vector3i(x, y, z)):
			return z
	return -100


func _pattern_color(x: int, y: int, z: int, pattern: String, base: Color, accent: Color, belly: Color, seed_v: int) -> Color:
	var h := Voxel.hash3(x, y, z, seed_v)
	var coarse := Voxel.hash3(floori(x / 2.0), floori(y / 2.0), floori(z / 2.0), seed_v + 5)
	var c := base
	var is_belly := y <= 1 or (z >= 3 and y <= 2)
	var top := y >= 4
	var side := absi(x) >= 4
	match pattern:
		"spots", "horned":
			if top and coarse > 0.72:
				c = accent
		"spots_light":
			if (top or side) and coarse > 0.78:
				c = accent
		"stripe_back":
			if absi(x) <= 1 and y >= 4:
				c = accent
		"stripe_side":
			if side and y == 3:
				c = accent
		"side_bars":
			if side and y >= 1 and y <= 3:
				c = belly if posmod(z, 3) == 0 else accent
		"stripes":
			if posmod(x + 8, 3) == 0 and y >= 2:
				c = accent
		"bands":
			if posmod(z + 9, 3) == 0 and y >= 2:
				c = accent
		"blotch":
			if coarse > 0.52:
				c = accent
		"legs_blue":
			if y <= 1:
				c = accent
		"mask":
			if side and y >= 4 and y <= 5 and z >= 0:
				c = accent
		"x_mark":
			if y >= 5 and absi(absi(x) - absi(z + 1)) == 0 and absi(x) <= 3:
				c = accent
		"moss":
			if coarse > 0.45:
				c = accent.lerp(base, h * 0.5)
		"warts", "wrinkly":
			if h > 0.82:
				c = base.lightened(0.18) if pattern == "warts" else accent
		"hairy":
			if side and y <= 2:
				c = accent
		"sparkle":
			c = base.lerp(accent, coarse)
			if h > 0.93:
				c = Color.WHITE
	if is_belly and pattern != "belly_fire":
		c = belly
	elif is_belly and pattern == "belly_fire":
		c = accent if coarse > 0.3 else Color("1a1a1a")
	return Voxel.jitter(c, 0.05, h)


func _process(delta: float) -> void:
	squash = squash.lerp(Vector3.ONE, 1.0 - exp(-9.0 * delta))
	root.scale = squash
	_blink_t -= delta
	if _blink_t <= 0.0:
		_blinking = 0.16
		_blink_t = randf_range(2.0, 5.5)
	if _blinking > 0.0:
		_blinking -= delta
		var k := absf(_blinking / 0.16 * 2.0 - 1.0)
		for e in eyes:
			e.scale.y = maxf(0.12, k)
	else:
		for e in eyes:
			e.scale.y = 1.0


func pulse(v: Vector3) -> void:
	squash = v


func set_hop(offset: float) -> void:
	root.position.y = offset


func croak(times: int = 2) -> void:
	if _croak_tw and _croak_tw.is_running():
		_croak_tw.kill()
	_croak_tw = create_tween()
	for i in times:
		_croak_tw.tween_property(throat, "scale", Vector3(1.25, 1.1, 1.15), 0.12).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		_croak_tw.tween_property(throat, "scale", Vector3.ONE * 0.35, 0.1)
	_croak_tw.tween_property(throat, "scale", Vector3.ONE * 0.01, 0.12)
	pulse(Vector3(1.08, 0.94, 1.08))
