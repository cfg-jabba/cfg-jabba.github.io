# Marble Allstars Tools for Blender

A Blender add-on for testing Marble Allstars levels without leaving Blender.
Three tools live in one sidebar tab (**3D View > press N > Marble**):

| Tool | What it does |
| --- | --- |
| **Drop Tester** | Place a spawn empty, drop one or more rigid-body marbles (optionally with a launch speed), watch them on the timeline and see a traced curve of where each one went, plus a text report (max speed, distance, fell off / finished / stopped). |
| **Playtest** | Drive a marble around the level inside the viewport with WASD + mouse. Godot-style fixed-step physics written in plain Python, third-person camera, checkpoints, finish timer, kill plane, recorded route. |
| **Level Design** | Jump-arc preview, "how fast do I need to launch to reach that spot" solver, ramp slope / speed-gained read-out, level stats with physics gotchas, checkpoint / finish / target markers, and JSON import/export so the numbers stay in sync with the Godot project. |

Download: **[dist/marble_allstars_tools-0.1.0.zip](dist/marble_allstars_tools-0.1.0.zip)**
(also served at <https://cfg-jabba.github.io/blender/> once this branch is merged).

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
   The spawn empty's **Z arrow points up from the floor** and its **Y arrow is the launch
   direction**. Rotate it (R) to aim jumps.
4. **Drop Marble** – the marble falls from the spawn and the timeline plays.
   Set **Launch Speed** to shoot it along the Y arrow, or **Marbles > 1** to drop a row of
   marbles across the ramp and see which ones make it.
5. **Play Level** – mouse over the viewport, click it, and drive the marble yourself.
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

* **Markers** – Checkpoint (respawn point during play), Finish (stops the timer, also detected
  by the drop tester) and Jump Target (used by the solver). Placed at the 3D cursor; the
  sphere size is the trigger radius.
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

The playtest physics is a deliberately small model so it can be tuned by hand:

| Setting | Meaning |
| --- | --- |
| Gravity | m/s² (Godot `physics/3d/default_gravity`, default 9.8) |
| Ground / Air Accel | acceleration from input while grounded / airborne |
| Max Input Speed | input stops adding speed past this; slopes and gravity still can |
| Jump Speed | vertical speed added by a jump |
| Bounce | restitution on contact (0 = none) |
| Rolling Friction | damping of surface-parallel velocity while grounded |
| Slope Limit | steeper surfaces are walls, not ground |
| Physics Hz / Substeps | tick rate (Godot default 60) and collision substeps |

Three presets are included (Godot default, Marble Blast style, Floaty). To keep numbers in
sync with the real game:

* **Read project.godot** – pulls gravity and the physics tick rate straight from the Godot
  project file.
* **Export / Import** – saves every setting to JSON. Keep that file next to the Godot project;
  whoever tunes the marble in Godot can update it and everyone re-imports it in Blender.

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
    level_tools.py         arcs, solver, ramp info, stats, markers, JSON sync
    ui.py                  sidebar panels
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
