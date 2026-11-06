import Adw from "gi://Adw";
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
const BIND_FLAGS = 0 | 1 | 2 | 4; // DEFAULT | GET | SET | NO_SENSITIVITY
// The keynav crash-recovery sentinels are state, not preferences: resetting
// them while the extension is running would discard the stock-key backup.
const RESET_EXCLUDED_KEYS = new Set(["keynav-stock-backup", "keynav-stock-dirty"]);
export default class MacosDockPreferences extends ExtensionPreferences {
    _signalConnections = [];
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // One page per category. AdwPreferencesWindow turns several pages into the
        // sidebar the eye lands on first, which is the whole point: a single page of
        // fourteen groups is a scroll, not a set of categories.
        const dockPage = new Adw.PreferencesPage({
            title: "Dock",
            icon_name: "preferences-desktop-appearance-symbolic",
        });
        window.add(dockPage);
        const behaviorPage = new Adw.PreferencesPage({
            title: "Behavior",
            icon_name: "preferences-desktop-apps-symbolic",
        });
        window.add(behaviorPage);
        const lookPage = new Adw.PreferencesPage({
            title: "Magnification",
            icon_name: "applications-graphics-symbolic",
        });
        window.add(lookPage);
        const hidePage = new Adw.PreferencesPage({
            title: "Auto-hide",
            icon_name: "view-conceal-symbolic",
        });
        window.add(hidePage);
        const geniePage = new Adw.PreferencesPage({
            title: "Genie Animation",
            icon_name: "media-playback-start-symbolic",
        });
        window.add(geniePage);
        const keysPage = new Adw.PreferencesPage({
            title: "Keyboard",
            icon_name: "input-keyboard-symbolic",
        });
        window.add(keysPage);
        const perfPage = new Adw.PreferencesPage({
            title: "Performance",
            icon_name: "preferences-system-details-symbolic",
        });
        window.add(perfPage);
        // System is added last on purpose: it holds shell-integration fixes and
        // the restore-defaults control, which are the tail of the sidebar.
        const systemPage = new Adw.PreferencesPage({
            title: "System",
            icon_name: "preferences-system-symbolic",
        });
        window.add(systemPage);
        // Size group
        const iconSizeGroup = new Adw.PreferencesGroup({
            title: "Size",
            description: "How big the dock's icons are",
        });
        dockPage.add(iconSizeGroup);
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
        iconSizeGroup.add(iconSizeRow);
        // Position group
        const positionGroup = new Adw.PreferencesGroup({
            title: "Position",
            description: "Where the dock attaches on screen",
        });
        dockPage.add(positionGroup);
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
            description: "The capsule behind the icons: how solid, how round, how frosted",
        });
        dockPage.add(bgGroup);
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
        // Launch group
        const launchGroup = new Adw.PreferencesGroup({
            title: "Launch & Animation",
            description: "What the dock does when an app starts, and how fast it moves",
        });
        behaviorPage.add(launchGroup);
        const bounceRow = new Adw.SwitchRow({
            title: "Bounce on launch",
            subtitle: "Animate the dock icon when an app starts",
        });
        settings.bind("bounce-on-launch", bounceRow, "active", BIND_FLAGS);
        launchGroup.add(bounceRow);
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
        launchGroup.add(animDurationRow);
        // The show-threshold row belongs to Auto-hide, where the rest of the
        // reveal-by-pointer rules live; it is not a behaviour of the dock itself.
        const buttonsGroup = new Adw.PreferencesGroup({
            title: "Dock Buttons",
            description: "The buttons that sit after the favourites",
        });
        behaviorPage.add(buttonsGroup);
        const appButtonRow = new Adw.SwitchRow({
            title: "Show applications button",
            subtitle: "Show a grid icon to access all apps",
        });
        settings.bind("show-applications-button", appButtonRow, "active", BIND_FLAGS);
        buttonsGroup.add(appButtonRow);
        const showTrashRow = new Adw.SwitchRow({
            title: "Show Trash",
            subtitle: "Show a Trash button next to the applications button",
        });
        settings.bind("show-trash", showTrashRow, "active", BIND_FLAGS);
        buttonsGroup.add(showTrashRow);
        const dndGroup = new Adw.PreferencesGroup({
            title: "Drag and Drop",
            description: "Rearrange the dock with the pointer, and pin or unpin by dragging",
        });
        behaviorPage.add(dndGroup);
        const dndRow = new Adw.SwitchRow({
            title: "Drag pinned icons",
            subtitle: "Reorder pinned icons, drop apps from the grid to pin them, drop on the applications button to unpin",
        });
        settings.bind("dock-dnd-enabled", dndRow, "active", BIND_FLAGS);
        dndGroup.add(dndRow);
        const dragHoldRow = new Adw.SpinRow({
            title: "Press-and-hold time",
            subtitle: "How long an icon must be held before the drag starts, in milliseconds",
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 1000,
                step_increment: 25,
                page_increment: 50,
                value: settings.get_int("drag-hold-ms"),
            }),
        });
        settings.bind("drag-hold-ms", dragHoldRow, "value", BIND_FLAGS);
        dndGroup.add(dragHoldRow);
        const runningGroup = new Adw.PreferencesGroup({
            title: "Running Applications",
            description: "Apps that are running but not pinned",
        });
        behaviorPage.add(runningGroup);
        const showRunningAppsRow = new Adw.SwitchRow({
            title: "Show running applications",
            subtitle: "Show non-favorite running apps in the dock",
        });
        settings.bind("show-running-apps", showRunningAppsRow, "active", BIND_FLAGS);
        runningGroup.add(showRunningAppsRow);
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
        runningGroup.add(workspaceModeRow);
        const previewsGroup = new Adw.PreferencesGroup({
            title: "Window Previews",
            description: "What hovering or clicking a running icon shows",
        });
        behaviorPage.add(previewsGroup);
        const windowPreviewsRow = new Adw.SwitchRow({
            title: "Window previews",
            subtitle: "Show live thumbnail previews of open windows on hover, and the window picker a click opens on an app with several windows",
        });
        settings.bind("window-previews", windowPreviewsRow, "active", BIND_FLAGS);
        previewsGroup.add(windowPreviewsRow);
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
        previewsGroup.add(previewScaleRow);
        // Magnification group
        const magGroup = new Adw.PreferencesGroup({
            title: "Magnification",
            description: "Icons grow as the pointer comes near them",
        });
        lookPage.add(magGroup);
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
        // Labels group. The distance is measured from the height the hovered icon
        // actually settles at, so the number is the visual gap, not a guess about it.
        const labelGroup = new Adw.PreferencesGroup({
            title: "Icon Labels",
            description: "The name bubble that appears above a hovered icon",
        });
        lookPage.add(labelGroup);
        const tooltipGapRow = new Adw.SpinRow({
            title: "Label distance",
            subtitle: "Gap between an icon and its name label, in pixels",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 30,
                step_increment: 1,
                page_increment: 2,
                value: settings.get_int("tooltip-gap-px"),
            }),
        });
        settings.bind("tooltip-gap-px", tooltipGapRow, "value", BIND_FLAGS);
        labelGroup.add(tooltipGapRow);
        const tooltipDelayRow = new Adw.SpinRow({
            title: "Label delay",
            subtitle: "How long the pointer must rest on an icon before its label appears (0 = instant)",
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 2000,
                step_increment: 50,
                page_increment: 100,
                value: settings.get_int("tooltip-delay-ms"),
            }),
        });
        settings.bind("tooltip-delay-ms", tooltipDelayRow, "value", BIND_FLAGS);
        labelGroup.add(tooltipDelayRow);
        // Indicators group
        const indGroup = new Adw.PreferencesGroup({
            title: "Running Indicators",
            description: "The marks under an icon that say it is running",
        });
        lookPage.add(indGroup);
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
        const maxDotsRow = new Adw.SpinRow({
            title: "Maximum dots per icon",
            subtitle: "Windows beyond this number are not drawn as dots",
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 10,
                step_increment: 1,
                value: settings.get_int("max-indicator-dots"),
            }),
        });
        settings.bind("max-indicator-dots", maxDotsRow, "value", BIND_FLAGS);
        indGroup.add(maxDotsRow);
        // Media group
        const mediaGroup = new Adw.PreferencesGroup({
            title: "Media",
            description: "What the dock shows for the app that is playing music",
        });
        lookPage.add(mediaGroup);
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
            title: "Rendering Cost",
            description: "Sharper icons and smoother magnification both cost CPU — raise these only if the dock looks soft or stutters",
        });
        perfPage.add(perfGroup);
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
        // Shell-integration fixes. None of these is a dock feature: they patch
        // behaviour the shell got wrong, and each one can be turned off to get the
        // native behaviour back.
        const appsFixGroup = new Adw.PreferencesGroup({
            title: "Show Apps Button",
            description: "The dock's own button, and what the shell does with it",
        });
        systemPage.add(appsFixGroup);
        const appsButtonFixRow = new Adw.SwitchRow({
            title: "Fix the Show Apps button",
            subtitle: "Open the app grid from the overview and use the brand icon instead of hiding the overview",
        });
        settings.bind("apps-button-fix-enabled", appsButtonFixRow, "active", BIND_FLAGS);
        appsFixGroup.add(appsButtonFixRow);
        // Running icons fix
        const iconsFixGroup = new Adw.PreferencesGroup({
            title: "Running Icons",
            description: "Keep apps you did not pin from vanishing out of the dock",
        });
        systemPage.add(iconsFixGroup);
        const iconsFixRow = new Adw.SwitchRow({
            title: "Keep running-app icons",
            subtitle: "Keep non-favorite running apps across minimize / workspace switch",
        });
        settings.bind("icons-fix-enabled", iconsFixRow, "active", BIND_FLAGS);
        iconsFixGroup.add(iconsFixRow);
        // Overview patches (D-058): shell-layout fixes, independent of the dock.
        const overviewPatchesGroup = new Adw.PreferencesGroup({
            title: "Overview Patches",
            description: "Shell-layout fixes applied while the dock is on. Independent of the dock; fall back to the native layout if a shell symbol moves.",
        });
        systemPage.add(overviewPatchesGroup);
        const overviewPatchesRow = new Adw.SwitchRow({
            title: "Inset overview previews & reserve the dock band",
            subtitle: "Pull window previews inside the desktop and stop the dock overlapping the overview",
        });
        settings.bind("overview-patches-enabled", overviewPatchesRow, "active", BIND_FLAGS);
        overviewPatchesGroup.add(overviewPatchesRow);
        // Defaults. One confirmation, then every user value is removed so the
        // schema defaults take over; the internal keynav sentinels are kept.
        const resetGroup = new Adw.PreferencesGroup({
            title: "Defaults",
            description: "Restore every user-facing setting to the defaults this fork ships",
        });
        systemPage.add(resetGroup);
        const resetRow = new Adw.ActionRow({
            title: "Restore default settings",
            subtitle: "Reset appearance, behavior, hotkeys and Genie settings; internal crash-recovery keys are kept",
        });
        const resetButton = new Gtk.Button({
            label: "Restore Defaults",
            valign: Gtk.Align.CENTER,
        });
        resetButton.add_css_class("destructive-action");
        resetButton.connect("clicked", () => this._confirmReset(settings, window));
        resetRow.add_suffix(resetButton);
        resetRow.activatable_widget = resetButton;
        resetGroup.add(resetRow);
        // Dodge
        const dodgeGroup = new Adw.PreferencesGroup({
            title: "Dodge",
            description: "Stay visible unless the focused window overlaps the dock",
        });
        hidePage.add(dodgeGroup);
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
            title: "Reveal by Pointer",
            description: "How hard you have to push the edge to get the dock back",
        });
        hidePage.add(peekGroup);
        const showThresholdRow = new Adw.SpinRow({
            title: "Show threshold",
            subtitle: "Distance in pixels from the screen edge that wakes the dock",
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
                value: settings.get_int("show-threshold"),
            }),
        });
        settings.bind("show-threshold", showThresholdRow, "value", BIND_FLAGS);
        peekGroup.add(showThresholdRow);
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
            title: "Super+Number Hotkeys",
            description: "Super+1..9 / Super+0 cycles the nth app in the dock: launch, raise, or minimize. While enabled the matching system switch-to-application shortcuts are cleared (restored on disable, self-healed on next enable after a crash).",
        });
        keysPage.add(keynavGroup);
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
        const keynavPeekRow = new Adw.SwitchRow({
            title: "Pop up the dock on shortcut",
            subtitle: "Briefly reveal a hidden dock when a Super+number shortcut fires",
        });
        settings.bind("keynav-peek-dock", keynavPeekRow, "active", BIND_FLAGS);
        keynavGroup.add(keynavPeekRow);
        const keynavPeekDurationRow = new Adw.SpinRow({
            title: "Shortcut dock peek duration (ms)",
            subtitle: "How long the dock stays revealed after a shortcut",
            adjustment: new Gtk.Adjustment({
                lower: 100,
                upper: 3000,
                step_increment: 50,
                value: settings.get_int("keynav-peek-duration"),
            }),
        });
        settings.bind("keynav-peek-duration", keynavPeekDurationRow, "value", BIND_FLAGS);
        keynavGroup.add(keynavPeekDurationRow);
        // Genie minimize/restore
        const genieGroup = new Adw.PreferencesGroup({
            title: "Genie Animation",
            description: "Windows pour into, and stream out of, their real dock icon",
        });
        geniePage.add(genieGroup);
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
        const genieIconRow = new Adw.SwitchRow({
            title: "React on the target icon",
            subtitle: "Press and rebound the icon as the window lands in it or leaves it",
        });
        settings.bind("genie-icon-reaction", genieIconRow, "active", BIND_FLAGS);
        genieGroup.add(genieIconRow);
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
        // Funnel shape. These five are the pour's geometry, and the defaults are
        // the tuned macOS look.
        const funnelGroup = new Adw.PreferencesGroup({
            title: "Funnel Shape",
            description: "How the window is poured into the icon. Leave these at their defaults unless the animation looks wrong to you",
        });
        geniePage.add(funnelGroup);
        funnelGroup.add(this._scaleRow(settings, "genie-curvature",
            "Curvature", "0 = gentle macOS S-curve, 1 = tighter gather"));
        funnelGroup.add(this._scaleRow(settings, "genie-lead-fraction",
            "Leading edge arrival", "When the near edge reaches the icon"));
        funnelGroup.add(this._scaleRow(settings, "genie-trail-fraction",
            "Trailing edge departure", "When the far edge starts to move"));
        funnelGroup.add(this._scaleRow(settings, "genie-absorb-depth",
            "Absorb depth", "How deep into the icon the window sinks"));
        funnelGroup.add(this._scaleRow(settings, "genie-tail-fade",
            "Tail fade", "Fade the last sliver as it sinks in"));
        const genieMeshRow = new Adw.SpinRow({
            title: "Mesh resolution",
            subtitle: "Maximum strips along the funnel; the actual count adapts to the window size (higher = smoother)",
            adjustment: new Gtk.Adjustment({
                lower: 16,
                upper: 192,
                step_increment: 8,
                value: settings.get_int("genie-mesh-resolution"),
            }),
        });
        settings.bind("genie-mesh-resolution", genieMeshRow, "value", BIND_FLAGS);
        funnelGroup.add(genieMeshRow);
        // Disconnect all tracked signals when the window is closed.
        window.connect("close-request", () => this._disconnectAll());
    }
    _confirmReset(settings, window) {
        const dialog = new Adw.AlertDialog({
            heading: "Restore default settings?",
            body: "Every user-facing setting returns to its default, including keyboard shortcuts and Super+number app slots. Internal crash-recovery keys are kept. This cannot be undone.",
        });
        dialog.add_response("cancel", "Cancel");
        dialog.add_response("restore", "Restore Defaults");
        dialog.set_response_appearance("restore", Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_default_response("cancel");
        dialog.set_close_response("cancel");
        dialog.connect("response", (_dialog, response) => {
            if (response !== "restore")
                return;
            this._resetSettings(settings);
            window.add_toast(new Adw.Toast({
                title: "Default settings restored",
                timeout: 3,
            }));
        });
        dialog.present(window);
    }
    _resetSettings(settings) {
        for (const key of settings.list_keys()) {
            if (RESET_EXCLUDED_KEYS.has(key))
                continue;
            // Only remove values the user (or a previous run) actually set;
            // an unset key already reads its schema default.
            if (settings.get_user_value(key) !== null)
                settings.reset(key);
        }
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
