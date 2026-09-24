import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
const BIND_FLAGS = 0 | 1 | 2 | 4; // DEFAULT | GET | SET | NO_SENSITIVITY
export default class MacosDockPreferences extends ExtensionPreferences {
    _signalConnections = [];
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: "General",
            icon_name: "preferences-system-symbolic",
        });
        window.add(page);
        // Appearance group
        const appearanceGroup = new Adw.PreferencesGroup({
            title: "Appearance",
            description: "Visual look of the dock",
        });
        page.add(appearanceGroup);
        const iconSizeRow = new Adw.SpinRow({
            title: "Icon size",
            subtitle: "Pixel size of dock icons",
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 96,
                step_increment: 2,
                page_increment: 8,
                value: settings.get_int("icon-size"),
            }),
        });
        settings.bind("icon-size", iconSizeRow, "value", BIND_FLAGS);
        appearanceGroup.add(iconSizeRow);
        // Position group
        const positionGroup = new Adw.PreferencesGroup({
            title: "Position",
            description: "Where the dock appears on screen",
        });
        page.add(positionGroup);
        const positionModel = new Gtk.StringList({
            strings: ["Bottom", "Left", "Right", "Top"],
        });
        const positionRow = new Adw.ComboRow({
            title: "Dock position",
            subtitle: "Choose which screen edge the dock attaches to",
            model: positionModel,
            selected: settings.get_int("dock-position"),
        });
        positionRow.connect("notify::selected", () => {
            settings.set_int("dock-position", positionRow.selected);
        });
        this._trackSignal(settings, "changed::dock-position", () => {
            positionRow.selected = settings.get_int("dock-position");
        });
        positionGroup.add(positionRow);
        // Background group
        const bgGroup = new Adw.PreferencesGroup({
            title: "Background",
            description: "Customize the dock background",
        });
        page.add(bgGroup);
        const opacityRow = new Adw.SpinRow({
            title: "Opacity",
            subtitle: "Dock background opacity (0-100%)",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int("dock-opacity"),
            }),
        });
        settings.bind("dock-opacity", opacityRow, "value", BIND_FLAGS);
        bgGroup.add(opacityRow);
        const borderRadiusRow = new Adw.SpinRow({
            title: "Border radius",
            subtitle: "Corner radius of the dock in pixels",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 50,
                step_increment: 1,
                page_increment: 4,
                value: settings.get_int("dock-border-radius"),
            }),
        });
        settings.bind("dock-border-radius", borderRadiusRow, "value", BIND_FLAGS);
        bgGroup.add(borderRadiusRow);
        const blurRow = new Adw.SwitchRow({
            title: "Enable blur",
            subtitle: "Frosted glass effect behind the dock",
        });
        settings.bind("dock-blur-enabled", blurRow, "active", BIND_FLAGS);
        bgGroup.add(blurRow);
        // Background color
        const colorRow = new Adw.ActionRow({ title: "Background color" });
        const colorButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({ with_alpha: false }),
        });
        const hexToRGBA = (hex) => {
            const c = new Gdk.RGBA();
            try {
                const r = parseInt(hex.slice(1, 3), 16) / 255;
                const g = parseInt(hex.slice(3, 5), 16) / 255;
                const b = parseInt(hex.slice(5, 7), 16) / 255;
                c.red = r; c.green = g; c.blue = b; c.alpha = 1.0;
            } catch (e) { c.red = 0.12; c.green = 0.12; c.blue = 0.12; c.alpha = 1.0; }
            return c;
        };
        const rgbaToHex = (rgba) => {
            const r = Math.round(rgba.red * 255).toString(16).padStart(2, "0");
            const g = Math.round(rgba.green * 255).toString(16).padStart(2, "0");
            const b = Math.round(rgba.blue * 255).toString(16).padStart(2, "0");
            return `#${r}${g}${b}`;
        };
        try { colorButton.set_rgba(hexToRGBA(settings.get_string("dock-background-color"))); } catch (e) {}
        colorButton.connect("notify::rgba", () => {
            try { settings.set_string("dock-background-color", rgbaToHex(colorButton.get_rgba())); } catch (e) {}
        });
        this._trackSignal(settings, "changed::dock-background-color", () => {
            try { colorButton.set_rgba(hexToRGBA(settings.get_string("dock-background-color"))); } catch (e) {}
        });
        colorRow.add_suffix(colorButton);
        colorRow.activatable_widget = colorButton;
        bgGroup.add(colorRow);
        // Behavior group
        const behaviorGroup = new Adw.PreferencesGroup({
            title: "Behavior",
        });
        page.add(behaviorGroup);
        const bounceRow = new Adw.SwitchRow({
            title: "Bounce on launch",
            subtitle: "Animate the dock icon when an app starts",
        });
        settings.bind("bounce-on-launch", bounceRow, "active", BIND_FLAGS);
        behaviorGroup.add(bounceRow);
        const animDurationRow = new Adw.SpinRow({
            title: "Animation duration",
            subtitle: "Show/hide animation time in milliseconds (0 = instant)",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 1000,
                step_increment: 10,
                page_increment: 50,
                value: settings.get_int("animation-duration"),
            }),
        });
        settings.bind("animation-duration", animDurationRow, "value", BIND_FLAGS);
        behaviorGroup.add(animDurationRow);
        const showThresholdRow = new Adw.SpinRow({
            title: "Show threshold",
            subtitle: "Distance in pixels from screen edge to trigger dock show",
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int("show-threshold"),
            }),
        });
        settings.bind("show-threshold", showThresholdRow, "value", BIND_FLAGS);
        behaviorGroup.add(showThresholdRow);
        const appButtonRow = new Adw.SwitchRow({
            title: "Show applications button",
            subtitle: "Show a grid icon to access all apps",
        });
        settings.bind("show-applications-button", appButtonRow, "active", BIND_FLAGS);
        behaviorGroup.add(appButtonRow);
        const showRunningAppsRow = new Adw.SwitchRow({
            title: "Show running applications",
            subtitle: "Show non-favorite running apps in the dock",
        });
        settings.bind("show-running-apps", showRunningAppsRow, "active", BIND_FLAGS);
        behaviorGroup.add(showRunningAppsRow);
        const workspaceModeModel = new Gtk.StringList({
            strings: ["All workspaces", "Current workspace only"],
        });
        const workspaceModeRow = new Adw.ComboRow({
            title: "Workspace mode",
            subtitle: "Which workspaces show running applications",
            model: workspaceModeModel,
            selected: settings.get_int("dock-workspace-mode"),
        });
        workspaceModeRow.connect("notify::selected", () => {
            settings.set_int("dock-workspace-mode", workspaceModeRow.selected);
        });
        this._trackSignal(settings, "changed::dock-workspace-mode", () => {
            workspaceModeRow.selected = settings.get_int("dock-workspace-mode");
        });
        behaviorGroup.add(workspaceModeRow);
        const windowPreviewsRow = new Adw.SwitchRow({
            title: "Window previews",
            subtitle: "Show live thumbnail previews of open windows on hover",
        });
        settings.bind("window-previews", windowPreviewsRow, "active", BIND_FLAGS);
        behaviorGroup.add(windowPreviewsRow);
        const previewScaleRow = new Adw.SpinRow({
            title: "Preview thumbnail width",
            subtitle: "Width of each preview thumbnail in pixels",
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 400,
                step_increment: 10,
                page_increment: 20,
                value: settings.get_int("preview-scale"),
            }),
        });
        settings.bind("preview-scale", previewScaleRow, "value", BIND_FLAGS);
        behaviorGroup.add(previewScaleRow);
        // Magnification group
        const magGroup = new Adw.PreferencesGroup({
            title: "Magnification",
            description: "Icon grows when the pointer is near it",
        });
        page.add(magGroup);
        const magEnabledRow = new Adw.SwitchRow({
            title: "Enable magnification",
        });
        settings.bind("magnification-enabled", magEnabledRow, "active", BIND_FLAGS);
        magGroup.add(magEnabledRow);
        // Max scale - connect to adjustment's signal, not the row's
        const magScaleAdj = new Gtk.Adjustment({
            lower: 1.0,
            upper: 2.0,
            step_increment: 0.05,
            page_increment: 0.1,
            value: settings.get_double("magnification-scale"),
        });
        const magScaleRow = new Adw.SpinRow({
            title: "Max scale",
            subtitle: "1.0 = no magnification, 2.0 = double size",
            adjustment: magScaleAdj,
            digits: 2,
        });
        magScaleAdj.connect("value-changed", () => {
            settings.set_double("magnification-scale", magScaleAdj.get_value());
        });
        this._trackSignal(settings, "changed::magnification-scale", () => {
            magScaleAdj.set_value(settings.get_double("magnification-scale"));
        });
        magGroup.add(magScaleRow);
        // Falloff distance
        const magFalloffAdj = new Gtk.Adjustment({
            lower: 40,
            upper: 300,
            step_increment: 10,
            page_increment: 20,
            value: settings.get_int("magnification-falloff"),
        });
        const magFalloffRow = new Adw.SpinRow({
            title: "Falloff distance",
            subtitle: "How far the magnification wave reaches (pixels)",
            adjustment: magFalloffAdj,
        });
        magFalloffAdj.connect("value-changed", () => {
            settings.set_int("magnification-falloff", magFalloffAdj.get_value());
        });
        this._trackSignal(settings, "changed::magnification-falloff", () => {
            magFalloffAdj.set_value(settings.get_int("magnification-falloff"));
        });
        magGroup.add(magFalloffRow);
        // Indicators group
        const indGroup = new Adw.PreferencesGroup({
            title: "Indicators",
        });
        page.add(indGroup);
        const indicatorsRow = new Adw.SwitchRow({
            title: "Running indicators",
            subtitle: "Show a dot under icons of running apps",
        });
        settings.bind("running-indicators", indicatorsRow, "active", BIND_FLAGS);
        indGroup.add(indicatorsRow);
        // Indicator style
        const indicatorStyleModel = new Gtk.StringList({
            strings: ["Dots per window", "Horizontal bar"],
        });
        const indicatorStyleRow = new Adw.ComboRow({
            title: "Indicator style",
            subtitle: "Dots per window (macOS) or a single horizontal bar",
            model: indicatorStyleModel,
            selected: settings.get_int("running-indicator-style"),
        });
        indicatorStyleRow.connect("notify::selected", () => {
            settings.set_int("running-indicator-style", indicatorStyleRow.selected);
        });
        this._trackSignal(settings, "changed::running-indicator-style", () => {
            indicatorStyleRow.selected = settings.get_int("running-indicator-style");
        });
        indGroup.add(indicatorStyleRow);
        // Media group
        const mediaGroup = new Adw.PreferencesGroup({
            title: "Media",
            description: "Music player integration",
        });
        page.add(mediaGroup);
        const mediaIndicatorRow = new Adw.SwitchRow({
            title: "Media indicator",
            subtitle: "Show a music note on the currently playing app icon",
        });
        settings.bind("media-indicator", mediaIndicatorRow, "active", BIND_FLAGS);
        mediaGroup.add(mediaIndicatorRow);
        const mediaControlsRow = new Adw.SwitchRow({
            title: "Media controls",
            subtitle: "Show play/pause/next/previous in the context menu",
        });
        settings.bind("media-controls", mediaControlsRow, "active", BIND_FLAGS);
        mediaGroup.add(mediaControlsRow);
        // Performance group
        const perfGroup = new Adw.PreferencesGroup({
            title: "Performance",
        });
        page.add(perfGroup);
        // Icon Quality
        const qualityModel = new Gtk.StringList({ strings: ["x1", "x2", "x4"] });
        const qualityRow = new Adw.ComboRow({
            title: "Icon Quality",
            subtitle: "Set icon resolution to improve rendering quality",
            model: qualityModel,
            selected: settings.get_int("icon-quality") === 4 ? 2 : settings.get_int("icon-quality") === 2 ? 1 : 0,
        });
        qualityRow.connect("notify::selected", () => {
            const values = [1, 2, 4];
            settings.set_int("icon-quality", values[qualityRow.selected]);
        });
        this._trackSignal(settings, "changed::icon-quality", () => {
            const v = settings.get_int("icon-quality");
            qualityRow.selected = v === 4 ? 2 : v === 2 ? 1 : 0;
        });
        perfGroup.add(qualityRow);
        // Framerate
        const fpsModel = new Gtk.StringList({ strings: ["30", "60", "120"] });
        const fpsRow = new Adw.ComboRow({
            title: "Framerate",
            subtitle: "Set animation framerate. Higher is smoother but uses more CPU",
            model: fpsModel,
            selected: settings.get_int("magnification-framerate") === 120
                ? 2
                : settings.get_int("magnification-framerate") === 60
                    ? 1
                    : 0,
        });
        fpsRow.connect("notify::selected", () => {
            const values = [30, 60, 120];
            settings.set_int("magnification-framerate", values[fpsRow.selected]);
        });
        this._trackSignal(settings, "changed::magnification-framerate", () => {
            const v = settings.get_int("magnification-framerate");
            fpsRow.selected = v === 120 ? 2 : v === 60 ? 1 : 0;
        });
        perfGroup.add(fpsRow);
        // Running icons fix
        const iconsFixGroup = new Adw.PreferencesGroup({
            title: "Running icons",
        });
        page.add(iconsFixGroup);
        const iconsFixRow = new Adw.SwitchRow({
            title: "Keep running-app icons",
            subtitle: "Keep non-favorite running apps across minimize / workspace switch",
        });
        settings.bind("icons-fix-enabled", iconsFixRow, "active", BIND_FLAGS);
        iconsFixGroup.add(iconsFixRow);
        // Dodge
        const dodgeGroup = new Adw.PreferencesGroup({
            title: "Dodge",
            description: "Stay visible unless the focused window overlaps the dock",
        });
        page.add(dodgeGroup);
        const dodgeRow = new Adw.SwitchRow({
            title: "Enable dodge",
            subtitle: "Hide the dock only when the focused window overlaps it",
        });
        settings.bind("dodge-enabled", dodgeRow, "active", BIND_FLAGS);
        dodgeGroup.add(dodgeRow);
        const dodgeFocusRow = new Adw.SwitchRow({
            title: "Only focused window dodges",
            subtitle: "Hide only when the focused window overlaps (recommended)",
        });
        settings.bind("dodge-only-focused", dodgeFocusRow, "active", BIND_FLAGS);
        dodgeGroup.add(dodgeFocusRow);
        // Peek & fullscreen
        const peekGroup = new Adw.PreferencesGroup({
            title: "Peek & fullscreen",
        });
        page.add(peekGroup);
        const peekZoneRow = new Adw.SpinRow({
            title: "Peek deep zone (px)",
            subtitle: "Push the pointer this close to the edge to reveal the dock",
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                value: settings.get_int("peek-edge-px"),
            }),
        });
        settings.bind("peek-edge-px", peekZoneRow, "value", BIND_FLAGS);
        peekGroup.add(peekZoneRow);
        const peekHoldRow = new Adw.SpinRow({
            title: "Peek hold time (ms)",
            subtitle: "Hold the pointer in the deep zone this long (0 = instant)",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 2000,
                step_increment: 50,
                value: settings.get_int("peek-hold-ms"),
            }),
        });
        settings.bind("peek-hold-ms", peekHoldRow, "value", BIND_FLAGS);
        peekGroup.add(peekHoldRow);
        const fullscreenRow = new Adw.SwitchRow({
            title: "Hide in fullscreen",
            subtitle: "Force-hide and disable peek over true fullscreen windows (video, games)",
        });
        settings.bind("hide-in-fullscreen", fullscreenRow, "active", BIND_FLAGS);
        peekGroup.add(fullscreenRow);
        // Super+number hotkeys
        const keynavGroup = new Adw.PreferencesGroup({
            title: "Super+number hotkeys",
            description: "Super+1..9 / Super+0 cycles the nth app in the dock: launch, raise, or minimize. While enabled the matching system switch-to-application shortcuts are cleared (restored on disable, self-healed on next enable after a crash).",
        });
        page.add(keynavGroup);
        const keynavOnRow = new Adw.SwitchRow({
            title: "Enable Super+number hotkeys",
            subtitle: "Launch / raise / minimize the nth dock app",
        });
        settings.bind("keynav-enabled", keynavOnRow, "active", BIND_FLAGS);
        keynavGroup.add(keynavOnRow);
        for (let i = 1; i <= 10; i++) {
            const labelRow = new Adw.ActionRow({ title: `App ${i} shortcut` });
            const value = () => {
                try {
                    return settings.get_strv(`keynav-app-${i}`).join(", ") || "(none)";
                }
                catch (e) {
                    return "(none)";
                }
            };
            labelRow.subtitle = value();
            const cid = settings.connect(`changed::keynav-app-${i}`, () => {
                try { labelRow.subtitle = value(); } catch (e) {}
            });
            labelRow.connect("destroy", () => {
                try { settings.disconnect(cid); } catch (e) {}
            });
            keynavGroup.add(labelRow);
        }
        // Genie minimize/restore
        const genieGroup = new Adw.PreferencesGroup({
            title: "Genie animation",
            description: "Windows pour into, and stream out of, their real dock icon",
        });
        page.add(genieGroup);
        const genieOnRow = new Adw.SwitchRow({
            title: "Enable genie minimize/restore",
            subtitle: "Animate minimizing/restoring windows into their dock icon",
        });
        settings.bind("genie-enabled", genieOnRow, "active", BIND_FLAGS);
        genieGroup.add(genieOnRow);
        const geniePeekRow = new Adw.SwitchRow({
            title: "Peek the hidden dock",
            subtitle: "Briefly show a dodge-hidden dock so you can see where the window goes",
        });
        settings.bind("genie-peek-hidden-dock", geniePeekRow, "active", BIND_FLAGS);
        genieGroup.add(geniePeekRow);
        const genieMinRow = new Adw.SpinRow({
            title: "Minimize duration (ms)",
            subtitle: "How long the window takes to pour into its icon",
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 3000,
                step_increment: 20,
                value: settings.get_int("genie-minimize-duration"),
            }),
        });
        settings.bind("genie-minimize-duration", genieMinRow, "value", BIND_FLAGS);
        genieGroup.add(genieMinRow);
        const genieRestoreRow = new Adw.SpinRow({
            title: "Restore duration (ms)",
            subtitle: "How long the window takes to stream back out",
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 3000,
                step_increment: 20,
                value: settings.get_int("genie-restore-duration"),
            }),
        });
        settings.bind("genie-restore-duration", genieRestoreRow, "value", BIND_FLAGS);
        genieGroup.add(genieRestoreRow);
        genieGroup.add(this._scaleRow(settings, "genie-curvature",
            "Curvature", "0 = gentle macOS S-curve, 1 = tighter gather"));
        genieGroup.add(this._scaleRow(settings, "genie-lead-fraction",
            "Leading edge arrival", "When the near edge reaches the icon"));
        genieGroup.add(this._scaleRow(settings, "genie-trail-fraction",
            "Trailing edge departure", "When the far edge starts to move"));
        genieGroup.add(this._scaleRow(settings, "genie-absorb-depth",
            "Absorb depth", "How deep into the icon the window sinks"));
        genieGroup.add(this._scaleRow(settings, "genie-tail-fade",
            "Tail fade", "Fade the last sliver as it sinks in"));
        const genieMeshRow = new Adw.SpinRow({
            title: "Mesh resolution",
            subtitle: "Strips along the funnel (higher = smoother)",
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 192,
                step_increment: 8,
                value: settings.get_int("genie-mesh-resolution"),
            }),
        });
        settings.bind("genie-mesh-resolution", genieMeshRow, "value", BIND_FLAGS);
        genieGroup.add(genieMeshRow);
        // Disconnect all tracked signals when the window is closed.
        window.connect("close-request", () => this._disconnectAll());
    }
    _scaleRow(settings, key, title, subtitle) {
        let lower = 0;
        let upper = 1;
        try {
            const range = settings.get_range(key).deep_unpack()[1].deep_unpack();
            lower = range[0];
            upper = range[1];
        }
        catch (e) {}
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: 0.01,
                value: settings.get_double(key),
            }),
            digits: 2,
            draw_value: true,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        settings.bind(key, scale.adjustment, "value", BIND_FLAGS);
        const row = new Adw.ActionRow({ title, subtitle });
        row.add_suffix(scale);
        scale.set_size_request(220, -1);
        return row;
    }
    _trackSignal(source, signal, callback) {
        const id = source.connect(signal, callback);
        this._signalConnections.push({ source, id });
    }
    _disconnectAll() {
        for (const conn of this._signalConnections) {
            conn.source.disconnect(conn.id);
        }
        this._signalConnections = [];
    }
}
