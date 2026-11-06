import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { IconManager, TRASH_ICON_ID } from "./iconManager.js";
import { applyClickAction, showsPreviewsOnClick } from "./clickAction.js";
import { TrashManager } from "./trashManager.js";
import { DockDnd } from "./dockDnd.js";
import { Magnification } from "./magnification.js";
import { MediaManager } from "./mediaManager.js";
import { SignalManager } from "./signalManager.js";
import { WindowPreviewPopup } from "./windowPreview.js";
import { DodgeController } from "./dodge.js";
import { HotkeyNavController } from "./hotkeyNav.js";
import { applyIconFix } from "./iconFix.js";
import { GenieController } from "./genieController.js";
import { applyOverviewPatches } from "./overviewPatches.js";
import { applyAppButtonFix } from "./overviewApps.js";
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
    _trashManager = null;
    _dockDnd = null;
    _magnification = null;
    _settings = null;
    _lastFocusedApp = null;
    _recentlyLaunched = new Set();
    _debounceSourceId = null;
    _extentCheckId = null;
    _pendingDebounceAppId = null;
    _dockPosition = POSITIONS.BOTTOM;
    _blurEffect = null;
    _previewPopup = null;
    _mediaManager = null;
    _genie = null;
    _overviewPatchesRevert = null;
    _revertAppButton = null;
    static MARGIN_BOTTOM = -1;
    static MIN_DOCK_WIDTH = 300;
    static LAUNCH_DEBOUNCE_MS = 400;
    constructor() {
        this._signals = new SignalManager();
    }
    // Height a hovered icon settles at, as a scale factor. 1 when magnification is
    // off, so callers can use it without asking whether the feature is on.
    // Vertical anchor of magnification, mirrored into the icon manager so a label
    // can be placed against the edge an icon keeps. Set by _applyDockPosition.
    _magPivotY = 1.0;
    _magnificationScale() {
        try {
            if (!this._settings?.get_boolean("magnification-enabled"))
                return 1;
            return this._settings.get_double("magnification-scale");
        } catch (e) {
            return 1;
        }
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
        // The extent check reads what is painted, so it may only testify while the
        // dock is on screen -- and it has to be re-armed when it comes back, or
        // dodging would silence a real disagreement instead of deferring it.
        this._signals.connect(this._container, "notify::visible",
            () => this._scheduleExtentCheck());
        Main.layoutManager.addTopChrome(this._container);
        // Trash manager: keeps the Trash window out of the Files icon at the
        // dock level without patching the Files Shell.App globally.
        try {
            this._trashManager = new TrashManager();
            this._trashManager.start();
        }
        catch (e) {
            console.warn(`${TAG} trash manager start failed:`, e);
            this._trashManager = null;
        }
        // Icon manager: populates the container with app buttons.
        this._iconManager = new IconManager(this._container, settings.get_int("icon-size"), settings.get_boolean("running-indicators"), settings.get_int("icon-quality"), settings.get_int("running-indicator-style"));
        this._iconManager.setTrashManager(this._trashManager);
        this._iconManager.setShowTrash(settings.get_boolean("show-trash"));
        this._iconManager.setOnClicked((app, action) => this._onAppClicked(app, action));
        this._iconManager.setOnTrashClicked((action) => this._onTrashClicked(action));
        this._iconManager.setOnIconsChanged(() => this._updatePosition());
        // The label is placed against the dock's resting rect and the height a hovered
        // icon settles at, so it does not inherit the entry slide or the pre-grow size.
        this._iconManager.setOnRestingRect(() => this.getRestingContainerRect());
        this._iconManager.setMagnificationScale(this._magnificationScale(), this._magPivotY);
        this._iconManager.setOnMediaAction((action) => this._onMediaAction(action));
        this._iconManager.setShowRunningApps(settings.get_boolean("show-running-apps"));
        this._iconManager.setWorkspaceMode(settings.get_int("dock-workspace-mode"));
        this._iconManager.setMediaIndicatorEnabled(settings.get_boolean("media-indicator"));
        this._iconManager.setMediaControlsEnabled(settings.get_boolean("media-controls"));
        // Window preview popup
        this._previewPopup = new WindowPreviewPopup();
        // Trash windows belong to Files at the Shell level, so they are dropped
        // from every other icon's preview -- except the Trash's own.
        this._previewPopup.setWindowFilter((window, app) => {
            if (app?.get_id?.() === TRASH_ICON_ID)
                return true;
            return !this._iconManager?.representsTrashWindow(window);
        });
        this._previewPopup.setPreviewWidth(settings.get_int("preview-scale"));
        this._iconManager.setPreviewPopup(this._previewPopup);
        this._iconManager.setWindowPreviewsEnabled(settings.get_boolean("window-previews"));
        this._iconManager.setTooltipGap(settings.get_int("tooltip-gap-px"));
        this._iconManager.setTooltipDelay(settings.get_int("tooltip-delay-ms"));
        this._iconManager.setMaxIndicatorDots(settings.get_int("max-indicator-dots"));
        this._iconManager.start();
        // Drag-and-drop: attached after start() because its unpin target is the
        // applications button, which start() is what creates.
        try {
            this._dockDnd = new DockDnd(this._iconManager);
            this._dockDnd.setDragHoldMs(settings.get_int("drag-hold-ms"));
            this._dockDnd.setEnabled(settings.get_boolean("dock-dnd-enabled"));
            this._iconManager.setDnd(this._dockDnd);
            this._dockDnd.start();
        }
        catch (e) {
            console.warn(`${TAG} dock drag-and-drop start failed:`, e);
            this._dockDnd = null;
            this._iconManager.setDnd(null);
        }
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
        // Show Apps button fix: its own concern (D-058), decoupled from the
        // running-icons fix. Applies once the icon row exists.
        this._startAppButtonFix();
        // Magnification: scale icons on hover.
        this._magnification = new Magnification(this._container, settings.get_boolean("magnification-enabled"), settings.get_double("magnification-scale"), settings.get_int("magnification-falloff"), settings.get_int("magnification-framerate"));
        this._magnification.start();
        // The drag suspends it for the gesture (D-134); the manager owns the
        // instance, so hand it over once it exists.
        if (this._dockDnd)
            this._dockDnd.setMagnification(this._magnification);
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
            this._iconManager?.setMagnificationScale(this._magnificationScale(), this._magPivotY);
        });
        this._signals.connect(settings, "changed::magnification-scale", () => {
            if (this._magnification) {
                this._magnification.setMaxScale(settings.get_double("magnification-scale"));
                }
            this._iconManager?.setMagnificationScale(this._magnificationScale(), this._magPivotY);
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
        this._signals.connect(settings, "changed::show-trash", () => {
            if (this._iconManager) {
                this._iconManager.setShowTrash(settings.get_boolean("show-trash"));
            }
            this._updatePosition();
        });
        this._signals.connect(settings, "changed::dock-dnd-enabled", () => {
            this._dockDnd?.setEnabled(settings.get_boolean("dock-dnd-enabled"));
        });
        this._signals.connect(settings, "changed::tooltip-gap-px", () => {
            this._iconManager?.setTooltipGap(settings.get_int("tooltip-gap-px"));
        });
        this._signals.connect(settings, "changed::tooltip-delay-ms", () => {
            this._iconManager?.setTooltipDelay(settings.get_int("tooltip-delay-ms"));
        });
        this._signals.connect(settings, "changed::max-indicator-dots", () => {
            this._iconManager?.setMaxIndicatorDots(settings.get_int("max-indicator-dots"));
        });
        this._signals.connect(settings, "changed::drag-hold-ms", () => {
            this._dockDnd?.setDragHoldMs(settings.get_int("drag-hold-ms"));
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
        this._signals.connect(settings, "changed::overview-patches-enabled", () => {
            try { this._refreshOverviewPatches(); } catch (e) {}
        });
        this._signals.connect(settings, "changed::apps-button-fix-enabled", () => {
            try { this._refreshAppButtonFix(); } catch (e) {}
        });
        this._startDodge();
        this._startKeynav();
        this._startGenie();
        this._startOverviewPatches();
        console.log(`${TAG} enable() total ${(GLib.get_monotonic_time() - tEnable) / 1000}ms`);
    }
    disable() {
        // Tear down the genie first: it must finish in-flight animations and
        // restore actor scale/opacity while the icon manager and container
        // still exist.
        this._stopGenie();
        this._stopDodge();
        this._stopKeynav();
        this._stopOverviewPatches();
        if (this._revertIconsSourceId !== null) {
            try { GLib.source_remove(this._revertIconsSourceId); } catch (e) {}
            this._revertIconsSourceId = null;
        }
        if (this._extentCheckId !== null) {
            try { GLib.source_remove(this._extentCheckId); } catch (e) {}
            this._extentCheckId = null;
        }
        if (this._revertIcons) {
            try {
                if (typeof this._revertIcons === "function")
                    this._revertIcons();
            }
            catch (e) {}
            this._revertIcons = null;
        }
        // No rebuild: the row is destroyed moments later, so re-creating 16
        // icons here only costs time and fills the journal during teardown.
        this._stopAppButtonFix(false);
        if (this._dockDnd) {
            try { this._dockDnd.stop(); } catch (e) { console.warn(`${TAG} dockDnd.stop() failed:`, e); }
            this._dockDnd = null;
        }
        if (this._trashManager) {
            try { this._trashManager.stop(); } catch (e) { console.warn(`${TAG} trashManager.stop() failed:`, e); }
            this._trashManager = null;
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
    // Overview layout patches (D-054 band + D-057 inset): a shell-layout concern
    // (D-058), gated by its own toggle. The band needs the dock's height, passed
    // in as a metrics provider — lib/overviewPatches.js never imports this class.
    _startOverviewPatches() {
        if (!this._settings?.get_boolean("overview-patches-enabled"))
            return;
        if (this._overviewPatchesRevert)
            return;
        try {
            this._overviewPatchesRevert = applyOverviewPatches({
                getBandMetrics: () => this.getOverviewBandMetrics(),
            });
        }
        catch (e) {
            console.warn(`${TAG} overview patches failed:`, e);
            this._overviewPatchesRevert = null;
        }
    }
    _stopOverviewPatches() {
        if (this._overviewPatchesRevert) {
            try { this._overviewPatchesRevert(); } catch (e) {}
            this._overviewPatchesRevert = null;
        }
    }
    _refreshOverviewPatches() {
        if (this._settings?.get_boolean("overview-patches-enabled"))
            this._startOverviewPatches();
        else
            this._stopOverviewPatches();
    }
    // Show Apps button fix (D-058): dock-coupled (it patches the dock's own
    // IconManager button), so it lives here rather than in the shell-patch
    // module — but it has its OWN toggle, decoupled from icons-fix-enabled.
    _startAppButtonFix() {
        if (!this._settings?.get_boolean("apps-button-fix-enabled"))
            return;
        if (this._revertAppButton)
            return;
        if (!this._iconManager)
            return;
        try {
            this._revertAppButton = applyAppButtonFix(this._iconManager);
        }
        catch (e) {
            console.warn(`${TAG} apps-button fix failed:`, e);
            this._revertAppButton = null;
        }
    }
    /**
     * `rebuild` is false on the teardown path only. The fix detaches the
     * button's original press/hover handlers and cannot re-attach them (their
     * connection ids live inside SignalManager's bookkeeping, which the patch
     * already dropped), so turning the fix OFF mid-session has to rebuild the
     * row to get the stock handlers back. During `disable()` that rebuild is
     * pure waste — the container is destroyed moments later — and it measured
     * 16 icons / 33.5 ms plus a `+trash`/`+separator`/`reload:` burst between
     * the revert and `[dnd] stopped` in the journal.
     */
    _stopAppButtonFix(rebuild = true) {
        if (this._revertAppButton) {
            try { this._revertAppButton.revert?.(); } catch (e) {}
            this._revertAppButton = null;
        }
        if (!rebuild)
            return;
        // The fix replaced the button's original press handler; rebuild the row
        // so the stock handler comes back rather than leaving a dead button.
        try { this._iconManager?.reload?.("apps-button-fix-disabled"); } catch (e) {}
    }
    _refreshAppButtonFix() {
        if (this._settings?.get_boolean("apps-button-fix-enabled"))
            this._startAppButtonFix();
        else
            this._stopAppButtonFix();
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
    _onAppClicked(app, action = "activate") {
        if (action === "new-window") {
            // Middle-click and the menu's New Window row: another window, whether
            // one exists or not.
            app?.open_new_window(-1);
            this._exitOverview();
            return;
        }
        const windows = this._findWindows(app);
        // Ubuntu's default click action, `focus-or-previews`: several windows and
        // one of them focused opens the window list instead of acting on a single
        // window. Previews switched off, or the icon gone mid-click, fall through
        // to the toggle rather than swallowing the click.
        if (showsPreviewsOnClick(windows.length, windows.some((window) => window.has_focus())) &&
            this._iconManager?.pinAppPreviews(app)) {
            this._exitOverview();
            return;
        }
        applyClickAction(windows[0] ?? null, global.get_current_time(), () => {
            // app can be null if the icon's app vanished mid-click (map race).
            app?.open_new_window(-1);
        });
        this._exitOverview();
    }
    /**
     * Trash presses arrive here so the click semantics and the overview teardown
     * live next to the app-icon ones they imitate.
     */
    _onTrashClicked(action) {
        const trash = this._trashManager;
        if (!trash)
            return;
        if (action === "new-window")
            trash.openNewWindow();
        else {
            // The same rule as an app icon, including the multi-window preview --
            // the Trash can have several windows open, and its own icon is the
            // only thing that knows about them.
            const windows = trash.getWindows();
            const previews = showsPreviewsOnClick(windows.length,
                windows.some((window) => window.has_focus())) &&
                this._iconManager?.pinTrashPreviews();
            if (!previews)
                trash.activate();
        }
        this._exitOverview();
    }
    // Exit the overview on icon click (the dock is reachable there), and
    // re-sync the Dash showApps checkbox so a later toggle sees a clean state.
    _exitOverview() {
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
    /**
     * Every window of `app` that the dock shows on this icon -- so the Trash
     * windows, which are Nautilus windows at the Shell level but belong to the
     * Trash button here, are left out (Ubuntu Dock's app icon never counts them
     * either).
     */
    _findWindows(app) {
        const tracker = Shell.WindowTracker.get_default();
        const windows = [];
        for (const wa of global.get_window_actors()) {
            const metaWin = wa.get_meta_window();
            if (!metaWin)
                continue;
            if (this._iconManager?.representsTrashWindow(metaWin))
                continue;
            if (tracker.get_window_app(metaWin) === app)
                windows.push(metaWin);
        }
        return windows;
    }
    _onFocusAppChanged() {
        if (!this._settings)
            return;
        if (!this._settings.get_boolean("bounce-on-launch"))
            return;
        if (!this._iconManager)
            return;
        if (this._iconManager?.representsTrashWindow(global.display.focus_window))
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
        const vertical = this._dockPosition === POSITIONS.LEFT ||
            this._dockPosition === POSITIONS.RIGHT;
        // The dock's length is the row's, measured off the children that are
        // actually in it. It used to be estimated from counts (icons + separator
        // + tail + a flag for the drag gap), and every child the estimate did not
        // know about put the trailing icons outside the background -- which is
        // what the live session showed after a drag. Ubuntu's dash has no such
        // estimate: the box is sized by its content. Reading the content here
        // also makes the gap's own width animation move the background, so the
        // dock grows and shrinks with the gap instead of jumping by a slot.
        // Measured here: the request comes off the actor, the gap between
        // requests lives on the BoxLayout (`container.spacing` is not a thing),
        // and a child's CSS margin is already folded into its own request --
        // adding it again overshoots the separator by 8px per row.
        const spacing = this._container.get_layout_manager().spacing;
        const padding = 20; // .macos-dock-container: 10px on each end
        let content = 0;
        let counted = 0;
        for (const child of this._container.get_children()) {
            if (!child.visible)
                continue;
            counted++;
            content += vertical ? child.get_preferred_height(0)[1]
                : child.get_preferred_width(0)[1];
        }
        if (counted > 0)
            content += spacing * (counted - 1);
        const dockAxisSize = Math.max(Math.round(content + padding),
            DockManager.MIN_DOCK_WIDTH);
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
        this._scheduleExtentCheck();
    }
    /**
     * One debounced, silent-unless-wrong check that the background we just
     * sized really covers the row it is drawn behind. This is the class of bug
     * the owner photographed twice and no offline tier can see: the sandbox has
     * no fractional scaling, no user theme and no live drag, so a length that
     * only disagrees on this machine would pass the offline tiers forever.
     * Compared against the children's own allocation -- what is actually painted
     * -- and only once things have settled, because during the gap's 200ms growth
     * the request legitimately runs one frame ahead of the allocation.
     */
    _scheduleExtentCheck() {
        if (this._extentCheckId !== null || !this._container)
            return;
        this._extentCheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
            this._extentCheckId = null;
            this._checkExtentAgreement();
            return GLib.SOURCE_REMOVE;
        });
    }
    _checkExtentAgreement() {
        const c = this._container;
        if (!c)
            return;
        // A dock that is hidden paints nothing, so there is nothing to cover:
        // `hide()` freezes the children's allocations while the length goes on
        // being computed from their requests, and the two then disagree by
        // whatever changed while the dock was away. It said so twice this boot,
        // with identical numbers -- "background 1127 does not cover the row's 930
        // (19 children)" at login and again right after a drop, both times with
        // the pointer gone and dodge holding the dock off screen. `notify::visible`
        // re-arms this, so the row is still judged once it is actually painted.
        if (!c.visible)
            return;
        // The gap is deliberately a child while it grows and while it shrinks:
        // its slot is real to the layout, but the row is mid-change. Judging it
        // here reads the request half a frame ahead of the allocation and warns
        // about a background the owner never saw (journal: 20/21 children, the
        // background 1188/1249 vs the row's 991). The placeholder's destroy
        // calls notifyRowChanged(), which schedules the check again once the
        // row is settled, so the real agreement is still tested.
        if (this._dockDnd?._placeholder ||
            (this._dockDnd?._animatingPlaceholders ?? 0) > 0)
            return;
        const vertical = this._dockPosition === POSITIONS.LEFT ||
            this._dockPosition === POSITIONS.RIGHT;
        const gap = this._dockDnd?._placeholder ?? null;
        let low = Infinity, high = -Infinity, n = 0;
        for (const child of c.get_children()) {
            if (!child.visible)
                continue;
            n++;
            const start = vertical ? child.y : child.x;
            const size = vertical ? child.height : child.width;
            // An unallocated row says nothing about the background: at login the
            // first sample of this check measured one painted icon out of
            // eighteen and called the dock 1011px too long. Only the gap may be
            // zero-sized on purpose, while it widens in or shrinks out.
            if (size === 0 && child !== gap)
                return;
            low = Math.min(low, start);
            high = Math.max(high, start + size);
        }
        if (n === 0)
            return;
        const rect = this._computeContainerRect();
        if (!rect)
            return;
        const painted = Math.round(high + low);
        const length = vertical ? rect.h : rect.w;
        if (Math.abs(length - painted) > 2) {
            console.warn(`${TAG} [layout] background ${length} does not cover the row's ${painted} (${n} children, position=${this._dockPosition})`);
        }
    }
    getRestingContainerRect() {
        return this._computeContainerRect();
    }
    getContainerActor() {
        return this._container;
    }
    _dockOccupiedHeight() {
        // Height of the screen strip the dock occupies, measured up from the
        // bottom edge (logical px). Derived from the very rect the dock is
        // positioned with, so it tracks icon-size / monitor changes.
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return 0;
        const rect = this._computeContainerRect();
        if (!rect)
            return 0;
        return Math.max(0, monitor.y + monitor.height - rect.y);
    }
    getOverviewBandMetrics() {
        // Injected into lib/overviewPatches.js: its band shadow reads the dock's
        // position + occupied height without that module importing this class.
        return { position: this._dockPosition, occupiedHeight: this._dockOccupiedHeight() };
    }
    _hideDefaultDash() {
        try {
            const dash = Main.overview?.dash;
            if (!dash) return;
            dash.hide();
            // `dash._dashSpacer` does not exist in 50.1 (verified — it appears
            // nowhere in this shell's ui/*.js), so on this machine the branch below
            // is inert. Kept rather than deleted: removing it would be an
            // unverifiable behaviour change on any major where the field may still
            // be live; needs manual confirmation before removal (D-064, D-078).
            const dashSpacer = dash._dashSpacer;
            if (dashSpacer) {
                dashSpacer.visible = false;
            }
            // The overview bottom-band override that used to live here moved to
            // lib/overviewPatches.js (D-058): hiding the dash is the dock's job;
            // reserving the overview band is a shell-layout concern with its own
            // toggle, applied via _startOverviewPatches().
        } catch (e) {
            console.warn(`${TAG} _hideDefaultDash failed:`, e);
        }
    }
    _showDefaultDash() {
        try {
            const dash = Main.overview?.dash;
            if (!dash) return;
            // Restore to the shell's own default rather than a value captured at
            // enable(): the shell hides this dash itself during layout passes, so
            // a snapshot could have caught it transiently hidden and left the
            // overview without its dash after this extension was turned off.
            dash.show();
            const dashSpacer = dash._dashSpacer;
            if (dashSpacer) {
                dashSpacer.visible = true;
            }
            // The band shadow's revert is owned by lib/overviewPatches.js, which
            // disable() stops before calling this.
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
        // The separator spans the icons, so a side dock has to lay it down.
        this._iconManager?.applySeparatorGeometry();
        // Update magnification pivot point based on position
        // One place decides which edge of an icon stays put while it grows: the same
        // pivot feeds the icon manager, which places the label clear of the grown icon.
        if (this._magnification) {
            switch (this._dockPosition) {
                case POSITIONS.TOP:
                    this._magnification.setPivotPoint(0.5, 0.0);
                    this._magPivotY = 0.0;
                    break;
                case POSITIONS.LEFT:
                    this._magnification.setPivotPoint(0.0, 0.5);
                    this._magPivotY = 0.5;
                    break;
                case POSITIONS.RIGHT:
                    this._magnification.setPivotPoint(1.0, 0.5);
                    this._magPivotY = 0.5;
                    break;
                default: // BOTTOM
                    this._magnification.setPivotPoint(0.5, 1.0);
                    this._magPivotY = 1.0;
            }
        }
        this._iconManager?.setMagnificationScale(this._magnificationScale(), this._magPivotY);
        this._updatePosition();
    }
}
