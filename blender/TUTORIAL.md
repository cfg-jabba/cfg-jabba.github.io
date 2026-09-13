# Marble Allstars Tools – Tutorial

This walks through one level from blockout to "it plays like the game". Ten minutes.
Every button lives in the 3D viewport sidebar: press **N**, open the **Marble** tab.

The panel also has a **Quick Start** section with the short version of this page.

---

## 0. Install (once)

1. Download `marble_allstars_tools-<version>.zip`. Do not unzip it.
2. Blender > **Edit > Preferences > Add-ons** > the small arrow in the top right >
   **Install from Disk** (Blender 4.0/4.1: the **Install...** button). Pick the zip.
3. Tick **Marble Allstars Tools**.
4. In the 3D viewport press **N** and click the **Marble** tab.

The add-on never writes to your disk except when you click Export. Rigid body caches live in
memory and are capped by *Sim Frames*.

---

## 1. Build the level

Model as usual. Two rules that keep physics honest:

* **Apply scale** (`Ctrl+A > Scale`) on every level mesh. Unapplied or negative scale is the
  number one cause of a marble sinking through a floor. **Level Stats** warns about it.
* Keep the level in its own collection if the scene has other stuff, and pick it as
  **Level Collection** at the top of the panel. Otherwise every visible mesh counts as level.

Set **Marble Radius** and **Mass** if the game changes (they default to the game's 0.5 m and
1.85 kg).

---

## 2. Place the spawn

1. Put the 3D cursor on the floor where the run starts (`Shift + right-click`).
2. Click **Spawn > At Cursor**.

An empty called `spawnbox` appears, lifted one marble radius so the ball sits on the floor.
Its **origin is the marble centre**, exactly how the game reads it. Its **green Y arrow is the
launch direction** used by the drop tester and the jump arc. Rotate it with `R` to aim.

`At Active` snaps the spawn to whatever object is selected instead.

---

## 3. Add the game boxes

Open **Level Design > Game Boxes**. These create empties named the way the game's
`level_controller.gd` looks for them, so they survive export to Godot unchanged:

| Button | Object | What the game does with it |
| --- | --- | --- |
| Spawn | `spawnbox` | player start |
| Timer | `timer-box` | the run clock starts when the marble enters |
| Finish | `finish-box` | entering it ends the run |
| Fall | `fall-box` | respawn zone; auto-sized as a slab under the whole level |

Timer and Finish boxes are placed at the 3D cursor, `Box Size` metres on a side. Scale them
with `S` to taste: Godot reads the zone size as **scale x 2**, and the add-on uses the same
rule. Clicking a box button again **moves** the existing box instead of adding a second one.

Fall places itself: it sizes to the level bounds plus a margin and sits 10 m below the lowest
geometry. Check it with **Level Stats**, which lists which boxes exist.

---

## 4. Drop test

**Drop Tester > Drop Marble**.

A real Bullet rigid-body marble (same mass, friction, bounce and gravity as the game) drops
from the spawn, the timeline plays, and a curve is drawn along its path. The box under the
button reports:

* whether it **finished** (touched `finish-box`), **fell** (`fall-box` or Kill Z) or **stopped**
* max speed, distance travelled and where it ended

Useful variations:

* **Launch Speed** shoots it along the spawn's Y arrow. Solve Launch Speed (below) fills this.
* **Marbles = 5, Spread = 4** drops a row across a ramp to see which lanes make the jump.
* **Keep Previous** keeps old paths so you can compare two ramp angles.
* **Substeps** up if a fast marble clips through thin geometry.

**Clear Drops** removes marbles and paths. Tick *Also remove auto rigid bodies* in the redo
panel (bottom left) to strip the passive rigid bodies the add-on added to your meshes.

The drop tester uses Blender's Bullet solver, not Godot's Jolt, so treat it as "roughly
where does the ball go". For feel, use play mode.

---

## 5. Play it

**Playtest > Play Level**, then move the mouse over the viewport.

| Key | Action |
| --- | --- |
| W A S D / arrows | move, relative to the camera |
| Space | jump. Hold to bunny-hop. Tap just before landing and it fires on touchdown |
| Mouse | look. `M` toggles mouse look, `Q` / `E` rotate without the mouse |
| Page Up / Down | camera pitch |
| Wheel | camera distance |
| R | respawn and reset the timer |
| Esc / right mouse | stop |

The viewport header shows speed, elapsed time, deaths and ground / air state. Checkpoints,
the timer box and the finish box all work. When you stop, the route is left as a curve
(`Play Path`) and the result box shows time, deaths, max speed and longest air time.

The physics follows `player.gd`: input force capped at MAX_SPEED on the ground, weaker in the
air; ground damping that fades above the cap so ramp speed coasts; jump impulse plus the
momentum bonus, coyote time and the input buffer; bounce only on airborne landings; ramp
momentum that re-aims speed along a changed floor instead of losing it; downhill boost.
Wall rides, slides and grind rails are not simulated.

Expand **Physics (matches player.gd)** to tweak anything. Every field's tooltip names the
game constant it comes from.

---

## 6. Design jumps with numbers

1. Rotate the spawn so its Y arrow points along the ramp you are testing.
2. Click **Markers > Target** with the cursor where the marble should land.
3. **Solve Launch Speed** prints the exact speed needed and draws the arc.
4. **Ramp Info** on the ramp mesh (select faces in Edit Mode for just the ramp surface) tells
   you the slope and how much speed a marble gains rolling down a given height.
5. **Drop Marble** with that launch speed to confirm it with the rigid body.

**Preview Jump Arc** draws the flight for any *Arc Speed* and reports flight time, distance,
height change and apex, plus how far it misses the target.

---

## 7. Keep the physics in sync with the game

**Level Design > Sync from Godot Project** and pick the game's `project.godot`. The add-on
reads:

* `project.godot` – gravity and physics tick rate (defaults 9.8 and 60 when not overridden)
* `player.tscn` – mass, gravity scale, friction, bounce, sphere radius
* `player.gd` – ROLL_FORCE, MAX_SPEED, JUMP_IMPULSE and the rest of the constants
* `camera_rig.gd` – camera distance, pitch, sensitivity, follow rate

and converts them (force / mass, impulse / mass, per-frame drag to per-second). Do this after
anyone touches the marble code and the playtest keeps matching the game.

**Export / Import** save every setting as JSON if you want to hand tuned numbers to someone.

---

## 8. Send it to Godot

Nothing extra is needed: the spawn and boxes are plain empties with the names the game wires,
and the add-on's own objects (`Marble (drop)`, paths, arcs) live in the `Marble Tools`
collection so you can hide or delete that collection before export.

---

## Troubleshooting

* **Marble falls through the floor** – apply scale on the mesh, check for flipped normals,
  raise *Substeps*.
* **Play Level button is greyed out** – you are already playing (Esc in the viewport) or the
  mouse is not over a 3D viewport.
* **Ball starts half-buried** – the spawn's origin is the marble centre; use *At Cursor* which
  lifts it automatically, or move the empty up by one radius.
* **Old numbers in an old .blend** – settings are stored per file. Pick the *Marble Allstars*
  preset and click the arrow next to it, or run Sync from Godot Project.
