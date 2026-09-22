import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

/**
 * Dodge controller for MacOS Dock companion fix.
 *
 * Desired behavior (user confirmed):
 *   auto-hide OFF + dodge ON  =>  dock stays visible when nothing covers it,
 *   hides when the *focused* window overlaps the dock rect.
 *   Mouse near the edge peeks the dock while hidden.
 *
 * The original extension only supports binary auto-hide:
 *   auto-hide ON  => always hidden unless pointer near edge (plus forced hide
 *                    on maximized overlap), starting hidden.
 *   auto-hide OFF => always visible, never dodges.
 * Original Intellihide also only checks maximized/fullscreen windows.
 *
 * This controller runs ONLY when original auto-hide is OFF, so the two never
 * fight. It reads dock geometry live from the container each check, so no
 * need to hook DockManager._updatePosition.
 *
 * Peek reliability (fix for "mouse to bottom edge never reveals dock"):
 * mirroring the original DockVisibility, pointer proximity is evaluated both
 * on motion-event AND in the poll tick via global.get_pointer(), so a missed
 * or stopped motion-event stream can never wedge the dock hidden.
 *
 * Peek is deliberately hard: the pointer must be pushed into a narrow deep
 * zone at the screen edge (peek-edge-px, cursor mostly clipped) and held
 * there for peek-hold-ms before the dock reveals. Passing near the edge
 * never triggers it.
 *
 * True fullscreen windows (video, games) force-hide the dock and suppress
 * peeking entirely when hide-in-fullscreen is on. Overview always wins and
 * forces the dock visible.
 */

console.log("[macos-dock-local][dodge] module LOADED marker-v3");
const TAG = "[macos-dock-local][dodge]";
const HIDE_THRESHOLD = 100; // px from the screen edge beyond which the pointer is "away"
const POINTER_ON_DOCK_PAD = 12; // pointer counts as "still on dock" within this margin
const POLL_MS = 120;

function rectsOverlap(a, b) {
    return a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
}

function windowShouldBeIgnored(metaWin) {
    if (!metaWin)
        return true;
    try {
        if (metaWin.minimized)
            return true;
    } catch (e) {}
    try {
        if (typeof metaWin.is_skip_taskbar === "function" && metaWin.is_skip_taskbar())
            return true;
    } catch (e) {}
    try {
        const t = metaWin.get_window_type();
        // Ignore desktop/dock/tooltip/notification chrome.
        if (t === Meta.WindowType.DESKTOP || t === Meta.WindowType.DOCK ||
            t === Meta.WindowType.SPLASHSCREEN || t === Meta.WindowType.NOTIFICATION ||
            t === Meta.WindowType.TOOLTIP)
            return true;
    } catch (e) {}
    try {
        if (!metaWin.showing_on_its_workspace())
            return true;
    } catch (e) {}
    try {
        const ws = metaWin.get_workspace();
        if (ws && ws !== global.workspace_manager.get_active_workspace())
            return true;
    } catch (e) {}
    return false;
}

export class DodgeController {
    _container = null;
    _dockManager = null;
    _onlyFocused = true;
    _isShown = true;
    _isAnimating = false;
    _peeked = false;
    _pollId = null;
    _animFallbackId = null;
    _lastRect = null;
    _overviewVisible = false;
    _companionSettings = null;
    _holdSince = 0;
    _startMonotonic = 0;
    _containerValid = true;
    _containerDestroyId = null;
    _conns = [];
    _graceId = null;

    constructor(container, dockManager, onlyFocused = true, companionSettings = null) {
        this._container = container;
        this._dockManager = dockManager;
        this._onlyFocused = onlyFocused;
        this._companionSettings = companionSettings;
    }

    setOnlyFocused(v) {
        this._onlyFocused = !!v;
        this._check(true);
    }

    _origSettings() {
        try {
            return this._dockManager?._settings ?? null;
        } catch (e) {
            return null;
        }
    }

    _animDuration() {
        try {
            const s = this._origSettings();
            if (s)
                return Math.max(0, Math.min(1000, s.get_int("animation-duration")));
        } catch (e) {}
        return 200;
    }

    _showThreshold() {
        try {
            const s = this._origSettings();
            if (s)
                return s.get_int("show-threshold");
        } catch (e) {}
        return 25;
    }

    _companionInt(key, fallback, min, max) {
        try {
            const s = this._companionSettings;
            if (s && typeof s.get_int === "function") {
                const v = s.get_int(key);
                if (Number.isFinite(v))
                    return Math.max(min, Math.min(max, v));
            }
        } catch (e) {}
        return fallback;
    }

    _peekEdgePx() {
        return this._companionInt("peek-edge-px", 5, 1, 60);
    }

    _peekHoldMs() {
        return this._companionInt("peek-hold-ms", 80, 0, 2000);
    }

    _hideInFullscreen() {
        try {
            const s = this._companionSettings;
            if (s && typeof s.get_boolean === "function")
                return s.get_boolean("hide-in-fullscreen");
        } catch (e) {}
        return true;
    }

    _inDeepZone(px, py, monitor, edge) {
        const z = this._peekEdgePx();
        switch (edge) {
            case 0:
                return py >= monitor.y + monitor.height - z;
            case 1:
                return px <= monitor.x + z;
            case 2:
                return px >= monitor.x + monitor.width - z;
            case 3:
                return py <= monitor.y + z;
        }
        return false;
    }

    _peekHoldReady() {
        const holdMs = this._peekHoldMs();
        if (holdMs <= 0)
            return true;
        let now = 0;
        try {
            now = GLib.get_monotonic_time() / 1000;
        } catch (e) {
            return true;
        }
        if (!this._holdSince) {
            this._holdSince = now;
            return false;
        }
        return now - this._holdSince >= holdMs;
    }

    _resetHold() {
        this._holdSince = 0;
    }

    _isFullscreenActive() {
        let actors = [];
        try {
            actors = global.get_window_actors();
        } catch (e) {
            return false;
        }
        for (const wa of actors) {
            let mw = null;
            try {
                mw = wa.get_meta_window();
            } catch (e) {
                continue;
            }
            // Skips minimized / other-workspace / chrome windows.
            if (!mw || windowShouldBeIgnored(mw))
                continue;
            try {
                if (typeof mw.is_fullscreen === "function" && mw.is_fullscreen())
                    return true;
            } catch (e) {}
        }
        return false;
    }

    _dockPosition() {
        try {
            return this._dockManager?._dockPosition ?? 0;
        } catch (e) {
            return 0;
        }
    }

    _dockRect() {
        if (!this._container || !this._containerValid)
            return this._lastRect;
        try {
            const [x, y] = this._container.get_position();
            const [w, h] = this._container.get_size();
            if (w && h) {
                this._lastRect = { x1: x, y1: y, x2: x + w, y2: y + h };
                return this._lastRect;
            }
        } catch (e) {}
        // Hidden (visible=false) actors may report zero size: fall back to
        // the last known rect so overlap checks keep working while hidden.
        return this._lastRect;
    }

    _focusedOverlap(dockRect) {
        let focusWin = null;
        try {
            focusWin = global.display.get_focus_window();
        } catch (e) {
            focusWin = null;
        }
        if (!focusWin || windowShouldBeIgnored(focusWin))
            return this._anyOverlap(dockRect);
        let r = null;
        try {
            r = focusWin.get_frame_rect();
        } catch (e) {
            return false;
        }
        return rectsOverlap(dockRect, { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height });
    }

    _anyOverlap(dockRect) {
        let actors = [];
        try {
            actors = global.get_window_actors();
        } catch (e) {
            return false;
        }
        for (const wa of actors) {
            let mw = null;
            try {
                mw = wa.get_meta_window();
            } catch (e) {
                continue;
            }
            if (!mw || windowShouldBeIgnored(mw))
                continue;
            let r = null;
            try {
                r = mw.get_frame_rect();
            } catch (e) {
                continue;
            }
            if (rectsOverlap(dockRect, { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height }))
                return true;
        }
        return false;
    }

    _isOverlap(dockRect) {
        if (this._onlyFocused)
            return this._focusedOverlap(dockRect);
        return this._anyOverlap(dockRect);
    }

    _pointerInPreviewOrMenu(px, py) {
        // Don't re-hide while pointer is inside preview popup / context menu,
        // mirroring original DockVisibility guards (defensive: everything optional).
        try {
            const popup = this._dockManager?._previewPopup;
            if (popup && typeof popup.isVisible === "function" && popup.isVisible()) {
                const b = typeof popup.getBounds === "function" ? popup.getBounds() : null;
                if (b && px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height)
                    return true;
            }
        } catch (e) {}
        try {
            const im = this._dockManager?._iconManager;
            const menu = im?._contextMenu;
            if (menu && menu.actor?.mapped) {
                const [mx, my] = menu.actor.get_transformed_position();
                const [mw, mh] = menu.actor.get_size();
                if (px >= mx && px <= mx + mw && py >= my && py <= my + mh)
                    return true;
            }
        } catch (e) {}
        return false;
    }

    _pointerOnDock(px, py, rect) {
        // Clicked a dock icon and the new window opened under the cursor:
        // pointer parked on the dock suppresses the dodge-hide until it moves away.
        if (!rect)
            return false;
        return px >= rect.x1 - POINTER_ON_DOCK_PAD && px <= rect.x2 + POINTER_ON_DOCK_PAD &&
               py >= rect.y1 - POINTER_ON_DOCK_PAD && py <= rect.y2 + POINTER_ON_DOCK_PAD;
    }

    start() {
        if (!this._container) {
            console.warn(`${TAG} no container, abort start`);
            return;
        }
        // Track container liveness without touching it after destroy.
        this._containerValid = true;
        this._containerDestroyId = null;
        try {
            if (!this._container._dockFixDodgeDestroyId) {
                this._containerDestroyId = this._container.connect("destroy", () => {
                    this._containerValid = false;
                });
                this._container._dockFixDodgeDestroyId = this._containerDestroyId;
            } else {
                this._containerDestroyId = this._container._dockFixDodgeDestroyId;
            }
        } catch (_e) {}
        // Ensure visible at start (dodge = stay unless covered).
        try {
            this._container.visible = true;
            this._container.opacity = 255;
        } catch (e) {}
        this._isShown = true;
        this._isAnimating = false;
        this._peeked = false;
        this._lastRect = null;
        this._overviewVisible = false;
        this._resetHold();

        const doTick = () => {
            if (!this._containerValid)
                return;
            try {
                // Reconcile overview state (belt-and-braces alongside the
                // showing/hiding signals below): overview incl. Show Apps
                // always shows the dock.
                let ov = false;
                try {
                    ov = Main.overview?.visible === true;
                } catch (e) {}
                if (ov !== this._overviewVisible)
                    this._setOverviewVisible(ov);
                // Pointer proximity first (peek/unpeek), then overlap.
                // Same dual path as original DockVisibility: active polling
                // heals any missed motion-event.
                let px = -1, py = -1;
                try {
                    [px, py] = global.get_pointer();
                } catch (e) {}
                if (px >= 0)
                    this._onPointer(px, py);
                this._check(false);
            } catch (e) {
                console.warn(`${TAG} tick failed:`, e);
            }
        };
        const conn = (obj, sig, cb) => {
            try {
                const id = obj.connect(sig, cb);
                this._conns.push({ obj, id });
            } catch (e) {}
        };
        try {
            conn(global.display, "restacked", () => doTick());
            conn(global.display, "window-created", () => doTick());
            conn(global.display, "notify::focus-window", () => doTick());
            conn(global.display, "in-fullscreen-changed", () => doTick());
            conn(global.workspace_manager, "workspace-switched", () => doTick());
            // Diagnostic canary (zero behaviour change): watch the overlay-key
            // signal so we can tell whether a 'Super stopped working' report is
            // a dead key-emission path or a stuck toggle downstream. Never
            // intercepts or handles the key.
            if (global.display && typeof global.display.connect === "function") {
                conn(global.display, "overlay-key", () => {
                    try {
                        console.log(`${TAG} canary overlay-key (modalCount=${Main.modalCount}` +
                            (Main.modalCount ? ", OVERVIEW_MODAL_BUSY" : "") + ")");
                    } catch (e) { /* logging only */ }
                });
            }
            const pointerEvent = (_a, ev) => {
                try {
                    const [px, py] = ev.get_coords();
                    this._onPointer(px, py);
                } catch (e) {}
                return Clutter.EVENT_PROPAGATE;
            };
            conn(global.stage, "motion-event", pointerEvent);
            conn(global.stage, "button-press-event", pointerEvent);
            conn(global.stage, "touch-event", pointerEvent);
            // Overview (incl. Show Apps grid): always show dock, suspend dodge.
            // 'showing'/'hiding' fire at animation start => zero-lag response.
            try {
                if (Main.overview) {
                    conn(Main.overview, "showing", () => {
                        try { this._setOverviewVisible(true); } catch (e) {}
                    });
                    conn(Main.overview, "hiding", () => {
                        try { this._setOverviewVisible(false); } catch (e) {}
                    });
                }
            } catch (e) {}
        } catch (e) {}

        if (this._pollId !== null) {
            try { GLib.source_remove(this._pollId); } catch (e) {}
            this._pollId = null;
        }
        try { this._startMonotonic = GLib.get_monotonic_time(); } catch (_e) { this._startMonotonic = 0; }
        this._pollId = GLib.timeout_add(GLib.PRIORITY_LOW, POLL_MS, () => {
            doTick();
            return GLib.SOURCE_CONTINUE;
        });
        // Autologin-safe: delay first evaluation 2s so initial layout settles
        this._graceId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
            this._graceId = null;
            try { doTick(); } catch (_e) {}
            return GLib.SOURCE_REMOVE;
        });
        console.log(`${TAG} started (onlyFocused=${this._onlyFocused})`);
    }

    stop() {
        for (const c of this._conns) {
            try { c.obj.disconnect(c.id); } catch (e) {}
        }
        this._conns = [];
        if (this._pollId !== null) {
            try { GLib.source_remove(this._pollId); } catch (e) {}
            this._pollId = null;
        }
        if (this._graceId !== null) {
            try { GLib.source_remove(this._graceId); } catch (e) {}
            this._graceId = null;
        }
        this._clearAnimFallback();
        try {
            if (this._container && this._containerValid && this._containerDestroyId !== null) {
                try { this._container.disconnect(this._containerDestroyId); } catch (_e) {}
                try {
                    if (this._container._dockFixDodgeDestroyId === this._containerDestroyId)
                        delete this._container._dockFixDodgeDestroyId;
                } catch (_e) {}
            }
        } catch (_e) {}
        this._containerDestroyId = null;
        // Restore visible so disabling companion never leaves dock hidden.
        // Zero-touch: skip entirely once the container is dead.
        try {
            if (this._container && this._containerValid) {
                try { this._container.remove_all_transitions(); } catch (e) {}
                this._container.visible = true;
                this._container.opacity = 255;
            }
        } catch (e) {}
        this._containerValid = false;
        this._isAnimating = false;
        this._resetHold();
        console.log(`${TAG} stopped`);
    }

    _setOverviewVisible(v) {
        this._overviewVisible = !!v;
        this._resetHold();
        if (this._overviewVisible) {
            this._peeked = false;
            console.log(`${TAG} overview -> show`);
            this._show();
        } else {
            // Leaving overview: re-evaluate dodge immediately.
            this._peeked = false;
            this._check(true);
        }
    }

    _onPointer(px, py) {
        if (!this._container || !this._containerValid)
            return;
        let monitor = null;
        try {
            monitor = Main.layoutManager.primaryMonitor;
        } catch (e) {}
        if (!monitor)
            return;
        if (this._pointerInPreviewOrMenu(px, py))
            return;
        const edge = this._dockPosition();
        let farFromEdge = false;
        switch (edge) {
            case 0:
                farFromEdge = py < monitor.y + monitor.height - HIDE_THRESHOLD;
                break;
            case 1:
                farFromEdge = px > monitor.x + HIDE_THRESHOLD;
                break;
            case 2:
                farFromEdge = px < monitor.x + monitor.width - HIDE_THRESHOLD;
                break;
            case 3:
                farFromEdge = py > monitor.y + HIDE_THRESHOLD;
                break;
        }
        if (!this._isShown && this._inDeepZone(px, py, monitor, edge)) {
            // Deliberate push: pointer hard against the edge, held. Peek
            // only once held long enough. Suppressed in fullscreen;
            // overview visibility is handled by _check, not here.
            if (this._overviewVisible) {
                this._resetHold();
            } else if (this._hideInFullscreen() && this._isFullscreenActive()) {
                this._resetHold();
            } else if (this._peekHoldReady()) {
                this._peeked = true;
                console.log(`${TAG} peek show (edge=${edge})`);
                this._show();
                this._resetHold();
            }
        } else {
            this._resetHold();
            if (this._isShown && this._peeked && farFromEdge) {
                this._peeked = false;
                // Re-evaluate: if still overlapped, hide again.
                this._check(true);
            }
        }
    }

    _dbgClock = 0;
    _dbg(reason, extra) {
        if (this._isShown)
            return;
        if (!this._container || !this._containerValid)
            return;
        let now = 0;
        try { now = GLib.get_monotonic_time(); } catch (_e) {}
        if (now - this._dbgClock < 1000000) return;
        this._dbgClock = now;
        let state = "";
        try {
            const [w0, h0] = this._container.get_size();
            state = `mapped=${this._container.mapped} size=${w0}x${h0} anim=${this._isAnimating} valid=${this._containerValid}`;
        } catch (_e) {
            state = "(container unreadable)";
        }
        console.log(`${TAG} DBG ${reason} :: ${state}` + (extra ? ` ${extra}` : ""));
    }
    _check(force) {
        if (!this._container || !this._containerValid)
            return;
        // Grace after start(): avoid flicker/hide race while session settles.
        // The mapped/size check is intentionally scoped INSIDE this 2s grace
        // window only. Once the dock is hidden its container is unmapped, so an
        // unconditional `mapped` gate here would wedge the dock hidden forever
        // (regression: dock never auto-appears again when a window is minimized
        // or moved off it). After grace we must let _dockRect() (_lastRect
        // fallback) drive the normal overlap -> show logic.
        try {
            const elapsed = this._startMonotonic ? (GLib.get_monotonic_time() - this._startMonotonic) / 1000 : 9999;
            if (elapsed < 2000) {
                try { if (!this._container.mapped) { this._dbg("grace-mapped"); return; } } catch (_e) { this._dbg("grace-catch"); return; }
                try {
                    const [w, h] = this._container.get_size();
                    if (!w || !h) { this._dbg("grace-zero-size"); return; }
                } catch (_e) {}
                return;
            }
        } catch (_e) {}
        // Overview (incl. Show Apps): dock always shown, never dodged.
        if (this._overviewVisible) {
            this._dbg("overview-block");
            if (!this._isShown)
                this._show();
            return;
        }
        // True fullscreen (video, games): force-hide, never peek.
        if (this._hideInFullscreen() && this._isFullscreenActive()) {
            this._peeked = false;
            this._resetHold();
            if (this._isShown) {
                console.log(`${TAG} fullscreen -> hide`);
                this._hide();
            }
            return;
        }
        let px = -1, py = -1;
        try {
            [px, py] = global.get_pointer();
        } catch (e) {}
        if (px >= 0 && this._pointerInPreviewOrMenu(px, py)) {
            this._dbg("menu-block");
            return;
        }
        const rect = this._dockRect();
        if (!rect) {
            this._dbg("no-rect");
            return;
        }
        const overlap = this._isOverlap(rect);
        this._dbg(`overlap=${overlap} peeked=${this._peeked}`, `rect=${JSON.stringify(rect)}`);
        if (overlap && this._isShown && !this._peeked && !this._pointerOnDock(px, py, rect)) {
            console.log(`${TAG} overlap -> hide`);
            this._hide();
        } else if (!overlap && !this._isShown) {
            // Uncovered (or focus moved to non-overlapping window): restore.
            // If user peeked, clear peek flag on natural restore.
            this._peeked = false;
            console.log(`${TAG} uncovered -> show`);
            this._show();
        } else if (!overlap && this._isShown && this._peeked && force) {
            this._peeked = false;
        }
    }

    _clearAnimFallback() {
        if (this._animFallbackId !== null) {
            try { GLib.source_remove(this._animFallbackId); } catch (e) {}
            this._animFallbackId = null;
        }
    }

    _armAnimFallback(dur) {
        this._clearAnimFallback();
        // If ease() onComplete never fires (interrupted transition), never
        // leave _isAnimating stuck: it would wedge the dock hidden forever.
        this._animFallbackId = GLib.timeout_add(GLib.PRIORITY_LOW, dur + 80, () => {
            this._isAnimating = false;
            this._animFallbackId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _show() {
        if (this._isShown || this._isAnimating || !this._container || !this._containerValid)
            return;
        this._isShown = true;
        this._isAnimating = true;
        const dur = this._animDuration();
        try {
            try { this._container.remove_all_transitions(); } catch (e) {}
            if (dur === 0) {
                this._container.visible = true;
                this._container.opacity = 255;
                this._isAnimating = false;
                return;
            }
            this._armAnimFallback(dur);
            this._container.visible = true;
            this._container.opacity = 0;
            const startY = this._container.y;
            this._container.y = startY + 20;
            this._container.ease({
                y: startY,
                opacity: 255,
                duration: dur,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    this._isAnimating = false;
                    this._clearAnimFallback();
                },
            });
        } catch (e) {
            try {
                this._container.visible = true;
                this._container.opacity = 255;
            } catch (e2) {}
            this._isAnimating = false;
            this._clearAnimFallback();
        }
    }

    _hide() {
        if (!this._isShown || this._isAnimating || !this._container || !this._containerValid)
            return;
        this._isShown = false;
        this._isAnimating = true;
        const dur = this._animDuration();
        try {
            try { this._container.remove_all_transitions(); } catch (e) {}
            if (dur === 0) {
                this._container.visible = false;
                this._isAnimating = false;
                return;
            }
            this._armAnimFallback(dur);
            const startY = this._container.y;
            this._container.ease({
                y: startY + 20,
                opacity: 0,
                duration: dur,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    try {
                        if (this._containerValid) {
                            this._container.visible = false;
                            this._container.y = startY;
                        }
                    } catch (e) {}
                    this._isAnimating = false;
                    this._clearAnimFallback();
                },
            });
        } catch (e) {
            try { this._container.visible = false; } catch (e2) {}
            this._isAnimating = false;
            this._clearAnimFallback();
        }
    }
}
