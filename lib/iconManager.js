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
    // Boot settle window: coalesce _reload() bursts fired while the session
    // restores apps (installed-changed etc.) so the dock paints once instead
    // of flashing a rebuild ~10s after login. First paint stays immediate.
    static SETTLE_WINDOW_MS = 12000;
    static SETTLE_DEBOUNCE_MS = 1500;
    static STARTUP_GRACE_MS = 1200;
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
    _tooltipText = null;
    _contextMenu = null;
    _menuSignals = null;
    _menuManager = null;
    _reloadBatching = false;
    _started = false;
    _startupFadePending = true;
    _startupGraceActive = false;
    _postGraceSourceId = null;
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
        // start()'s own _reload() already reads the field. Reloading here would
        // consume _startupFadePending while _startupGraceActive is still false,
        // exposing the remaining startup rebuilds on a visible dock (flicker).
        if (this._started)
            this._reload();
    }
    setWorkspaceMode(mode) {
        this._workspaceMode = mode;
        if (this._started)
            this._reload();
    }
    reload() {
        this._reload();
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
        this._signals.connect(appSystem, "installed-changed", () => this._requestReload());
        // Cache org.gnome.shell settings and refresh the dock when the user
        // pins/unpins a favorite (previously only picked up on an unrelated
        // reload). Disconnected by stop()'s disconnectAll().
        try {
            this._shellSettings = new Gio.Settings({ schema: "org.gnome.shell" });
            this._signals.connect(this._shellSettings, "changed::favorite-apps", () => this._requestReload());
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
        // Hide the dock during the noisy startup phase (transient windows/apps)
        // and reveal it once the layout has stabilised. The grace flag must be
        // set BEFORE the first _reload() so it stays hidden, not fading in.
        this._startupGraceActive = true;
        this._reload();
        this._postGraceSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IconManager.STARTUP_GRACE_MS, () => {
            this._postGraceSourceId = null;
            this._endStartupGrace();
            return GLib.SOURCE_REMOVE;
        });
        // From here on the setters must reload again (they were no-ops before).
        this._started = true;
    }
    _endStartupGrace() {
        this._startupGraceActive = false;
        this._reload();
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
     * Settle-aware request for external bursts (installed-changed).
     * Inside the post-login settle window, do a non-destructive *incremental*
     * sync (_doWindowChange) instead of a full teardown (!). A full _reload()
     * removes all children then re-adds them, which paints a visible flash;
     * the incremental sync just adds/removes the newly-restored running apps
     * in place, so the dock never fully repaints. User-initiated setters keep
     * calling _reload() directly (immediate, full).
     */
    _requestReload() {
        // Startup grace: the container is hidden; skip installed-driven syncs
        // entirely (the end-of-grace full reload settles everything).
        if (this._startupGraceActive)
            return;
        let inSettle = false;
        try {
            if (this._startupMono)
                inSettle = (GLib.get_monotonic_time() - this._startupMono) / 1000 < IconManager.SETTLE_WINDOW_MS;
        } catch (_e) { inSettle = false; }
        if (!inSettle) {
            this._reload();
            return;
        }
        if (this._settleSourceId !== null) {
            try { GLib.source_remove(this._settleSourceId); } catch (_e) {}
            this._settleSourceId = null;
        }
        try {
            this._settleSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IconManager.SETTLE_DEBOUNCE_MS, () => {
                this._settleSourceId = null;
                try { this._doWindowChange(); } catch (_e) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (_e) { this._settleSourceId = null; }
    }
    _reload() {
        // During startup, keep the container hidden until the grace period ends
        // so transient windows/apps don't make the separator and Show Apps
        // button flicker. The first visible paint fades the whole dock in once.
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
                this._addSeparator();
            }
            // Then any running app that isn't already a favorite.
            for (const app of runningApps) {
                this._addIcon(app);
            }
            // Add applications button at the end
            this._updateAppButton();
            if (this._startupFadePending && !this._startupGraceActive) {
                this._startupFadePending = false;
                const fadeIn = (params) => this._container.ease(params);
                fadeIn({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
            console.log(`[macos-dock-local][icons] reload: ${this._icons.size} icons in ${(GLib.get_monotonic_time() - t0) / 1000}ms`);
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
        // Remove any existing timeout before creating a new one.
        if (this._windowChangeSourceId !== null) {
            GLib.source_remove(this._windowChangeSourceId);
            this._windowChangeSourceId = null;
        }
        // During the startup grace period the container is hidden; skip
        // window-driven updates entirely (the end-of-grace reload settles).
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
                        if (this._onIconsChanged)
                            this._onIconsChanged();
                    },
                });
                changed = true;
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
            }
        }
        // Update separator visibility
        this._updateSeparator();
        this._refreshAllIndicators();
        // Notify dock to resize when icons were added/removed.
        if (changed && this._onIconsChanged)
            this._onIconsChanged();
    }
    _updateSeparator() {
        if (!this._showRunningApps) {
            if (this._separator) {
                this._separator.destroy();
                this._separator = null;
            }
            return;
        }
        // Count non-favorite running apps
        const runningNonFavorites = this._getRunningApps().filter((app) => !this._favorites.includes(app.get_id()));
        const hasFavorites = this._favorites.length > 0;
        const hasRunningNonFavorites = runningNonFavorites.length > 0;
        // Add separator if needed
        if (hasFavorites && hasRunningNonFavorites && !this._separator) {
            this._addSeparator();
        }
        // Remove separator if not needed
        else if ((!hasFavorites || !hasRunningNonFavorites) && this._separator) {
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
        this._container.add_child(actor);
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
    _refreshAllIndicators() {
        for (const [appId, actor] of this._icons.entries()) {
            this._refreshRunningIndicator(actor, appId);
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
        // Count all windows for this app (including minimized).
        let windowCount = 0;
        const actors = global.get_window_actors();
        for (const wa of actors) {
            const mw = wa.get_meta_window();
            if (!mw)
                continue;
            if (tracker.get_window_app(mw) === app) {
                windowCount++;
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
    _addSeparator() {
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
