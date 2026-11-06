import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { SignalManager } from "./signalManager.js";
const UPDATE_INTERVAL_MS = 200; // 5fps
const CLOSE_DELAY_MS = 300;
const MAX_COLUMNS = 4;
export class WindowPreviewPopup {
    _signals;
    _popup = null;
    _thumbs = [];
    _updateTimer = null;
    _closeTimer = null;
    _refreshTimer = null;
    _visible = false;
    _previewWidth;
    _lastIconActor = null;
    _currentAppId = null;
    _closing = false;
    _pinned = false;
    _pinGrab = null;
    _windowFilter = null;
    constructor() {
        this._signals = new SignalManager();
        this._previewWidth = 200;
    }
    setPreviewWidth(width) {
        this._previewWidth = width;
    }
    /**
     * Restrict the preview to the windows a predicate accepts. Used by the dock
     * to keep the Trash window out of the Files preview without patching Files.
     */
    setWindowFilter(filter) {
        this._windowFilter = filter;
    }
    _windowsFor(app) {
        const windows = app.get_windows();
        return this._windowFilter
            ? windows.filter((window) => this._windowFilter(window, app))
            : windows;
    }
    isVisible() {
        return this._visible;
    }
    /**
     * Ubuntu's `focus-or-previews` half: the same popup a hover already shows,
     * opened by a click on an app with several windows and held open until it is
     * dismissed -- a press outside it, Escape, or the same icon clicked again.
     *
     * The grab is the whole feature. Without `Main.pushModal` the pointer walking
     * off the dock closes the popup exactly as it closes a hover preview, and a
     * click that cannot be reached is not a preview. If the grab is refused the pin
     * is dropped rather than left open, so the popup falls back to the hover rules
     * instead of hanging on screen with nothing able to dismiss it.
     */
    togglePinned(app, iconActor) {
        if (this._pinned && this._currentAppId === app.get_id()) {
            this.hide();
            return;
        }
        this._cancelCloseTimer();
        this._pinned = true;
        this.show(app, iconActor);
        // show() builds nothing for an app with no windows, and a pin with nothing
        // to show must not hold a grab.
        if (!this._popup) {
            this._pinned = false;
            return;
        }
        if (!this._pushGrab()) {
            this._pinned = false;
            this.scheduleHide();
        }
    }
    _pushGrab() {
        if (this._pinGrab !== null)
            return true;
        if (!this._popup)
            return false;
        this._pinGrab = Main.pushModal(this._popup);
        return this._pinGrab !== null;
    }
    _releaseGrab() {
        if (this._pinGrab === null)
            return;
        try {
            Main.popModal(this._pinGrab);
        }
        catch (_e) { /* the grab was already gone with the stage */ }
        this._pinGrab = null;
    }
    /**
     * Returns the bounding rectangle of the popup so DockVisibility
     * can ignore pointer events inside it.
     */
    getBounds() {
        if (!this._popup || !this._visible)
            return null;
        const [x, y] = this._popup.get_transformed_position();
        const [w, h] = this._popup.get_size();
        return { x, y, width: w, height: h };
    }
    show(app, iconActor) {
        const windows = this._windowsFor(app);
        if (windows.length === 0)
            return;
        const appId = app.get_id();
        // Only skip the rebuild when the popup already shows THIS app (and is
        // not mid close). The old check ignored the app identity, so moving
        // the pointer from icon A to icon B kept showing A's windows.
        if (this._visible && this._popup && !this._closing && this._currentAppId === appId) {
            this._lastIconActor = iconActor;
            return;
        }
        this._currentAppId = appId;
        this._lastIconActor = iconActor;
        // Destroy synchronously to avoid race condition with async hide animation
        this._destroyPopupSync();
        this._createPopup(app, windows, iconActor);
    }
    hide() {
        this._pinned = false;
        this._releaseGrab();
        this._cancelCloseTimer();
        this._cancelRefreshTimer();
        this._stopUpdateTimer();
        if (this._popup) {
            // Mark the 120ms out-animation so a re-hover during it revives the
            // popup (show() rebuilds) instead of letting it die silently.
            this._closing = true;
            this._animateOut(() => {
                this._destroyPopup();
            });
        }
    }
    scheduleHide() {
        // A click-opened preview outlives the pointer: hover-leave must not close
        // it, or the pin would be cosmetic.
        if (this._pinned)
            return;
        this._cancelCloseTimer();
        this._closeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CLOSE_DELAY_MS, () => {
            this.hide();
            this._closeTimer = null;
            return GLib.SOURCE_REMOVE;
        });
    }
    cancelScheduledHide() {
        this._cancelCloseTimer();
    }
    stop() {
        this._pinned = false;
        this._cancelCloseTimer();
        this._cancelRefreshTimer();
        this._stopUpdateTimer();
        this._destroyPopup();
    }
    _createPopup(app, windows, iconActor) {
        const grid = new St.BoxLayout({
            style_class: "macos-dock-preview-grid",
            vertical: false,
            reactive: true,
        });
        const columns = Math.min(windows.length, MAX_COLUMNS);
        const thumbHeight = Math.round(this._previewWidth * 0.625);
        const thumbSpacing = 6;
        let col = 0;
        let row = 0;
        const rows = [];
        // First pass: non-minimized windows
        for (const metaWin of windows) {
            if (metaWin.minimized)
                continue;
            const thumbData = this._createThumb(app, metaWin, thumbHeight);
            this._thumbs.push(thumbData);
            if (!rows[row])
                rows[row] = [];
            rows[row].push(thumbData);
            col++;
            if (col >= columns) {
                col = 0;
                row++;
            }
        }
        // If all windows are minimized, show them with reduced opacity
        if (this._thumbs.length === 0) {
            for (const metaWin of windows) {
                const thumbData = this._createThumb(app, metaWin, thumbHeight);
                thumbData.actor.opacity = 128;
                this._thumbs.push(thumbData);
                if (!rows[row])
                    rows[row] = [];
                rows[row].push(thumbData);
                col++;
                if (col >= columns) {
                    col = 0;
                    row++;
                }
            }
        }
        // Build row layout
        for (const rowData of rows) {
            const rowBox = new St.BoxLayout({
                style_class: "macos-dock-preview-row",
                vertical: false,
            });
            rowBox.set_style(`spacing: ${thumbSpacing}px;`);
            for (const thumbData of rowData) {
                rowBox.add_child(thumbData.actor);
            }
            grid.add_child(rowBox);
        }
        // Create outer popup container
        this._popup = new St.BoxLayout({
            style_class: "macos-dock-preview-popup",
            vertical: true,
            reactive: true,
        });
        this._popup.add_child(grid);
        // Keep popup open when mouse is over it
        this._signals.connect(this._popup, "enter-event", () => {
            this.cancelScheduledHide();
            return Clutter.EVENT_PROPAGATE;
        });
        this._signals.connect(this._popup, "leave-event", () => {
            this.scheduleHide();
            return Clutter.EVENT_PROPAGATE;
        });
        // While a click holds this preview open the popup owns a modal grab, so
        // everything arrives here first: Escape or a press anywhere outside it is a
        // dismiss. Same shape as the shell's own MenuManager._onCapturedEvent
        // (popupMenu.js:1501-1529) -- it is the pattern that makes a pinned popup
        // safe to grab at all.
        this._signals.connect(this._popup, "captured-event", (_actor, event) => {
            if (!this._pinned)
                return Clutter.EVENT_PROPAGATE;
            const type = event.type();
            if (type === Clutter.EventType.KEY_PRESS &&
                event.get_key_symbol() === Clutter.KEY_Escape) {
                this.hide();
                return Clutter.EVENT_STOP;
            }
            if (type !== Clutter.EventType.BUTTON_PRESS)
                return Clutter.EVENT_PROPAGATE;
            const target = global.stage.get_event_actor(event);
            if (target && this._popup?.contains(target))
                return Clutter.EVENT_PROPAGATE;
            this.hide();
            return Clutter.EVENT_STOP;
        });
        Main.layoutManager.addTopChrome(this._popup);
        // A rebuild for a different app while pinned has to re-grab: the old popup
        // was destroyed, and its grab went with it.
        if (this._pinned)
            this._pushGrab();
        // Position the popup
        this._positionPopup(iconActor);
        // Animate in
        this._animateIn();
        // Start thumbnail updates
        this._startUpdateTimer();
    }
    _createThumb(app, metaWin, thumbHeight) {
        const thumbBox = new St.BoxLayout({
            style_class: "macos-dock-preview-thumb",
            vertical: true,
            reactive: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        // Window thumbnail using Clutter.Clone of the window actor
        const windowActors = global.get_window_actors();
        for (const wa of windowActors) {
            const metaWin2 = wa.meta_window;
            if (metaWin2 === metaWin) {
                const clone = new Clutter.Clone({
                    source: wa,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                // Scale the clone to fit the thumbnail width
                const [actorWidth, actorHeight] = wa.get_size();
                if (actorWidth > 0 && actorHeight > 0) {
                    const scale = this._previewWidth / actorWidth;
                    clone.set_size(this._previewWidth, Math.round(actorHeight * scale));
                }
                thumbBox.add_child(clone);
                break;
            }
        }
        // Window title
        const title = metaWin.get_title() || "Window";
        const titleLabel = new St.Label({
            style_class: "macos-dock-preview-title",
            text: title,
            x_align: Clutter.ActorAlign.CENTER,
        });
        thumbBox.add_child(titleLabel);
        // Close button
        const closeBtn = new St.Button({
            style_class: "macos-dock-preview-close-btn",
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.START,
            label: "×",
            reactive: true,
        });
        closeBtn.set_pivot_point(1.0, 0.0);
        closeBtn.connect("clicked", () => {
            metaWin.delete(global.get_current_time());
            if (this._refreshTimer !== null) {
                GLib.source_remove(this._refreshTimer);
                this._refreshTimer = null;
            }
            this._refreshTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._refreshAfterClose(app);
                this._refreshTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        });
        closeBtn.connect("button-press-event", () => Clutter.EVENT_STOP);
        thumbBox.add_child(closeBtn);
        // Click to focus this window
        this._signals.connect(thumbBox, "button-press-event", (_actor, event) => {
            const button = event.get_button();
            if (button === 1) {
                if (metaWin.minimized) {
                    metaWin.unminimize();
                }
                metaWin.activate(global.get_current_time());
                this.hide();
            }
            return Clutter.EVENT_STOP;
        });
        // Highlight focused window
        if (metaWin.has_focus()) {
            thumbBox.add_style_class_name("macos-dock-preview-focused");
        }
        // Set size
        const thumbWidth = this._previewWidth;
        thumbBox.set_size(thumbWidth, thumbHeight + 24);
        return { actor: thumbBox, metaWindow: metaWin };
    }
    _positionPopup(iconActor) {
        if (!this._popup)
            return;
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const [iconX, iconY] = iconActor.get_transformed_position();
        const [iconW, iconH] = iconActor.get_size();
        const [, popupW] = this._popup.get_preferred_width(-1);
        const [, popupH] = this._popup.get_preferred_height(-1);
        // Try positioning above the icon first
        let x = iconX + (iconW - popupW) / 2;
        let y = iconY - popupH - 10;
        // If it goes above the screen, position below
        if (y < monitor.y) {
            y = iconY + iconH + 10;
        }
        // Clamp horizontal to monitor bounds
        if (x < monitor.x) {
            x = monitor.x + 4;
        }
        else if (x + popupW > monitor.x + monitor.width) {
            x = monitor.x + monitor.width - popupW - 4;
        }
        this._popup.set_position(Math.round(x), Math.round(y));
    }
    _animateIn() {
        if (!this._popup)
            return;
        this._popup.opacity = 0;
        const startY = this._popup.y;
        this._popup.y = startY + 10;
        this._popup.ease({
            opacity: 255,
            y: startY,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this._visible = true;
            },
        });
    }
    _animateOut(onComplete) {
        if (!this._popup) {
            onComplete();
            return;
        }
        const popupRef = this._popup;
        const startY = this._popup.y;
        this._popup.ease({
            opacity: 0,
            y: startY + 10,
            duration: 120,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                this._visible = false;
                // Only call onComplete if the popup hasn't been replaced
                if (this._popup === popupRef) {
                    onComplete();
                }
            },
        });
    }
    _startUpdateTimer() {
        this._stopUpdateTimer();
        this._updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_INTERVAL_MS, () => {
            this._updateFocusHighlights();
            return GLib.SOURCE_CONTINUE;
        });
    }
    _stopUpdateTimer() {
        if (this._updateTimer !== null) {
            GLib.source_remove(this._updateTimer);
            this._updateTimer = null;
        }
    }
    _updateFocusHighlights() {
        for (const thumb of this._thumbs) {
            // A window can be destroyed between two 200ms ticks; skip it rather
            // than throwing on a disposed Meta.Window / actor.
            try {
                if (!thumb.metaWindow)
                    continue;
                const isFocused = thumb.metaWindow.has_focus();
                if (isFocused) {
                    if (!thumb.actor.has_style_class_name("macos-dock-preview-focused")) {
                        thumb.actor.add_style_class_name("macos-dock-preview-focused");
                    }
                }
                else {
                    thumb.actor.remove_style_class_name("macos-dock-preview-focused");
                }
            }
            catch (_e) {
                // Disposed window/actor; ignore this tick.
            }
        }
    }
    _refreshAfterClose(app) {
        if (!this._visible)
            return;
        const windows = this._windowsFor(app);
        if (windows.length === 0) {
            this.hide();
            return;
        }
        // Rebuild the popup
        this._destroyPopup();
        this._currentAppId = app.get_id();
        if (this._lastIconActor) {
            this._createPopup(app, windows, this._lastIconActor);
        }
    }
    _destroyPopupSync() {
        this._cancelCloseTimer();
        this._cancelRefreshTimer();
        this._stopUpdateTimer();
        this._destroyPopup();
    }
    _destroyPopup() {
        this._stopUpdateTimer();
        this._cancelRefreshTimer();
        // The grab belongs to the popup actor, so it has to come down with it --
        // a rebuilt popup pushes a fresh one, and a popup destroyed while pinned
        // would otherwise leave the stage grabbed with nothing left on screen.
        this._releaseGrab();
        for (const thumb of this._thumbs) {
            thumb.actor.destroy();
        }
        this._thumbs = [];
        if (this._popup) {
            this._signals.disconnectAll();
            Main.layoutManager.removeChrome(this._popup);
            this._popup.destroy();
            this._popup = null;
        }
        this._visible = false;
        this._closing = false;
        this._currentAppId = null;
    }
    _cancelCloseTimer() {
        if (this._closeTimer !== null) {
            GLib.source_remove(this._closeTimer);
            this._closeTimer = null;
        }
    }
    _cancelRefreshTimer() {
        if (this._refreshTimer !== null) {
            GLib.source_remove(this._refreshTimer);
            this._refreshTimer = null;
        }
    }
}
