// SPDX-License-Identifier: GPL-2.0-or-later
// Derived from macos-genie (https://github.com/SekiroKenjii/macos-genie)
// © Thuong Vo (SekiroKenjii) — GPL-2.0-or-later.
// Merged into macos-dock@local and maintained by © SHADE-glitch.
//
// genieController.js — the only shell-coupled layer of the merged genie.
// It is the merged analogue of macos-genie's extension.js: lifecycle, the
// WindowManager hooks, icon-rect resolution against the real dock icons, and
// the exactly-once completion latch.
//
// It deliberately does NOT touch Main.wm._shouldAnimateActor (burn-my-windows
// owns that method); it takes the animation over via the same signal-hook +
// Set-steal approach the original genie used, which is orthogonal to BMW.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { GenieManager, validateRuntime } from './genieEngine.js';
import { funnelGeometry, clamp } from './genieGeometry.js';

const TAG = '[macos-dock-local][genie]';

export class GenieController {
    constructor(dockManager, settings) {
        this._dockManager = dockManager;
        this._settings = settings;
        this._manager = new GenieManager();
        this._minimizeId = 0;
        this._unminimizeId = 0;
        this._enabled = false;
        this._rectCache = new Map(); // appId -> {rect, ts}
        this._records = new Map();   // actor -> record
    }

    // ---- lifecycle ---------------------------------------------------------

    enable() {
        const problems = this._validate();
        if (problems.length) {
            console.warn(`${TAG} disabled — missing/changed private APIs: ` +
                `${problems.join(', ')}. Falling back to the native minimize animation.`);
            return false;
        }
        try {
            this._manager.sweepLeftovers();
            this._minimizeId = global.window_manager.connect(
                'minimize', this._onMinimize.bind(this));
            this._unminimizeId = global.window_manager.connect(
                'unminimize', this._onUnminimize.bind(this));
        }
        catch (e) {
            console.warn(`${TAG} hook connect failed: ${e}. ` +
                `Falling back to the native minimize animation.`);
            this._disconnect();
            return false;
        }
        this._enabled = true;
        this.warmCache();
        console.log(`${TAG} enabled`);
        return true;
    }

    disable() {
        this._enabled = false;
        this._disconnect();
        try { this._manager.finishAll(); }
        catch (e) { console.warn(`${TAG} finishAll failed:`, e); }
        for (const rec of [...this._records.values()])
            this._endRecord(rec);
        this._records.clear();
        this._rectCache.clear();
        const dodge = this._dodge();
        if (dodge) {
            try { dodge.endAnimationPeek(); } catch (_e) {}
        }
        // Re-sweep in case a strip container survived a hard failure.
        try { this._manager.sweepLeftovers(); } catch (_e) {}
        console.log(`${TAG} disabled`);
    }

    _disconnect() {
        try {
            if (this._minimizeId)
                global.window_manager.disconnect(this._minimizeId);
        }
        catch (_e) {}
        try {
            if (this._unminimizeId)
                global.window_manager.disconnect(this._unminimizeId);
        }
        catch (_e) {}
        this._minimizeId = 0;
        this._unminimizeId = 0;
    }

    // ---- private-API validation --------------------------------------------

    _validate() {
        const problems = [];
        const wm = Main.wm;
        if (!wm) {
            problems.push('Main.wm');
        }
        else {
            if (!this._isSetLike(wm._minimizing))
                problems.push('Main.wm._minimizing');
            if (!this._isSetLike(wm._unminimizing))
                problems.push('Main.wm._unminimizing');
        }
        const gwm = global.window_manager;
        if (!gwm || typeof gwm.connect !== 'function') {
            problems.push('global.window_manager.connect');
        }
        else {
            if (typeof gwm.completed_minimize !== 'function')
                problems.push('ShellWM.completed_minimize');
            if (typeof gwm.completed_unminimize !== 'function')
                problems.push('ShellWM.completed_unminimize');
        }
        try {
            for (const m of validateRuntime())
                problems.push(m);
        }
        catch (_e) {
            problems.push('genieEngine.validateRuntime');
        }
        return problems;
    }

    _isSetLike(o) {
        return !!o && typeof o.has === 'function' && typeof o.delete === 'function';
    }

    // ---- animation hooks ---------------------------------------------------

    // Take the in-flight effect away from the shell's WindowManager: remove
    // its bookkeeping entry FIRST so that stopping its ease does NOT emit
    // completed_* — mutter then keeps the actor mapped until we complete.
    _steal(actor, set) {
        set.delete(actor);
        actor.remove_all_transitions();
        actor.set_scale(1, 1);
        actor.set_pivot_point(0, 0);
        actor.set_opacity(255);
    }

    // Windows that fundamentally should not have a dock icon (tool/utility
    // windows, background chrome) are left alone so the shell's native
    // animation runs. Normal windows and dialogs get the genie.
    _shouldSkip(metaWindow) {
        if (!metaWindow)
            return true;
        try {
            const type = metaWindow.get_window_type();
            if (type !== Meta.WindowType.NORMAL && type !== Meta.WindowType.DIALOG)
                return true;
        }
        catch (_e) {
            return true;
        }
        try {
            if (typeof metaWindow.is_skip_taskbar === 'function' && metaWindow.is_skip_taskbar())
                return true;
        }
        catch (_e) {}
        return false;
    }

    _onMinimize(shellwm, actor) {
        let metaWindow = null;
        try { metaWindow = actor.meta_window; } catch (_e) {}
        // The shell's handler ran first. If it decided not to animate
        // (animations off, skipped actor, special window), respect that.
        try {
            if (!Main.wm._minimizing.has(actor))
                return;
        }
        catch (_e) { return; }
        if (this._shouldSkip(metaWindow))
            return;

        // Finish any in-flight animation for this actor first: this ends the
        // previous record (and its backstop) before a new one is created.
        try { this._manager.finishFor(actor); } catch (_e) {}
        try { this._steal(actor, Main.wm._minimizing); }
        catch (e) { console.warn(`${TAG} steal(minimize) failed:`, e); return; }

        const duration = this._minDur();
        const rec = this._beginRecord(actor, 'minimize', shellwm, duration);
        const finish = () => { this._fireComplete(rec); this._endRecord(rec); };
        try {
            // Suspend magnification first: it snaps every icon back to its
            // resting scale, so the target rect resolved just below is the
            // real icon square, and no icon stays enlarged while the window
            // flies. Resumed in _endRecord.
            this._pauseMagnification(rec);
            // Resolve the target BEFORE peeking so the snapshot is taken at
            // the container's resting position, never mid-slide.
            const target = this._resolveTarget(metaWindow);
            if (target.peekNeeded) {
                const dodge = this._dodge();
                if (dodge) {
                    try { dodge.peekForAnimation(duration); } catch (_e) {}
                }
            }
            const winRect = { x: actor.x, y: actor.y, width: actor.width, height: actor.height };
            const geom = this._geom(winRect, target.iconRect);

            // Snapshot the window's pixels into a static texture. In snapshot
            // mode we can also report minimize complete IMMEDIATELY: from
            // mutter's and the client's point of view this is
            // indistinguishable from the stock animation, so client commits
            // during the animation are not geometry-suppressed. In live-clone
            // mode completion must wait until the end — mutter hides the
            // actor on completion, and the clones need it painted until then.
            const content = this._trySnapshot(actor);
            if (content)
                this._fireComplete(rec);
            this._manager.run(actor, {
                reverse: false, duration, complete: finish,
                content, winRect, geom, strips: this._strips(winRect),
                capture: this._iconReactionCapture(metaWindow, false),
                park: !content,
            });
        }
        catch (e) {
            console.error(`${TAG} minimize effect failed: ${e}`);
            try { actor.set_scale(1, 1); actor.set_opacity(255); } catch (_e) {}
            this._fireComplete(rec);
            this._endRecord(rec);
        }
    }

    _onUnminimize(shellwm, actor) {
        let metaWindow = null;
        try { metaWindow = actor.meta_window; } catch (_e) {}
        try {
            if (!Main.wm._unminimizing.has(actor))
                return;
        }
        catch (_e) { return; }
        if (this._shouldSkip(metaWindow))
            return;

        // Finish any in-flight animation for this actor first: this ends the
        // previous record (and its backstop) before a new one is created.
        try { this._manager.finishFor(actor); } catch (_e) {}
        try { this._steal(actor, Main.wm._unminimizing); }
        catch (e) { console.warn(`${TAG} steal(unminimize) failed:`, e); return; }

        const duration = this._restoreDur();
        const rec = this._beginRecord(actor, 'unminimize', shellwm, duration);
        const finish = () => { this._fireComplete(rec); this._endRecord(rec); };
        try {
            // Suspend magnification first (see _onMinimize). Resumed in
            // _endRecord.
            this._pauseMagnification(rec);
            // The shell had moved the actor to the icon; put it back where the
            // window really is (the shell's cleanup never restores position).
            const rect = metaWindow.get_buffer_rect();
            actor.set_position(rect.x, rect.y);
            actor.show();
            // Report completion to mutter IMMEDIATELY: while an effect is "in
            // progress" mutter suppresses actor-geometry syncing, which would
            // misalign client frames committed during the animation. The genie
            // animates strips of the scale-parked actor (snapshot or clones),
            // so it does not need the effect to stay registered.
            this._fireComplete(rec);

            const target = this._resolveTarget(metaWindow);
            if (target.peekNeeded) {
                const dodge = this._dodge();
                if (dodge) {
                    try { dodge.peekForAnimation(duration); } catch (_e) {}
                }
            }
            const winRect = { x: actor.x, y: actor.y, width: actor.width, height: actor.height };
            const geom = this._geom(winRect, target.iconRect);
            // Opportunistic snapshot: without it restore renders live clones of
            // the real window, forcing a full-resolution source repaint every
            // frame — the most expensive path in the whole effect. A snapshot
            // makes it as cheap as minimize.
            // `park: true` is required EITHER WAY: mutter keeps the actor
            // shown on unminimize, so without parking the real full-size
            // window would show through behind the strips.
            const content = this._trySnapshot(actor);
            this._manager.run(actor, {
                reverse: true, duration, complete: finish,
                content, winRect, geom, strips: this._strips(winRect),
                capture: this._iconReactionCapture(metaWindow, true),
                park: true,
            });
        }
        catch (e) {
            console.error(`${TAG} restore effect failed: ${e}`);
            try { actor.set_scale(1, 1); actor.set_opacity(255); } catch (_e) {}
            this._fireComplete(rec);
            this._endRecord(rec);
        }
    }

    // ---- completion record (exactly-once) ----------------------------------

    _beginRecord(actor, kind, shellwm, duration) {
        const rec = {
            actor, kind, shellwm,
            completed: false, actorGone: false, paused: false,
            destroyId: 0, backstopId: 0,
        };
        try {
            rec.destroyId = actor.connect('destroy', () => {
                // Window closed mid-animation: mutter cleans up the effect
                // state itself on destroy — do not touch the dying actor and
                // do not report completion.
                rec.actorGone = true;
                this._endRecord(rec);
            });
        }
        catch (_e) { rec.destroyId = 0; }
        // Backstop: the engine has its own watchdog (duration + 500ms); this
        // one sits behind it so a completion can never be lost forever.
        rec.backstopId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, duration + 800, () => {
            rec.backstopId = 0;
            if (!rec.completed && !rec.actorGone)
                this._fireComplete(rec);
            this._endRecord(rec);
            return GLib.SOURCE_REMOVE;
        });
        this._records.set(actor, rec);
        return rec;
    }

    _fireComplete(rec) {
        if (!rec || rec.completed)
            return; // the latch: exactly once, across every path
        rec.completed = true;
        try {
            if (rec.kind === 'minimize')
                rec.shellwm.completed_minimize(rec.actor);
            else
                rec.shellwm.completed_unminimize(rec.actor);
        }
        catch (e) {
            console.warn(`${TAG} completed_${rec.kind} failed:`, e);
        }
    }

    _endRecord(rec) {
        if (!rec)
            return;
        // Single resume point: every completion path (engine finish,
        // watchdog, completed signal, actor destroy, both catch blocks, and
        // disable()'s finishAll loop) funnels through here, so magnification
        // can never be left suspended.
        if (rec.paused) {
            rec.paused = false;
            try { this._magnification()?.resume?.(); } catch (_e) {}
        }
        if (rec.backstopId) {
            try { GLib.source_remove(rec.backstopId); } catch (_e) {}
            rec.backstopId = 0;
        }
        if (rec.destroyId) {
            try {
                if (!rec.actorGone)
                    rec.actor.disconnect(rec.destroyId);
            }
            catch (_e) {}
            rec.destroyId = 0;
        }
        if (this._records.get(rec.actor) === rec)
            this._records.delete(rec.actor);
    }

    // ---- icon rect resolution + cache --------------------------------------

    onLayoutChanged() {
        const dodge = this._dodge();
        const hidden = dodge?.isHidden?.() ?? false;
        // Only re-warm while the dock is visible: a hidden container reports
        // no usable live rects, and clearing here would throw away the last
        // known-good cache we still want as fallback #2.
        if (hidden)
            return;
        this._rectCache.clear();
        this.warmCache();
    }

    warmCache() {
        const im = this._dockManager?._iconManager;
        if (!im || typeof im.getIconRectsSnapshot !== 'function')
            return;
        try {
            const now = GLib.get_monotonic_time();
            for (const [appId, rect] of im.getIconRectsSnapshot())
                this._rectCache.set(appId, { rect, ts: now });
        }
        catch (e) {
            console.warn(`${TAG} cache warm failed:`, e);
        }
    }

    // Fallback order (requirement 6):
    //   live app icon rect -> last cached rect -> dock center -> screen bottom
    //   center. The chain always terminates (funnelGeometry dereferences icon).
    _resolveTarget(metaWindow) {
        const appId = this._appIdForWindow(metaWindow);

        let iconRect = null;
        if (appId)
            iconRect = this._restingIconRect(appId);
        if (iconRect && appId)
            this._rectCache.set(appId, { rect: iconRect, ts: GLib.get_monotonic_time() });
        else if (appId) {
            const cached = this._rectCache.get(appId);
            if (cached)
                iconRect = cached.rect;
        }
        if (!iconRect)
            iconRect = this._dockCenterRect();
        if (!iconRect)
            iconRect = this._dockEdgeCenterRect();
        if (!iconRect)
            iconRect = { x: 0, y: 0, width: 64, height: 12 }; // last resort

        let peekNeeded = false;
        const dodge = this._dodge();
        if (dodge?.isHidden?.() ?? false) {
            if (this._boolSetting('genie-peek-hidden-dock', true))
                peekNeeded = true;
            else
                iconRect = this._dockEdgeAt(iconRect);
        }
        return { iconRect, peekNeeded };
    }

    _appIdForWindow(metaWindow) {
        if (!metaWindow)
            return null;
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(metaWindow);
            return app ? app.get_id() : null;
        }
        catch (_e) {
            return null;
        }
    }

    _restingIconRect(appId) {
        const im = this._dockManager?._iconManager;
        if (!im || typeof im.getIconRectForAppId !== 'function')
            return null;
        let live = null;
        try { live = im.getIconRectForAppId(appId); } catch (_e) { live = null; }
        if (!live)
            return null;
        // Normalize into the container's RESTING position: DodgeController
        // slides the container by ±20px while showing/hiding, so a live rect
        // taken mid-slide would aim the window at a transient spot. The
        // correction is only the small dodge offset — if the two positions
        // ever disagree by more than that (a coordinate-space mismatch), keep
        // the live rect rather than applying a wild shift.
        try {
            const c = this._dockManager.getRestingContainerRect();
            const ca = this._dockManager.getContainerActor();
            if (c && ca) {
                const [cx, cy] = ca.get_position();
                const dx = c.x - cx;
                const dy = c.y - cy;
                if (Math.abs(dx) <= 64 && Math.abs(dy) <= 64) {
                    return {
                        x: live.x + dx,
                        y: live.y + dy,
                        width: live.width, height: live.height,
                    };
                }
            }
        }
        catch (_e) {}
        return live;
    }

    _dockCenterRect() {
        try {
            const c = this._dockManager.getRestingContainerRect();
            if (!c)
                return null;
            return { x: c.x + c.w / 2 - 32, y: c.y + c.h / 2 - 12, width: 64, height: 12 };
        }
        catch (_e) {
            return null;
        }
    }

    // Requirement 7: the dock only lives on the primary monitor, so the final
    // fallback also lands on the primary monitor — on the SAME edge the dock
    // is attached to, so the target agrees with the funnel axis (#1).
    _dockEdgeCenterRect() {
        try {
            const m = Main.layoutManager.primaryMonitor;
            if (!m)
                return null;
            const [x, y] = this._edgeAnchor(m.x + m.width / 2, m.y + m.height / 2, m);
            return { x: x - 32, y: y - 12, width: 64, height: 12 };
        }
        catch (_e) {
            return null;
        }
    }

    // Requirement 4 (peek off): fly to the dock's screen edge while keeping the
    // icon's position along that edge.
    _dockEdgeAt(rect) {
        let x = rect.x + rect.width / 2;
        let y = rect.y + rect.height / 2;
        try {
            const m = Main.layoutManager.primaryMonitor;
            if (m)
                [x, y] = this._edgeAnchor(x, y, m);
        }
        catch (_e) {}
        return { x: x - 32, y: y - 12, width: 64, height: 12 };
    }

    // Snap a point onto the dock's edge of monitor `m`, keeping its coordinate
    // along that edge. Both last-resort fallbacks go through here so the
    // target always sits on the edge the funnel is aiming at.
    _edgeAnchor(px, py, m) {
        switch (this._dockPosition()) {
        case 1: return [m.x, py];              // LEFT
        case 2: return [m.x + m.width, py];    // RIGHT
        case 3: return [px, m.y];              // TOP
        default: return [px, m.y + m.height];  // BOTTOM
        }
    }

    _geom(winRect, iconRect) {
        return funnelGeometry(winRect, iconRect, {
            dockPosition: this._dockPosition(),
            curvature: this._doubleSetting('genie-curvature', 0.85),
            absorb: this._doubleSetting('genie-absorb-depth', 0.85),
            leadFrac: this._doubleSetting('genie-lead-fraction', 0.58),
            trailFrac: this._doubleSetting('genie-trail-fraction', 0.38),
            tailFade: this._doubleSetting('genie-tail-fade', 0.08),
        });
    }

    // ---- helpers -----------------------------------------------------------

    _dodge() {
        try { return this._dockManager?._dodge ?? null; } catch (_e) { return null; }
    }

    _magnification() {
        try { return this._dockManager?._magnification ?? null; } catch (_e) { return null; }
    }

    // Best-effort static snapshot of the window's pixels. Opportunistic: a
    // null or a throw means "use live clones instead", never an error. On
    // restore the client may not have committed a fresh buffer yet, so the
    // texture can occasionally be stale — hence the fallback, and the reason
    // the engine takes `content` and `park` separately.
    _trySnapshot(actor) {
        try {
            return actor.paint_to_content(null);
        }
        catch (e) {
            console.log(`${TAG} snapshot unavailable (${e.message}), using live clone`);
            return null;
        }
    }

    // Build the engine's capture hook so the dock icon reacts exactly when the
    // window arrives (minimize) or leaves (restore) it. The engine compares the
    // eased progress p: minimize fires on the way up, restore on the way down.
    // Returns null when the reaction is disabled.
    _iconReactionCapture(metaWindow, reverse) {
        if (!this._boolSetting('genie-icon-reaction', true))
            return null;
        return {
            reverse,
            thresholds: [reverse ? 0.85 : 0.8],
            next: 0,
            shoot: () => this._squashIcon(metaWindow, reverse),
        };
    }

    // Fire the dock icon's press/rebound reaction. Called from the engine's
    // per-frame capture hook, so it must never throw.
    _squashIcon(metaWindow, reverse) {
        try {
            const appId = this._appIdForWindow(metaWindow);
            if (!appId)
                return;
            const im = this._dockManager?._iconManager;
            im?.squashForAppId?.(appId, {
                reverse,
                dockPosition: this._dockPosition(),
            });
        }
        catch (_e) {}
    }

    // Suspend magnification for the duration of `rec`. Sets rec.paused so
    // _endRecord resumes exactly once — but only if the controller actually
    // has pause(); otherwise there is nothing to resume.
    _pauseMagnification(rec) {
        const mag = this._magnification();
        if (!mag || typeof mag.pause !== 'function')
            return;
        // Set the flag BEFORE calling pause: an extra resume is clamped to 0
        // (harmless), whereas a leaked pause would leave magnification dead.
        rec.paused = true;
        try { mag.pause(); } catch (_e) {}
    }

    // DockManager.POSITIONS: 0=bottom, 1=left, 2=right, 3=top. Defaults to
    // bottom when the dock manager is unavailable.
    _dockPosition() {
        try {
            const p = this._dockManager?._dockPosition;
            return Number.isFinite(p) ? p : 0;
        }
        catch (_e) {
            return 0;
        }
    }

    _intSetting(key, def, lo, hi) {
        try {
            const v = this._settings.get_int(key);
            if (Number.isFinite(v))
                return clamp(v, lo, hi);
        }
        catch (_e) {}
        return def;
    }

    _doubleSetting(key, def) {
        try {
            const v = this._settings.get_double(key);
            if (Number.isFinite(v))
                return v;
        }
        catch (_e) {}
        return def;
    }

    _boolSetting(key, def) {
        try { return this._settings.get_boolean(key); }
        catch (_e) { return def; }
    }

    _minDur() { return this._intSetting('genie-minimize-duration', 560, 100, 3000); }
    _restoreDur() { return this._intSetting('genie-restore-duration', 480, 100, 3000); }

    // Strip count along the funnel axis. `genie-mesh-resolution` is a CAP,
    // not an exact value: the curve is approximated by straight-edged quads,
    // and beyond ~10px per strip the polyline error is sub-pixel, so tall
    // windows get more strips and small ones far fewer. The floor keeps the
    // outline from looking faceted.
    _strips(winRect) {
        const cap = this._intSetting('genie-mesh-resolution', 64, 16, 192);
        const dp = this._dockPosition();
        const vertical = dp === 1 || dp === 2; // LEFT / RIGHT
        const axial = Math.max(1, vertical ? winRect.width : winRect.height);
        return clamp(Math.round(axial / 10), 24, cap);
    }
}
