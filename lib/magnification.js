import GLib from "gi://GLib";
import { SignalManager } from "./signalManager.js";
const MIN_SCALE = 1.0;
const LERP_FACTOR = 0.25; // smoothing factor per tick
const POINTER_DEAD_ZONE_PX = 4; // pointer must move this far before scale re-targets
export class Magnification {
    _signals;
    _container;
    _enabled;
    _maxScale;
    _falloffDistance;
    _framerate;
    _pollId = null;
    _currentScales = [];
    _pivotX = 0.5;
    _pivotY = 1.0;
    _targetX = null;
    _targetY = null;
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
        if (!enabled)
            this._resetAll();
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
        this._signals.connect(this._container, "leave-event", () => {
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
        this._startPoll();
    }
    stop() {
        this._signals.disconnectAll();
        this._stopPoll();
        this._resetAll();
    }
    _startPoll() {
        this._stopPoll();
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
    _update() {
        if (!this._enabled)
            return;
        if (!this._container.visible)
            return;
        const [px, py] = global.get_pointer();
        const [dx, dy] = this._container.get_position();
        const [, dh] = this._container.get_size();
        const localX = px - dx;
        const localY = py - dy;
        if (localY < 0 || localY > dh) {
            this._resetAll();
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
            return;
        }
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
            // Lerp towards target.
            const prev = this._currentScales[i] ?? MIN_SCALE;
            const next = prev + (target - prev) * LERP_FACTOR;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
    _resetAll() {
        this._targetX = null;
        this._targetY = null;
        const children = this._container.get_children();
        for (let i = 0; i < children.length; i++) {
            const prev = this._currentScales[i] ?? MIN_SCALE;
            if (Math.abs(prev - MIN_SCALE) < 0.001)
                continue;
            const next = prev + (MIN_SCALE - prev) * LERP_FACTOR;
            this._currentScales[i] = next;
            children[i].scale_x = next;
            children[i].scale_y = next;
        }
    }
}
