# Playtesting Frogs in the Sky 🐸

Two ways to play. **Option A** needs no installs.

## Option A: download a ready-to-play build (easiest)
1. Go to the repo's **Actions** tab, open the latest **"Frogs in the Sky builds"** run, and scroll to **Artifacts**. You need to be logged into GitHub with access to this repo.
2. Download the build for your computer:
   - **Windows**: `FrogsInTheSky-Windows`. Unzip it and double-click `FrogsInTheSky.exe`.
     - If Windows SmartScreen warns you, click **More info**, then **Run anyway**. The game isn't code-signed yet.
   - **Mac**: `FrogsInTheSky-macOS`. Unzip it, then unzip the inner zip.
     - The first time, right-click the app, choose **Open**, then **Open** again. It's unsigned, so macOS asks once.
   - **Linux / Steam Deck**: `FrogsInTheSky-Linux`. Unzip it, run `chmod +x FrogsInTheSky.x86_64`, then run it.
3. Plug in a controller if you have one. Xbox, PlayStation and Switch Pro controllers all work.

## Option B: run it from the source in Godot (to tinker)
1. Install **Godot 4.3**, the standard build, not .NET: https://godotengine.org/download/archive/4.3-stable/
   - Godot is one program with no installer: unzip it and run it.
2. Get the code:
   - With git: `git clone https://github.com/cfg-jabba/cfg-jabba.github.io.git`, then `git checkout claude/sleepy-cannon-1vtdgq`.
   - Without git: on GitHub, switch to that branch, then click **Code** and **Download ZIP**.
3. In Godot's Project Manager, click **Import** and select `frogs-in-the-sky/project.godot`, then **Import & Edit**.
   - The first open takes a minute while Godot imports the sounds.
4. Press **F5**, or the ▶ button at the top right.

## If it runs slowly
Open **Settings > Graphics** and pick the **High** or **Medium** preset. Ultra turns on global illumination (SDFGI) and volumetric fog, which need a decent GPU. On laptops, try **Render scale 0.75** with **AMD FSR 2.2**.

If it won't start at all, your GPU may not support Vulkan. Start it in compatibility mode:
- Windows: `FrogsInTheSky.exe --rendering-driver opengl3`
- Mac or Linux: `./FrogsInTheSky.x86_64 --rendering-driver opengl3`

## Controls
| | Keyboard / Mouse | Controller |
|---|---|---|
| Move / camera | WASD / mouse | Left / right stick |
| Hop (hold for higher) | Space | A |
| Tongue | F / left click | X |
| Interact | E | Y |
| Croak | C | B |
| Focus mode | Tab / Q / right click | LT / LB |
| Pause | Esc | Start |

Walk into brick, concrete or wood to climb with sticky hands. Metal is slippery.

## What to send back
- Where you got stuck or confused (screenshots welcome).
- Anything that felt floaty, slippy or unfair.
- Your FPS and your PC or GPU, plus which preset you used.
- Funny physics moments 🐸

Your progress saves automatically: in `%APPDATA%\Godot\app_userdata\Frogs in the Sky` on Windows, and `~/.local/share/godot/app_userdata/Frogs in the Sky` on Linux.
