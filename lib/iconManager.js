import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import St from "gi://St";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { getAppFavorites } from "resource:///org/gnome/shell/ui/appFavorites.js";
import { SignalManager } from "./signalManager.js";

// Gap between the label's bottom edge and the top edge of the icon it names,
// measured against the height that icon actually settles at once magnification
// has run. Ubuntu's dash uses 10px for a bottom dock (`margin-bottom` on
// `.dash-label.bottom`); this dock uses 6px by default and exposes the value as
// `tooltip-gap-px`, because the wrapper's own padding already contributes most
// of the visual distance.
const TOOLTIP_GAP = 6;
// The shell's own dash waits this long before naming an icon
// (DASH_ITEM_HOVER_TIMEOUT) and fades the label in over this long
// (DASH_ITEM_LABEL_SHOW_TIME), so sweeping the pointer across the row shows
// nothing at all instead of flashing every name.
const TOOLTIP_DELAY_MS = 300;
const TOOLTIP_FADE_MS = 150;
// The shell's dash caps the running dots the same way (MAX_WINDOWS_CLASSES): an
// application with a dozen windows must not lengthen the indicator row.
const MAX_INDICATOR_DOTS = 4;
// The Trash button has no Shell.App behind it, so the dock's app-id-keyed
// services — the genie animation target, the icon squash, the window preview —
// address it through this id instead. Nothing real can collide with it: app ids
// end in `.desktop`.
export const TRASH_ICON_ID = "macos-dock:trash";
/**
 * Manages app icons inside the dock container.
 *
 * Each icon is a small St.BoxLayout wrapping an St.Icon and a running
 * indicator dot. Icons are ordered: favorite apps first, then any
 * additional running-but-not-favorited apps (like macOS shows persistent
 * apps in the dock even when not in the favorites list).
 */
export class IconManager {
    static MEDIA_BADGE_SIZE = 12;
    static MEDIA_BADGE_INSET = 3;
    // Boot settle window: while the session restores apps (installed-changed
    // bursts), external reload requests are debounced into ONE incremental
    // sync. installed-changed / favorite-apps NEVER full-reload anymore —
    // the full rebuild was the login-flicker root cause (journal showed full
    // rebuilds flashing the dock at T+60~90s). First paint stays immediate.
    static SETTLE_WINDOW_MS = 12000;
    static SETTLE_DEBOUNCE_MS = 1500;
    static STARTUP_GRACE_MS = 1200;
    // Conditional early grace-end: reveal once the session is quiet (no
    // window events for QUIET_MS after FLOOR_MS). The cap above stays as the
    // worst-case bound, so slow sessions behave exactly as before.
    static STARTUP_GRACE_FLOOR_MS = 400;
    static STARTUP_GRACE_QUIET_MS = 500;
    static BRAND_ICON = "start-here-symbolic";
    _signals;
    _container;
    _iconSize;
    _runningIndicatorsEnabled;
    _indicatorStyle; // 0 = dots per window, 1 = horizontal bar
    _onClicked = null;
    _onIconsChanged = null;
    _onMediaAction = null;
    _mediaControlsEnabled = false;
    _icons = new Map();
    _apps = new Map();
    _favorites = [];
    _shellSettings = null;
    _windowChangeSourceId = null;
    _startupMono = 0;
    _settleSourceId = null;
    _settleReason = null;
    _tooltipText = null;
    // The icon the label is currently anchored to, kept so it can be re-placed when
    // the dock moves (see _positionTooltip).
    _tooltipActor = null;
    _tooltipAppId = null;
    _tooltipSourceId = null;
    // Scale a hovered icon settles at, and the rect the dock rests at. Both come from
    // DockManager: the label is placed for the settled geometry, not the live one.
    _magScale = 1;
    _magPivotY = 1;
    // User-tunable; the constants above are the defaults the schema ships.
    _tooltipGap = TOOLTIP_GAP;
    _tooltipDelayMs = TOOLTIP_DELAY_MS;
    _maxIndicatorDots = MAX_INDICATOR_DOTS;
    _restingRect = null;
    _contextMenu = null;
    _menuSignals = null;
    _menuManager = null;
    _reloadBatching = false;
    // Scoped scratch for one _refreshAllIndicators pass (see _countWindowsByApp).
    _indicatorCounts = null;
    _started = false;
    _startupFadePending = true;
    _startupGraceActive = false;
    _postGraceSourceId = null;
    _graceCheckSourceId = null;
    _lastWindowEventMono = 0;
    _separator = null;
    _appButton = null;
    _trashButton = null;
    _trashIcon = null;
    _trashIconWrapper = null;
    _trashIndicatorBox = null;
    _trashIndicatorState = null;
    _trashManager = null;
    _showTrash = true;
    _dnd = null;
    _dragInProgress = false;
    _dndDeferred = null;
    _pressedIcon = null;
    _pressedTrash = null;
    _onTrashClicked = null;
    _appButtonIcon = null;
    _showAppButton = true;
    _showRunningApps = true;
    _workspaceMode = 0; // 0=all, 1=current-only
    _mediaIndicatorEnabled = true;
    _playingAppId = null;
    _windowPreviewsEnabled = false;
    _previewPopup = null;
    constructor(container, iconSize, runningIndicatorsEnabled, _quality = 2, indicatorStyle = 0) {
        this._signals = new SignalManager();
        this._container = container;
        this._iconSize = iconSize;
        this._runningIndicatorsEnabled = runningIndicatorsEnabled;
        // Texture multiplier from the icon-quality setting. Until this was stored, the
        // setter re-applied the same size and the preference did nothing at all.
        this._quality = Math.max(1, _quality);
        this._indicatorStyle = indicatorStyle;
        // The label is placed from the dock's resting geometry, so it does not need to
        // follow the entry slide. These keep it glued when the dock itself moves or
        // resizes underneath a label that is already visible.
        this._signals.connect(container, "notify::x", () => this._repositionTooltip());
        this._signals.connect(container, "notify::y", () => this._repositionTooltip());
    }
    setOnClicked(callback) {
        this._onClicked = callback;
    }
    // Trash presses route through the dock for the same reason app clicks do:
    // leaving the overview is the shell layer's job, not a button's.
    setOnTrashClicked(callback) {
        this._onTrashClicked = callback;
    }
    setOnIconsChanged(callback) {
        this._onIconsChanged = callback;
    }
    // Where the dock sits when it is not mid-slide. The label must not inherit the
    // entry offset, so it is placed against this rect rather than the live actor.
    setOnRestingRect(callback) {
        this._restingRect = callback;
    }
    // 1 when magnification is off: the label then sits against the resting top
    // instead of a height the icon never reaches. pivotY says which edge of the icon
    // stays put while it grows -- 1 anchors the bottom (a bottom dock), 0 the top, 0.5
    // the centre (side docks), so the label clears the icon whichever way it grows.
    setMagnificationScale(scale, pivotY = 1) {
        this._magScale = Math.max(1, Number(scale) || 1);
        this._magPivotY = Math.min(1, Math.max(0, Number(pivotY) || 0));
        this._repositionTooltip();
    }
    setTooltipGap(px) {
        const next = Math.min(30, Math.max(0, Math.round(Number(px) || 0)));
        if (next === this._tooltipGap)
            return;
        this._tooltipGap = next;
        this._repositionTooltip();
    }
    setTooltipDelay(ms) {
        this._tooltipDelayMs = Math.min(2000, Math.max(0, Math.round(Number(ms) || 0)));
    }
    setMaxIndicatorDots(count) {
        const next = Math.min(10, Math.max(1,
            Math.round(Number(count) || MAX_INDICATOR_DOTS)));
        if (next === this._maxIndicatorDots)
            return;
        this._maxIndicatorDots = next;
        this._refreshAllIndicators();
        this._refreshTrashIndicator();
    }
    setOnMediaAction(callback) {
        this._onMediaAction = callback;
    }
    setMediaControlsEnabled(enabled) {
        this._mediaControlsEnabled = enabled;
    }
    setIconSize(size) {
        this._iconSize = size;
        for (const actor of this._icons.values()) {
            this._applyIconSize(actor);
        }
        if (this._appButton && this._appButtonIcon) {
            this._appButtonIcon.set_icon_size(this._iconSize);
            const padded = this._iconSize + 12;
            this._appButton.set_size(padded, padded + 4);
        }
        this._applyTrashIconSize();
        this.applySeparatorGeometry();
    }
    setQuality(quality) {
        this._quality = Math.max(1, quality);
        for (const actor of this._icons.values()) {
            this._applyIconSize(actor);
        }
        // The trash icon is a full-colour themed icon like the app icons, so it
        // follows the texture pipeline rather than the symbolic app button.
        // The app button's brand icon keeps the logical size: it is the symbolic
        // `start-here-symbolic` SVG, which St rasterises at whatever edge it is asked
        // for, so a doubled texture buys no sharpness -- and its parent is a BoxLayout
        // that allocates the child's preferred size, which would hand the 2x texture a
        // 2x cell and leave the scaled-down paint in that cell's top-left corner.
        // The trash icon is a full-colour themed icon like the app icons, so it
        // follows the texture pipeline rather than that symbolic button.
        this._applyTrashIconSize();
    }
    setIndicatorStyle(style) {
        this._indicatorStyle = style;
        this._refreshAllIndicators();
        this._refreshTrashIndicator();
    }
    setRunningIndicatorsEnabled(enabled) {
        this._runningIndicatorsEnabled = enabled;
        for (const [appId, actor] of this._icons.entries()) {
            this._refreshRunningIndicator(actor, appId);
        }
        this._refreshTrashIndicator();
    }
    setShowAppButton(show) {
        this._showAppButton = show;
        this._updateAppButton();
        this._updateSeparator("tail-button");
    }
    setShowRunningApps(enabled) {
        this._showRunningApps = enabled;
        // Skipped during enable(): dockManager sets this before start(), and
        // start()'s own _reload() already reads the field. This guard is
        // load-bearing — reloading here would consume _startupFadePending (the
        // fade now arms on the first reload only), leaving start()'s full
        // rebuild to run on an already-visible dock = flash.
        if (this._started)
            this._reload("show-running-apps");
    }
    setWorkspaceMode(mode) {
        this._workspaceMode = mode;
        if (this._started)
            this._reload("workspace-mode");
    }
    reload(reason = "external") {
        this._reload(reason);
    }
    setMediaIndicatorEnabled(enabled) {
        this._mediaIndicatorEnabled = enabled;
        this._refreshAllMediaIndicators();
    }
    setPlayingApp(appId) {
        this._playingAppId = appId;
        this._refreshAllMediaIndicators();
    }
    setPreviewPopup(popup) {
        this._previewPopup = popup;
    }
    setWindowPreviewsEnabled(enabled) {
        this._windowPreviewsEnabled = enabled;
    }
    start() {
        const appSystem = Shell.AppSystem.get_default();
        this._signals.connect(appSystem, "installed-changed", () => this._requestReload("installed-changed"));
        // Cache org.gnome.shell settings and refresh the dock when the user
        // pins/unpins a favorite (previously only picked up on an unrelated
        // reload). Disconnected by stop()'s disconnectAll().
        try {
            this._shellSettings = new Gio.Settings({ schema: "org.gnome.shell" });
            this._signals.connect(this._shellSettings, "changed::favorite-apps", () => this._requestReload("favorite-apps"));
        }
        catch (_e) {
            this._shellSettings = null;
        }
        const tracker = Shell.WindowTracker.get_default();
        this._signals.connect(tracker, "notify::focus-app", () => this._refreshAllIndicators());
        this._signals.connect(global.display, "window-created", () => this._onWindowChange());
        this._signals.connect(global.display, "window-entered-monitor", () => this._onWindowChange());
        this._signals.connect(global.display, "window-left-monitor", () => this._onWindowChange());
        // Initialize tooltip - add to top chrome layer like the dock
        this._tooltipText = new St.Label({
            style_class: "macos-dock-tooltip",
            text: "",
            visible: false,
        });
        Main.layoutManager.addTopChrome(this._tooltipText);
        this._menuManager = new PopupMenu.PopupMenuManager(this._container);
        try { this._startupMono = GLib.get_monotonic_time(); } catch (_e) { this._startupMono = 0; }
        // The grace suppresses UPDATES only (installed-changed / favorite-apps
        // / window-change are dropped until it ends, then settled by one
        // incremental sync) — it no longer gates visibility, the first paint
        // fades in immediately. Still set BEFORE _reload() so nothing slips
        // through while the icon row is being built.
        this._startupGraceActive = true;
        this._reload("startup");
        this._postGraceSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IconManager.STARTUP_GRACE_MS, () => {
            this._postGraceSourceId = null;
            this._endStartupGrace();
            return GLib.SOURCE_REMOVE;
        });
        // Conditional early grace-end checker (200ms cadence, startup only):
        // end the grace as soon as the floor is reached AND no window event
        // arrived during the quiet window. Bursts still in flight keep the
        // grace alive; the cap timer above ends it regardless.
        this._lastWindowEventMono = 0;
        try {
            this._graceCheckSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                if (!this._startupGraceActive) {
                    this._graceCheckSourceId = null;
                    return GLib.SOURCE_REMOVE;
                }
                let now = 0;
                try { now = GLib.get_monotonic_time(); } catch (_e) {}
                const elapsedMs = this._startupMono ? (now - this._startupMono) / 1000 : 9999;
                const quietMs = this._lastWindowEventMono ? (now - this._lastWindowEventMono) / 1000 : 9999;
                if (elapsedMs >= IconManager.STARTUP_GRACE_FLOOR_MS &&
                    quietMs >= IconManager.STARTUP_GRACE_QUIET_MS) {
                    this._graceCheckSourceId = null;
                    if (this._postGraceSourceId !== null) {
                        try { GLib.source_remove(this._postGraceSourceId); } catch (_e) {}
                        this._postGraceSourceId = null;
                    }
                    console.log(`[macos-dock-local][icons] startup grace ended early at ${Math.round(elapsedMs)}ms (quiet ${Math.round(quietMs)}ms)`);
                    this._endStartupGrace();
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        } catch (_e) { this._graceCheckSourceId = null; }
        // From here on the setters must reload again (they were no-ops before).
        this._started = true;
    }
    _endStartupGrace() {
        this._startupGraceActive = false;
        if (this._graceCheckSourceId !== null) {
            try { GLib.source_remove(this._graceCheckSourceId); } catch (_e) {}
            this._graceCheckSourceId = null;
        }
        // Incremental, NOT _reload(): the dock is already visible now that the
        // startup fade runs on the first paint, so a full teardown here would
        // flash the whole icon row. _doSync diffs favorites + running set +
        // order in place and never destroys an existing icon.
        this._runSync("startup-grace-end");
    }
    stop() {
        this._signals.disconnectAll();
        if (this._windowChangeSourceId !== null) {
            GLib.source_remove(this._windowChangeSourceId);
            this._windowChangeSourceId = null;
        }
        if (this._settleSourceId !== null) {
            try { GLib.source_remove(this._settleSourceId); } catch (_e) {}
            this._settleSourceId = null;
        }
        if (this._postGraceSourceId !== null) {
            try { GLib.source_remove(this._postGraceSourceId); } catch (_e) {}
            this._postGraceSourceId = null;
        }
        if (this._graceCheckSourceId !== null) {
            try { GLib.source_remove(this._graceCheckSourceId); } catch (_e) {}
            this._graceCheckSourceId = null;
        }
        this._startupGraceActive = false;
        this._hideTooltip();
        if (this._tooltipText) {
            Main.layoutManager.removeChrome(this._tooltipText);
            this._tooltipText.destroy();
            this._tooltipText = null;
        }
        this._closeContextMenu();
        this._menuManager = null;
        // Destroy all children to avoid transient actor leaks.
        const kids = this._container.get_children();
        for (const k of kids) {
            try { k.destroy(); } catch (e) {}
        }
        this._icons.clear();
        this._apps.clear();
        this._favorites = [];
        this._shellSettings = null;
        this._pressedIcon = null;
        this._dragInProgress = false;
        this._dndDeferred = null;
        this._trashButton = null;
        this._trashIcon = null;
        this._trashIconWrapper = null;
        this._trashIndicatorBox = null;
        this._trashIndicatorState = null;
        this._trashManager = null;
        this._started = false;
    }
    setTrashManager(manager) {
        this._trashManager = manager;
        manager?.setOnChanged(() => this.refreshTrashState());
        if (!this._started)
            return;
        this._updateTrashButton();
        this._enforceOrder();
        if (this._onIconsChanged)
            this._onIconsChanged();
    }
    setShowTrash(show) {
        this._showTrash = show;
        if (!this._started)
            return;
        this._updateTrashButton();
        this._updateSeparator("tail-button");
        this._enforceOrder();
        if (this._onIconsChanged)
            this._onIconsChanged();
    }
    /**
     * Tell the dock that the row's extent changed for a reason that is not an
     * icon appearing or leaving: a drag gap opening, growing or shrinking away.
     * The dock sizes itself from the layout, so this is only the "look again"
     * half -- there is no counter here to keep in step.
     */
    notifyRowChanged() {
        this._onIconsChanged?.();
    }
    /**
     * True when `metaWin` is the Trash window and the dock shows its own Trash
     * button for it. With `show-trash` off nothing else represents that window,
     * so it goes back to Files and the dock behaves like a stock one.
     */
    representsTrashWindow(metaWin) {
        return this._trashButton !== null &&
            this._trashManager?.isTrashWindow(metaWin) === true;
    }
    /**
     * Which dock icon a window belongs to: the Trash sentinel when the dock is
     * showing that window on its own button, otherwise the app id the window
     * tracker gives. Everything that lands an animation, a squash or a preview
     * on an icon goes through here so the Trash never falls back to Files.
     */
    iconIdForWindow(metaWin) {
        if (!metaWin)
            return null;
        if (this.representsTrashWindow(metaWin))
            return TRASH_ICON_ID;
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(metaWin);
            return app ? app.get_id() : null;
        }
        catch (_e) {
            return null;
        }
    }
    setDnd(dnd) {
        this._dnd = dnd;
    }
    /**
     * Drag-and-drop holds the whole row still: a favorites write landing
     * mid-gesture would rebuild the row and destroy the actor being dragged.
     * Releasing replays the one deferred sync, so nothing is lost -- the drag
     * only delays it, never drops it.
     */
    setDragInProgress(active) {
        this._dragInProgress = active;
        if (active)
            return;
        const pending = this._dndDeferred;
        this._dndDeferred = null;
        if (!pending)
            return;
        console.log(`[macos-dock-local][icons] sync replayed after drag (${pending.kind}/${pending.reason})`);
        if (pending.kind === "reload")
            this._reload(pending.reason);
        else
            this._doSync(pending.reason);
    }
    _deferForDrag(kind, reason) {
        if (!this._dragInProgress)
            return false;
        this._dndDeferred = { kind, reason };
        console.log(`[macos-dock-local][icons] sync deferred during drag (${kind}/${reason})`);
        return true;
    }
    refreshTrashState() {
        if (!this._started)
            return;
        this._refreshTrashIcon();
        this._refreshTrashIndicator();
        if (this._startupGraceActive)
            return;
        this._doWindowChange();
    }
    /**
     * Get the visible icon actors in the dock, in display order. Used by
     * the magnification animator to map pointer X to a focal index.
     */
    getIconActors() {
        const result = [];
        const children = this._container.get_children();
        for (const child of children) {
            result.push(child);
        }
        return result;
    }
    /**
     * Trigger a macOS-style "bounce" animation on the icon for a given app,
     * used to draw the user's attention when an app is launched.
     */
    bounceForApp(app) {
        const appId = app.get_id();
        const actor = this._icons.get(appId);
        if (!actor)
            return;
        this._bounce(actor);
    }
    /**
     * Settle-aware request for external bursts (installed-changed,
     * favorite-apps). ALWAYS incremental now: a full _reload() destroys all
     * children then re-adds them, which paints a visible flash — the login
     * flicker root cause (journal showed full rebuilds flashing the dock at
     * T+60~90s). The settle window below only debounces session-restore
     * bursts. User-initiated setters keep calling _reload() directly
     * (immediate, full).
     */
    _requestReload(reason = "unspecified") {
        // Startup grace: skip installed-driven syncs entirely; the single
        // incremental sync at grace end settles everything the burst changed.
        if (this._startupGraceActive)
            return;
        let inSettle = false;
        try {
            if (this._startupMono)
                inSettle = (GLib.get_monotonic_time() - this._startupMono) / 1000 < IconManager.SETTLE_WINDOW_MS;
        } catch (_e) { inSettle = false; }
        if (!inSettle) {
            this._runSync(reason);
            return;
        }
        if (this._settleSourceId !== null) {
            try { GLib.source_remove(this._settleSourceId); } catch (_e) {}
            this._settleSourceId = null;
        }
        // Remember the latest trigger so the debounced sync logs the reason
        // that actually caused it (a burst may mix installed-changed and
        // favorite-apps).
        this._settleReason = reason;
        try {
            this._settleSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IconManager.SETTLE_DEBOUNCE_MS, () => {
                this._settleSourceId = null;
                const r = this._settleReason ?? reason;
                this._settleReason = null;
                this._runSync(r);
                return GLib.SOURCE_REMOVE;
            });
        } catch (_e) { this._settleSourceId = null; }
    }
    // Incremental sync with a full-reload safety net: an unexpected failure
    // in the diff paths degrades to the pre-existing full rebuild instead of
    // leaving the dock in a mixed state.
    _runSync(reason) {
        try {
            this._doSync(reason);
        }
        catch (e) {
            console.warn(`[macos-dock-local][icons] incremental sync failed (reason=${reason}), falling back to full reload:`, e);
            try { this._reload(reason); } catch (_e) {}
        }
    }
    /**
     * One incremental pass: favorites diff + running-set diff + order
     * enforcement. Non-destructive — existing icons are never destroyed, so
     * the dock never flashes.
     */
    _doSync(reason) {
        if (this._deferForDrag("incremental", reason))
            return;
        const t0 = GLib.get_monotonic_time();
        const fav = this._syncFavorites();
        // The iconFix wrapper may suppress _doWindowChange to undefined on
        // error; count that as a no-op rather than failing the whole sync.
        const win = this._doWindowChange() ?? { added: 0, removed: 0 };
        const reordered = this._enforceOrder();
        if (reason === "installed-changed")
            this._refreshIconsFromAppSystem();
        console.log(`[macos-dock-local][icons] incremental: +${fav.added + win.added} -${fav.removed + win.removed} reorder:${reordered ? "yes" : "no"} (reason=${reason}) in ${(GLib.get_monotonic_time() - t0) / 1000}ms`);
        // Add/remove paths notify as they mutate the row. A reorder-only sync
        // must do the same or genie's rect cache can retain the old icon slots.
        if (reordered && this._onIconsChanged)
            this._onIconsChanged();
    }
    /**
     * Incremental favorites diff: add icons for newly pinned favorites whose
     * app resolves, fade out entries whose .desktop no longer resolves (and
     * that are not running), then adopt the new list. Demotions (unpinned but
     * still running) are picked up by _doWindowChange + _enforceOrder once the
     * list is updated here.
     */
    _syncFavorites() {
        const appSystem = Shell.AppSystem.get_default();
        const newFavs = this._readFavorites();
        const runningIds = new Set(this._getRunningApps().map((app) => app.get_id()));
        let added = 0;
        let removed = 0;
        for (const id of newFavs) {
            // The favorite came back inside its own 200ms fade-out. Reusing the
            // actor is the only correct move here: the table still holds it, so
            // skipping the add (the old behaviour) let the fade's tail destroy the
            // icon for good -- the dropped icon that never returned. See D-106.
            if (this._keepExistingIcon(id))
                continue;
            const app = appSystem.lookup_app(id);
            if (!app)
                continue;
            this._addIcon(app);
            added++;
        }
        for (const id of this._favorites) {
            if (!this._icons.has(id))
                continue;
            if (appSystem.lookup_app(id))
                continue;
            if (runningIds.has(id))
                continue; // keep a still-running app as a running icon
            const actor = this._icons.get(id);
            this._removeIconAnimated(id, actor);
            removed++;
        }
        this._favorites = newFavs;
        return { added, removed };
    }
    /**
     * Enforce the canonical child order in place: favorites (in favorites
     * order) | separator | running non-favorites (stable visual order) |
     * Show Apps button. Uses set_child_at_index() only (no add/remove, so no
     * recursion with the iconFix pin/actor-added hooks). Also heals
     * _addSeparator()'s insert index, which assumes favorites-first Map order.
     *
     * Index-space care: get/set_child_at_index count ALL children including
     * the separator and Show Apps button, so the icon comparison must walk
     * past them (comparing raw indexes misfires whenever the separator sits
     * mid-row: every sync then "moves" icons already in place and misreports
     * reorder:yes). Steady state costs zero moves.
     */
    _enforceOrder() {
        const c = this._container;
        if (!c)
            return false;
        const favActors = [];
        const favSet = new Set();
        for (const id of this._favorites) {
            const a = this._icons.get(id);
            if (a) {
                favActors.push(a);
                favSet.add(a);
            }
        }
        // Current icon order, excluding separator, trash and Show Apps button.
        const current = [];
        for (const child of c.get_children()) {
            if (child === this._separator || child === this._appButton || child === this._trashButton)
                continue;
            current.push(child);
        }
        const desired = [...favActors, ...current.filter((child) => !favSet.has(child))];
        let moved = false;
        try {
            // Icons first, walking the full child-index space past the
            // separator / button (indexes shift on every move, so always
            // re-read them live, never cache).
            const skip = new Set();
            if (this._separator)
                skip.add(this._separator);
            if (this._appButton)
                skip.add(this._appButton);
            let j = 0;
            for (let i = 0; i < desired.length; i++) {
                while (skip.has(c.get_child_at_index(j)))
                    j++;
                if (c.get_child_at_index(j) !== desired[i]) {
                    c.set_child_at_index(desired[i], j);
                    moved = true;
                }
                j++;
            }
            // Then pin separator after the last favorite, trash before Show
            // Apps, Show Apps last. The tail elements are pinned rather than
            // walked: a trash that is both a placement target and a skip entry
            // would move on every sync and keep reporting a reorder.
            if (this._separator && c.get_child_at_index(favActors.length) !== this._separator) {
                c.set_child_at_index(this._separator, favActors.length);
                moved = true;
            }
            if (this._trashButton) {
                const trashIndex = c.get_n_children() - 1 - (this._appButton ? 1 : 0);
                if (c.get_child_at_index(trashIndex) !== this._trashButton) {
                    c.set_child_at_index(this._trashButton, trashIndex);
                    moved = true;
                }
            }
            if (this._appButton && c.get_child_at_index(c.get_n_children() - 1) !== this._appButton) {
                c.set_child_at_index(this._appButton, c.get_n_children() - 1);
                moved = true;
            }
        }
        catch (_e) { /* container gone mid-pass; next sync retries */ }
        return moved;
    }
    // installed-changed can swap an app's icon or recreate its Shell.App;
    // refresh gicons and cached app objects so the dock never shows stale
    // graphics (full reloads used to do this implicitly).
    _refreshIconsFromAppSystem() {
        const appSystem = Shell.AppSystem.get_default();
        for (const [id, actor] of this._icons.entries()) {
            const data = this._getStored(actor);
            if (!data)
                continue;
            const app = appSystem.lookup_app(id);
            if (!app)
                continue;
            this._apps.set(id, app);
            try {
                data.icon.set_gicon(app.get_icon());
            }
            catch (_e) { /* icon actor gone; next sync rebuilds */ }
        }
    }
    _reload(reason = "unspecified") {
        if (this._deferForDrag("reload", reason))
            return;
        // Seed opacity 0 purely as the starting point for the fade-in at the
        // bottom of this method — both run in the same synchronous call, so no
        // frame is ever painted at 0. The fade is armed on THIS first paint
        // rather than at grace end: the startup build already produces the
        // final icon set (journal: 17 icons in 6.75ms), so holding the dock
        // invisible only cost the whole grace window (~1.2s on a cold boot).
        if (this._startupFadePending)
            this._container.opacity = 0;
        // Batch layout notifications; emit a single resize at the end.
        this._reloadBatching = true;
        try {
            const t0 = GLib.get_monotonic_time();
            // Destroy all children to avoid transient actor leaks.
            const kids = this._container.get_children();
            for (const k of kids) {
                try { k.destroy(); } catch (e) {}
            }
            this._icons.clear();
            this._apps.clear();
            this._separator = null;
            this._appButton = null;
            this._trashButton = null;
            this._trashIcon = null;
            this._trashIconWrapper = null;
            this._trashIndicatorBox = null;
            this._trashIndicatorState = null;
            this._favorites = this._readFavorites();
            const appSystem = Shell.AppSystem.get_default();
            // Add favorites in their stored order first.
            for (const appId of this._favorites) {
                const app = appSystem.lookup_app(appId);
                if (!app)
                    continue;
                this._addIcon(app);
            }
            // Get running apps that aren't favorites
            const runningApps = this._showRunningApps
                ? this._getRunningApps().filter((app) => !this._favorites.includes(app.get_id()))
                : [];
            // Then any running app that isn't already a favorite.
            for (const app of runningApps) {
                this._addIcon(app);
            }
            // Add the trash button before the applications button.
            this._updateTrashButton();
            // Add applications button at the end
            this._updateAppButton();
            // The separator comes last: its rule reads the tail buttons, and a
            // reload used to duplicate the condition here before they existed.
            this._updateSeparator("reload");
            if (this._startupFadePending) {
                this._startupFadePending = false;
                const fadeIn = (params) => this._container.ease(params);
                fadeIn({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
            console.log(`[macos-dock-local][icons] reload: ${this._icons.size} icons in ${(GLib.get_monotonic_time() - t0) / 1000}ms (reason=${reason})`);
            if (this._onIconsChanged)
                this._onIconsChanged();
        }
        finally {
            // Always reset, even if a step above throws — otherwise every later
            // _onIconsChanged() resize would be suppressed for the whole session
            // and the dock width would drift out of sync with the icon count.
            this._reloadBatching = false;
        }
    }
    _onWindowChange() {
        // Timestamp every window event for the startup grace quiet detector
        // (stamped even while grace skips the update itself).
        try { this._lastWindowEventMono = GLib.get_monotonic_time(); } catch (_e) {}
        // Remove any existing timeout before creating a new one.
        if (this._windowChangeSourceId !== null) {
            GLib.source_remove(this._windowChangeSourceId);
            this._windowChangeSourceId = null;
        }
        // During the startup grace period skip window-driven updates entirely;
        // the incremental sync at grace end settles them in one pass.
        if (this._startupGraceActive)
            return;
        // Delay to ensure window is fully initialized before checking.
        this._windowChangeSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._doWindowChange();
            this._windowChangeSourceId = null;
            return GLib.SOURCE_REMOVE;
        });
    }
    _doWindowChange() {
        // Track which apps are running right now. We add/remove icons as
        // needed so non-favorite running apps still appear (and disappear
        // when their last window closes).
        const runningIds = new Set();
        for (const app of this._getRunningApps()) {
            runningIds.add(app.get_id());
        }
        let changed = false;
        let removedCount = 0;
        let addedCount = 0;
        // Remove icons for apps that are no longer running and aren't favorites,
        // or all non-favorite running apps if show-running-apps is disabled.
        // NOTE: the map entry is kept until the fade-out animation completes so
        // the fading child stays in the row it was measured from; dropping it
        // early shrinks the dock ~200ms before the icon has left the screen and
        // yanks the trailing buttons past the background's edge.
        for (const [id, actor] of this._icons.entries()) {
            const isFavorite = this._favorites.includes(id);
            if (isFavorite)
                continue;
            if (!this._showRunningApps || !runningIds.has(id)) {
                this._removeIconAnimated(id, actor);
                changed = true;
                removedCount++;
            }
        }
        // Add icons for newly running, non-favorited apps (only if enabled).
        if (this._showRunningApps) {
            for (const id of runningIds) {
                if (this._keepExistingIcon(id))
                    continue;
                if (this._favorites.includes(id))
                    continue;
                const appSystem = Shell.AppSystem.get_default();
                const app = appSystem.lookup_app(id);
                if (!app)
                    continue;
                this._addIcon(app);
                changed = true;
                addedCount++;
            }
        }
        // Update separator visibility
        this._updateSeparator("window-change");
        this._refreshAllIndicators();
        // Notify dock to resize when icons were added/removed.
        if (changed && this._onIconsChanged)
            this._onIconsChanged();
        return { added: addedCount, removed: removedCount };
    }
    /**
     * Fade an icon out and drop it from the maps once the animation
     * completes. Shared by _doWindowChange (running apps) and _syncFavorites
     * (unresolvable favorites). The pending flag prevents double animation
     * when both paths target the same id in one sync (e.g. a demoted,
     * uninstalled, non-running favorite).
     */
    _removeIconAnimated(id, actor) {
        if (!actor || actor._dockRemovalPending)
            return;
        actor._dockRemovalPending = true;
        // A fading icon can be re-armed by a second removal after coming back;
        // the token is what makes the first removal's tail a no-op.
        const token = (actor._dockRemovalToken = (actor._dockRemovalToken ?? 0) + 1);
        const easeOut = (params) => actor.ease(params);
        easeOut({
            opacity: 0,
            scale_x: 0.8,
            scale_y: 0.8,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                // A newer judgement about this icon (it came back as a favorite,
                // or a rebuilt actor took its place) invalidates the removal: the
                // token is what makes a stale tail a no-op rather than a deletion.
                if (actor._dockRemovalToken !== token || actor._dockRemovalPending === false)
                    return;
                // A full _reload() during the 200ms fade-out may have
                // destroyed this actor already (it clears _icons and
                // destroys all children); every access below would
                // throw on the disposed object.
                try {
                    this._container.remove_child(actor);
                }
                catch (_e) {
                    return;
                }
                // The actor is removed but not destroyed here, so its
                // "destroy" hook never fires — drop its signal entries
                // explicitly or they leak for the session.
                this._signals.disconnect(actor);
                this._dnd?.teardownIcon(actor);
                if (this._icons.get(id) === actor) {
                    this._icons.delete(id);
                    this._apps.delete(id);
                }
                // Backstop only: under the settled judgement in
                // _updateSeparator a fading icon never raised the separator, so
                // this is normally a no-op. It still matters when the settled
                // picture changed during the 200ms fade (favorites came and
                // went), and is a no-op when a full _reload() already rebuilt
                // everything (early return above).
                try { this._updateSeparator("fade-complete"); } catch (_e2) {}
                if (this._onIconsChanged)
                    this._onIconsChanged();
            },
        });
    }
    /**
     * Whether `id` already owns an icon that will still be on screen. An actor
     * mid fade-out does not: its removal is cancelled and the same actor kept,
     * which is what stops the fade's tail from deleting an icon that the new
     * state asked for in the pass right after it.
     */
    _keepExistingIcon(id) {
        const actor = this._icons.get(id);
        if (!actor)
            return false;
        if (actor._dockRemovalPending)
            this._cancelIconRemoval(actor);
        return true;
    }
    _cancelIconRemoval(actor) {
        if (!actor || !actor._dockRemovalPending)
            return;
        actor._dockRemovalPending = false;
        // Bump the token too: it is what turns a tail that Clutter still delivers
        // into a no-op, and it survives being re-armed by a later removal.
        actor._dockRemovalToken = (actor._dockRemovalToken ?? 0) + 1;
        try {
            actor.remove_all_transitions();
            actor.opacity = 255;
            actor.scale_x = 1;
            actor.scale_y = 1;
        }
        catch (_e) { /* already gone */ }
        console.log(`[macos-dock-local][icons] fade-out cancelled (came back mid-fade)`);
    }
    _updateSeparator(reason = "unspecified") {
        if (!this._showRunningApps) {
            if (this._separator) {
                console.log(`[macos-dock-local][icons] -separator (running-apps-hidden reason=${reason})`);
                this._separator.destroy();
                this._separator = null;
            }
            return;
        }
        // Count SETTLED non-favorite icons — the ones that will still be here
        // once any fade-out finishes — and take the set from _icons rather than
        // _getRunningApps(). The add path (_doWindowChange) skips any app whose
        // id AppSystem.lookup_app() cannot resolve, so re-querying the running
        // set could count an app that never got an icon. Native dash.js derives
        // its separator from the real child count for the same reason.
        // An icon mid fade-out stays keyed in _icons until onComplete (see
        // _removeIconAnimated) and is flagged _dockRemovalPending there. It must
        // NOT count: when it is the last non-favorite, including it raised a
        // separator on the same _doWindowChange that was starting the fade-out,
        // so the dock snapped 15px wider and then 200ms later lost both the
        // separator and the icon. Journal (after 709fe31/b772371 shipped):
        //   +separator at=17 (favs=17 running=1 reason=window-change)
        //   -separator       (favs=17 running=0 reason=fade-complete)
        //   +separator at=17 (favs=17 running=1 reason=window-change)
        // on every keyboard-cycle minimize of the last non-favorite window.
        // Excluding the flag keeps the property the old fadingNonFavorites pass
        // existed for: with two or more non-favorites and one fading, the rest
        // still count, so the separator does not pop out from under an icon that
        // is still on screen.
        // _dockRemovalPending is a plain JS expando set in _removeIconAnimated,
        // not a GObject property, so reading it never touches the native
        // instance — safe even if the actor was destroyed by a _reload() during
        // the fade (in which case _icons was already cleared anyway).
        let runningNonFavorites = 0;
        for (const [id, actor] of this._icons.entries()) {
            if (!this._favorites.includes(id) && !actor?._dockRemovalPending)
                runningNonFavorites++;
        }
        const hasFavorites = this._favorites.length > 0;
        // The line marks the favorites boundary. Ubuntu's dash uses
        // `nFavorites > 0 && nFavorites < nIcons` and counts the Trash inside
        // nIcons, so with a tail button present the line never disappears --
        // which is the whole reason it used to snap the dock 15px wider and
        // then back as the last non-favorite window minimized
        // (D-017 / D-037 / D-041 are all that one toggle). The settled count
        // below still decides the case where both tail buttons are switched
        // off, so its fade-out rule stays.
        const hasTail = runningNonFavorites > 0 ||
            this._trashButton !== null || this._appButton !== null;
        // Add separator if needed
        if (hasFavorites && hasTail && !this._separator) {
            this._addSeparator(reason, this._favorites.length, runningNonFavorites);
        }
        // Remove separator if not needed
        else if ((!hasFavorites || !hasTail) && this._separator) {
            console.log(`[macos-dock-local][icons] -separator (favs=${this._favorites.length} running=${runningNonFavorites} reason=${reason})`);
            this._separator.destroy();
            this._separator = null;
        }
    }
    _addIcon(app) {
        const appId = app.get_id();
        if (this._icons.has(appId))
            return;
        const actor = new St.BoxLayout({
            style_class: "macos-dock-icon",
            reactive: true,
            track_hover: true,
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._applyIconSize(actor);
        const icon = new St.Icon({
            gicon: app.get_icon(),
            icon_size: this._iconSize,
            style_class: "macos-dock-icon-gicon",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._applyIconTexture(icon);
        const iconWrapper = new St.Widget({
            style_class: "macos-dock-icon-wrapper",
            layout_manager: new Clutter.FixedLayout(),
            x_align: Clutter.ActorAlign.CENTER,
            width: this._iconSize,
            height: this._iconSize,
        });
        icon.set_position(0, 0);
        iconWrapper.add_child(icon);
        actor.add_child(iconWrapper);
        // Container for running indicator dots (or a single bar).
        const indicatorBox = new St.BoxLayout({
            style_class: "macos-dock-indicator-box",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        actor.add_child(indicatorBox);
        // Store references on the actor for retrieval later.
        const appData = {
            appId,
            icon,
            iconWrapper,
            indicatorBox,
            dots: [],
            mediaIndicator: null,
        };
        actor._appData = appData;
        this._dnd?.bindIcon(actor, appId);
        this._signals.connect(actor, "button-press-event", (_actor, event) => {
            const button = event.get_button();
            if (button === 3) {
                this._showContextMenu(actor, app);
                return Clutter.EVENT_STOP;
            }
            if (button === 2) {
                // Ubuntu's dash opens another window on middle-click.
                if (!this._dragInProgress)
                    this._onClicked?.(app, "new-window");
                return Clutter.EVENT_STOP;
            }
            if (button !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            // The left press is deliberately not consumed, and the click is
            // answered on release: activating on press hid the dock out from
            // under the pointer (dodge), which killed the drag gesture before
            // its hold-timeout could elapse.
            this._pressedIcon = actor;
            return Clutter.EVENT_PROPAGATE;
        });
        this._signals.connect(actor, "button-release-event", (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const pressed = this._pressedIcon;
            this._pressedIcon = null;
            // A drop that ended a drag releases outside this actor's hover, and
            // the drag's own modal grab normally eats the release first; both
            // guards stay because launching after a reorder is not a tolerable
            // second best.
            if (this._dragInProgress || pressed !== actor || !actor.hover)
                return Clutter.EVENT_PROPAGATE;
            if (this._onClicked) {
                this._onClicked(app);
            }
            return Clutter.EVENT_STOP;
        });
        // Tooltip events - use notify::hover since track_hover is enabled
        this._signals.connect(actor, "notify::hover", () => {
            if (actor.hover) {
                this._showTooltip(actor, app.get_name(), app.get_id());
                // Show window preview popup
                if (this._windowPreviewsEnabled && this._previewPopup) {
                    this._previewPopup.cancelScheduledHide();
                    this._previewPopup.show(app, actor);
                }
            }
            else {
                this._hideTooltip();
                // Schedule hide of preview popup (delay allows mouse to move to popup)
                if (this._previewPopup?.isVisible()) {
                    this._previewPopup.scheduleHide();
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // Drop this actor's entries from the shared signal table when the actor
        // goes away. Raw connect (not via _signals) so it does not try to
        // disconnect itself while it is being emitted.
        actor.connect("destroy", () => this._signals.disconnect(actor));
        // Fade in only on incremental adds. Whole-table reloads (and the
        // startup build) fade the container as a unit, so per-icon fades there
        // would just stack into a flicker.
        const fadeIn = !this._reloadBatching && !this._startupFadePending;
        if (fadeIn)
            actor.opacity = 0;
        this._container.add_child(actor);
        if (fadeIn) {
            actor.ease({
                opacity: 255,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        this._icons.set(appId, actor);
        this._apps.set(appId, app);
        this._refreshRunningIndicator(actor, appId);
        // Notify dock to resize (batched by _reload during the first build).
        if (this._onIconsChanged && !this._reloadBatching)
            this._onIconsChanged();
    }
    /**
     * Texture edge in physical pixels. The icon-quality setting is a multiplier on
     * the logical size, so 2 asks the icon theme for a texture twice as wide.
     */
    _textureSize() {
        return Math.max(1, Math.ceil(this._iconSize * this._quality));
    }
    /**
     * Ask St for a texture `quality` times the logical edge, then shrink the actor
     * back to the logical size. The wrapper keeps its old geometry, and magnifying
     * it now samples the larger texture instead of upscaling the small one -- which
     * is the whole point of the setting.
     *
     * Scaling rather than resizing is deliberate: St.Icon paints its texture at
     * icon-size and clips it to the allocation, so a larger icon_size alone would
     * overflow the wrapper instead of filling it.
     *
     * This only holds under `Clutter.FixedLayout`, which gives the child its
     * preferred size at the position set below. A layout that allocates the child
     * itself (a BoxLayout, say) would give the 2x texture a 2x cell, and the
     * scaled-down paint would land in that cell's corner.
     */
    _applyIconTexture(icon) {
        icon.set_icon_size(this._textureSize());
        icon.set_scale(1 / this._quality, 1 / this._quality);
        icon.set_position(0, 0);
    }
    _applyIconSize(actor) {
        const data = this._getStored(actor);
        if (data) {
            this._applyIconTexture(data.icon);
            data.iconWrapper.set_size(this._iconSize, this._iconSize);
            if (data.mediaIndicator) {
                this._positionMediaIndicator(data.mediaIndicator);
            }
        }
        const padded = this._iconSize + 12;
        actor.set_size(padded, padded + 4);
    }
    _positionMediaIndicator(indicator) {
        const badgeSize = IconManager.MEDIA_BADGE_SIZE;
        const inset = IconManager.MEDIA_BADGE_INSET;
        indicator.set_size(badgeSize, badgeSize);
        indicator.set_position(this._iconSize - badgeSize + inset, -inset);
    }
    /**
     * One window-actor walk for a whole indicator pass. Keyed by Shell.App
     * object rather than id, so the lookup is exactly the `=== app` comparison
     * the per-icon scan it replaces performs.
     *
     * Without this, _refreshRunningIndicator rescans every window for every
     * icon: O(icons x windows) per refresh, on every focus/restack burst —
     * iconFix routes app-state-changed, restacked, notify::focus-window and
     * notify::focus-app here, so one Alt-Tab keypress did ~(N+2) full walks.
     */
    _countWindowsByApp() {
        const tracker = Shell.WindowTracker.get_default();
        const counts = new Map();
        for (const wa of global.get_window_actors()) {
            const mw = wa.get_meta_window();
            if (!mw)
                continue;
            if (this.representsTrashWindow(mw))
                continue;
            const app = tracker.get_window_app(mw);
            if (!app)
                continue;
            counts.set(app, (counts.get(app) ?? 0) + 1);
        }
        return counts;
    }
    _refreshAllIndicators() {
        // The counts hang off `this` instead of being passed as an argument
        // because iconFix wraps _refreshRunningIndicator with a fixed
        // (actor, appId) signature and would silently drop a third parameter.
        // Cleared in `finally` so the standalone callers (_addIcon,
        // setRunningIndicatorsEnabled) still count only their own app.
        this._indicatorCounts = this._countWindowsByApp();
        try {
            for (const [appId, actor] of this._icons.entries()) {
                this._refreshRunningIndicator(actor, appId);
            }
        }
        finally {
            this._indicatorCounts = null;
        }
    }
    _refreshAllMediaIndicators() {
        for (const [appId, actor] of this._icons.entries()) {
            this._refreshMediaIndicator(actor, appId);
        }
    }
    _refreshMediaIndicator(actor, appId) {
        const data = this._getStored(actor);
        if (!data)
            return;
        const isPlaying = this._mediaIndicatorEnabled && this._playingAppId === appId;
        if (isPlaying && !data.mediaIndicator) {
            const badge = new St.Widget({
                style_class: "macos-dock-media-indicator",
                layout_manager: new Clutter.BinLayout(),
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const noteIcon = new St.Icon({
                icon_name: "folder-music-symbolic",
                icon_size: 8,
                style_class: "macos-dock-media-indicator-icon",
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });
            badge.add_child(noteIcon);
            this._positionMediaIndicator(badge);
            data.iconWrapper.add_child(badge);
            data.mediaIndicator = badge;
        }
        else if (!isPlaying && data.mediaIndicator) {
            data.iconWrapper.remove_child(data.mediaIndicator);
            data.mediaIndicator.destroy();
            data.mediaIndicator = null;
        }
    }
    _refreshRunningIndicator(actor, appId) {
        const data = this._getStored(actor);
        if (!data)
            return;
        const { indicatorBox } = data;
        if (!indicatorBox)
            return;
        if (!this._runningIndicatorsEnabled) {
            indicatorBox.visible = false;
            return;
        }
        const tracker = Shell.WindowTracker.get_default();
        const app = this._apps.get(appId);
        if (!app) {
            indicatorBox.visible = false;
            return;
        }
        // Count all windows for this app (including minimized). Inside a
        // _refreshAllIndicators pass the counts come from one shared walk;
        // a standalone call scans for this app alone.
        let windowCount = 0;
        if (this._indicatorCounts) {
            windowCount = this._indicatorCounts.get(app) ?? 0;
        }
        else {
            const actors = global.get_window_actors();
            for (const wa of actors) {
                const mw = wa.get_meta_window();
                if (!mw)
                    continue;
                if (this.representsTrashWindow(mw))
                    continue;
                if (tracker.get_window_app(mw) === app) {
                    windowCount++;
                }
            }
        }
        const focused = tracker.focus_app === app &&
            !this.representsTrashWindow(global.display.focus_window);
        const isRunning = windowCount > 0 || focused;
        if (!isRunning) {
            indicatorBox.visible = false;
            if (data)
                data._lastIndicatorState = "off";
            return;
        }
        // Skip widget churn when nothing changed since last refresh (e.g.
        // every Alt-Tab fires notify::focus-app even for unrelated apps).
        const dots = Math.min(windowCount, this._maxIndicatorDots);
        const stateKey = `${focused ? 1 : 0}:${dots}:${this._indicatorStyle}:${this._runningIndicatorsEnabled ? 1 : 0}`;
        if (data._lastIndicatorState === stateKey && indicatorBox.visible)
            return;
        data._lastIndicatorState = stateKey;
        indicatorBox.visible = true;
        // Clear all children before adding new style.
        indicatorBox.remove_all_children();
        if (this._indicatorStyle === 0) {
            // Dots per window (macOS style).
            const needed = focused ? Math.max(dots, 1) : dots;
            // Add or remove dots to match window count.
            while (indicatorBox.get_n_children() < needed) {
                const dot = new St.Widget({
                    style_class: "macos-dock-indicator-dot",
                });
                indicatorBox.add_child(dot);
            }
            while (indicatorBox.get_n_children() > needed) {
                const last = indicatorBox.get_n_children() - 1;
                indicatorBox.get_child_at_index(last)?.destroy();
            }
        }
        else {
            // Horizontal bar style.
            const bar = new St.Widget({
                style_class: "macos-dock-indicator-bar",
            });
            indicatorBox.add_child(bar);
        }
    }
    _getRunningApps() {
        const tracker = Shell.WindowTracker.get_default();
        const seen = new Set();
        const result = [];
        const windows = global.get_window_actors();
        const activeWorkspace = global.workspace_manager.get_active_workspace();
        for (const wa of windows) {
            const metaWin = wa.get_meta_window();
            if (!metaWin)
                continue;
            if (this.representsTrashWindow(metaWin))
                continue;
            if (!metaWin.showing_on_its_workspace())
                continue;
            if (this._workspaceMode === 1 && metaWin.get_workspace() !== activeWorkspace)
                continue;
            const app = tracker.get_window_app(metaWin);
            if (!app)
                continue;
            const id = app.get_id();
            if (seen.has(id))
                continue;
            seen.add(id);
            result.push(app);
        }
        return result;
    }
    _readFavorites() {
        try {
            if (!this._shellSettings)
                this._shellSettings = new Gio.Settings({ schema: "org.gnome.shell" });
            return this._shellSettings.get_strv("favorite-apps");
        }
        catch {
            return [];
        }
    }
    _getStored(actor) {
        const data = actor._appData;
        if (!data)
            return null;
        return data;
    }
    /**
     * The actor every icon-keyed service measures and animates: an app icon's
     * inner `iconWrapper`, or the Trash button's own wrapper for the
     * TRASH_ICON_ID sentinel. Absent icons yield null.
     */
    _iconWrapperFor(appId) {
        if (appId === TRASH_ICON_ID)
            return this._trashIconWrapper;
        const actor = this._icons.get(appId);
        const data = actor ? this._getStored(actor) : null;
        return data?.iconWrapper;
    }
    /**
     * Public accessors used by the genie minimize/restore animation to resolve
     * the on-screen rectangle of an app's icon. These are additive and do not
     * change any existing behaviour.
     *
     * getIconRectForAppId returns the screen-space rect of the PURE icon square
     * (`iconWrapper`, exactly iconSize × iconSize). Deliberately NOT the outer
     * actor, which is padded to iconSize+12 × iconSize+16 and includes the
     * running-indicator strip — using that would make the animation target too
     * wide and too tall. Includes any live magnification scale, since
     * get_transformed_* walks the scaled ancestor.
     */
    getIconRectForAppId(appId) {
        const wrapper = this._iconWrapperFor(appId);
        if (!wrapper)
            return null;
        try {
            const [x, y] = wrapper.get_transformed_position();
            const [w, h] = wrapper.get_transformed_size();
            if (!(w > 0 && h > 0))
                return null;
            // Undo our own squash (see squashForAppId): get_transformed_size()
            // walks the scaled ancestor chain, so a resolve happening while the
            // icon is mid-press would otherwise shrink the animation target.
            // The pivot is centred, so the scaled origin has moved inward too.
            const sx = Math.abs(wrapper.scale_x) || 1;
            const sy = Math.abs(wrapper.scale_y) || 1;
            if (sx === 1 && sy === 1)
                return { x, y, width: w, height: h };
            const w0 = w / sx;
            const h0 = h / sy;
            return { x: x - (w0 - w) / 2, y: y - (h0 - h) / 2, width: w0, height: h0 };
        }
        catch (_e) {
            return null;
        }
    }

    /**
     * A small "press and rebound" reaction on an icon, fired as a window lands
     * in it during a genie minimize/restore. Compresses along the dock's
     * normal (perpendicular to its edge) with a slight counter-stretch along
     * the tangent, then springs back.
     *
     * `reverse` mirrors the first direction: restore pushes out before
     * compressing, so the motion reads as the window being spat back out.
     *
     * Deliberately defensive — it runs from the animation's per-frame path, so
     * it must never throw. It scales the INNER `iconWrapper`, not the outer
     * actor, so it cannot fight magnification or `_bounce` (both of which
     * write the outer actor).
     */
    squashForAppId(appId, {reverse = false, dockPosition = 0} = {}) {
        const wrapper = this._iconWrapperFor(appId);
        if (!wrapper)
            return;
        try {
            const amplitude = 0.08;
            const counter = 0.035;
            const step = 70; // ms per phase, ~210ms total
            const vertical = dockPosition === 0 || dockPosition === 3; // BOTTOM/TOP
            const normalProp = vertical ? "scale_y" : "scale_x";
            const tangentProp = vertical ? "scale_x" : "scale_y";

            // Token: a newer squash (or a torn-down icon) invalidates the
            // chain, so a stale onComplete can never write to a dead actor.
            const token = (wrapper._genieSquash = (wrapper._genieSquash ?? 0) + 1);
            wrapper.set_pivot_point(0.5, 0.5);

            // try/catch: the wrapper can already be disposed when this fires.
            // A full _reload() or stop() destroys every icon child, but pending
            // backstops still run for up to step*3+120ms afterwards, and probing
            // a disposed GObject logs "object has been disposed" rather than
            // returning null. Same no-touch reasoning as iconFix's deadActors
            // flags — treat an unreadable wrapper as dead, never poke it.
            const alive = () => {
                try {
                    return token === wrapper._genieSquash && wrapper.get_parent() !== null;
                }
                catch (_e) {
                    return false;
                }
            };
            const rest = () => {
                if (!alive())
                    return;
                wrapper[normalProp] = 1;
                wrapper[tangentProp] = 1;
            };
            // Backstop: if a transition never completes, put the icon back.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, step * 3 + 120, () => {
                rest();
                return GLib.SOURCE_REMOVE;
            });

            // minimize: 1 -> press -> slight overshoot -> 1
            // restore:  1 -> slight overshoot -> press -> 1
            const phases = reverse
                ? [[1 + counter, 1 - counter * 0.5],
                   [1 - amplitude, 1 + amplitude * 0.4],
                   [1, 1]]
                : [[1 - amplitude, 1 + amplitude * 0.4],
                   [1 + counter, 1 - counter * 0.5],
                   [1, 1]];
            const last = phases.length - 1;
            const run = i => {
                if (i > last || !alive())
                    return;
                const [n, t] = phases[i];
                wrapper.ease({
                    [normalProp]: n,
                    [tangentProp]: t,
                    duration: step,
                    mode: i === last
                        ? Clutter.AnimationMode.EASE_IN_QUAD
                        : Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => run(i + 1),
                });
            };
            run(0);
        }
        catch (_e) {}
    }
    getIconRectsSnapshot() {
        const out = new Map();
        for (const appId of this._icons.keys()) {
            const rect = this.getIconRectForAppId(appId);
            if (rect)
                out.set(appId, rect);
        }
        if (this._trashIconWrapper) {
            const rect = this.getIconRectForAppId(TRASH_ICON_ID);
            if (rect)
                out.set(TRASH_ICON_ID, rect);
        }
        return out;
    }
    _bounce(actor) {
        const baseY = 0;
        const up = -28;
        const small = -10;
        // Note: translation_y is the correct GJS property name (snake_case), even though
        // the TypeScript types expect camelCase (translationY). This is a type definition mismatch.
        const ease = (params) => actor.ease(params);
        ease({
            translation_y: up,
            duration: 180,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                ease({
                    translation_y: baseY,
                    duration: 120,
                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                    onComplete: () => {
                        ease({
                            translation_y: small,
                            duration: 100,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onComplete: () => {
                                ease({
                                    translation_y: baseY,
                                    duration: 80,
                                    mode: Clutter.AnimationMode.EASE_IN_QUAD,
                                });
                            },
                        });
                    },
                });
            },
        });
    }
    _showTooltip(actor, label, appId = null) {
        if (!this._tooltipText)
            return;
        // A hold that turned into a drag: nothing that belongs to mere hovering
        // may appear over a row that is now moving.
        if (this._dragInProgress)
            return;
        if (this._tooltipActor === actor && (this._tooltipText.visible || this._tooltipSourceId !== null))
            return;
        this._cancelTooltipDelay();
        this._tooltipActor = actor;
        this._tooltipAppId = appId;
        this._tooltipText.set_text(label);
        this._tooltipSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._tooltipDelayMs, () => {
            this._tooltipSourceId = null;
            this._revealTooltip();
            return GLib.SOURCE_REMOVE;
        });
    }
    _revealTooltip() {
        if (!this._tooltipText || !this._tooltipActor)
            return;
        this._positionTooltip();
        if (!this._tooltipActor)
            return;
        this._tooltipText.opacity = 0;
        this._tooltipText.show();
        this._tooltipText.ease({
            opacity: 255,
            duration: TOOLTIP_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }
    _cancelTooltipDelay() {
        if (this._tooltipSourceId === null)
            return;
        try {
            GLib.source_remove(this._tooltipSourceId);
        }
        catch (_e) { /* already fired */ }
        this._tooltipSourceId = null;
    }
    /**
     * The word the applications button shows while a pinned icon is dragged over
     * it. The shell does the same to its own button -- `setDragApp()` relabels it
     * "Unpin" (dash.js:237-246) -- because a background highlight on an icon that
     * otherwise means "open the grid" is not something anyone finds by looking,
     * which is exactly how the owner came to try dropping on the app grid
     * instead. Shown without the hover delay: mid-drag this is the only signal.
     */
    setUnpinLabel(show) {
        if (!this._tooltipText || !this._appButton)
            return;
        if (show) {
            this._cancelTooltipDelay();
            this._tooltipActor = this._appButton;
            this._tooltipAppId = null;
            this._tooltipText.set_text("Unpin");
            this._revealTooltip();
            return;
        }
        if (this._tooltipActor !== this._appButton)
            return;
        if (this._appButton.hover) {
            this._tooltipText.set_text("Applications");
            return;
        }
        this._hideTooltip();
    }
    /**
     * Place the label above the hovered icon, centred and clamped to the screen.
     *
     * Every input is the *settled* geometry, never the live one. The icon's live
     * transformed position is wrong twice over at the moment a label appears: the dock
     * may still be sliding in from its 20px entry offset, and the icon has not grown to
     * its final scale yet, so the label would be anchored where the icon was before it
     * floated up -- and it would then sit behind the enlarged icon. The dock's resting
     * rect is known, and magnification records the scale each icon actually reached in
     * `_dockMagnifyScale`; using the configured maximum instead lifted the label off a
     * row-edge icon that never gets the full wave (the owner's extra gap).
     */
    _positionTooltip() {
        const actor = this._tooltipActor;
        if (!this._tooltipText || !actor || !this._container)
            return;
        // The row may have been removed while the pointer was still on it; reading a
        // destroyed actor's position logs a CRITICAL that no try/catch suppresses.
        // The Show Apps and Trash buttons have no entry in the icon map, so they
        // are checked directly; leaving the trash out made its label keep the
        // position of whatever icon was hovered last.
        const anchorAlive = this._tooltipAppId === null
            ? (actor === this._appButton || actor === this._trashButton)
            : this._icons.get(this._tooltipAppId) === actor;
        if (!anchorAlive) {
            this._hideTooltip();
            return;
        }
        let rest = null;
        try {
            rest = this._restingRect?.() ?? null;
        } catch (e) {}
        const containerX = rest ? rest.x : this._container.x;
        const containerY = rest ? rest.y : this._container.y;
        // Magnification scales the slot about its pivot, so a hovered icon's top edge
        // ends up (scale - 1) * slotHeight * pivotY above where it rests. Use the
        // scale this icon actually settled at: the configured maximum is wrong at
        // the ends of the row, where the wave is attenuated or absent entirely.
        const settledScale = Math.max(1, Number(actor._dockMagnifyScale) || 1);
        const iconTop =
            containerY + actor.y - (settledScale - 1) * actor.height * this._magPivotY;
        const iconLeft = containerX + actor.x;
        const [, tooltipWidth] = this._tooltipText.get_preferred_width(-1);
        const [, tooltipHeight] = this._tooltipText.get_preferred_height(-1);
        let tooltipX = iconLeft + (actor.width - tooltipWidth) / 2;
        let tooltipY = iconTop - tooltipHeight - this._tooltipGap;
        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                tooltipX = Math.max(monitor.x, Math.min(tooltipX, monitor.x + monitor.width - tooltipWidth));
                tooltipY = Math.max(monitor.y, tooltipY);
            }
        } catch (e) {}
        this._tooltipText.set_position(tooltipX, tooltipY);
    }
    _repositionTooltip() {
        if (this._tooltipText?.visible)
            this._positionTooltip();
    }
    _hideTooltip() {
        this._cancelTooltipDelay();
        if (this._tooltipText) {
            this._tooltipText.remove_all_transitions();
            this._tooltipText.opacity = 0;
            this._tooltipText.hide();
        }
        this._tooltipActor = null;
        this._tooltipAppId = null;
    }
    _showContextMenu(actor, app) {
        const appId = app.get_id();
        const favorites = getAppFavorites();
        const menuItems = [
            { label: "New Window", action: () => app.open_new_window(-1) },
        ];
        if (this._mediaControlsEnabled && this._playingAppId === appId) {
            menuItems.push({
                label: "Play/Pause",
                action: () => this._onMediaAction?.("play-pause"),
            });
            menuItems.push({
                label: "Next",
                action: () => this._onMediaAction?.("next"),
            });
            menuItems.push({
                label: "Previous",
                action: () => this._onMediaAction?.("previous"),
            });
        }
        menuItems.push({
            label: favorites.isFavorite(appId) ? "Unpin from Dock" : "Pin to Dock",
            action: () => this._togglePinned(appId),
        });
        menuItems.push({ label: "Close", action: () => this._closeApp(app) });
        this._showMenu(actor, menuItems);
    }
    /**
     * Pinning goes through the shell's own AppFavorites rather than writing
     * `favorite-apps` by hand: the dock already reloads on that key, the shell
     * appends at the end, and the native Undo notification comes with it.
     */
    _togglePinned(appId) {
        const favorites = getAppFavorites();
        if (favorites.isFavorite(appId))
            favorites.removeFavorite(appId);
        else
            favorites.addFavorite(appId);
    }
    _showTrashContextMenu(actor) {
        // Ubuntu's Trash is an AppInfo whose only advertised action is
        // `empty-trash` (locations.js:797-806), so its menu is New Window plus
        // that row when the trash has something in it. There is no "Open
        // Trash": opening is what clicking the icon does, and a row that also
        // just brought the trash forward read as a duplicate of New Window.
        const menuItems = [
            { label: "New Window", action: () => this._trashAction("new-window") },
        ];
        if (this._trashManager && !this._trashManager.isEmpty()) {
            menuItems.push({
                label: "Empty Trash",
                action: () => this._trashManager?.emptyTrash(),
            });
        }
        this._showMenu(actor, menuItems);
    }
    _trashAction(action) {
        this._onTrashClicked?.(action);
    }
    /**
     * Open the window preview and hold it open (see WindowPreviewPopup's
     * togglePinned). False when previews are switched off or the icon is not there
     * any more, so the caller falls back to the single-window behaviour instead of
     * swallowing the click.
     */
    pinAppPreviews(app) {
        if (!this._windowPreviewsEnabled || !this._previewPopup)
            return false;
        const actor = this._icons.get(app.get_id());
        if (!actor)
            return false;
        this._previewPopup.togglePinned(app, actor);
        return true;
    }
    pinTrashPreviews() {
        if (!this._windowPreviewsEnabled || !this._previewPopup || !this._trashButton)
            return false;
        this._previewPopup.togglePinned(this._trashPreviewSubject(), this._trashButton);
        return true;
    }
    /**
     * The window preview is keyed on an app, and the Trash has none. It only ever
     * asks for an id and a window list, so a two-method stand-in is enough to
     * give the Trash the same thumbnails — and the same click-to-activate — as
     * any other icon. A fresh subject per hover keeps it reading the live window
     * list, which the popup re-reads when a thumbnail is closed.
     */
    _trashPreviewSubject() {
        return {
            get_id: () => TRASH_ICON_ID,
            get_windows: () => this._trashManager?.getWindows() ?? [],
        };
    }
    _showMenu(actor, menuItems) {
        this._closeContextMenu();
        if (!this._menuManager)
            return;
        const menu = new PopupMenu.PopupMenu(actor, 0.5, St.Side.TOP);
        menu.blockSourceEvents = true;
        menu.box.add_style_class_name("macos-dock-popup-menu");
        // Hide until open() computes the real position so the menu never
        // flashes one frame at (0,0) before being repositioned above the icon.
        menu.actor.opacity = 0;
        Main.uiGroup.add_child(menu.actor);
        this._contextMenu = menu;
        this._menuSignals = new SignalManager();
        for (const item of menuItems) {
            const menuItem = new PopupMenu.PopupMenuItem(item.label);
            this._menuSignals.connect(menuItem, "activate", () => {
                // Nothing else here: the menu's OWN activate handler is connected
                // AFTER this one and closes the menu (popupMenu.js:785-787), and
                // closing it ourselves was the crash. An action that writes
                // favorites rebuilds the row, the icon the menu is anchored to
                // dies with it, and the BoxPointer is disposed before our close
                // reaches it -- journal: "BoxPointer ... already disposed" from
                // exactly this line, with the PopupMenuItem right behind it.
                item.action();
            });
            menu.addMenuItem(menuItem);
        }
        this._menuSignals.connect(menu, "open-state-changed", (_source, isOpen) => {
            if (!isOpen) {
                this._finalizeContextMenu();
            }
        });
        // The shell disposes a menu whose anchor dies under it, and no
        // open-state-changed reaches us for that. Without this hook the corpse
        // stays in `_contextMenu`, and the manager would still be closing it on
        // the next open -- this boot's "Object Gjs_ui_boxpointer_BoxPointer has
        // been already disposed" stack, thrown out of our own `menu.open()`.
        // Here we only let go of our own references: the actor is gone, so
        // touching it again is exactly the noise this hook exists to prevent.
        this._menuSignals.connect(menu.actor, "destroy", () => {
            if (this._contextMenu !== menu)
                return;
            this._contextMenu = null;
            const signals = this._menuSignals;
            this._menuSignals = null;
            signals?.disconnectAll();
        });
        this._menuManager.addMenu(menu);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._contextMenu !== menu) {
                return GLib.SOURCE_REMOVE;
            }
            // The identity check above is not enough: a favorites change that
            // rebuilds the row destroys the menu's source actor, and the menu
            // disposes with it while this idle is still queued. Measured live --
            // journal showed `open()` throwing on an already-disposed BoxPointer.
            try {
                menu.actor.opacity = 255;
                menu.open(BoxPointer.PopupAnimation.FULL);
                this._menuManager?.ignoreRelease?.();
            }
            catch (e) {
                this._finalizeContextMenu();
                console.warn(`[macos-dock-local][icons] context menu vanished before it opened: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    _closeContextMenu() {
        const menu = this._contextMenu;
        if (!menu)
            return;
        let open = false;
        try {
            open = menu.isOpen;
        }
        catch (_e) {
            // The menu outlived its own anchor: the row rebuild that followed a
            // favorites write destroyed the icon it points at, and the BoxPointer
            // went with it -- silently, with no open-state-changed for us to see.
            // The bookkeeping still has to come down or every later menu inherits
            // this dead reference.
            this._finalizeContextMenu();
            return;
        }
        if (open)
            // NONE, not the FADE default: `close()` emits the state change
            // synchronously and then animates (popupMenu.js:1083-1094), so the
            // finalize this signal runs destroys the actor WHILE that animation
            // is still holding it — which is how the BoxPointer ended up disposed
            // from C code with the manager still pointing at it.
            menu.close(BoxPointer.PopupAnimation.NONE);
        else
            this._finalizeContextMenu();
    }
    /**
     * Tear the context menu down in the order the shell's own bookkeeping
     * requires:
     *
     *   1. our references first, so nothing re-enters;
     *   2. CLOSE it if it is still open, because `_onMenuOpenState` is the only
     *      thing that assigns `activeMenu = null` (popupMenu.js:1486-1487) and it
     *      only does so on the close;
     *   3. destroy, and let the manager's own destroy hook call `removeMenu`.
     *
     * Step 3 is why step 2 cannot be skipped and why we never call `removeMenu()`
     * ourselves: that method pops the modal and unlinks the menu but NEVER clears
     * `activeMenu` (popupMenu.js:1438-1456), and it disconnects the manager from
     * the menu on the way out — so a menu destroyed while open leaves the manager
     * holding a corpse, and the next `menu.open()` throws while closing it. That
     * is the "Object Gjs_ui_boxpointer_BoxPointer has been already disposed"
     * stack this boot's journal shows twice, with our own open() in frame 5.
     */
    _finalizeContextMenu() {
        const menu = this._contextMenu;
        this._contextMenu = null;
        const signals = this._menuSignals;
        this._menuSignals = null;
        if (!menu) {
            signals?.disconnectAll();
            return;
        }
        try {
            if (menu.isOpen)
                menu.close(BoxPointer.PopupAnimation.NONE);
        }
        catch (_e) {
            // Already disposed with the icon it was anchored to. Its open state is
            // unknowable now, but the manager can no longer close it either, so
            // the only thing left to do is make sure we never point at it again.
        }
        // Disconnected after the close: the close is what the manager needs to
        // hear, and the signal handlers are ours to hand over.
        signals?.disconnectAll();
        try {
            menu.destroy();
        }
        catch (_e) { /* already gone with its anchor */ }
    }
    _closeApp(app) {
        const windows = app.get_windows();
        for (const window of windows) {
            if (this.representsTrashWindow(window))
                continue;
            window.delete(global.get_current_time());
        }
    }
    /**
     * The line spans the icons rather than a fixed pixel count, and it lies
     * down when the dock turns to a side edge -- Ubuntu's stylesheet carries one
     * rule per position for the same reason. Called when the separator is
     * created, when `icon-size` changes and when the dock changes position.
     */
    applySeparatorGeometry() {
        if (!this._separator)
            return;
        const vertical = !!this._container?.vertical;
        const size = this._iconSize;
        this._separator.set_size(vertical ? size : 1, vertical ? 1 : size);
    }
    _addSeparator(reason = "unspecified", favCount = -1, runningCount = -1) {
        if (this._separator)
            return;
        this._separator = new St.Widget({
            style_class: "macos-dock-separator",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.applySeparatorGeometry();
        // Insert after the last favorite icon, before non-favorite running apps
        let insertIndex = 0;
        for (const [id] of this._icons) {
            if (this._favorites.includes(id)) {
                insertIndex++;
            }
            else {
                break;
            }
        }
        this._container.insert_child_at_index(this._separator, insertIndex);
        console.log(`[macos-dock-local][icons] +separator at=${insertIndex} (favs=${favCount} running=${runningCount} reason=${reason})`);
    }
    _updateTrashButton() {
        if (this._showTrash && this._trashManager && !this._trashButton) {
            this._addTrashButton();
        }
        else if ((!this._showTrash || !this._trashManager) && this._trashButton) {
            this._removeTrashButton();
        }
        else {
            this._refreshTrashIcon();
        }
    }
    _refreshTrashIcon() {
        if (this._trashIcon && this._trashManager)
            this._trashIcon.set_gicon(this._trashManager.getIcon());
    }
    _applyTrashIconSize() {
        if (!this._trashButton)
            return;
        this._applyIconTexture(this._trashIcon);
        this._trashIconWrapper.set_size(this._iconSize, this._iconSize);
        const padded = this._iconSize + 12;
        this._trashButton.set_size(padded, padded + 4);
    }
    /**
     * One indicator per open trash window, in the dock's current indicator
     * style, so an open trash reads as running the way any other icon does.
     */
    _refreshTrashIndicator() {
        const box = this._trashIndicatorBox;
        if (!box)
            return;
        const count = this._runningIndicatorsEnabled && this._trashManager
            ? Math.min(this._trashManager.getWindows().length, this._maxIndicatorDots)
            : 0;
        const stateKey = `${count}:${this._indicatorStyle}:${this._runningIndicatorsEnabled ? 1 : 0}`;
        if (count === 0) {
            box.visible = false;
            this._trashIndicatorState = stateKey;
            return;
        }
        if (this._trashIndicatorState === stateKey && box.visible)
            return;
        this._trashIndicatorState = stateKey;
        box.visible = true;
        box.remove_all_children();
        if (this._indicatorStyle === 0) {
            for (let i = 0; i < count; i++) {
                box.add_child(new St.Widget({ style_class: "macos-dock-indicator-dot" }));
            }
        }
        else {
            box.add_child(new St.Widget({ style_class: "macos-dock-indicator-bar" }));
        }
    }
    _addTrashButton() {
        if (this._trashButton || !this._trashManager)
            return;
        this._trashButton = new St.BoxLayout({
            style_class: "macos-dock-trash",
            reactive: true,
            track_hover: true,
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
        });
        this._trashIcon = new St.Icon({
            gicon: this._trashManager.getIcon(),
            style_class: "macos-dock-trash-icon",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._trashIconWrapper = new St.Widget({
            style_class: "macos-dock-icon-wrapper",
            layout_manager: new Clutter.FixedLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._trashIconWrapper.add_child(this._trashIcon);
        this._trashButton.add_child(this._trashIconWrapper);
        // The indicator row repeats an app icon's two-child shape, so a Trash
        // dot lands on the same line as every other dot in the row.
        this._trashIndicatorBox = new St.BoxLayout({
            style_class: "macos-dock-indicator-box",
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._trashButton.add_child(this._trashIndicatorBox);
        this._applyTrashIconSize();
        this._refreshTrashIndicator();
        this._signals.connect(this._trashButton, "button-press-event", (_actor, event) => {
            const button = event.get_button();
            if (button === 3) {
                this._showTrashContextMenu(this._trashButton);
                return Clutter.EVENT_STOP;
            }
            if (button === 2) {
                this._trashAction("new-window");
                return Clutter.EVENT_STOP;
            }
            if (button !== 1)
                return Clutter.EVENT_PROPAGATE;
            // Activating on release, like an app icon: the dock can be mid-dodge
            // when a press lands, and a press that both hides the row and opens
            // the trash reads as one wrong click.
            this._pressedTrash = this._trashButton;
            return Clutter.EVENT_PROPAGATE;
        });
        this._signals.connect(this._trashButton, "button-release-event", (_actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            const pressed = this._pressedTrash;
            this._pressedTrash = null;
            if (pressed !== this._trashButton || !this._trashButton.hover)
                return Clutter.EVENT_PROPAGATE;
            this._trashAction("activate");
            return Clutter.EVENT_STOP;
        });
        this._signals.connect(this._trashButton, "notify::hover", () => {
            if (this._trashButton?.hover) {
                this._showTooltip(this._trashButton, "Trash");
                if (this._windowPreviewsEnabled && this._previewPopup) {
                    this._previewPopup.cancelScheduledHide();
                    this._previewPopup.show(this._trashPreviewSubject(), this._trashButton);
                }
            }
            else {
                this._hideTooltip();
                if (this._previewPopup?.isVisible())
                    this._previewPopup.scheduleHide();
            }
        });
        const btn = this._trashButton;
        btn.connect("destroy", () => this._signals.disconnect(btn));
        this._container.add_child(this._trashButton);
        console.log(`[macos-dock-local][icons] +trash (empty=${this._trashManager.isEmpty()})`);
        if (this._onIconsChanged && !this._reloadBatching)
            this._onIconsChanged();
    }
    _removeTrashButton() {
        if (!this._trashButton)
            return;
        this._pressedTrash = null;
        // The button is gone, so no leave-event will ever arrive to close what it
        // was showing.
        this._previewPopup?.hide();
        this._container.remove_child(this._trashButton);
        this._trashButton.destroy();
        this._trashButton = null;
        this._trashIcon = null;
        this._trashIconWrapper = null;
        this._trashIndicatorBox = null;
        this._trashIndicatorState = null;
        if (this._onIconsChanged)
            this._onIconsChanged();
    }
    _updateAppButton() {
        if (this._showAppButton && !this._appButton) {
            this._addAppButton();
        }
        else if (!this._showAppButton && this._appButton) {
            this._removeAppButton();
        }
    }
    _addAppButton() {
        if (this._appButton)
            return;
        const padded = this._iconSize + 12;
        this._appButton = new St.BoxLayout({
            style_class: "macos-dock-app-button",
            reactive: true,
            track_hover: true,
            vertical: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.FILL,
            width: padded,
            height: padded + 4,
        });
        this._appButtonIcon = new St.Icon({
            icon_name: IconManager.BRAND_ICON,
            icon_size: this._iconSize,
            style_class: "macos-dock-app-button-icon",
        });
        this._appButton.add_child(this._appButtonIcon);
        this._signals.connect(this._appButton, "button-press-event", () => {
            if (Main.overview.visible) {
                Main.overview.hide();
            }
            else {
                Main.overview.showApps();
            }
            return Clutter.EVENT_STOP;
        });
        // Tooltip on hover
        this._signals.connect(this._appButton, "notify::hover", () => {
            if (this._appButton?.hover) {
                this._showTooltip(this._appButton, "Applications");
            }
            else {
                this._hideTooltip();
            }
        });
        // Drop this button's entries from the shared signal table when it is
        // destroyed (_removeAppButton), so they do not accumulate across
        // toggles. Raw connect so it is not self-managed.
        const btn = this._appButton;
        btn.connect("destroy", () => this._signals.disconnect(btn));
        this._container.add_child(this._appButton);
        // Notify dock to resize (batched by _reload during the first build)
        if (this._onIconsChanged && !this._reloadBatching)
            this._onIconsChanged();
    }
    _removeAppButton() {
        if (!this._appButton)
            return;
        this._container.remove_child(this._appButton);
        this._appButton.destroy();
        this._appButton = null;
        this._appButtonIcon = null;
        // Notify dock to resize
        if (this._onIconsChanged)
            this._onIconsChanged();
    }
}
