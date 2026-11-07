class_name Voxel
extends RefCounted
## Tiny voxel mesher: hidden-face culling + per-vertex ambient occlusion.
## A voxel at integer position p occupies [p, p+1] * size + origin.

const AXES: Array[Vector3i] = [Vector3i(1, 0, 0), Vector3i(0, 1, 0), Vector3i(0, 0, 1)]
const CORNERS: Array[Vector2i] = [Vector2i(-1, -1), Vector2i(1, -1), Vector2i(1, 1), Vector2i(-1, 1)]

static var _vc_mat: StandardMaterial3D
static var _plant_mat: ShaderMaterial


static func vertex_material() -> StandardMaterial3D:
	if _vc_mat == null:
		_vc_mat = StandardMaterial3D.new()
		_vc_mat.vertex_color_use_as_albedo = true
		_vc_mat.vertex_color_is_srgb = true
		_vc_mat.roughness = 0.72
		_vc_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
		_vc_mat.diffuse_mode = BaseMaterial3D.DIFFUSE_BURLEY
		_vc_mat.rim_enabled = true
		_vc_mat.rim = 0.25
		_vc_mat.rim_tint = 0.6
	return _vc_mat


static func plant_material() -> ShaderMaterial:
	if _plant_mat == null:
		_plant_mat = ShaderMaterial.new()
		_plant_mat.shader = load("res://shaders/plant.gdshader")
	return _plant_mat


static func build_mesh(vox: Dictionary, vsize: float, origin: Vector3 = Vector3.ZERO, ao: bool = true) -> ArrayMesh:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var half := Vector3(0.5, 0.5, 0.5)
	for key in vox:
		var p: Vector3i = key
		var c: Color = vox[key]
		for a in 3:
			for si in 2:
				var s := -1 if si == 0 else 1
				var n: Vector3i = AXES[a] * s
				if vox.has(p + n):
					continue
				var u: Vector3i = AXES[(a + 1) % 3]
				var v: Vector3i = AXES[(a + 2) % 3]
				var center := Vector3(p) + half + Vector3(n) * 0.5
				var pts: Array[Vector3] = []
				var shade: Array[float] = []
				for cr in CORNERS:
					pts.append(center + Vector3(u) * 0.5 * cr.x + Vector3(v) * 0.5 * cr.y)
					var sh := 1.0
					if ao:
						var o: Vector3i = p + n
						var s1 := vox.has(o + u * cr.x)
						var s2 := vox.has(o + v * cr.y)
						var cc := vox.has(o + u * cr.x + v * cr.y)
						var occ := 3 if (s1 and s2) else int(s1) + int(s2) + int(cc)
						sh = 1.0 - occ * 0.13
					shade.append(sh)
				for idx in [0, 1, 2, 0, 2, 3]:
					verts.append(pts[idx] * vsize + origin)
					norms.append(Vector3(n))
					var k: float = shade[idx]
					cols.append(Color(c.r * k, c.g * k, c.b * k, c.a))
	var mesh := ArrayMesh.new()
	if verts.is_empty():
		return mesh
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_COLOR] = cols
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return mesh


static func fill_box(vox: Dictionary, from: Vector3i, to: Vector3i, col: Color) -> void:
	for x in range(mini(from.x, to.x), maxi(from.x, to.x) + 1):
		for y in range(mini(from.y, to.y), maxi(from.y, to.y) + 1):
			for z in range(mini(from.z, to.z), maxi(from.z, to.z) + 1):
				vox[Vector3i(x, y, z)] = col


static func jitter(c: Color, amount: float, h: float) -> Color:
	var k := 1.0 + (h - 0.5) * 2.0 * amount
	return Color(clampf(c.r * k, 0, 1), clampf(c.g * k, 0, 1), clampf(c.b * k, 0, 1), c.a)


static func hash3(x: int, y: int, z: int, seed_v: int = 0) -> float:
	var h := (x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ (seed_v * 2654435761)
	h = (h ^ (h >> 13)) * 1274126177
	h = h ^ (h >> 16)
	return float(h & 0xFFFF) / 65535.0


static func mesh_instance(vox: Dictionary, vsize: float, origin: Vector3 = Vector3.ZERO, plant := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = build_mesh(vox, vsize, origin)
	mi.material_override = plant_material() if plant else vertex_material()
	return mi
