import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";
import St from "gi://St";
import * as BoxPointer from "resource:///org/gnome/shell/ui/boxpointer.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { SignalManager } from "./signalManager.js";
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
    _onContextMenuActorChanged = null;
    _icons = new Map();
    _apps = new Map();
    _favorites = [];
    _shellSettings = null;
    _windowChangeSourceId = null;
    _startupMono = 0;
    _settleSourceId = null;
    _settleReason = null;
    _tooltipText = null;
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
        this._indicatorStyle = indicatorStyle;
    }
    setOnClicked(callback) {
        this._onClicked = callback;
    }
    setOnIconsChanged(callback) {
        this._onIconsChanged = callback;
    }
    setOnMediaAction(callback) {
        this._onMediaAction = callback;
    }
    setMediaControlsEnabled(enabled) {
        this._mediaControlsEnabled = enabled;
    }
    setOnContextMenuActorChanged(callback) {
        this._onContextMenuActorChanged = callback;
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
    }
    setQuality(_quality) {
        for (const actor of this._icons.values()) {
            this._applyIconSize(actor);
        }
    }
    setIndicatorStyle(style) {
        this._indicatorStyle = style;
        this._refreshAllIndicators();
    }
    setRunningIndicatorsEnabled(enabled) {
        this._runningIndicatorsEnabled = enabled;
        for (const [appId, actor] of this._icons.entries()) {
            this._refreshRunningIndicator(actor, appId);
        }
    }
    setShowAppButton(show) {
        this._showAppButton = show;
        this._updateAppButton();
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
        this._started = false;
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
    getIconCount() {
        return this._icons.size;
    }
    hasSeparator() {
        return this._separator !== null;
    }
    hasAppButton() {
        return this._appButton !== null;
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
        const t0 = GLib.get_monotonic_time();
        const fav = this._syncFavorites();
        // The iconFix wrapper may suppress _doWindowChange to undefined on
        // error; count that as a no-op rather than failing the whole sync.
        const win = this._doWindowChange() ?? { added: 0, removed: 0 };
        const reordered = this._enforceOrder();
        if (reason === "installed-changed")
            this._refreshIconsFromAppSystem();
        console.log(`[macos-dock-local][icons] incremental: +${fav.added + win.added} -${fav.removed + win.removed} reorder:${reordered ? "yes" : "no"} (reason=${reason}) in ${(GLib.get_monotonic_time() - t0) / 1000}ms`);
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
            if (this._icons.has(id))
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
        // Current icon order, excluding separator and Show Apps button.
        const current = [];
        for (const child of c.get_children()) {
            if (child === this._separator || child === this._appButton)
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
            // Then pin separator after the last favorite, Show Apps last.
            // Relocating these two never disturbs icon relative order. Check
            // first so steady state costs zero moves and zero log noise.
            if (this._separator && c.get_child_at_index(favActors.length) !== this._separator) {
                c.set_child_at_index(this._separator, favActors.length);
                moved = true;
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
            // Add separator if there are both favorites and running apps
            if (this._favorites.length > 0 && runningApps.length > 0) {
                this._addSeparator("reload", this._favorites.length, runningApps.length);
            }
            // Then any running app that isn't already a favorite.
            for (const app of runningApps) {
                this._addIcon(app);
            }
            // Add applications button at the end
            this._updateAppButton();
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
        // getIconCount() (and thus the dock width) stays in sync with the still
        // -visible child; otherwise the container shrinks ~200ms too early and
        // pushes the Show Apps button past the dock's right edge.
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
                if (this._icons.has(id))
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
        const easeOut = (params) => actor.ease(params);
        easeOut({
            opacity: 0,
            scale_x: 0.8,
            scale_y: 0.8,
            duration: 200,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
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
                if (this._icons.get(id) === actor) {
                    this._icons.delete(id);
                    this._apps.delete(id);
                }
                // Re-settle the separator now the fade is complete (it was
                // kept alive by the fading icon above, if it was the last
                // running non-favorite). No-op when a full _reload() already
                // rebuilt everything (early return above).
                try { this._updateSeparator("fade-complete"); } catch (_e2) {}
                if (this._onIconsChanged)
                    this._onIconsChanged();
            },
        });
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
        // Count ACTUAL non-favorite icons, not _getRunningApps(). The add path
        // (_doWindowChange) skips any app whose id AppSystem.lookup_app() cannot
        // resolve, so re-querying the running set here could count an app that
        // never got an icon and raise an orphan separator: journal showed
        // "+separator running=1" inside the same _doSync that logged
        // "incremental: +0 -0", then "-separator running=0" ~660ms later — a 1px
        // line popping in and the dock snapping 15px wider and back, with no
        // animation either way. Native dash.js derives its separator from the
        // real child count for exactly this reason.
        // Icons mid fade-out are still keyed in _icons (the entry is kept until
        // onComplete, see _removeIconAnimated), so this single loop also covers
        // what the old fadingNonFavorites pass existed for — the separator still
        // does not pop out from under a still-fading icon. Only Map keys are
        // read, never actor properties, so this stays clear of the disposed
        // -actor probing that iconFix's no-touch guards exist to avoid.
        let runningNonFavorites = 0;
        for (const id of this._icons.keys()) {
            if (!this._favorites.includes(id))
                runningNonFavorites++;
        }
        const hasFavorites = this._favorites.length > 0;
        const hasRunningNonFavorites = runningNonFavorites > 0;
        // Add separator if needed
        if (hasFavorites && hasRunningNonFavorites && !this._separator) {
            this._addSeparator(reason, this._favorites.length, runningNonFavorites);
        }
        // Remove separator if not needed
        else if ((!hasFavorites || !hasRunningNonFavorites) && this._separator) {
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
        this._signals.connect(actor, "button-press-event", (_actor, event) => {
            const button = event.get_button();
            if (button === 3) {
                this._showContextMenu(actor, app);
                return Clutter.EVENT_STOP;
            }
            if (button !== 1) {
                return Clutter.EVENT_PROPAGATE;
            }
            if (this._onClicked) {
                this._onClicked(app);
            }
            return Clutter.EVENT_STOP;
        });
        // Tooltip events - use notify::hover since track_hover is enabled
        this._signals.connect(actor, "notify::hover", () => {
            if (actor.hover) {
                this._showTooltip(actor, app.get_name());
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
    _applyIconSize(actor) {
        const data = this._getStored(actor);
        if (data) {
            data.icon.set_icon_size(this._iconSize);
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
                if (tracker.get_window_app(mw) === app) {
                    windowCount++;
                }
            }
        }
        const focused = tracker.focus_app === app;
        const isRunning = windowCount > 0 || focused;
        if (!isRunning) {
            indicatorBox.visible = false;
            if (data)
                data._lastIndicatorState = "off";
            return;
        }
        // Skip widget churn when nothing changed since last refresh (e.g.
        // every Alt-Tab fires notify::focus-app even for unrelated apps).
        const stateKey = `${focused ? 1 : 0}:${windowCount}:${this._indicatorStyle}:${this._runningIndicatorsEnabled ? 1 : 0}`;
        if (data._lastIndicatorState === stateKey && indicatorBox.visible)
            return;
        data._lastIndicatorState = stateKey;
        indicatorBox.visible = true;
        // Clear all children before adding new style.
        indicatorBox.remove_all_children();
        if (this._indicatorStyle === 0) {
            // Dots per window (macOS style).
            const needed = focused ? Math.max(windowCount, 1) : windowCount;
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
        const actor = this._icons.get(appId);
        const data = actor ? this._getStored(actor) : null;
        const wrapper = data?.iconWrapper;
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
        const actor = this._icons.get(appId);
        const data = actor ? this._getStored(actor) : null;
        const wrapper = data?.iconWrapper;
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

            const alive = () => token === wrapper._genieSquash && wrapper.get_parent() !== null;
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
    _showTooltip(actor, appName) {
        if (!this._tooltipText)
            return;
        const [x, y] = actor.get_transformed_position();
        const [width] = actor.get_size();
        this._tooltipText.set_text(appName);
        const [, tooltipWidth] = this._tooltipText.get_preferred_width(-1);
        const [, tooltipHeight] = this._tooltipText.get_preferred_height(-1);
        // Position tooltip above the icon, centered, clamped to screen bounds
        let tooltipX = x + (width - tooltipWidth) / 2;
        let tooltipY = y - 40;
        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                tooltipX = Math.max(monitor.x, Math.min(tooltipX, monitor.x + monitor.width - tooltipWidth));
                tooltipY = Math.max(monitor.y, tooltipY);
            }
        } catch (e) {}
        this._tooltipText.set_position(tooltipX, tooltipY);
        this._tooltipText.show();
    }
    _hideTooltip() {
        if (this._tooltipText) {
            this._tooltipText.hide();
        }
    }
    _showContextMenu(actor, app) {
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
        const menuItems = [
            { label: "New Window", action: () => app.open_new_window(-1) },
        ];
        if (this._mediaControlsEnabled && this._playingAppId === app.get_id()) {
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
        menuItems.push({ label: "Close", action: () => this._closeApp(app) });
        for (const item of menuItems) {
            const menuItem = new PopupMenu.PopupMenuItem(item.label);
            this._menuSignals.connect(menuItem, "activate", () => {
                item.action();
                this._closeContextMenu();
            });
            menu.addMenuItem(menuItem);
        }
        this._menuSignals.connect(menu, "open-state-changed", (_source, isOpen) => {
            if (!isOpen) {
                this._finalizeContextMenu();
            }
        });
        this._menuManager.addMenu(menu);
        this._onContextMenuActorChanged?.(menu.actor);
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._contextMenu !== menu) {
                return GLib.SOURCE_REMOVE;
            }
            try { menu.actor.opacity = 255; } catch (e) {}
            menu.open(BoxPointer.PopupAnimation.FULL);
            this._menuManager?.ignoreRelease?.();
            return GLib.SOURCE_REMOVE;
        });
    }
    _closeContextMenu() {
        if (!this._contextMenu)
            return;
        if (this._contextMenu.isOpen) {
            this._contextMenu.close();
        }
        else {
            this._finalizeContextMenu();
        }
    }
    _finalizeContextMenu() {
        this._onContextMenuActorChanged?.(null);
        if (this._menuSignals) {
            this._menuSignals.disconnectAll();
            this._menuSignals = null;
        }
        if (this._contextMenu) {
            const menu = this._contextMenu;
            this._contextMenu = null;
            this._menuManager?.removeMenu(menu);
            menu.destroy();
        }
    }
    _closeApp(app) {
        const windows = app.get_windows();
        for (const window of windows) {
            window.delete(global.get_current_time());
        }
    }
    _addSeparator(reason = "unspecified", favCount = -1, runningCount = -1) {
        if (this._separator)
            return;
        this._separator = new St.Widget({
            style_class: "macos-dock-separator",
            width: 1,
            height: 32,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
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
