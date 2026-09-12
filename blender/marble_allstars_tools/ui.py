"""Sidebar panels (3D View > N > Marble)."""

import textwrap

import bpy

from . import utils
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
        col = layout.column(align=True)
        col.prop(s, "level_collection")
        col.prop(s, "marble_radius")
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
        box.label(text="Z arrow = up, Y arrow = launch dir", icon="INFO")


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

        col = layout.column(align=True)
        col.label(text="Physics")
        col.prop(s, "gravity")
        col.prop(s, "accel")
        col.prop(s, "air_accel")
        col.prop(s, "max_speed")
        col.prop(s, "jump_speed")
        col.prop(s, "bounce")
        col.prop(s, "friction")
        col.prop(s, "slope_limit")
        row = col.row(align=True)
        row.prop(s, "physics_hz")
        row.prop(s, "physics_substeps")

        col = layout.column(align=True)
        col.label(text="Camera")
        col.prop(s, "cam_distance")
        col.prop(s, "cam_height")
        col.prop(s, "cam_pitch")
        row = col.row(align=True)
        row.prop(s, "mouse_look", toggle=True)
        row.prop(s, "mouse_sensitivity", text="Sens")
        row = layout.row(align=True)
        row.prop(s, "record_play_path", toggle=True)
        row.prop(s, "restore_view", toggle=True)
        layout.operator("marble.clear_play", icon="TRASH")

        box = layout.box()
        col = box.column(align=True)
        col.scale_y = 0.8
        col.label(text="WASD / arrows: move", icon="EVENT_W")
        col.label(text="Space: jump   R: respawn", icon="EVENT_SPACEKEY")
        col.label(text="Mouse / Q E: look   Wheel: zoom", icon="MOUSE_MOVE")
        col.label(text="M: toggle mouse look   Esc: stop", icon="EVENT_ESC")


class MARBLE_PT_design(MarblePanelMixin, bpy.types.Panel):
    bl_label = "Level Design"
    bl_idname = "MARBLE_PT_design"
    bl_parent_id = "MARBLE_PT_setup"

    def draw(self, context):
        s = get_settings(context)
        layout = self.layout

        col = layout.column(align=True)
        col.label(text="Markers (at 3D cursor)")
        row = col.row(align=True)
        row.operator("marble.add_marker", text="Checkpoint", icon="EMPTY_AXIS").marker_type = "CHECKPOINT"
        row.operator("marble.add_marker", text="Finish", icon="SOLO_ON").marker_type = "FINISH"
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
        col.label(text="Inspect")
        row = col.row(align=True)
        row.operator("marble.ramp_info", icon="MOD_SIMPLIFY")
        row.operator("marble.level_stats", icon="INFO")

        col = layout.column(align=True)
        col.label(text="Sync with Godot")
        row = col.row(align=True)
        row.operator("marble.export_settings", text="Export", icon="EXPORT")
        row.operator("marble.import_settings", text="Import", icon="IMPORT")
        col.operator("marble.import_godot_project", icon="FILE_SCRIPT")

        draw_result(layout, s.design_result)


CLASSES = (MARBLE_PT_setup, MARBLE_PT_drop, MARBLE_PT_play, MARBLE_PT_design)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
