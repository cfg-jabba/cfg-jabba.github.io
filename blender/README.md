# Marble Allstars Tools for Blender

A Blender add-on for testing Marble Allstars levels without leaving Blender.
Three tools live in one sidebar tab (**3D View > press N > Marble**):

| Tool | What it does |
| --- | --- |
| **Drop Tester** | Place the spawn, drop one or more rigid-body marbles (optionally with a launch speed), watch them on the timeline and see a traced curve of where each one went, plus a text report (max speed, distance, fell / finished / stopped). |
| **Playtest** | Drive a marble around the level inside the viewport with WASD + mouse. A fixed-step physics loop that mirrors the game's `player.gd` (input force and cap, coast damping, jump momentum bonus, coyote time, jump buffer, landing-only bounce, ramp momentum, downhill boost), third-person camera like the game's rig, timer / finish / fall boxes, checkpoints, recorded route. |
| **Level Design** | Godot-named game boxes (`spawnbox`, `timer-box`, `finish-box`, `fall-box`), jump-arc preview, "how fast do I need to launch to reach that spot" solver, ramp slope / speed-gained read-out, level stats, and **Sync from Godot Project** which reads the physics numbers straight out of `player.gd`, `player.tscn` and `camera_rig.gd`. |

Download: **[dist/marble_allstars_tools-0.2.0.zip](dist/marble_allstars_tools-0.2.0.zip)**
(also served at <https://cfg-jabba.github.io/blender/> once this branch is merged).

**New here? Read [TUTORIAL.md](TUTORIAL.md)** – a ten-minute walk-through of one level, from
spawn to "plays like the game". The panel's Quick Start section has the short version.

Blender 4.0 or newer. Tested headlessly against Blender 4.2 LTS.

## Install

1. Download the zip above (do not unzip it).
2. Blender > **Edit > Preferences > Add-ons > Install...** and pick the zip.
   On Blender 4.2+ use the drop-down arrow in the top right > **Install from Disk**.
3. Tick **Marble Allstars Tools**.
4. Press **N** in the 3D viewport and open the **Marble** tab.

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

The viewport header shows speed, elapsed time, deaths, ground/air state and checkpoint /
finish messages while playing.

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
    level_tools.py         game boxes, markers, arcs, solver, ramp info, stats, Godot sync
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
