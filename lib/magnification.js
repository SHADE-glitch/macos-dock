import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import { SignalManager } from "./signalManager.js";
const MIN_SCALE = 1.0;
// Smoothing time constant for the scale easing. Expressed in TIME, not as a
// per-tick ratio: a fixed per-tick ratio made the dock settle visibly faster
// on a 120/144Hz display than on a 60Hz one. With this the framerate only
// changes the sampling rate, not the feel.
const SMOOTH_TAU_MS = 60;
const POINTER_DEAD_ZONE_PX = 4; // pointer must move this far before scale re-targets
export class Magnification {
    _signals;
    _container;
    _enabled;
    _maxScale;
    _falloffDistance;
    _framerate;
    _pollId = null;
    _started = false;
    _containerValid = true;
    _containerDestroyId = null;
    _currentScales = [];
    _pivotX = 0.5;
    _pivotY = 1.0;
    _targetX = null;
    _targetY = null;
    _lastTickMono = 0;
    _pauseCount = 0;
    constructor(container, enabled, maxScale, falloffDistance = 100, framerate = 60) {
        this._signals = new SignalManager();
        this._container = container;
        this._enabled = enabled;
        this._maxScale = maxScale;
        this._falloffDistance = falloffDistance;
        this._framerate = framerate;
    }
    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled) {
            // Stop the 30-120Hz poll while disabled (was running 24/7 even
            // with magnification off). Restart on re-enable after start().
            this._stopPoll();
            // Snap, not ease: with the poll stopped an eased reset would
            // freeze the icons part-way through shrinking back.
            this._snapToRest();
        } else if (this._started) {
            this._startPoll();
        }
    }
    // Suspend magnification for the duration of a genie animation. Refcounted
    // so overlapping animations cannot resume it early.
    pause() {
        this._pauseCount += 1;
        if (this._pauseCount === 1) {
            this._stopPoll();
            // Snap rather than ease: the poll is stopped, so an eased reset
            // would freeze the icons part-way enlarged. Also means the genie's
            // target rect is resolved against resting icons.
            this._snapToRest();
        }
    }
    resume() {
        this._pauseCount = Math.max(0, this._pauseCount - 1);
        if (this._pauseCount > 0)
            return;
        if (this._started && this._enabled && this._containerValid)
            this._startPoll();
    }
    // Immediately return every icon to its resting scale.
    _snapToRest() {
        this._targetX = null;
        this._targetY = null;
        if (!this._containerValid)
            return;
        try {
            const children = this._container.get_children();
            for (let i = 0; i < children.length; i++) {
                this._currentScales[i] = MIN_SCALE;
                children[i].scale_x = MIN_SCALE;
                children[i].scale_y = MIN_SCALE;
            }
        }
        catch (_e) {}
    }
    setMaxScale(scale) {
        this._maxScale = scale;
    }
    setFalloffDistance(distance) {
        this._falloffDistance = distance;
    }
    setFramerate(fps) {
        this._framerate = fps;
        this._restartPoll();
    }
    setPivotPoint(x, y) {
        this._pivotX = x;
        this._pivotY = y;
    }
    start() {
        this._started = true;
        // Liveness guard (same pattern as DodgeController): at shell
        // teardown chrome actors can be destroyed from the C side before our
        // stop() runs; without this the poll keeps touching a disposed
        // container ("impossible to access" warnings in the journal).
        this._containerValid = true;
        this._containerDestroyId = null;
        try {
            this._containerDestroyId = this._container.connect("destroy", () => {
                this._containerValid = false;
                this._stopPoll();
            });
        } catch (_e) {}
        this._signals.connect(this._container, "leave-event", () => {
            if (!this._containerValid)
                return;
            // Only reset on a genuine exit from the dock's horizontal span.
            // Spurious "leave" fires when two magnified (scaled-up) neighbour
            // icons overlap the pointer in the 6px gap; resetting there makes
            // icons shrink -> pointer re-hovers the other icon -> re-grow ->
            // shrink... a self-sustaining shake loop. Ignoring the false
            // leave lets the scale settle. True exits (left/right/below) are
            // still caught by _update()'s localY and minDist checks next poll.
            let inside = true;
            try {
                const [px] = global.get_pointer();
                const [dx] = this._container.get_position();
                const [dw] = this._container.get_size();
                inside = px >= dx && px <= dx + dw;
            } catch (e) {}
            if (!inside)
                this._resetAll("leave");
        });
        // Parked-poll restart: while the poll is parked (pointer idle far away
        // or dock hidden) any pointer motion near the dock re-arms it. Cheap:
        // returns immediately while the poll is already running, so steady
        // motion costs one flag check per event.
        this._signals.connect(global.stage, "motion-event", () => {
            this._restartIfPointerNear();
            return Clutter.EVENT_PROPAGATE;
        });
        // Dodge can reveal the dock under a stationary pointer ("uncovered ->
        // show"), and with no motion event nothing would ever re-arm the poll:
        // the icon already under the cursor stays un-magnified until the user
        // jiggles the mouse. notify::visible is what the shell itself uses for
        // this kind of chrome reaction (layout.js _queueUpdateRegions).
        this._signals.connect(this._container, "notify::visible", () => {
            this._restartIfPointerNear();
        });
        if (this._enabled)
            this._startPoll();
    }
    /**
     * Re-arm a parked poll when the pointer is already inside the magnification
     * band. Shared by the stage motion handler and the container's
     * notify::visible so the near-dock test lives in exactly one place.
     */
    _restartIfPointerNear() {
        if (this._pollId !== null || this._pauseCount > 0 || !this._started ||
            !this._enabled || !this._containerValid)
            return;
        try {
            if (!this._container.visible)
                return;
            const [px, py] = global.get_pointer();
            const [dx, dy] = this._container.get_position();
            const [dw, dh] = this._container.get_size();
            const margin = this._falloffDistance * 2;
            if (px >= dx - margin && px <= dx + dw + margin &&
                py >= dy - margin && py <= dy + dh + margin)
                this._startPoll();
        } catch (_e) {}
    }
    stop() {
        this._started = false;
        this._signals.disconnectAll();
        this._stopPoll();
        try {
            if (this._containerDestroyId !== null)
                this._container.disconnect(this._containerDestroyId);
        } catch (_e) {}
        this._containerDestroyId = null;
        // Teardown: the suspension refcount is meaningless from here on.
        this._pauseCount = 0;
        this._snapToRest();
        this._containerValid = false;
    }
    _startPoll() {
        // Never while suspended for a genie animation.
        if (this._pauseCount > 0)
            return;
        this._stopPoll();
        // Forget the clock so the first tick after a (re)start holds instead
        // of jumping: after a long park dt would otherwise be huge.
        this._lastTickMono = 0;
        const interval = Math.round(1000 / this._framerate);
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, interval, () => {
            this._update();
            return GLib.SOURCE_CONTINUE;
        });
    }
    _stopPoll() {
        if (this._pollId !== null) {
            GLib.source_remove(this._pollId);
            this._pollId = null;
        }
    }
    _restartPoll() {
        if (this._pollId !== null) {
            this._startPoll();
        }
    }
    // Time-based smoothing factor for the current tick: k = 1 - exp(-dt/tau).
    // Advances the shared clock, so it must be called at most once per tick
    // (from _update or _resetAll, whichever runs). Returns 0 for the first
    // tick after a (re)start so a long park or a stall cannot cause a jump.
    _smoothingFactor() {
        const nowMs = GLib.get_monotonic_time() / 1000;
        const dt = this._lastTickMono > 0 ? (nowMs - this._lastTickMono) / 1000 : 0;
        this._lastTickMono = nowMs;
        if (!(dt > 0))
            return 0;
        return 1 - Math.exp(-Math.min(dt, 0.1) / (SMOOTH_TAU_MS / 1000));
    }
    _update() {
        if (!this._enabled || !this._containerValid)
            return;
        if (!this._container.visible) {
            // Dock hidden by dodge: nothing to animate. Park the poll (zero
            // idle wakeups); the stage motion handler re-arms it once the
            // dock is visible again and the pointer is back in range.
            this._stopPoll();
            return;
        }
        const [px, py] = global.get_pointer();
        const [dx, dy] = this._container.get_position();
        const [, dh] = this._container.get_size();
        const localX = px - dx;
        const localY = py - dy;
        if (localY < 0 || localY > dh) {
            this._resetAll();
            if (this._scalesSettled())
                this._stopPoll();
            return;
        }
        const children = this._container.get_children();
        if (children.length === 0)
            return;
        // Dead-zone on pointer X: absorb sub-pixel/sub-threshold jitter so a
        // held pointer stops the icons trembling. The compositor reports
        // integer pointer coords that flicker ±1..2px even when the mouse is
        // still; near an icon gap that made both neighbour icons oscillate.
        // Only re-target when the pointer has really moved enough.
        if (this._targetX === null) {
            this._targetX = localX;
        } else if (Math.abs(localX - this._targetX) >= POINTER_DEAD_ZONE_PX) {
            this._targetX = localX;
        }
        if (this._targetY === null) {
            this._targetY = localY;
        } else if (Math.abs(localY - this._targetY) >= POINTER_DEAD_ZONE_PX) {
            this._targetY = localY;
        }
        const effectX = this._targetX;
        const effectY = this._targetY;
        // Ensure pivot-point and currentScales array are sized.
        for (const child of children) {
            if (child.get_pivot_point()[0] !== this._pivotX ||
                child.get_pivot_point()[1] !== this._pivotY) {
                child.set_pivot_point(this._pivotX, this._pivotY);
            }
        }
        while (this._currentScales.length < children.length) {
            this._currentScales.push(MIN_SCALE);
        }
        // Scale every icon independently from a continuous function of the
        // distance between the pointer and that icon's center. This mirrors
        // the macOS dock and, because it has no single "focal" winner, cannot
        // flip-flop when the pointer sits exactly between two icons (which
        // used to make both icons oscillate together).
        const smooth = (t) => {
            const x = Math.max(0, Math.min(1, t));
            return x * x * (3 - 2 * x);
        };
        // Reset (and don't apply any scale this frame) once the pointer is
        // clearly outside the magnify range of every icon.
        let minDist = Infinity;
        const isVertical = this._pivotX < 0.25 || this._pivotX > 0.75;
        for (let i = 0; i < children.length; i++) {
            const [cx, cy] = children[i].get_position();
            const [cw, ch] = children[i].get_size();
            minDist = Math.min(minDist, isVertical
                ? Math.abs(effectY - (cy + ch / 2))
                : Math.abs(effectX - (cx + cw / 2)));
        }
        if (minDist > this._falloffDistance * 1.5) {
            this._resetAll();
            // Pointer far away and every scale settled back to 1.0: park the
            // poll (zero idle wakeups); stage motion re-arms it in range.
            if (this._scalesSettled())
                this._stopPoll();
            return;
        }
        // One time-based factor for the whole frame.
        const k = this._smoothingFactor();
        for (let i = 0; i < children.length; i++) {
            const [cx, cy] = children[i].get_position();
            const [cw, ch] = children[i].get_size();
            const center = cx + cw / 2;
            const centerY = cy + ch / 2;
            // Use X distance for horizontal docks, Y for vertical, or
            // combined for edge cases. The pivot point tells us orientation:
            // pivotY ≈ 1.0 → horizontal dock (bottom), pivotX ≈ 0.5 → use X.
            const isVertical = this._pivotX < 0.25 || this._pivotX > 0.75;
            const dist = isVertical
                ? Math.abs(effectY - centerY)
                : Math.abs(effectX - center);
            const t = 1 - dist / this._falloffDistance;
            const target = MIN_SCALE + (this._maxScale - MIN_SCALE) * smooth(t);
            // Ease towards target over real time (see _smoothingFactor).
            const prev = this._currentScales[i] ?? MIN_SCALE;
            const next = prev + (target - prev) * k;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
    _scalesSettled() {
        for (const s of this._currentScales) {
            if (Math.abs(s - MIN_SCALE) >= 0.001)
                return false;
        }
        return true;
    }
    _resetAll() {
        if (!this._containerValid)
            return;
        this._targetX = null;
        this._targetY = null;
        // Shares the tick clock with _update: both ease the same property, so
        // apportioning by elapsed time keeps the feel constant whichever runs.
        const k = this._smoothingFactor();
        const children = this._container.get_children();
        for (let i = 0; i < children.length; i++) {
            const prev = this._currentScales[i] ?? MIN_SCALE;
            if (Math.abs(prev - MIN_SCALE) < 0.001)
                continue;
            const next = prev + (MIN_SCALE - prev) * k;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
}
