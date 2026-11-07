extends Node
## Renders screenshots (needs a display; uses the Compatibility renderer under Xvfb).
var main: Node
var out := OS.get_environment("SHOT_DIR")

func snap(name: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(out.path_join(name + ".png"))
	print("shot ", name)

func frames(n: int) -> void:
	for i in n:
		await get_tree().process_frame

func _ready() -> void:
	Game.save_path = "user://test_save.cfg"
	get_window().size = Vector2i(1600, 900)
	Game.settings.window_mode = "windowed"
	main = load("res://scripts/main.gd").new()
	add_child(main)
	await frames(120)
	await snap("01_title")
	for i in 3:
		main.start_level(i)
		await frames(60)
		main.rig.yaw = [0.9, 0.6, 0.7][i]
		await frames(180)
		await snap("%02d_level%d_start" % [i * 3 + 2, i + 1])
		main.player.global_position = main.level.spawn.lerp(main.level.center, 0.0)
		main.rig.orbit_mode = true
		main.rig.orbit_dist = 22.0
		main.ui.set_hud_visible(false)
		await frames(200)
		await snap("%02d_level%d_overview" % [i * 3 + 3, i + 1])
		main.rig.orbit_mode = false
		main.ui.set_hud_visible(true)
	# frog lineup
	main.start_level(0)
	await frames(60)
	var row := Node3D.new()
	main.world.add_child(row)
	var picks := [0, 1, 2, 4, 6, 9, 10, 21, 33, 99]
	for k in picks.size():
		var f := FrogModel.create(FrogSpecies.get_species(picks[k]), 1.0)
		f.position = Vector3(-6 + (k % 5) * 0.9, 0.0 + 0.0, 5.0 - (k / 5) * 1.0)
		f.rotation.y = 0.3
		row.add_child(f)
	main.player.visible = false
	main.rig.target = row
	main.rig.focus_point = Vector3(-4.2, 0.4, 4.6)
	main.rig.yaw = 0.15
	main.rig.pitch = -0.35
	main.ui.set_hud_visible(false)
	await frames(200)
	await snap("10_frogs")
	get_tree().quit()
