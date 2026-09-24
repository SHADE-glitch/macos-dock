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

const TAG = "[macos-dock-local][dodge]";
const DODGE_DEBUG = false; // set true only when diagnosing dodge; gates _dbg + per-tick stringify
const HIDE_THRESHOLD = 100; // px from the screen edge beyond which the pointer is "away"
const POINTER_ON_DOCK_PAD = 12; // pointer counts as "still on dock" within this margin
// Window types that can never cause a dock hide. windowShouldBeIgnored() below
// already refuses to measure these, so _watchWindow() refuses to connect to them
// either -- one list, both decisions. Deliberately the same five types the
// predicate names, so the watch set can never be narrower than the set the hide
// logic actually consults.
const UNWATCHABLE_WINDOW_TYPES = [
    Meta.WindowType.DESKTOP,
    Meta.WindowType.DOCK,
    Meta.WindowType.SPLASHSCREEN,
    Meta.WindowType.NOTIFICATION,
    Meta.WindowType.TOOLTIP,
];
const POLL_MS = 120;
const SLOW_POLL_MS = 500; // heartbeat while shown or pointer far from edge

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
        if (UNWATCHABLE_WINDOW_TYPES.includes(t))
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
    _pollIntervalMs = 0;
    _doTick = null;
    // True while the poll is intentionally stopped (dock shown at rest, pointer
    // far from the edge, nothing settling). Signals and pointer motion wake it.
    _parked = false;
    _animFallbackId = null;
    _lastRect = null;
    _overviewVisible = false;
    _companionSettings = null;
    _holdSince = 0;
    _startMonotonic = 0;
    _containerValid = true;
    _containerDestroyId = null;
    _conns = [];
    _winSignals = new Map(); // Meta.Window -> [{obj, id}] geometry watch
    _graceId = null;
    _peekEdgePxCached = 5;
    _peekHoldMsCached = 80;
    _hideInFullscreenCached = true;
    // Genie animation peek: while true the dock is force-shown and refuses to
    // hide, so a minimize/restore animation can fly to a visible icon.
    _animPeek = false;
    _animPeekHideId = null;
    _animPeekDeadline = 0; // monotonic ms; the longest pending peek wins

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
        return this._peekEdgePxCached ?? 5;
    }

    _peekHoldMs() {
        return this._peekHoldMsCached ?? 80;
    }

    _hideInFullscreen() {
        return this._hideInFullscreenCached ?? true;
    }

    // Read companion settings once and cache them; refreshed on changed::*
    // (connected in start(), cleaned in stop()). Avoids 4 GSettings IPC
    // round-trips on every 120ms tick + pointer/stage event.
    _refreshCachedSettings() {
        try { this._peekEdgePxCached = this._companionInt("peek-edge-px", 5, 1, 60); } catch (_e) {}
        try { this._peekHoldMsCached = this._companionInt("peek-hold-ms", 80, 0, 2000); } catch (_e) {}
        try {
            const s = this._companionSettings;
            if (s && typeof s.get_boolean === "function")
                this._hideInFullscreenCached = s.get_boolean("hide-in-fullscreen");
        } catch (_e) {}
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
        // Fast path: mutter's own per-monitor fullscreen bookkeeping, which is
        // what the shell's LayoutManager reads for the same "get the chrome out
        // of the way" decision (ui/layout.js:169). If no monitor is flagged, no
        // window can be fullscreen on one, so the walk below would find nothing
        // -- yet it used to walk every window actor, and call into
        // windowShouldBeIgnored() for each, on every poll tick.
        //
        // The gate can only ever OPEN the walk, never substitute for its
        // answer: windowShouldBeIgnored() (minimized, other workspace,
        // skip-taskbar, chrome types) stays the authority, so a monitor flagged
        // for a window the predicate rejects produces the same false it always
        // did. Every monitor is consulted, not just the dock's, to keep the gate
        // a superset of the walk's view.
        try {
            if (!Main.layoutManager.monitors.some((m) => m.inFullscreen))
                return false;
        } catch (_e) {
            // Gate unavailable: fall through and pay the full walk.
        }
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

    // Which axis the dock slides along when hiding, and in which direction
    // (away from its screen edge): BOTTOM slides down (+y), TOP up (-y),
    // LEFT left (-x), RIGHT right (+x). The visible position is always the
    // container's resting coordinate, so _show() eases from
    // `base + sign * 20` back to `base`.
    _slide() {
        switch (this._dockPosition()) {
            case 1: return {prop: "x", sign: -1}; // LEFT
            case 2: return {prop: "x", sign: 1};  // RIGHT
            case 3: return {prop: "y", sign: -1}; // TOP
            default: return {prop: "y", sign: 1}; // BOTTOM
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
        // NOTE: do NOT touch opacity here — iconManager owns the startup
        // fade (opacity 0 -> 255 at end of grace). Setting 255 here used to
        // defeat that and flash the dock on first boot.
        try {
            this._container.visible = true;
        } catch (e) {}
        this._isShown = true;
        this._isAnimating = false;
        this._peeked = false;
        this._parked = false;
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
            conn(global.display, "window-created", (_d, win) => {
                this._watchWindow(win);
                doTick();
            });
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
            // Cache companion settings; refresh on change instead of per-tick.
            try {
                this._refreshCachedSettings();
                const cs = this._companionSettings;
                if (cs && typeof cs.connect === "function") {
                    conn(cs, "changed::peek-edge-px", () => { try { this._refreshCachedSettings(); } catch (_e) {} });
                    conn(cs, "changed::peek-hold-ms", () => { try { this._refreshCachedSettings(); } catch (_e) {} });
                    conn(cs, "changed::hide-in-fullscreen", () => { try { this._refreshCachedSettings(); } catch (_e) {} });
                }
            } catch (_e) {}
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
        // Watch the geometry of every window already on screen; new ones are
        // picked up by the "window-created" handler above.
        this._watchAllWindows();
        try { this._startMonotonic = GLib.get_monotonic_time(); } catch (_e) { this._startMonotonic = 0; }
        this._doTick = doTick;
        this._schedulePoll(true);
        // Autologin-safe: delay first evaluation 2s so initial layout settles
        this._graceId = GLib.timeout_add(GLib.PRIORITY_LOW, 2000, () => {
            this._graceId = null;
            this._wake();
            try { doTick(); } catch (_e) {}
            return GLib.SOURCE_REMOVE;
        });
        console.log(`${TAG} started (onlyFocused=${this._onlyFocused}, watching ${this._winSignals.size} windows)`);
    }

    // Adaptive poll cadence: the 120ms tick is only needed while the dock is
    // hidden and the pointer is near our edge (peek-hold granularity). While
    // shown, or while the pointer is far from the edge, a 500ms heartbeat
    // suffices — restacked/focus/motion/overview signals drive immediate
    // reactions, the poll stays purely as the event-loss healer.
    _schedulePoll(forceFast = false) {
        if (typeof this._doTick !== "function")
            return;
        // Scheduling always means "we want to be polling".
        this._parked = false;
        if (this._pollId !== null) {
            try { GLib.source_remove(this._pollId); } catch (e) {}
            this._pollId = null;
        }
        this._pollIntervalMs = forceFast ? POLL_MS : this._nextPollMs();
        const iv = this._pollIntervalMs;
        this._pollId = GLib.timeout_add(GLib.PRIORITY_LOW, iv, () => {
            // Clear BEFORE the tick: _onPointer may bump to fast mid-tick,
            // and the bump's fresh source must survive the re-arm below.
            this._pollId = null;
            try {
                this._doTick();
            } catch (e) {
                console.warn(`${TAG} tick failed:`, e);
            }
            if (this._pollId === null && this._containerValid) {
                if (this._shouldPark()) {
                    // Nothing left to heal: stop until a signal or pointer
                    // motion wakes us (see _wake). Saves a 500ms wakeup
                    // forever while the dock just sits there.
                    this._parked = true;
                } else {
                    this._schedulePoll();
                }
            }
            return GLib.SOURCE_REMOVE;
        });
    }
    // Restart the poll if it was parked. No-op otherwise, so callers can use
    // it freely without disturbing the current cadence.
    _wake() {
        if (!this._parked)
            return;
        this._schedulePoll();
    }
    // True when the poll can safely stop. The poll is the healer for a lost
    // event stream, so it must keep running whenever something could still
    // need it:
    //  - hidden: the poll is what notices a push into the deep zone, so
    //    parking there would reintroduce "mouse to the edge never reveals dock";
    //  - animating / peeked / animation-peeking / overview / fullscreen:
    //    state is still settling;
    //  - the 2s startup grace;
    //  - the pointer is near our edge (the fast cadence is required).
    _shouldPark() {
        if (!this._containerValid)
            return false;
        if (!this._isShown || this._isAnimating || this._peeked || this._animPeek)
            return false;
        if (this._overviewVisible)
            return false;
        try {
            const elapsed = this._startMonotonic
                ? (GLib.get_monotonic_time() - this._startMonotonic) / 1000
                : 0;
            if (elapsed < 2000)
                return false;
        } catch (_e) {
            return false;
        }
        try {
            if (this._hideInFullscreen() && this._isFullscreenActive())
                return false;
        } catch (_e) {}
        return this._pointerFarFromEdge();
    }
    // Is the pointer clear of the screen edge the dock is attached to?
    // Extracted so the park decision and _onPointer agree exactly. Callers
    // with authoritative event coords pass them in; otherwise the current
    // pointer position is read. Returns false on any error, i.e. "not far"
    // -> do not park.
    _pointerFarFromEdge(px = null, py = null) {
        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (!monitor)
                return false;
            if (px === null || py === null)
                [px, py] = global.get_pointer();
            switch (this._dockPosition()) {
                case 0:
                    return py < monitor.y + monitor.height - HIDE_THRESHOLD;
                case 1:
                    return px > monitor.x + HIDE_THRESHOLD;
                case 2:
                    return px < monitor.x + monitor.width - HIDE_THRESHOLD;
                case 3:
                    return py > monitor.y + HIDE_THRESHOLD;
            }
        } catch (_e) {}
        return false;
    }
    _nextPollMs() {
        if (this._isShown)
            return SLOW_POLL_MS;
        try {
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                const [px, py] = global.get_pointer();
                const edge = this._dockPosition();
                switch (edge) {
                    case 0:
                        if (py >= monitor.y + monitor.height - HIDE_THRESHOLD)
                            return POLL_MS;
                        break;
                    case 1:
                        if (px <= monitor.x + HIDE_THRESHOLD)
                            return POLL_MS;
                        break;
                    case 2:
                        if (px >= monitor.x + monitor.width - HIDE_THRESHOLD)
                            return POLL_MS;
                        break;
                    case 3:
                        if (py <= monitor.y + HIDE_THRESHOLD)
                            return POLL_MS;
                        break;
                }
            }
        } catch (_e) {}
        return SLOW_POLL_MS;
    }
    _bumpPollFast() {
        // Motion events are the authoritative "pointer moved" signal: switch
        // to the fast cadence immediately when the pointer is near our edge
        // so a push into the deep zone starts its hold timer at full 120ms
        // granularity (peek semantics unchanged).
        if (this._pollId !== null && this._pollIntervalMs === POLL_MS)
            return;
        this._schedulePoll(true);
    }

    // ---- per-window geometry watch -----------------------------------------
    //
    // A parked poll has no other way to learn that a window was dragged or
    // resized so that it now covers — or no longer covers — the dock:
    //   * "restacked" does not fire for a plain move;
    //   * focus does not change when the user drags the already-focused window;
    //   * the pointer can sit far from our edge for the whole drag, so
    //     _onPointer never bumps the poll back to life.
    // Watching each window's geometry makes the re-evaluation event-driven,
    // which is both correct and faster than the old 500ms heartbeat. This is
    // the fix for "drag a small window down over the dock and it never hides".
    _watchWindow(win) {
        if (!win || this._winSignals.has(win))
            return;
        // Chrome windows never affect the hide decision (see
        // UNWATCHABLE_WINDOW_TYPES), so connecting to them would be pure
        // overhead -- and notification/tooltip/splash windows come and go
        // constantly, which is exactly the churn that could leave entries
        // stranded in _winSignals if a window ever skipped "unmanaged".
        // Filtered here rather than in the caller so window-created and the
        // startup sweep behave alike.
        try {
            if (UNWATCHABLE_WINDOW_TYPES.includes(win.get_window_type()))
                return;
        } catch (_e) {
            // Unknown type: watch it. Missing a real window would hide the dock
            // wrongly; watching a chrome window only costs a disconnect later.
        }
        const ids = [];
        const onChange = () => this._onWindowGeometry();
        try {
            ids.push({ obj: win, id: win.connect("position-changed", onChange) });
            ids.push({ obj: win, id: win.connect("size-changed", onChange) });
            ids.push({ obj: win, id: win.connect("unmanaged", () => this._unwatchWindow(win)) });
        } catch (_e) {
            // A window we cannot watch is simply not watched.
        }
        this._winSignals.set(win, ids);
    }
    _unwatchWindow(win) {
        const ids = this._winSignals.get(win);
        if (!ids)
            return;
        this._winSignals.delete(win);
        for (const c of ids) {
            try { c.obj.disconnect(c.id); } catch (_e) {}
        }
    }
    _unwatchAllWindows() {
        for (const win of [...this._winSignals.keys()])
            this._unwatchWindow(win);
    }
    _watchAllWindows() {
        let actors = [];
        try { actors = global.get_window_actors(); } catch (_e) { return; }
        for (const actor of actors) {
            let win = null;
            try { win = actor.get_meta_window(); } catch (_e) {}
            if (win)
                this._watchWindow(win);
        }
    }
    _onWindowGeometry() {
        // Restart the poll if it parked, then re-evaluate right away so the
        // dock reacts while the window is still under the pointer.
        this._wake();
        this._check(false);
    }

    stop() {
        for (const c of this._conns) {
            try { c.obj.disconnect(c.id); } catch (e) {}
        }
        this._conns = [];
        this._unwatchAllWindows();
        this._clearAnimPeekTimer();
        this._animPeek = false;
        this._animPeekDeadline = 0;
        if (this._pollId !== null) {
            try { GLib.source_remove(this._pollId); } catch (e) {}
            this._pollId = null;
        }
        this._pollIntervalMs = 0;
        this._doTick = null;
        this._parked = false;
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
                // iconManager owns opacity until its startup fade completes;
                // forcing 255 here would flash the still-hidden-by-grace dock
                // when dodge is stopped within the first seconds after
                // enable() (same rationale as the start() note above).
                if (!this._dockManager?._iconManager?._startupFadePending)
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
            // Leaving overview: re-evaluate dodge immediately. Wake the poll
            // too, in case it parked before the overview round-trip and the
            // re-evaluation below hides the dock.
            this._peeked = false;
            this._wake();
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
        const farFromEdge = this._pointerFarFromEdge(px, py);
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
        // Keep the fast cadence while the pointer is near our edge so a push
        // into the deep zone is evaluated at full granularity.
        if (!farFromEdge)
            this._bumpPollFast();
    }

    _dbgClock = 0;
    _dbg(reason, extra) {
        if (!DODGE_DEBUG)
            return;
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
        // Animation peek outranks everything below (grace, overview,
        // fullscreen force-hide, overlap-hide): the dock must stay visible
        // until the genie animation has landed.
        if (this._animPeek) {
            if (!this._isShown)
                this._show();
            return;
        }
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
                this._hide("fullscreen");
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
        if (DODGE_DEBUG)
            this._dbg(`overlap=${overlap} peeked=${this._peeked}`, `rect=${JSON.stringify(rect)}`);
        if (overlap && this._isShown && !this._peeked && !this._pointerOnDock(px, py, rect)) {
            this._hide("overlap");
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

    // ---- animation peek (genie minimize/restore) ---------------------------

    isHidden() {
        return !this._isShown;
    }

    /**
     * Temporarily force the dock visible for the duration of a minimize/restore
     * animation, so the user can see where the window flew. While armed, the
     * dock cannot hide for any reason (grace/overview/fullscreen/overlap).
     * After `durationMs` (+ a short beat) the peek is released and the normal
     * dodge state is re-evaluated, so the dock re-hides iff it is still
     * covered. Safe to call repeatedly; each call re-arms the release timer.
     */
    peekForAnimation(durationMs) {
        if (!this._container || !this._containerValid)
            return;
        // The peek ends with the dock possibly hidden again, and the poll is
        // the only thing that can heal a lost motion event there.
        this._wake();
        this._animPeek = true;
        const hold = Math.max(0, durationMs | 0) + 150;
        let now = 0;
        try { now = GLib.get_monotonic_time() / 1000; } catch (_e) {}
        const deadline = now + hold;
        // Longest peek wins: a later, shorter request (e.g. the genie's
        // minimize duration arriving right after a longer hotkey peek) must
        // not cut an in-flight peek short.
        if (this._animPeekDeadline > 0 && this._animPeekDeadline >= deadline) {
            if (!this._isShown)
                this._show();
            return;
        }
        this._animPeekDeadline = deadline;
        this._clearAnimPeekTimer();
        if (!this._isShown)
            this._show();
        this._animPeekHideId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, hold, () => {
            this._animPeekHideId = null;
            this._animPeekDeadline = 0;
            this._animPeek = false;
            this._check(true);
            return GLib.SOURCE_REMOVE;
        });
    }

    endAnimationPeek() {
        this._animPeek = false;
        this._animPeekDeadline = 0;
        this._clearAnimPeekTimer();
        this._wake();
        this._check(true);
    }

    _clearAnimPeekTimer() {
        if (this._animPeekHideId !== null) {
            try { GLib.source_remove(this._animPeekHideId); } catch (_e) {}
            this._animPeekHideId = null;
        }
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
            const {prop, sign} = this._slide();
            const base = this._container[prop];
            this._container[prop] = base + sign * 20;
            this._container.ease({
                [prop]: base,
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

    _hide(reason = "overlap") {
        if (this._animPeek)
            return;
        if (!this._isShown || this._isAnimating || !this._container || !this._containerValid)
            return;
        // Log only when the hide will actually run. Logging at the call site
        // printed 7-8 lines in a row while the hide was still blocked by the
        // in-flight show animation (spam, no state change).
        console.log(`${TAG} ${reason} -> hide`);
        this._isShown = false;
        // The dock is now hidden, so the poll becomes the only thing that can
        // heal a lost motion event and reveal it again. Must run on every path
        // out of here, including the dur === 0 early return below.
        this._wake();
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
            const {prop, sign} = this._slide();
            const base = this._container[prop];
            this._container.ease({
                [prop]: base + sign * 20,
                opacity: 0,
                duration: dur,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    try {
                        if (this._containerValid) {
                            this._container.visible = false;
                            this._container[prop] = base;
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
