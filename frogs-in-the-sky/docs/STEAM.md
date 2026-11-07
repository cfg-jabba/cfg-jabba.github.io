# Shipping on Steam

1. **Steamworks**: pay the Steam Direct fee, create the app and note the **App ID**.
2. **Steam API (achievements, cloud saves, overlay)**: add [GodotSteam](https://godotsteam.com) as a GDExtension.
   - Add an autoload that calls `Steam.steamInitEx()`. Put `steam_appid.txt` next to the executable for local testing only.
   - Good first achievements: *First Pond*, *Snack Goblin* (all snacks in a level), *Friend of Frogs* (croak back and forth), *Frog Book 25/50/100*.
   - **Steam Cloud**: point Auto-Cloud at `user://save.cfg` and `user://settings.cfg`. On Windows, `user://` is `%APPDATA%/Godot/app_userdata/Frogs in the Sky`.
3. **Export**: `export_presets.cfg` has Windows, Linux (Steam Deck) and macOS presets. Install the Godot 4.3 export templates, then:
   `godot --headless --export-release "Windows Desktop (Steam)"`
4. **Steam Deck**: controller glyphs switch automatically. Default to the *High* preset at 1280x800 with FSR 2 at a 0.75 render scale.
5. **Upload**: use SteamPipe with ContentBuilder, with one depot per OS.
6. **Store page**: capsule art from the title screen (orbit camera) and the 10 frog lineup. Tags: *Relaxing, Cozy, Puzzle Platformer, Voxel, Cute, Nature*.
