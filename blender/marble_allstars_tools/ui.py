"""Sidebar panels (3D View > N > Marble)."""

import textwrap

import bpy

from . import runs, utils
from .props import get_settings


def draw_result(layout, text, width=38):
    if not text:
        return
    box = layout.box()
    col = box.column(align=True)
    col.scale_y = 0.8
    for line in text.splitlines():
        for part in line.split(" | "):
            for wrapped in textwrap.wrap(part, width=width) or [""]:
                col.label(text=wrapped)


class MarblePanelMixin:
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Marble"


class MARBLE_PT_setup(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Marble Allstars Tools"
    bl_idname = "MARBLE_PT_setup"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout

        row = layout.row(align=True)
        row.prop(s, "show_dev", toggle=True,
                 icon="HIDE_OFF" if s.show_dev else "HIDE_ON")
        sub = row.row(align=True)
        sub.active = s.show_dev
        sub.prop(s, "show_dev_arcs", text="", icon="IPO_EASE_IN_OUT", toggle=True)
        sub.prop(s, "show_dev_boxes", text="", icon="MESH_CUBE", toggle=True)
        sub.prop(s, "show_dev_runs", text="", icon="TRACKING_BACKWARDS", toggle=True)

        if s.is_playing:
            # The sidebar redraws with the viewport while playing, so keep it cheap:
            # no scanning the scene for the spawn sixty times a second.
            box = layout.box()
            box.label(text="Playing - Esc in the viewport to stop", icon="PLAY")
            return

        col = layout.column(align=True)
        col.prop(s, "level_collection")
        row = col.row(align=True)
        row.prop(s, "marble_radius")
        row.prop(s, "marble_mass")
        col.prop(s, "kill_z")
        row = layout.row(align=True)
        row.prop(s, "preset", text="")
        row.operator("marble.apply_preset", text="", icon="IMPORT")

        spawn = utils.find_spawn(context.scene)
        box = layout.box()
        box.label(text="Spawn: " + (spawn.name if spawn else "none yet"), icon="EMPTY_ARROWS")
        row = box.row(align=True)
        row.operator("marble.add_spawn", text="At Cursor", icon="PIVOT_CURSOR")
        row.operator("marble.spawn_from_active", text="At Active", icon="OBJECT_DATA")
        row.operator("marble.select_spawn", text="", icon="RESTRICT_SELECT_OFF")
        box.label(text="Origin = marble centre, Y arrow = launch dir", icon="INFO")


class MARBLE_PT_quickstart(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Quick Start"
    bl_idname = "MARBLE_PT_quickstart"
    bl_parent_id = "MARBLE_PT_setup"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        col = layout.column(align=True)
        col.scale_y = 0.85
        steps = (
            "1. Model the level. Apply scale (Ctrl+A).",
            "2. Put the 3D cursor on the floor at the start,",
            "    click Spawn > At Cursor.",
            "3. Level Design > Game Boxes: add Timer,",
            "    Finish and Fall. Name them for Godot.",
            "4. Drop Tester > Drop Marble to watch a",
            "    rigid-body marble roll from the spawn.",
            "5. Playtest > Play Level, then WASD + Space.",
            "    Esc stops. Your route is left as a curve.",
            "6. Replays: every run is saved as a ghost.",
            "    Watch them back on the timeline.",
            "7. Ramp Lab: mark a ramp face to see how far",
            "    it throws you. Marble Limits sizes gaps.",
            "8. Sync from Godot Project keeps the physics",
            "    identical to player.gd.",
        )
        for line in steps:
            col.label(text=line)
        layout.operator("marble.open_tutorial", icon="HELP")


class MARBLE_PT_drop(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Drop Tester"
    bl_idname = "MARBLE_PT_drop"
    bl_parent_id = "MARBLE_PT_setup"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout
        col = layout.column(align=True)
        col.prop(s, "launch_speed")
        row = col.row(align=True)
        row.prop(s, "drop_count")
        sub = row.row(align=True)
        sub.active = s.drop_count > 1
        sub.prop(s, "drop_spread")
        col.prop(s, "sim_frames")
        col.prop(s, "substeps")
        row = col.row(align=True)
        row.prop(s, "rb_friction")
        row.prop(s, "rb_bounciness")
        row = layout.row(align=True)
        row.prop(s, "trace_path", toggle=True)
        row.prop(s, "keep_previous", toggle=True)
        row.prop(s, "auto_play", toggle=True)

        row = layout.row(align=True)
        row.scale_y = 1.6
        row.operator("marble.drop", icon="PLAY")
        layout.operator("marble.clear_drops", icon="TRASH")
        draw_result(layout, s.drop_result)


class MARBLE_PT_play(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Playtest"
    bl_idname = "MARBLE_PT_play"
    bl_parent_id = "MARBLE_PT_setup"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout
        row = layout.row(align=True)
        row.scale_y = 1.6
        if s.is_playing:
            row.label(text="Playing - Esc in viewport to stop", icon="PAUSE")
        else:
            row.operator("marble.playtest", icon="PLAY")
        draw_result(layout, s.play_result)

        box = layout.box()
        col = box.column(align=True)
        col.scale_y = 0.8
        col.label(text="WASD / arrows: move", icon="EVENT_W")
        col.label(text="Space: jump   R: respawn", icon="EVENT_SPACEKEY")
        col.label(text="Mouse / Q E: look   Wheel: zoom", icon="MOUSE_MOVE")
        col.label(text="M: toggle mouse look   Esc: stop", icon="EVENT_ESC")

        col = layout.column(align=True)
        col.label(text="Camera")
        row = col.row(align=True)
        row.prop(s, "cam_distance", text="Dist")
        row.prop(s, "cam_pitch", text="Pitch")
        row = col.row(align=True)
        row.prop(s, "cam_height", text="Height")
        row.prop(s, "cam_follow_rate", text="Follow")
        row = col.row(align=True)
        row.prop(s, "mouse_look", toggle=True)
        row.prop(s, "mouse_sensitivity", text="Sens")
        col = layout.column(align=True)
        col.label(text="Performance")
        col.prop(s, "fast_draw", toggle=True)
        col.prop(s, "render_hz")
        row = col.row(align=True)
        row.prop(s, "show_hud", toggle=True)
        row.prop(s, "show_trail", toggle=True)

        row = layout.row(align=True)
        row.prop(s, "record_play_path", toggle=True)
        row.prop(s, "restore_view", toggle=True)
        layout.operator("marble.clear_play", icon="TRASH")


class MARBLE_PT_runs(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Replays"
    bl_idname = "MARBLE_PT_runs"
    bl_parent_id = "MARBLE_PT_play"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout
        row = layout.row(align=True)
        row.prop(s, "record_runs", toggle=True)
        row.prop(s, "keep_runs")
        if s.is_playing:
            layout.label(text="Recording...", icon="REC")
            return

        recorded = runs.all_runs(context.scene)
        row = layout.row(align=True)
        row.scale_y = 1.3
        row.enabled = bool(recorded)
        row.operator("marble.play_runs", icon="PLAY")
        row = layout.row(align=True)
        row.prop(s, "align_runs", toggle=True)
        row.operator("marble.realign_runs", text="Apply", icon="FILE_REFRESH")

        if not recorded:
            layout.label(text="Play the level to record a run", icon="INFO")
            return
        box = layout.box()
        col = box.column(align=True)
        for run in recorded:
            row = col.row(align=True)
            icon = "SOLO_ON" if run.get(runs.RUN_FINISHED) else "DOT"
            label = run.name
            deaths = run.get(runs.RUN_DEATHS, 0)
            if deaths:
                label += f"  x{deaths}"
            row.label(text=label, icon=icon)
            row.operator("marble.solo_run", text="", icon="HIDE_OFF").name = run.name
            row.operator("marble.delete_run", text="", icon="X").name = run.name
        layout.operator("marble.clear_runs", icon="TRASH")


class MARBLE_PT_physics(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Physics (matches player.gd)"
    bl_idname = "MARBLE_PT_physics"
    bl_parent_id = "MARBLE_PT_play"
    bl_options = {"DEFAULT_CLOSED"}

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout
        col = layout.column(align=True)
        col.label(text="Gravity & jump")
        col.prop(s, "gravity")
        row = col.row(align=True)
        row.prop(s, "fall_gravity_mult")
        row.prop(s, "jump_cut", toggle=True)
        col.prop(s, "jump_speed")
        col.prop(s, "jump_bonus")
        row = col.row(align=True)
        row.prop(s, "jump_bonus_min", text="From")
        row.prop(s, "jump_bonus_span", text="Span")
        row = col.row(align=True)
        row.prop(s, "coyote_time", text="Coyote")
        row.prop(s, "jump_buffer", text="Buffer")

        col = layout.column(align=True)
        col.label(text="Movement")
        col.prop(s, "accel")
        col.prop(s, "air_accel")
        col.prop(s, "max_speed")
        col.prop(s, "friction")
        col.prop(s, "coast_friction")
        col.prop(s, "air_friction")
        col.prop(s, "air_drag")

        col = layout.column(align=True)
        col.label(text="Surfaces")
        col.prop(s, "bounce")
        col.prop(s, "ramp_keep")
        col.prop(s, "flow_limit")
        col.prop(s, "slope_boost")
        row = col.row(align=True)
        row.prop(s, "uphill_assist", text="Uphill")
        row.prop(s, "assist_min_speed", text="From")
        col.prop(s, "slope_limit")
        row = col.row(align=True)
        row.prop(s, "physics_hz")
        row.prop(s, "physics_substeps")


class MARBLE_PT_design(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Level Design"
    bl_idname = "MARBLE_PT_design"
    bl_parent_id = "MARBLE_PT_setup"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout

        col = layout.column(align=True)
        col.label(text="Game Boxes (Godot names, at 3D cursor)")
        row = col.row(align=True)
        row.operator("marble.add_game_box", text="Spawn", icon="EMPTY_ARROWS").kind = "SPAWN"
        row.operator("marble.add_game_box", text="Timer", icon="TIME").kind = "TIMER"
        row = col.row(align=True)
        row.operator("marble.add_game_box", text="Finish", icon="SOLO_ON").kind = "FINISH"
        row.operator("marble.add_game_box", text="Fall", icon="TRIA_DOWN_BAR").kind = "FALL"
        row = col.row(align=True)
        row.operator("marble.add_cosmetic", text="Cosmetic", icon="SHADERFX")
        col.prop(s, "box_size")
        col.prop(s, "cosmetic_height")

        col = layout.column(align=True)
        col.label(text="Markers (at 3D cursor)")
        row = col.row(align=True)
        row.operator("marble.add_marker", text="Checkpoint", icon="EMPTY_AXIS").marker_type = "CHECKPOINT"
        row.operator("marble.add_marker", text="Target", icon="OUTLINER_OB_EMPTY").marker_type = "TARGET"
        col.prop(s, "marker_radius")

        col = layout.column(align=True)
        col.label(text="Jumps")
        col.prop(s, "arc_speed")
        row = col.row(align=True)
        row.prop(s, "arc_max_time", text="Max s")
        row.prop(s, "arc_samples", text="Samples")
        row = col.row(align=True)
        row.operator("marble.jump_arc", icon="CURVE_BEZCURVE")
        row.operator("marble.solve_jump_speed", icon="DRIVER")
        col.operator("marble.clear_design", icon="TRASH")

        col = layout.column(align=True)
        col.label(text="Ramp Lab")
        col.operator("marble.mark_ramp", icon="CON_TRACKTO")
        row = col.row(align=True)
        row.prop(s, "ramp_min_speed")
        row.prop(s, "ramp_max_speed")
        col.prop(s, "ramp_speed_steps")
        row = col.row(align=True)
        row.operator("marble.analyse_ramps", text="Re-fly", icon="FILE_REFRESH")
        row.operator("marble.clear_ramps", text="Clear", icon="TRASH")
        draw_result(layout, s.ramp_result)

        col = layout.column(align=True)
        col.label(text="Inspect")
        row = col.row(align=True)
        row.operator("marble.ramp_info", icon="MOD_SIMPLIFY")
        row.operator("marble.level_stats", icon="INFO")
        col.operator("marble.marble_limits", icon="ARROW_LEFTRIGHT")
        draw_result(layout, s.limits_result)
        draw_result(layout, s.design_result)

        col = layout.column(align=True)
        col.label(text="Sync with Godot")
        col.operator("marble.sync_godot", icon="FILE_REFRESH")
        row = col.row(align=True)
        row.operator("marble.export_settings", text="Export", icon="EXPORT")
        row.operator("marble.import_settings", text="Import", icon="IMPORT")
        draw_result(layout, s.sync_result)


CLASSES = (
    MARBLE_PT_setup,
    MARBLE_PT_quickstart,
    MARBLE_PT_drop,
    MARBLE_PT_play,
    MARBLE_PT_runs,
    MARBLE_PT_physics,
    MARBLE_PT_design,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
