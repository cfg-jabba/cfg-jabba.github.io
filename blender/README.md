# Marble Allstars Tools for Blender

A Blender add-on for testing Marble Allstars levels without leaving Blender.
Three tools live in one sidebar tab (**3D View > press N > Marble**):

| Tool | What it does |
| --- | --- |
| **Drop Tester** | Place the spawn, drop one or more rigid-body marbles (optionally with a launch speed), watch them on the timeline and see a traced curve of where each one went, plus a text report (max speed, distance, fell / finished / stopped). |
| **Playtest** | Drive a marble around the level inside the viewport with WASD + mouse. A fixed-step physics loop that mirrors the game's `player.gd` (input force and cap, coast damping, jump momentum bonus, coyote time, jump buffer, landing-only bounce, ramp momentum, downhill boost), third-person camera like the game's rig, timer / finish / fall boxes, checkpoints, recorded route. |
| **Level Design** | Godot-named game boxes (`spawnbox`, `timer-box`, `finish-box`, `fall-box`) and `cosmetic1..N` anchors, jump-arc preview, "how fast do I need to launch to reach that spot" solver, level stats, and **Sync from Godot Project** which reads the physics numbers straight out of `player.gd`, `player.tscn` and `camera_rig.gd`. |
| **Ramp Lab** | Mark a ramp face and the add-on flies the real physics up it at a range of entry speeds, draws every trajectory and reports how far and how high each one throws you. **Marble Limits** measures what the marble can do on flat ground, so you have a number to size gaps and ledges against. |
| **Replays** | Every run you play is saved as a keyframed ghost marble. Press the timeline's play button and watch your attempts back, all racing from the same frame or one after another. |

Download: **[dist/marble_allstars_tools-0.3.0.zip](dist/marble_allstars_tools-0.3.0.zip)**
(also served at <https://cfg-jabba.github.io/blender/> once this branch is merged).

**New here? Read [TUTORIAL.md](TUTORIAL.md)** – a ten-minute walk-through of one level, from
spawn to "plays like the game". The panel's Quick Start section has the short version.

Blender 4.0 or newer. Tested headlessly against Blender 4.2 LTS.

## Install

By hand, about twenty seconds:

1. Download the zip above (do not unzip it).
2. Blender > **Edit > Preferences > Add-ons > Install...** and pick the zip.
   On Blender 4.2+ use the drop-down arrow in the top right > **Install from Disk**.
3. Tick **Marble Allstars Tools**.
4. Press **N** in the 3D viewport and open the **Marble** tab.

Or let a script do it. Put `install_addon.py` and the zip in the same folder, then either:

* **Windows:** close Blender and double-click `install_windows.bat`. It finds `blender.exe`,
  installs the add-on, enables it and saves your preferences.
* **Any OS:** open Blender, go to the **Scripting** workspace, `Text > Open` the
  `install_addon.py` file, and press Run.

The script finds the newest `marble_allstars_tools-*.zip` in Downloads, on the Desktop or beside
itself, removes any older copy of the add-on, installs and enables it. It touches nothing
outside Blender's own add-ons folder.

Nothing is written to disk by the add-on except the settings JSON when you explicitly export it.
Rigid-body caches stay in memory and the simulation length is capped by *Sim Frames*.

## 60-second workflow

1. Model the level as normal meshes. Optionally put them in a collection and pick it as
   **Level Collection** (otherwise every visible mesh counts as level).
2. Set **Marble Radius** to the radius used in the game.
3. Put the 3D cursor on the floor where the marble should start and click **At Cursor**.
   The `spawnbox` empty's **origin is the marble centre** (the game reads it the same way) and
   its **Y arrow is the launch direction**. Rotate it (R) to aim jumps.
4. **Level Design > Game Boxes**: add **Timer**, **Finish** and **Fall**. They are empties with
   the names the game's level controller wires (`timer-box`, `finish-box`, `fall-box`), sized so
   Godot's zone = scale x 2. Fall auto-sizes itself under the whole level.
5. **Drop Marble** – the marble falls from the spawn and the timeline plays.
   Set **Launch Speed** to shoot it along the Y arrow, or **Marbles > 1** to drop a row of
   marbles across the ramp and see which ones make it.
6. **Play Level** – mouse over the viewport, click it, and drive the marble yourself.
   Press **Esc** to stop; the route you drove is left behind as a curve.

## Playtest controls

| Key | Action |
| --- | --- |
| W A S D / arrows | move relative to the camera |
| Space | jump (hold to bunny-hop) |
| Mouse | look around (toggle with **M**) |
| Q / E | rotate camera without the mouse |
| Page Up / Page Down | camera pitch |
| Mouse wheel | camera distance |
| R | respawn at the start and reset the timer |
| Esc / right mouse | stop playing |

The overlay shows speed, elapsed time, deaths, ground/air state and checkpoint / finish
messages while playing.

**If play mode feels heavy**, the Performance block under Playtest has the levers:

* **Fast Draw** (on by default) paints the marble straight into the viewport instead of moving
  a real object. Moving an object tags Blender's dependency graph every frame, which forces a
  full scene re-evaluation sixty times a second - that is what made play mode crawl. Turn it
  off only if you want the marble's own material.
* **Redraw Hz** caps how often the viewport redraws. Physics still runs at Physics Hz, so
  dropping this to 30 halves the drawing cost without changing how the marble behaves.
* **Live Trail** and **HUD** can each be switched off.
* Solid or wireframe shading beats Material Preview by a mile on a big level.

## Replays

Every run is recorded and baked into a ghost marble with a keyframe per frame, so playback is
just Blender's timeline. Under **Playtest > Replays**:

* **Watch Replays** rewinds and starts playback.
* **Race Ghosts** starts every run on the same frame so your attempts run side by side. Turn it
  off and hit **Apply** to lay them out back to back instead.
* Each run is listed with its time; a filled icon means it reached the finish box. The eye
  button solos one run, the X deletes it.
* **Keep Runs** caps how many are kept - the oldest is dropped past that.

Ghosts are ordinary animated objects in the *Marble Runs* collection. Delete the collection and
they are gone.

## Ramp Lab

Select the face of a ramp in Edit Mode (or just make the ramp the active object) and click
**Mark Ramp**. The add-on works out the slope, the up-slope direction and where the ramp ends,
then flies the real play-mode physics up it once per entry speed across the range you set.

You get a trajectory curve per speed and a report like:

```
Max jump 5.4 m across, 0.4 m high
Ramp Jump01 (20 deg)
   8.0 m/s in, 12.7 out:   5.4 m across,  0.4 m up, 0.42 s air
  16.0 m/s in, 12.7 out:   5.4 m across,  0.3 m up, 0.42 s air
```

The exit speed is worth reading: holding forward up a ramp pulls every approach toward Max
Input Speed, so a long ramp often throws you the same distance no matter how fast you arrive.
If you want the approach to matter, make the ramp shorter or steeper.

**Marble Limits** is the companion: it runs the marble on a synthetic flat plane, so the
numbers are the same whatever scene is open.

```
Top speed 12.0 m/s
Standing jump 2.38 m high, 1.00 s air
Running jump 16.7 m across, 3.42 m high, 1.18 s air
```

That is your grammar for gaps and ledges. It also draws the full-speed jump from the spawn so
you can eyeball a gap against it.

## Level design helpers

* **Game Boxes** – Spawn, Timer, Finish, Fall: the zones the game wires by object name.
  Clicking a box button again moves the existing box instead of adding another.
* **Markers** – Checkpoint (respawn point during play) and Jump Target (used by the solver).
  Placed at the 3D cursor; the sphere size is the checkpoint's trigger radius.
* **Preview Jump Arc** – draws the flight path from the spawn along its Y arrow at *Arc Speed*
  using the playtest gravity, stops where the marble would touch the level, and reports
  flight time, horizontal distance, height change and apex. If a Jump Target exists it also
  reports how far the arc misses it.
* **Solve Launch Speed** – computes the exact speed needed to fly from the spawn to the Jump
  Target with the spawn's current angle, writes it into *Arc Speed* and *Launch Speed*, and
  draws the arc. Then hit **Drop Marble** to confirm it with real rigid-body physics.
* **Cosmetic** – drops a `cosmetic1`, `cosmetic2`, ... anchor at the cursor, auto-numbered and
  floated above the floor. The level script spawns a pickup on anything named that way.
* **Dev Tools toggle** – the eye button at the top of the panel hides everything the add-on
  generates, so you can see the level as it will ship. The three small buttons next to it hide
  arcs and paths, boxes and markers, or replays on their own.
* **Ramp Info** – select faces in Edit Mode (or a whole mesh in Object Mode) to get the slope
  angle, downhill heading, height and the speed a marble gains rolling down it from rest.
* **Level Stats** – polygon count, bounds and warnings for unapplied / negative scale and
  non-mesh objects (the usual reasons physics misbehaves).

## Matching the Godot project

The defaults are the game's own numbers, derived from `player.gd`, `player.tscn` and
`camera_rig.gd` (the *Marble Allstars* preset):

| Setting | Game source |
| --- | --- |
| Gravity 19.6 | `default_gravity` 9.8 x `gravity_scale` 2.0 |
| Ground / Air Accel 21.6 / 11.9 | `ROLL_FORCE` 40 / mass 1.85, x `AIR_CONTROL` 0.55 |
| Max Input Speed 12 | `MAX_SPEED` |
| Jump Speed 10.3 + Bonus 4.3 (from 6 over 12 m/s) | `JUMP_IMPULSE` 19 / mass, `JUMP_SPEED_BONUS` 8 / mass, `JUMP_BONUS_MIN/SPAN` |
| Coyote 0.12, Buffer 0.12 | `COYOTE_TIME`, `JUMP_BUFFER` |
| Ground / Coast / Air Damp 0.5 / 0.15 / 0.35 | `GROUND_DAMP`, `COAST_DAMP`, `AIR_DAMP` |
| Air Drag 0.26 per second | `AIR_DRAG` 0.995 per frame |
| Bounce 0.52 on landings only | PhysicsMaterial `bounce`, swapped to 0 while rolling |
| Ramp Momentum 0.985, Flow Limit 0.75 | `RAMP_KEEP`, `FLOW_LIMIT` |
| Downhill Boost 90, Uphill Assist 0.8 from 10 m/s | `SLOPE_BOOST`, `UPHILL_ASSIST`, `ASSIST_MIN_SPEED` |
| Camera 6 m, pitch -30, sensitivity 0.1, follow 10 | `camera_rig.gd` |

Other presets: *Snappy* (heavier falls plus jump cut), *Marble Blast style*, *Godot stock*.

* **Sync from Godot Project** – pick the game's `project.godot`; the add-on reads that file plus
  `player.gd`, `player.tscn` and `camera_rig.gd` next to it, converts forces and impulses by
  mass, and applies everything. Run it whenever the marble code changes.
* **Export / Import** – saves every setting to JSON if you want to hand tuned numbers around.

Not simulated in play mode: wall rides, slides (Shift), grind rails, launch pads.

The rigid-body drop tester uses Blender's Bullet solver, so it will never match Godot's
Jolt/Godot Physics exactly. Use it for "does the ramp launch the marble roughly here" and the
playtest for feel; use the arc solver for exact numbers.

## Repository layout

```
blender/
  marble_allstars_tools/   the add-on package
    __init__.py            bl_info + registration
    props.py               all settings + presets
    utils.py               collections, spawn, level geometry, BVH, curves
    drop_tester.py         rigid-body drop / launch / path tracing
    playtest.py            in-viewport play mode + MarblePhysics
    overlay.py             GPU marble / trail / HUD drawing (why play mode is fast)
    runs.py                replay recording and the keyframed ghosts
    ramp_tools.py          ramp marking, launch sweeps, flat-ground limits
    level_tools.py         game boxes, cosmetics, arcs, solver, stats, Godot sync
    ui.py                  sidebar panels
  TUTORIAL.md              step-by-step walkthrough
  tests/test_headless.py   smoke test (python -m pip install bpy; python tests/test_headless.py)
  tests/demo_level.blend   the level the test builds, for poking at in Blender
  build_zip.py             rebuilds dist/marble_allstars_tools-<version>.zip
```

Run the tests with the `bpy` pip module (`pip install bpy`) or with Blender itself:

```
blender --background --python tests/test_headless.py
```

## Prior art

* [RandomityGuy/blender_mb](https://github.com/RandomityGuy/blender_mb) – Marble Blast
  played inside Blender; the inspiration for the play mode.
* [thearst3rd/godot4-marble-game](https://github.com/thearst3rd/godot4-marble-game) – MIT
  Godot 4 marble game with Marble Blast style movement, handy for comparing feel.
