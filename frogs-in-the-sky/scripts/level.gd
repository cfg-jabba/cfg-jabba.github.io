class_name Level
extends Node3D
## A floating diorama. Provides building helpers used by Levels.* builders,
## plus runtime: snacks, growth-as-you-climb, vines, completion.

signal completed
signal snack_changed(count: int, total: int)
signal toast_requested(text: String)

var def: Dictionary
var level_index := 0
var spawn := Vector3.ZERO
var kill_y := -14.0
var top_y := 12.0
var center := Vector3.ZERO
var snack_total := 0
var snack_count := 0
var player: PlayerFrog
var is_complete := false
var npcs: Array = []
var rng := RandomNumberGenerator.new()
var _growth: Array = []          # [{node, at, done, scale}]
var _crates: Array = []          # [{node, home}]
var _vine_targets := {}          # SoilPlot id -> {climb: AABB, ...}
var _snack_seq := 0
var _pond_pos := Vector3.ZERO

static var _mats := {}
static var _slippery := {}   # material -> true: smooth metal/paint the frog's sticky hands can't grip
const SLIPPERY_KINDS := ["metal", "rust", "hazard", "sign_green", "white", "tile"]

const KINDS := {
	"concrete": ["bdb8ad", "a39f95", 0.32, 0.9, 0.0],
	"asphalt": ["4a4b52", "3e3f46", 0.18, 0.95, 0.0],
	"brick": ["b0634a", "94503c", 0.3, 0.9, 0.0],
	"tile": ["d8d4cc", "c4beb4", 0.2, 0.6, 0.0],
	"rust": ["8a4a2a", "6a3a22", 0.15, 0.6, 0.35],
	"metal": ["8a9298", "727a80", 0.05, 0.4, 0.6],
	"wood": ["8a6440", "70502f", 0.2, 0.85, 0.0],
	"rock": ["8a8278", "6e675e", 0.22, 0.95, 0.0],
	"dirt": ["6a4a30", "5a3e26", 0.65, 0.95, 0.0],
	"sign_green": ["3a7a52", "f2f2e8", 0.05, 0.5, 0.2],
	"hazard": ["e8c040", "2a2a2a", 0.0, 0.6, 0.0],
	"white": ["e8e6e0", "d8d6d0", 0.1, 0.7, 0.0],
}


# ================================================================ materials
func mat(kind: String) -> ShaderMaterial:
	if _mats.has(kind):
		return _mats[kind]
	var k: Array = KINDS.get(kind, KINDS["concrete"])
	var m := ShaderMaterial.new()
	m.shader = preload("res://shaders/voxel_block.gdshader")
	m.set_shader_parameter("base_color", Color(k[0]))
	m.set_shader_parameter("alt_color", Color(k[1]))
	m.set_shader_parameter("moss", k[2])
	m.set_shader_parameter("roughness_v", k[3])
	m.set_shader_parameter("metallic_v", k[4])
	if kind == "hazard":
		m.set_shader_parameter("stripes", 1.0)
		m.set_shader_parameter("alt_amount", 0.0)
	if kind in SLIPPERY_KINDS:
		_slippery[m] = true
	_mats[kind] = m
	return m


func mat_color(c: Color, moss: float = 0.0, metal: float = 0.0) -> ShaderMaterial:
	var key := "c_%s_%.2f_%.2f" % [c.to_html(false), moss, metal]
	if _mats.has(key):
		return _mats[key]
	var m := ShaderMaterial.new()
	m.shader = preload("res://shaders/voxel_block.gdshader")
	m.set_shader_parameter("base_color", c)
	m.set_shader_parameter("alt_color", c.darkened(0.12))
	m.set_shader_parameter("moss", moss)
	m.set_shader_parameter("roughness_v", 0.45 if metal > 0.0 else 0.85)
	m.set_shader_parameter("metallic_v", metal)
	if metal > 0.0:
		_slippery[m] = true
	_mats[key] = m
	return m


func mat_emit(c: Color, energy: float = 2.0, alpha: float = 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(c.r, c.g, c.b, alpha)
	m.emission_enabled = true
	m.emission = c
	m.emission_energy_multiplier = energy
	m.roughness = 0.1
	if alpha < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


# ================================================================ geometry helpers
func box(c: Vector3, size: Vector3, material: Material, collide: bool = true, parent: Node = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = material
	mi.position = c
	(parent if parent else self).add_child(mi)
	if collide:
		var sb := StaticBody3D.new()
		sb.collision_layer = 1
		if _slippery.has(material):
			sb.set_meta("slippery", true)
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		sb.add_child(cs)
		mi.add_child(sb)
	return mi


## Axis-aligned slab from two corners.
func slab(x0: float, y0: float, z0: float, x1: float, y1: float, z1: float, kind: String, collide: bool = true) -> MeshInstance3D:
	var size := Vector3(absf(x1 - x0), absf(y1 - y0), absf(z1 - z0))
	var c := Vector3((x0 + x1) * 0.5, (y0 + y1) * 0.5, (z0 + z1) * 0.5)
	return box(c, size, mat(kind), collide)


## Floating island rock underside, tapering down into the fog.
func island(x0: float, z0: float, x1: float, z1: float, y_top: float, depth: float = 9.0) -> void:
	var cx := (x0 + x1) * 0.5
	var cz := (z0 + z1) * 0.5
	var w := absf(x1 - x0)
	var d := absf(z1 - z0)
	var y := y_top
	var layers := int(depth / 1.5)
	for i in layers:
		var k := 1.0 - float(i + 1) / float(layers + 1)
		var lw := w * (0.35 + 0.65 * k) * rng.randf_range(0.85, 1.0)
		var ld := d * (0.35 + 0.65 * k) * rng.randf_range(0.85, 1.0)
		var h := rng.randf_range(1.2, 1.9)
		var ox := rng.randf_range(-0.8, 0.8) * (1.0 - k)
		var oz := rng.randf_range(-0.8, 0.8) * (1.0 - k)
		box(Vector3(cx + ox, y - h * 0.5, cz + oz), Vector3(lw, h, ld), mat("rock" if i > 0 else "dirt"), false)
		# little chunks sticking out for a voxel cliff silhouette
		for j in 3:
			var sx := rng.randf_range(-0.5, 0.5) * lw
			var sz := rng.randf_range(-0.5, 0.5) * ld
			box(Vector3(cx + ox + sx, y - h * rng.randf_range(0.3, 0.9), cz + oz + sz), Vector3(rng.randf_range(0.8, 2.0), rng.randf_range(0.6, 1.4), rng.randf_range(0.8, 2.0)), mat("rock"), false)
		y -= h
	# roots and vines dangling below
	for i in int(6 * _density()):
		var p := Vector3(cx + rng.randf_range(-w * 0.35, w * 0.35), y_top - rng.randf_range(1.0, 3.0), cz + rng.randf_range(-d * 0.35, d * 0.35))
		hanging_vine(p, rng.randf_range(2.0, 5.0), false)


func _density() -> float:
	return clampf(float(Game.settings.foliage_density), 0.2, 1.0)


# ================================================================ plants (voxel, wind-swayed)
static var _tuft_meshes: Array = []


func _plant_meshes() -> Array:
	if not _tuft_meshes.is_empty():
		return _tuft_meshes
	var r := RandomNumberGenerator.new()
	r.seed = 99
	var defs := [
		["grass", Color("6a9a3a"), Color("8ab04a")],
		["grass", Color("5a8a34"), Color("7aa040")],
		["lupine", Color("9a7ad8"), Color("6a9a3a")],
		["lupine", Color("e88ab0"), Color("6a9a3a")],
		["wheat", Color("d8b060"), Color("b89040")],
		["daisy", Color("f2f0e8"), Color("6a9a3a")],
		["fern", Color("5a9a3a"), Color("4a8030")],
		["poppy", Color("e86a4a"), Color("6a9a3a")],
	]
	for dd in defs:
		var v := {}
		var kind: String = dd[0]
		var c1: Color = dd[1]
		var c2: Color = dd[2]
		match kind:
			"grass":
				for b in 6:
					var bx := r.randi_range(-2, 2)
					var bz := r.randi_range(-2, 2)
					var h := r.randi_range(3, 7)
					for y in h:
						v[Vector3i(bx + (1 if y > h - 2 and b % 2 == 0 else 0), y, bz)] = c1.lerp(c2, float(y) / h)
			"lupine":
				for y in 4:
					v[Vector3i(0, y, 0)] = c2
				v[Vector3i(1, 1, 0)] = c2
				v[Vector3i(-1, 2, 0)] = c2
				for y in range(4, 10):
					var wv := 1 if y < 8 else 0
					for x in range(-wv, wv + 1):
						for z in range(-wv, wv + 1):
							if (x + z + y) % 2 == 0 or (x == 0 and z == 0):
								v[Vector3i(x, y, z)] = c1.lightened(float(y - 4) * 0.04)
			"wheat":
				for b in 4:
					var bx := r.randi_range(-2, 2)
					var bz := r.randi_range(-2, 2)
					for y in 9:
						v[Vector3i(bx, y, bz)] = c2 if y < 6 else c1
					v[Vector3i(bx + 1, 7, bz)] = c1
			"daisy", "poppy":
				for y in 5:
					v[Vector3i(0, y, 0)] = c2
				for o in [Vector3i(1, 5, 0), Vector3i(-1, 5, 0), Vector3i(0, 5, 1), Vector3i(0, 5, -1)]:
					v[o] = c1
				v[Vector3i(0, 5, 0)] = Color("f2c030") if kind == "daisy" else Color("2a2a2a")
			"fern":
				for a in 5:
					var ang := a / 5.0 * TAU
					for i in 5:
						var p := Vector3i(roundi(cos(ang) * i * 0.8), int(i * 0.9 - (i * i) * 0.12) + 1, roundi(sin(ang) * i * 0.8))
						v[p] = c1.lerp(c2, i / 5.0)
		_tuft_meshes.append(Voxel.build_mesh(v, 0.07, Vector3(-0.5, 0, -0.5) * 0.07, false))
	return _tuft_meshes


## Scatter foliage over a rectangle at height y. kinds = indices into _plant_meshes.
func foliage(x0: float, z0: float, x1: float, z1: float, y: float, count: int, kinds: Array = [0, 1]) -> Node3D:
	var holder := Node3D.new()
	holder.position = Vector3(0, y, 0)
	add_child(holder)
	var meshes := _plant_meshes()
	var n := int(count * _density())
	var per := {}
	for i in n:
		var k: int = kinds[rng.randi() % kinds.size()]
		if not per.has(k):
			per[k] = []
		per[k].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.45, 0.9)),
			Vector3(rng.randf_range(x0, x1), 0.0, rng.randf_range(z0, z1))))
	for k in per:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = meshes[k]
		var arr: Array = per[k]
		mm.instance_count = arr.size()
		for i in arr.size():
			mm.set_instance_transform(i, arr[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.material_override = Voxel.plant_material()
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		holder.add_child(mmi)
	return holder


## A dangling vine strand made of voxels with leaves and the odd flower.
func hanging_vine(top: Vector3, length: float, flowers: bool = true, wisteria: bool = false) -> MeshInstance3D:
	var v := {}
	var n := int(length / 0.08)
	var x := 0
	var z := 0
	var leaf := Color("5a8a34")
	var leaf2 := Color("7aa844")
	var fl := Color("b490e0") if wisteria else Color("f2a0c0")
	for i in n:
		if rng.randf() < 0.15:
			x += rng.randi_range(-1, 1)
		if rng.randf() < 0.15:
			z += rng.randi_range(-1, 1)
		var y := -i
		v[Vector3i(x, y, z)] = leaf.lerp(leaf2, rng.randf())
		if rng.randf() < 0.4:
			v[Vector3i(x + rng.randi_range(-1, 1), y, z + rng.randi_range(-1, 1))] = leaf2
		if wisteria and i > n * 0.3:
			for xx in range(-1, 2):
				if rng.randf() < 0.6:
					v[Vector3i(x + xx, y, z + 1)] = fl.lightened(rng.randf() * 0.2)
		elif flowers and rng.randf() < 0.05:
			v[Vector3i(x + 1, y, z)] = fl
	var mi := MeshInstance3D.new()
	mi.mesh = Voxel.build_mesh(v, 0.08, Vector3(-0.5, 0, -0.5) * 0.08, false)
	mi.material_override = Voxel.plant_material()
	mi.position = top
	add_child(mi)
	return mi


## A row of hanging vines along an edge.
func vine_curtain(a: Vector3, b: Vector3, count: int, min_len: float, max_len: float, wisteria: bool = false) -> Node3D:
	var holder := Node3D.new()
	holder.position = Vector3(0, maxf(a.y, b.y), 0)
	add_child(holder)
	for i in int(count * _density()):
		var p := a.lerp(b, rng.randf())
		var vm := hanging_vine(p, rng.randf_range(min_len, max_len), true, wisteria and rng.randf() < 0.5)
		vm.reparent(holder, false)
		vm.position -= holder.position
	return holder


func bush(p: Vector3, r: float, col: Color = Color("5a8a34")) -> MeshInstance3D:
	var v := {}
	var n := int(r / 0.1)
	for x in range(-n, n + 1):
		for y in range(0, n + 1):
			for z in range(-n, n + 1):
				var d := Vector3(x, y * 1.3, z).length()
				if d <= n + rng.randf_range(-0.8, 0.4):
					v[Vector3i(x, y, z)] = col.lerp(Color("8ab84a"), rng.randf() * 0.4 + float(y) / n * 0.3)
	var mi := Voxel.mesh_instance(v, 0.1, Vector3(-0.5, 0, -0.5) * 0.1, true)
	mi.position = p
	add_child(mi)
	return mi


func sapling(p: Vector3, h: float) -> Node3D:
	var holder := Node3D.new()
	holder.position = p
	add_child(holder)
	var t := {}
	var n := int(h / 0.1)
	for y in n:
		t[Vector3i(0, y, 0)] = Color("6a4a2e")
	holder.add_child(Voxel.mesh_instance(t, 0.1, Vector3(-0.5, 0, -0.5) * 0.1))
	var b := bush(p + Vector3(0, h * 0.7, 0), h * 0.35)
	b.reparent(holder, false)
	b.position = Vector3(0, h * 0.7, 0)
	return holder


# ================================================================ props (decor)
func car(p: Vector3, rot_y: float, col: Color, collide: bool = true) -> Node3D:
	var n := Node3D.new()
	n.position = p
	n.rotation.y = rot_y
	add_child(n)
	var paint := mat_color(col, 0.25, 0.3)
	box(Vector3(0, 0.55, 0), Vector3(3.6, 0.8, 1.7), paint, collide, n)
	box(Vector3(-0.2, 1.25, 0), Vector3(2.0, 0.6, 1.55), paint, collide, n)
	box(Vector3(-0.2, 1.25, 0), Vector3(2.02, 0.42, 1.45), mat_color(Color("2a3a44"), 0.0, 0.5), false, n)
	for sx in [-1.1, 1.1]:
		for sz in [-0.8, 0.8]:
			box(Vector3(sx, 0.3, sz), Vector3(0.6, 0.6, 0.25), mat_color(Color("222326")), false, n)
	box(Vector3(1.8, 0.65, 0.55), Vector3(0.05, 0.18, 0.3), mat_emit(Color("fff0c0"), 0.3), false, n)
	box(Vector3(1.8, 0.65, -0.55), Vector3(0.05, 0.18, 0.3), mat_emit(Color("fff0c0"), 0.3), false, n)
	return n


func phys(p: Vector3, vox: Dictionary, vsize: float, shape: Shape3D, shape_y: float, mass_kg: float, label: String, rot_y: float = 0.0) -> Props.PhysProp:
	var b := Props.PhysProp.new()
	b.level = self
	b.mass = mass_kg
	b.label = label
	b.position = p
	b.rotation.y = rot_y
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position.y = shape_y
	b.add_child(cs)
	b.add_child(Voxel.mesh_instance(vox, vsize, Vector3(-0.5, 0, -0.5) * vsize))
	add_child(b)
	return b


func cone(p: Vector3) -> Props.PhysProp:
	var v := {}
	for y in 6:
		var r := 2 - int(y / 3)
		for x in range(-r, r + 1):
			for z in range(-r, r + 1):
				v[Vector3i(x, y, z)] = Color("e86a2a") if y != 3 else Color("f2f0e8")
	Voxel.fill_box(v, Vector3i(-3, 0, -3), Vector3i(3, 0, 3), Color("e86a2a"))
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.5, 0.48, 0.5)
	return phys(p, v, 0.08, sh, 0.24, 0.6, "Traffic Cone", rng.randf() * TAU)


func tire(p: Vector3, flat: bool = true) -> Props.PhysProp:
	var v := {}
	for a in 24:
		var ang := a / 24.0 * TAU
		for rr in [3, 4]:
			v[Vector3i(roundi(cos(ang) * rr), 0, roundi(sin(ang) * rr))] = Color("26262a")
			v[Vector3i(roundi(cos(ang) * rr), 1, roundi(sin(ang) * rr))] = Color("2e2e33")
	var sh := CylinderShape3D.new()
	sh.radius = 0.4
	sh.height = 0.18
	var b := phys(p, v, 0.09, sh, 0.09, 2.0, "Old Tire")
	if not flat:
		b.rotation.x = PI / 2
	return b


func can(p: Vector3, col: Color = Color("c84a3a")) -> Props.PhysProp:
	var v := {}
	for y in 4:
		for x in range(-1, 2):
			for z in range(-1, 2):
				v[Vector3i(x, y, z)] = col if y in [1, 2] else Color("b8bcc0")
	var sh := CylinderShape3D.new()
	sh.radius = 0.1
	sh.height = 0.22
	return phys(p, v, 0.06, sh, 0.11, 0.15, "Soda Can")


func bottle(p: Vector3) -> Props.PhysProp:
	var v := {}
	var g := Color("6ab08a")
	for y in 7:
		var r := 1 if y < 4 else 0
		for x in range(-r, r + 1):
			for z in range(-r, r + 1):
				v[Vector3i(x, y, z)] = g.lightened(0.1 * float(y > 4))
	var sh := CylinderShape3D.new()
	sh.radius = 0.08
	sh.height = 0.36
	return phys(p, v, 0.055, sh, 0.18, 0.25, "Glass Bottle")


func bucket(p: Vector3) -> Props.PhysProp:
	var v := {}
	for y in 6:
		for x in range(-3, 4):
			for z in range(-3, 4):
				var edge := maxi(absi(x), absi(z)) == 3
				if y == 0 or edge:
					v[Vector3i(x, y, z)] = Color("3a7ad0") if y < 5 else Color("4a8ae0")
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.5, 0.4, 0.5)
	return phys(p, v, 0.07, sh, 0.2, 0.8, "Bucket")


func flower_pot(p: Vector3) -> Props.PhysProp:
	var v := {}
	for y in 5:
		var r := 2 if y < 4 else 3
		for x in range(-r, r + 1):
			for z in range(-r, r + 1):
				v[Vector3i(x, y, z)] = Color("c87a4a") if y < 4 else Color("b06a3a")
	for i in 9:
		var x := rng.randi_range(-2, 2)
		var z := rng.randi_range(-2, 2)
		var h := rng.randi_range(2, 5)
		for y in h:
			v[Vector3i(x, 5 + y, z)] = Color("5a9a3a")
		v[Vector3i(x, 5 + h, z)] = [Color("f2a0c0"), Color("f2e070"), Color("b490e0")][i % 3]
	var sh := BoxShape3D.new()
	sh.size = Vector3(0.4, 0.34, 0.4)
	return phys(p, v, 0.07, sh, 0.17, 1.2, "Flower Pot")


func barrel(p: Vector3) -> Props.PhysProp:
	var v := {}
	for y in 11:
		for x in range(-4, 5):
			for z in range(-4, 5):
				if x * x + z * z <= 17:
					v[Vector3i(x, y, z)] = Color("4a6a8a") if y % 5 != 0 else Color("3a5a7a")
	var sh := CylinderShape3D.new()
	sh.radius = 0.36
	sh.height = 0.88
	return phys(p, v, 0.08, sh, 0.44, 3.0, "Oil Drum")


## Scatter knockable junk in a rectangle.
func junk(x0: float, z0: float, x1: float, z1: float, y: float, count: int) -> void:
	for i in count:
		var p := Vector3(rng.randf_range(x0, x1), y + 0.02, rng.randf_range(z0, z1))
		match rng.randi() % 5:
			0:
				can(p, [Color("c84a3a"), Color("3a8ac8"), Color("e8c040")][i % 3])
			1:
				bottle(p)
			2:
				bucket(p)
			3:
				flower_pot(p)
			_:
				cone(p)


func streetlight(p: Vector3, rot_y: float, light_col: Color = Color("ffd8a0")) -> void:
	var n := Node3D.new()
	n.position = p
	n.rotation.y = rot_y
	add_child(n)
	box(Vector3(0, 2.0, 0), Vector3(0.16, 4.0, 0.16), mat("metal"), true, n)
	box(Vector3(0.6, 4.0, 0), Vector3(1.3, 0.12, 0.14), mat("metal"), false, n)
	box(Vector3(1.2, 3.9, 0), Vector3(0.4, 0.12, 0.25), mat_emit(light_col, 3.0), false, n)
	var sl := SpotLight3D.new()
	sl.position = Vector3(1.2, 3.8, 0)
	sl.rotation_degrees = Vector3(-90, 0, 0)
	sl.light_color = light_col
	sl.light_energy = 6.0
	sl.spot_range = 7.0
	sl.spot_angle = 38.0
	sl.shadow_enabled = true
	sl.light_volumetric_fog_energy = 2.0
	n.add_child(sl)


func guardrail(a: Vector3, b: Vector3) -> void:
	var d := b - a
	var L := d.length()
	var mid := (a + b) * 0.5
	var ang := atan2(d.x, d.z)
	var n := Node3D.new()
	n.position = mid
	n.rotation.y = ang
	add_child(n)
	box(Vector3(0, 0.55, 0), Vector3(0.08, 0.22, L), mat("metal"), true, n)
	var posts := int(L / 1.5)
	for i in posts + 1:
		box(Vector3(0, 0.3, -L * 0.5 + i * L / maxf(posts, 1)), Vector3(0.1, 0.6, 0.1), mat("metal"), false, n)


func sign_board(p: Vector3, rot_y: float, size: Vector2, col: Color = Color("3a7a52")) -> Node3D:
	var n := Node3D.new()
	n.position = p
	n.rotation.y = rot_y
	add_child(n)
	box(Vector3(0, 0, 0), Vector3(size.x, size.y, 0.08), mat_color(col, 0.15), false, n)
	box(Vector3(0, size.y * 0.1, 0.045), Vector3(size.x * 0.7, 0.06, 0.01), mat_color(Color("f2f2e8")), false, n)
	box(Vector3(-size.x * 0.1, -size.y * 0.15, 0.045), Vector3(size.x * 0.45, 0.06, 0.01), mat_color(Color("f2f2e8")), false, n)
	return n


func crate_stack_decor(p: Vector3) -> void:
	box(p + Vector3(0, 0.35, 0), Vector3(0.7, 0.7, 0.7), mat("wood"), true)


func vending_machine(p: Vector3, rot_y: float) -> void:
	var n := Node3D.new()
	n.position = p
	n.rotation.y = rot_y
	add_child(n)
	box(Vector3(0, 0.95, 0), Vector3(1.1, 1.9, 0.8), mat_color(Color("c84a3a"), 0.2), true, n)
	box(Vector3(-0.1, 1.15, 0.41), Vector3(0.75, 1.1, 0.02), mat_emit(Color("e8f0ff"), 0.6), false, n)


# ================================================================ crystal pond (goal)
func crystal_pond(c: Vector3, r: float = 1.4) -> void:
	_pond_pos = c
	var rim := mat("rock")
	var s := r + 0.4
	box(c + Vector3(0, 0.15, -s), Vector3(s * 2 + 0.4, 0.3, 0.4), rim, true)
	box(c + Vector3(0, 0.15, s), Vector3(s * 2 + 0.4, 0.3, 0.4), rim, true)
	box(c + Vector3(-s, 0.15, 0), Vector3(0.4, 0.3, s * 2), rim, true)
	box(c + Vector3(s, 0.15, 0), Vector3(0.4, 0.3, s * 2), rim, true)
	var w := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(s * 2 - 0.4, s * 2 - 0.4)
	pm.subdivide_depth = 12
	pm.subdivide_width = 12
	w.mesh = pm
	var wm := ShaderMaterial.new()
	wm.shader = preload("res://shaders/water.gdshader")
	w.material_override = wm
	w.position = c + Vector3(0, 0.18, 0)
	add_child(w)
	# crystals
	var cols := [Color("a8f0ff"), Color("f0b8ff"), Color("c8ffe8")]
	for i in 9:
		var ang := i / 9.0 * TAU + rng.randf() * 0.3
		var rr := s + rng.randf_range(0.2, 0.9)
		var h := rng.randf_range(0.6, 1.8)
		var col: Color = cols[i % 3]
		var cm := box(c + Vector3(cos(ang) * rr, h * 0.5, sin(ang) * rr), Vector3(0.3, h, 0.3), mat_emit(col, 1.2, 0.85), false)
		cm.rotation = Vector3(rng.randf_range(-0.3, 0.3), rng.randf() * TAU, rng.randf_range(-0.3, 0.3))
	var l := OmniLight3D.new()
	l.light_color = Color("b8f4ff")
	l.light_energy = 2.0
	l.omni_range = 6.0
	l.position = c + Vector3(0, 1.2, 0)
	l.light_volumetric_fog_energy = 1.5
	add_child(l)
	var sp := CPUParticles3D.new()
	sp.amount = 24
	sp.lifetime = 3.0
	sp.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	sp.emission_box_extents = Vector3(s, 0.1, s)
	sp.direction = Vector3.UP
	sp.spread = 15
	sp.gravity = Vector3(0, 0.3, 0)
	sp.initial_velocity_min = 0.1
	sp.initial_velocity_max = 0.4
	var qm := BoxMesh.new()
	qm.size = Vector3.ONE * 0.05
	qm.material = mat_emit(Color("e8fcff"), 3.0)
	sp.mesh = qm
	sp.position = c + Vector3(0, 0.3, 0)
	add_child(sp)
	var goal := Props.Trigger.new()
	goal.size = Vector3(s * 2 - 0.4, 1.0, s * 2 - 0.4)
	goal.position = c + Vector3(0, 0.5, 0)
	goal.once = true
	goal.on_enter = _on_goal
	add_child(goal)
	var insp := Props.Inspectable.new()
	insp.label = "Crystal Pond"
	insp.text = "Cool, clear and humming softly. Every frog's dream."
	insp.position = c + Vector3(0, 0.4, 0)
	add_child(insp)


## The snack dish on a stand: a nod to frogs that will absolutely not stop trying.
func snack_dish(p: Vector3) -> void:
	box(p + Vector3(0, 0.45, 0), Vector3(0.7, 0.9, 0.7), mat("white"), true)
	var v := {}
	for x in range(-6, 7):
		for z in range(-6, 7):
			var d := sqrt(x * x + z * z)
			if d <= 6.2:
				v[Vector3i(x, 0, z)] = Color("dcdcd8")
			if d > 4.8 and d <= 6.2:
				v[Vector3i(x, 1, z)] = Color("ececE8")
				v[Vector3i(x, 2, z)] = Color("f4f4f0")
			if d <= 4.6 and Voxel.hash3(x, 0, z) > 0.5:
				v[Vector3i(x, 1, z)] = Color("8a5a32").lightened(Voxel.hash3(x, 1, z) * 0.2)
	var mi := Voxel.mesh_instance(v, 0.1, Vector3(-0.5, 0, -0.5) * 0.1)
	mi.position = p + Vector3(0, 0.9, 0)
	add_child(mi)
	box(p + Vector3(0, 1.0, 0), Vector3(1.25, 0.1, 1.25), mat("white"), true)
	var insp := Props.Inspectable.new()
	insp.label = "The Snack Dish"
	insp.text = "Someone keeps putting obstacles around it. The frogs keep evolving. Like, seriously."
	insp.position = p + Vector3(0, 1.1, 0)
	add_child(insp)


# ================================================================ gameplay helpers
func snack(p: Vector3, kind: int = -1) -> void:
	_snack_seq += 1
	var sid := "s%d" % _snack_seq
	snack_total += 1
	var lid: String = def.get("id", "")
	var got: Array = Game.data.collected.get(lid, [])
	if sid in got:
		snack_count += 1
		return
	var s := Props.Snack.new()
	s.level = self
	s.id = sid
	s.kind = kind if kind >= 0 else rng.randi_range(0, 2)
	s.position = p
	add_child(s)


func on_snack(s: Node) -> void:
	snack_count += 1
	var lid: String = def.get("id", "")
	if not Game.data.collected.has(lid):
		Game.data.collected[lid] = []
	Game.data.collected[lid].append(s.id)
	Game.data.snacks_total = int(Game.data.snacks_total) + 1
	snack_changed.emit(snack_count, snack_total)
	if int(Game.data.snacks_total) % 4 == 0:
		var got := Game.unlock_next_frogs(1)
		if not got.is_empty():
			var sp := FrogSpecies.get_species(got[0])
			toast("New frog unlocked: %s (%s)" % [sp.name, sp.region])
	Game.save_game()


func toast(t: String) -> void:
	toast_requested.emit(t)


func seed_pickup(p: Vector3) -> void:
	var s := Props.SeedPickup.new()
	s.level = self
	s.position = p
	add_child(s)


## A soil plot at `p` whose vine climbs a wall up to `top_y`. `face` points from the wall to the frog.
func soil(p: Vector3, top: float, face: Vector3) -> Props.SoilPlot:
	var s := Props.SoilPlot.new()
	s.level = self
	s.position = p
	s.grow_height = top - p.y
	s.wall_normal = face
	add_child(s)
	return s


func grow_vine(s: Props.SoilPlot) -> void:
	var base := s.global_position
	var h := s.grow_height
	var face := s.wall_normal.normalized()
	var side := Vector3(face.z, 0, -face.x)
	# climb zone hugging the wall
	var cz := Props.ClimbZone.new()
	var zone_center := base - face * 0.05 + Vector3(0, h * 0.5 + 0.4, 0)
	var thick := 1.0
	cz.size = Vector3(absf(side.x) * 1.5 + absf(face.x) * thick, h + 1.0, absf(side.z) * 1.5 + absf(face.z) * thick)
	cz.position = zone_center
	add_child(cz)
	# visual: strands growing up the wall, revealed bottom-to-top
	var holder := Node3D.new()
	holder.position = base - face * 0.42
	add_child(holder)
	for i in 5:
		var off := side * (i - 2) * 0.28
		var v := {}
		var n := int(h / 0.08) + 4
		var wob := 0
		for y in n:
			if rng.randf() < 0.2:
				wob = clampi(wob + rng.randi_range(-1, 1), -1, 1)
			v[Vector3i(wob, y, 0)] = Color("4a8a2e").lerp(Color("7ab844"), rng.randf())
			if rng.randf() < 0.35:
				v[Vector3i(wob + rng.randi_range(-1, 1), y, 1)] = Color("6aa83a")
			if rng.randf() < 0.04:
				v[Vector3i(wob, y, 1)] = Color("f2c8e8")
		var mi := MeshInstance3D.new()
		mi.mesh = Voxel.build_mesh(v, 0.08, Vector3.ZERO, false)
		mi.material_override = Voxel.plant_material()
		mi.position = off
		mi.rotation.y = atan2(face.x, face.z)
		mi.scale = Vector3(1, 0.001, 1)
		holder.add_child(mi)
		var tw := create_tween()
		tw.tween_interval(i * 0.12)
		tw.tween_property(mi, "scale:y", 1.0, 2.2).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	# leaves sprout around the base
	var f := foliage(base.x - 0.6, base.z - 0.6, base.x + 0.6, base.z + 0.6, base.y, 10, [0, 6])
	f.scale = Vector3(1, 0.01, 1)
	create_tween().tween_property(f, "scale:y", 1.0, 1.0)
	toast("The vine grew! Walk into it to climb with sticky toes.")


func crate(p: Vector3) -> Props.Crate:
	var c := Props.Crate.new()
	c.level = self
	c.position = p
	add_child(c)
	var v := {}
	for x in range(-5, 6):
		for y in range(-5, 6):
			for z in range(-5, 6):
				var edge := int(absi(x) == 5) + int(absi(y) == 5) + int(absi(z) == 5)
				if edge >= 1:
					var col := Color("9a7448") if edge >= 2 or (absi(x) == absi(y) and absi(z) == 5) else Color("b88a58")
					v[Vector3i(x, y, z)] = col.lightened(Voxel.hash3(x, y, z) * 0.08)
	var mi := Voxel.mesh_instance(v, 0.088, Vector3(-0.5, -0.5, -0.5) * 0.088)
	c.add_child(mi)
	_crates.append({"node": c, "home": p})
	var insp := Props.Inspectable.new()
	insp.label = "Heavy Crate"
	insp.text = "Hop into it to push. Heavy enough to hold down a plate."
	c.add_child(insp)
	return c


func reset_crate(c: Node3D) -> void:
	for e in _crates:
		if e.node == c:
			(c as RigidBody3D).linear_velocity = Vector3.ZERO
			c.global_position = e.home + Vector3(0, 0.5, 0)


func plate(p: Vector3, targets: Array) -> Props.PressurePlate:
	var pp := Props.PressurePlate.new()
	pp.level = self
	pp.targets = targets
	pp.position = p
	add_child(pp)
	return pp


func mover(from: Transform3D, to: Transform3D, duration: float = 1.6) -> Props.Mover:
	var m := Props.Mover.new()
	m.level = self
	m.from_xf = from
	m.to_xf = to
	m.duration = duration
	m.collision_layer = 1
	add_child(m)
	return m


## Adds a box mesh + collider as child of a body (Mover/Rotator).
func body_box(body: Node3D, c: Vector3, size: Vector3, material: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = material
	mi.position = c
	body.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	cs.position = c
	body.add_child(cs)
	if _slippery.has(material):
		body.set_meta("slippery", true)
	return mi


func valve(p: Vector3, rot_y: float, targets: Array, parent: Node = null) -> Props.Valve:
	var v := Props.Valve.new()
	v.level = self
	v.targets = targets
	v.position = p
	v.rotation.y = rot_y
	(parent if parent else self).add_child(v)
	return v


func rotator(p: Vector3, start_deg: float) -> Props.Rotator:
	var r := Props.Rotator.new()
	r.level = self
	r.position = p
	r.rotation.y = deg_to_rad(start_deg)
	r.collision_layer = 1
	add_child(r)
	return r


func inspect(p: Vector3, label: String, text: String) -> void:
	var i := Props.Inspectable.new()
	i.label = label
	i.text = text
	i.position = p
	add_child(i)


func checkpoint(p: Vector3) -> void:
	var v := {}
	for x in range(-4, 5):
		for z in range(-4, 5):
			if x * x + z * z <= 17 and not (x > 0 and absi(z) <= 0):
				v[Vector3i(x, 0, z)] = Color("5a9a3a").lerp(Color("7ab84a"), Voxel.hash3(x, 0, z))
	v[Vector3i(-2, 1, -1)] = Color("f2b8d0")
	v[Vector3i(-2, 2, -1)] = Color("f8d8e8")
	var mi := Voxel.mesh_instance(v, 0.09, Vector3(-0.5, 0, -0.5) * 0.09)
	mi.position = p + Vector3(0, 0.01, 0)
	add_child(mi)
	var t := Props.Trigger.new()
	t.size = Vector3(1.0, 1.0, 1.0)
	t.position = p + Vector3(0, 0.5, 0)
	t.on_enter = func(b: Node3D) -> void:
		var pf := b as PlayerFrog
		if pf.respawn_point.distance_to(p) > 0.5:
			pf.respawn_point = p
			Sfx.play_at("plop", p, -8.0, 1.3)
	add_child(t)


func kill_zone(c: Vector3, size: Vector3) -> void:
	var t := Props.Trigger.new()
	t.size = size
	t.position = c
	t.on_enter = func(b: Node3D) -> void: (b as PlayerFrog).respawn()
	add_child(t)


func crow(p: Vector3) -> void:
	var c := Props.Crow.new()
	c.position = p
	add_child(c)


func npc(p: Vector3, species_index: int = -1) -> Props.NPCFrog:
	var f := Props.NPCFrog.new()
	var si := species_index if species_index >= 0 else rng.randi_range(0, FrogSpecies.count() - 1)
	f.species = FrogSpecies.get_species(si)
	f.position = p
	add_child(f)
	npcs.append(f)
	return f


func buddy(p: Vector3, species_index: int) -> Props.Buddy:
	var b := Props.Buddy.new()
	b.species = FrogSpecies.get_species(species_index)
	b.level = self
	b.position = p
	add_child(b)
	npcs.append(b)
	return b


## Nodes that appear (grow in) once the player has climbed above `at` height.
func grows(node: Node3D, at: float) -> void:
	var s := node.scale
	node.scale = Vector3(s.x, 0.001, s.z)
	node.visible = false
	_growth.append({"node": node, "at": at, "done": false, "scale": s})


# ================================================================ runtime
func attach_player(p: PlayerFrog) -> void:
	player = p
	p.level = self
	p.respawn_point = spawn
	p.croaked.connect(_on_croak)
	for n in npcs:
		n.player = p
	for c in get_children():
		if c is Props.Crow:
			(c as Props.Crow).player = p


func _on_croak(pos: Vector3) -> void:
	for n in npcs:
		if is_instance_valid(n):
			n.hear_croak(pos)


func progress() -> float:
	if player == null:
		return 0.0
	return clampf((player.max_height - spawn.y) / maxf(1.0, top_y - spawn.y), 0.0, 1.0)


func _process(_d: float) -> void:
	if player == null:
		return
	var h := player.max_height
	for g in _growth:
		if not g.done and h >= g.at:
			g.done = true
			var n: Node3D = g.node
			n.visible = true
			var tw := create_tween()
			tw.tween_property(n, "scale", g.scale, 1.6).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
			Sfx.play_at("grow", n.global_position, -10.0, randf_range(0.9, 1.15))
	if _pond_pos != Vector3.ZERO:
		Sfx.set_water_proximity(1.0 - player.global_position.distance_to(_pond_pos) / 12.0)


func _on_goal(b: Node3D) -> void:
	if is_complete:
		return
	is_complete = true
	Sfx.play("splash", 0.0)
	for n in npcs:
		if is_instance_valid(n) and n.has_method("celebrate"):
			n.celebrate()
	completed.emit()
