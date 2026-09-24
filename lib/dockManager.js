import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { IconManager } from "./iconManager.js";
import { Magnification } from "./magnification.js";
import { MediaManager } from "./mediaManager.js";
import { SignalManager } from "./signalManager.js";
import { WindowPreviewPopup } from "./windowPreview.js";
import { DodgeController } from "./dodge.js";
import { HotkeyNavController } from "./hotkeyNav.js";
import { applyIconFix } from "./iconFix.js";
import { GenieController } from "./genieController.js";
const TAG = "[macos-dock-local]";
const POSITIONS = { BOTTOM: 0, LEFT: 1, RIGHT: 2, TOP: 3 };
// Fixed geometry — not user-configurable (formerly companion settings).
// Bottom gap sits 1px below the screen edge; icon-vpad is the distance of
// the icon+dot from the TOP edge; dock-height extra is absorbed downward.
const FIXED_ICON_VPAD = 7;
const FIXED_DOCK_HEIGHT = -8;
export class DockManager {
    _signals;
    _container = null;
    _dodge = null;
    _hotkeyNav = null;
_revertIcons = null;
    _revertIconsSourceId = null;
    _iconManager = null;
    _magnification = null;
    _settings = null;
    _lastFocusedApp = null;
    _recentlyLaunched = new Set();
    _debounceSourceId = null;
    _pendingDebounceAppId = null;
    _originalDashVisible;
    _dockPosition = POSITIONS.BOTTOM;
    _blurEffect = null;
    _previewPopup = null;
    _mediaManager = null;
    _genie = null;
    static MARGIN_BOTTOM = -1;
    static MIN_DOCK_WIDTH = 300;
    static LAUNCH_DEBOUNCE_MS = 400;
    constructor() {
        this._signals = new SignalManager();
    }
    get _dockHeight() {
        const iconSize = this._settings?.get_int("icon-size") ?? 48;
        const iconActorHeight = iconSize + 16;
        // top pad = FIXED_ICON_VPAD, bottom pad = max(0, FIXED_ICON_VPAD + FIXED_DOCK_HEIGHT) = 0
        return iconActorHeight + FIXED_ICON_VPAD;
    }
    enable(settings) {
        this._settings = settings;
        const tEnable = GLib.get_monotonic_time();
        // Hide the default GNOME dash to avoid conflict.
        this._hideDefaultDash();
        this._container = new St.BoxLayout({
            style_class: "macos-dock-container",
            vertical: false,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
        });
        // Liveness guard: at shell teardown the container may be destroyed
        // from the C side before disable() runs; nulling it turns every
        // guarded consumer (_updatePosition etc.) into a no-op instead of
        // touching a disposed object (journal: "set_size ... already disposed").
        this._container.connect("destroy", () => { this._container = null; });
        Main.layoutManager.addTopChrome(this._container);
        // Icon manager: populates the container with app buttons.
        this._iconManager = new IconManager(this._container, settings.get_int("icon-size"), settings.get_boolean("running-indicators"), settings.get_int("icon-quality"), settings.get_int("running-indicator-style"));
        this._iconManager.setOnClicked((app) => this._onAppClicked(app));
        this._iconManager.setOnIconsChanged(() => this._updatePosition());
        this._iconManager.setOnMediaAction((action) => this._onMediaAction(action));
        this._iconManager.setShowRunningApps(settings.get_boolean("show-running-apps"));
        this._iconManager.setWorkspaceMode(settings.get_int("dock-workspace-mode"));
        this._iconManager.setMediaIndicatorEnabled(settings.get_boolean("media-indicator"));
        this._iconManager.setMediaControlsEnabled(settings.get_boolean("media-controls"));
        // Window preview popup
        this._previewPopup = new WindowPreviewPopup();
        this._previewPopup.setPreviewWidth(settings.get_int("preview-scale"));
        this._iconManager.setPreviewPopup(this._previewPopup);
        this._iconManager.setWindowPreviewsEnabled(settings.get_boolean("window-previews"));
        this._iconManager.start();
        // Running-app icon fix (keep minimized windows; extra change signals).
        // Deferred to idle so it never blocks the first dock paint.
        if (settings.get_boolean("icons-fix-enabled")) {
            this._revertIconsSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._revertIconsSourceId = null;
                try {
                    this._revertIcons = applyIconFix(this._iconManager);
                }
                catch (e) {
                    console.warn(`${TAG} icon fix failed:`, e);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
        // Magnification: scale icons on hover.
        this._magnification = new Magnification(this._container, settings.get_boolean("magnification-enabled"), settings.get_double("magnification-scale"), settings.get_int("magnification-falloff"), settings.get_int("magnification-framerate"));
        this._magnification.start();
        // Media manager: MPRIS integration for music controls.
        this._mediaManager = new MediaManager();
        this._mediaManager.setOnStateChanged((app) => {
            if (this._iconManager) {
                this._iconManager.setPlayingApp(app?.get_id() ?? null);
            }
        });
        this._mediaManager.start();
        this._applyDockStyle();
        this._applyDockPosition();
        this._updatePosition();
        this._signals.connect(global.display, "workareas-changed", () => this._updatePosition());
        // Watch for newly launched apps so we can bounce their dock icon.
        const tracker = Shell.WindowTracker.get_default();
        this._signals.connect(tracker, "notify::focus-app", () => this._onFocusAppChanged());
        // Live settings.
        this._signals.connect(settings, "changed::icon-size", () => {
            if (this._iconManager) {
                this._iconManager.setIconSize(settings.get_int("icon-size"));
            }
            this._updatePosition();
        });
        this._signals.connect(settings, "changed::magnification-enabled", () => {
            if (this._magnification) {
                this._magnification.setEnabled(settings.get_boolean("magnification-enabled"));
            }
        });
        this._signals.connect(settings, "changed::magnification-scale", () => {
            if (this._magnification) {
                this._magnification.setMaxScale(settings.get_double("magnification-scale"));
            }
        });
        this._signals.connect(settings, "changed::magnification-falloff", () => {
            if (this._magnification) {
                this._magnification.setFalloffDistance(settings.get_int("magnification-falloff"));
            }
        });
        this._signals.connect(settings, "changed::running-indicators", () => {
            if (this._iconManager) {
                this._iconManager.setRunningIndicatorsEnabled(settings.get_boolean("running-indicators"));
            }
        });
        this._signals.connect(settings, "changed::magnification-framerate", () => {
            if (this._magnification) {
                this._magnification.setFramerate(settings.get_int("magnification-framerate"));
            }
        });
        this._signals.connect(settings, "changed::icon-quality", () => {
            if (this._iconManager) {
                this._iconManager.setQuality(settings.get_int("icon-quality"));
            }
        });
        this._signals.connect(settings, "changed::running-indicator-style", () => {
            if (this._iconManager) {
                this._iconManager.setIndicatorStyle(settings.get_int("running-indicator-style"));
            }
        });
        this._signals.connect(settings, "changed::dock-opacity", () => this._applyDockStyle());
        this._signals.connect(settings, "changed::dock-background-color", () => this._applyDockStyle());
        this._signals.connect(settings, "changed::dock-border-radius", () => this._applyDockStyle());
        this._signals.connect(settings, "changed::dock-blur-enabled", () => this._applyDockStyle());
        this._signals.connect(settings, "changed::dock-position", () => this._applyDockPosition());
        this._signals.connect(settings, "changed::show-applications-button", () => {
            if (this._iconManager) {
                this._iconManager.setShowAppButton(settings.get_boolean("show-applications-button"));
            }
            this._updatePosition();
        });
        this._signals.connect(settings, "changed::window-previews", () => {
            const enabled = settings.get_boolean("window-previews");
            if (this._iconManager) {
                this._iconManager.setWindowPreviewsEnabled(enabled);
            }
            if (!enabled && this._previewPopup) {
                this._previewPopup.hide();
            }
        });
        this._signals.connect(settings, "changed::preview-scale", () => {
            if (this._previewPopup) {
                this._previewPopup.setPreviewWidth(settings.get_int("preview-scale"));
            }
        });
        this._signals.connect(settings, "changed::show-running-apps", () => {
            if (this._iconManager) {
                this._iconManager.setShowRunningApps(settings.get_boolean("show-running-apps"));
            }
        });
        this._signals.connect(settings, "changed::dock-workspace-mode", () => {
            if (this._iconManager) {
                this._iconManager.setWorkspaceMode(settings.get_int("dock-workspace-mode"));
            }
        });
        this._signals.connect(global.workspace_manager, "workspace-switched", () => {
            if (this._iconManager && this._settings?.get_int("dock-workspace-mode") === 1) {
                this._iconManager.reload("workspace-switched");
            }
        });
        this._signals.connect(settings, "changed::media-indicator", () => {
            if (this._iconManager) {
                this._iconManager.setMediaIndicatorEnabled(settings.get_boolean("media-indicator"));
            }
        });
        this._signals.connect(settings, "changed::media-controls", () => {
            if (this._iconManager) {
                this._iconManager.setMediaControlsEnabled(settings.get_boolean("media-controls"));
            }
        });
        // Dodge + keyboard navigation (formerly the companion controllers).
        this._signals.connect(settings, "changed::dodge-enabled", () => { try { this._refreshDodge(); } catch (e) {} });
        this._signals.connect(settings, "changed::dodge-only-focused", () => {
            try { if (this._dodge) this._dodge.setOnlyFocused(settings.get_boolean("dodge-only-focused")); } catch (e) {}
        });
        this._signals.connect(settings, "changed::keynav-enabled", () => {
            try { this._stopKeynav(); this._startKeynav(); } catch (e) {}
        });
        this._signals.connect(settings, "changed::genie-enabled", () => {
            try { this._refreshGenie(); } catch (e) {}
        });
        this._startDodge();
        this._startKeynav();
        this._startGenie();
        console.log(`${TAG} enable() total ${(GLib.get_monotonic_time() - tEnable) / 1000}ms`);
    }
    disable() {
        // Tear down the genie first: it must finish in-flight animations and
        // restore actor scale/opacity while the icon manager and container
        // still exist.
        this._stopGenie();
        this._stopDodge();
        this._stopKeynav();
        if (this._revertIconsSourceId !== null) {
            try { GLib.source_remove(this._revertIconsSourceId); } catch (e) {}
            this._revertIconsSourceId = null;
        }
        if (this._revertIcons) {
            try {
                if (typeof this._revertIcons === "function")
                    this._revertIcons();
            }
            catch (e) {}
            this._revertIcons = null;
        }
        if (this._iconManager) {
            try { this._iconManager.stop(); } catch (e) { console.warn(`${TAG} iconManager.stop() failed:`, e); }
            this._iconManager = null;
        }
        if (this._magnification) {
            try { this._magnification.stop(); } catch (e) { console.warn(`${TAG} magnification.stop() failed:`, e); }
            this._magnification = null;
        }
        if (this._previewPopup) {
            try { this._previewPopup.stop(); } catch (e) { console.warn(`${TAG} previewPopup.stop() failed:`, e); }
            this._previewPopup = null;
        }
        if (this._mediaManager) {
            try { this._mediaManager.stop(); } catch (e) { console.warn(`${TAG} mediaManager.stop() failed:`, e); }
            this._mediaManager = null;
        }
        this._signals.disconnectAll();
        if (this._debounceSourceId !== null) {
            GLib.source_remove(this._debounceSourceId);
            this._debounceSourceId = null;
        }
        this._recentlyLaunched.clear();
        this._lastFocusedApp = null;
        this._blurEffect = null;
        if (this._container) {
            Main.layoutManager.removeChrome(this._container);
            this._container.destroy();
            this._container = null;
        }
        // Restore the default GNOME dash.
        this._showDefaultDash();
        this._settings = null;
    }
    _startDodge() {
        if (!this._settings?.get_boolean("dodge-enabled"))
            return;
        if (this._dodge)
            return;
        try {
            this._dodge = new DodgeController(this._container, this, this._settings.get_boolean("dodge-only-focused"), this._settings);
            this._dodge.start();
        }
        catch (e) {
            console.warn(`${TAG} dodge start failed:`, e);
            this._dodge = null;
        }
    }
    _stopDodge() {
        if (this._dodge) {
            try { this._dodge.stop(); } catch (e) {}
            this._dodge = null;
        }
    }
    _refreshDodge() {
        if (this._settings?.get_boolean("dodge-enabled")) {
            if (this._dodge) {
                try { this._dodge.setOnlyFocused(this._settings.get_boolean("dodge-only-focused")); } catch (e) {}
            }
            else {
                this._startDodge();
            }
        }
        else {
            this._stopDodge();
            try {
                if (this._container) {
                    this._container.visible = true;
                    // Skip opacity while the startup fade is still pending;
                    // forcing 255 would defeat the grace-period fade and
                    // flash the dock (same rationale as DodgeController.stop).
                    if (!this._iconManager?._startupFadePending)
                        this._container.opacity = 255;
                }
            }
            catch (e) {}
        }
    }
    _startKeynav() {
        if (!this._settings?.get_boolean("keynav-enabled"))
            return;
        if (this._hotkeyNav)
            return;
        try {
            this._hotkeyNav = new HotkeyNavController();
            this._hotkeyNav.enable(this._settings, this);
        }
        catch (e) {
            console.warn(`${TAG} keynav start failed:`, e);
            this._hotkeyNav = null;
        }
    }
    _stopKeynav() {
        if (this._hotkeyNav) {
            try { this._hotkeyNav.disable(); } catch (e) {}
            this._hotkeyNav = null;
        }
    }
    _startGenie() {
        if (!this._settings?.get_boolean("genie-enabled"))
            return;
        if (this._genie)
            return;
        try {
            const genie = new GenieController(this, this._settings);
            if (genie.enable()) {
                this._genie = genie;
            }
            else {
                // enable() already warned loudly; degrade to the native
                // minimize animation and leave the dock otherwise untouched.
                this._genie = null;
            }
        }
        catch (e) {
            console.warn(`${TAG} genie start failed:`, e);
            this._genie = null;
        }
    }
    _stopGenie() {
        if (this._genie) {
            try { this._genie.disable(); } catch (e) {}
            this._genie = null;
        }
    }
    _refreshGenie() {
        if (this._settings?.get_boolean("genie-enabled"))
            this._startGenie();
        else
            this._stopGenie();
    }
    /**
     * Pop the dock up when a Super+number shortcut fires, so the user can see
     * the dock while launching, focusing, switching or minimizing an app.
     * No-op when dodge is off (the dock is always visible) or the user turned
     * the behaviour off.
     */
    peekForHotkey() {
        try {
            if (!this._settings?.get_boolean("keynav-peek-dock"))
                return;
            const ms = this._settings.get_int("keynav-peek-duration");
            this._dodge?.peekForAnimation(ms);
        }
        catch (_e) {}
    }
    _onAppClicked(app) {
        const firstWindow = this._findFirstWindow(app);
        if (firstWindow) {
            if (firstWindow.has_focus() && !firstWindow.minimized) {
                // Window is focused and visible — minimize it.
                firstWindow.minimize();
            }
            else if (firstWindow.minimized) {
                // Window is minimized — restore and activate.
                firstWindow.unminimize();
                firstWindow.activate(global.get_current_time());
            }
            else {
                // Window exists but not focused — activate it.
                firstWindow.activate(global.get_current_time());
            }
        }
        else if (app) {
            // app can be null if the icon's app vanished mid-click (map race).
            app.open_new_window(-1);
        }
        // Exit the overview on icon click (the dock is reachable there), and
        // re-sync the Dash showApps checkbox so a later toggle sees a clean state.
        try {
            if (Main.overview?.visible)
                Main.overview.hide();
        }
        catch (e) {}
        try {
            const sab = Main.overview?.dash?.showAppsButton;
            if (sab && sab.checked !== false)
                sab.checked = false;
        }
        catch (e) {}
    }
    _onMediaAction(action) {
        if (!this._mediaManager)
            return;
        switch (action) {
            case "play-pause":
                this._mediaManager.togglePlayPause();
                break;
            case "next":
                this._mediaManager.next();
                break;
            case "previous":
                this._mediaManager.previous();
                break;
        }
    }
    _findFirstWindow(app) {
        const tracker = Shell.WindowTracker.get_default();
        const windows = global.get_window_actors();
        for (const wa of windows) {
            const metaWin = wa.get_meta_window();
            if (!metaWin)
                continue;
            if (tracker.get_window_app(metaWin) === app) {
                return metaWin;
            }
        }
        return null;
    }
    _onFocusAppChanged() {
        if (!this._settings)
            return;
        if (!this._settings.get_boolean("bounce-on-launch"))
            return;
        if (!this._iconManager)
            return;
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.focus_app;
        if (!app) {
            this._lastFocusedApp = null;
            return;
        }
        const appId = app.get_id();
        if (this._lastFocusedApp === app)
            return;
        this._lastFocusedApp = app;
        if (this._recentlyLaunched.has(appId))
            return;
        this._recentlyLaunched.add(appId);
        if (this._debounceSourceId !== null) {
            GLib.source_remove(this._debounceSourceId);
            if (this._pendingDebounceAppId)
                this._recentlyLaunched.delete(this._pendingDebounceAppId);
        }
        this._pendingDebounceAppId = appId;
        this._debounceSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DockManager.LAUNCH_DEBOUNCE_MS, () => {
            this._recentlyLaunched.delete(appId);
            this._pendingDebounceAppId = null;
            this._debounceSourceId = null;
            return GLib.SOURCE_REMOVE;
        });
        this._iconManager.bounceForApp(app);
    }
    _computeContainerRect() {
        if (!this._container)
            return null;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;
        const iconCount = this._iconManager?.getIconCount() ?? 0;
        const hasSeparator = this._iconManager?.hasSeparator() ?? false;
        const hasAppButton = this._iconManager?.hasAppButton() ?? false;
        const iconPadded = (this._settings?.get_int("icon-size") ?? 48) + 12;
        const spacing = 6;
        const padding = 20;
        const separatorWidth = 9; // 1px width + 4px margin each side
        const contentSize = iconCount > 0
            ? iconCount * iconPadded +
                (iconCount - 1) * spacing +
                (hasSeparator ? separatorWidth + spacing : 0) +
                (hasAppButton ? iconPadded + spacing : 0)
            : hasAppButton
                ? iconPadded
                : 0;
        const dockAxisSize = Math.max(contentSize + padding, DockManager.MIN_DOCK_WIDTH);
        let x = 0;
        let y = 0;
        let w = 0;
        let h = 0;
        switch (this._dockPosition) {
            case POSITIONS.BOTTOM:
                w = dockAxisSize;
                h = this._dockHeight;
                x = monitor.x + Math.floor((monitor.width - w) / 2);
                y = monitor.y + monitor.height - h - DockManager.MARGIN_BOTTOM;
                break;
            case POSITIONS.TOP:
                w = dockAxisSize;
                h = this._dockHeight;
                x = monitor.x + Math.floor((monitor.width - w) / 2);
                y = monitor.y + DockManager.MARGIN_BOTTOM;
                break;
            case POSITIONS.LEFT:
                w = this._dockHeight;
                h = dockAxisSize;
                x = monitor.x + DockManager.MARGIN_BOTTOM;
                y = monitor.y + Math.floor((monitor.height - h) / 2);
                break;
            case POSITIONS.RIGHT:
                w = this._dockHeight;
                h = dockAxisSize;
                x = monitor.x + monitor.width - w - DockManager.MARGIN_BOTTOM;
                y = monitor.y + Math.floor((monitor.height - h) / 2);
                break;
        }
        return { x, y, w, h };
    }
    _updatePosition() {
        const rect = this._computeContainerRect();
        if (!rect)
            return;
        this._container.set_size(rect.w, rect.h);
        this._container.set_position(rect.x, rect.y);
        // The genie resolver caches icon rects; a layout change invalidates
        // them, so let the controller re-warm its cache.
        if (this._genie) {
            try { this._genie.onLayoutChanged(); } catch (_e) {}
        }
    }
    getRestingContainerRect() {
        return this._computeContainerRect();
    }
    getContainerActor() {
        return this._container;
    }
    _hideDefaultDash() {
        try {
            const dash = Main.overview?.dash;
            if (!dash) return;
            this._originalDashVisible = dash.visible;
            dash.hide();
            const dashSpacer = dash._dashSpacer;
            if (dashSpacer) {
                dashSpacer.visible = false;
            }
        } catch (e) {
            console.warn(`${TAG} _hideDefaultDash failed:`, e);
        }
    }
    _showDefaultDash() {
        try {
            const dash = Main.overview?.dash;
            if (!dash) return;
            dash.visible = this._originalDashVisible ?? true;
            const dashSpacer = dash._dashSpacer;
            if (dashSpacer) {
                dashSpacer.visible = true;
            }
        } catch (e) {
            console.warn(`${TAG} _showDefaultDash failed:`, e);
        }
    }
    _applyDockStyle() {
        if (!this._container || !this._settings)
            return;
        const opacity = this._settings.get_int("dock-opacity");
        const color = this._settings.get_string("dock-background-color");
        const radius = this._settings.get_int("dock-border-radius");
        const blurEnabled = this._settings.get_boolean("dock-blur-enabled");
        // Parse hex color
        const r = parseInt(color.slice(1, 3), 16) || 30;
        const g = parseInt(color.slice(3, 5), 16) || 30;
        const b = parseInt(color.slice(5, 7), 16) || 30;
        const alpha = opacity / 100;
        this._container.style = `
      background-color: rgba(${r}, ${g}, ${b}, ${alpha});
      border-radius: ${radius}px;
      padding: ${FIXED_ICON_VPAD}px 10px 0px 10px;
      spacing: 6px;
    `;
        // Handle blur effect
        if (blurEnabled && !this._blurEffect) {
            this._blurEffect = new Shell.BlurEffect();
            this._blurEffect.set({ sigma: 30, mode: Shell.BlurMode.BACKGROUND });
            this._container.add_effect(this._blurEffect);
        }
        else if (!blurEnabled && this._blurEffect) {
            this._container.remove_effect(this._blurEffect);
            this._blurEffect = null;
        }
    }
    _applyDockPosition() {
        if (!this._container)
            return;
        this._dockPosition = this._settings?.get_int("dock-position") ?? POSITIONS.BOTTOM;
        const isVertical = this._dockPosition === POSITIONS.LEFT || this._dockPosition === POSITIONS.RIGHT;
        this._container.vertical = isVertical;
        // Update magnification pivot point based on position
        if (this._magnification) {
            switch (this._dockPosition) {
                case POSITIONS.TOP:
                    this._magnification.setPivotPoint(0.5, 0.0);
                    break;
                case POSITIONS.LEFT:
                    this._magnification.setPivotPoint(0.0, 0.5);
                    break;
                case POSITIONS.RIGHT:
                    this._magnification.setPivotPoint(1.0, 0.5);
                    break;
                default: // BOTTOM
                    this._magnification.setPivotPoint(0.5, 1.0);
            }
        }
        this._updatePosition();
    }
}
