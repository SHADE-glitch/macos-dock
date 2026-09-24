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

            // Snapshot the window's pixels into a static texture and report
            // minimize complete IMMEDIATELY: from mutter's and the client's
            // point of view this is indistinguishable from the stock
            // animation, so client commits during the animation are not
            // geometry-suppressed.
            let content = null;
            try { content = actor.paint_to_content(null); }
            catch (e) {
                console.log(`${TAG} snapshot unavailable (${e.message}), using live clone`);
            }

            if (content) {
                this._fireComplete(rec);
                this._manager.run(actor, {
                    reverse: false, duration, complete: finish,
                    content, winRect, geom, strips: this._strips(), capture: null,
                });
            }
            else {
                this._manager.run(actor, {
                    reverse: false, duration, complete: finish,
                    winRect, geom, strips: this._strips(), capture: null,
                });
            }
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
            // The shell had moved the actor to the icon; put it back where the
            // window really is (the shell's cleanup never restores position).
            const rect = metaWindow.get_buffer_rect();
            actor.set_position(rect.x, rect.y);
            actor.show();
            // Report completion to mutter IMMEDIATELY: while an effect is "in
            // progress" mutter suppresses actor-geometry syncing, which would
            // misalign client frames committed during the animation. The
            // genie animates strips cloned from the scale-parked actor.
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
            this._manager.run(actor, {
                reverse: true, duration, complete: finish,
                winRect, geom, strips: this._strips(), capture: null,
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
            completed: false, actorGone: false,
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
            iconRect = this._bottomCenterRect();
        if (!iconRect)
            iconRect = { x: 0, y: 0, width: 64, height: 12 }; // last resort

        let peekNeeded = false;
        const dodge = this._dodge();
        if (dodge?.isHidden?.() ?? false) {
            if (this._boolSetting('genie-peek-hidden-dock', true))
                peekNeeded = true;
            else
                iconRect = this._bottomEdgeAt(iconRect);
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
    // fallback also lands on the primary monitor.
    _bottomCenterRect() {
        try {
            const m = Main.layoutManager.primaryMonitor;
            if (!m)
                return null;
            return { x: m.x + m.width / 2 - 32, y: m.y + m.height - 12, width: 64, height: 12 };
        }
        catch (_e) {
            return null;
        }
    }

    // Requirement 4 (peek off): fly to the primary screen's bottom edge while
    // keeping the icon's horizontal position.
    _bottomEdgeAt(rect) {
        let y = rect.y;
        try {
            const m = Main.layoutManager.primaryMonitor;
            if (m)
                y = m.y + m.height - 12;
        }
        catch (_e) {}
        return { x: rect.x + rect.width / 2 - 32, y, width: 64, height: 12 };
    }

    _geom(winRect, iconRect) {
        return funnelGeometry(winRect, iconRect, {
            curvature: this._doubleSetting('genie-curvature', 0.85),
            absorb: this._doubleSetting('genie-absorb-depth', 0.6),
            leadFrac: this._doubleSetting('genie-lead-fraction', 0.58),
            trailFrac: this._doubleSetting('genie-trail-fraction', 0.38),
            tailFade: this._doubleSetting('genie-tail-fade', 0.08),
        });
    }

    // ---- helpers -----------------------------------------------------------

    _dodge() {
        try { return this._dockManager?._dodge ?? null; } catch (_e) { return null; }
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
    _strips() { return this._intSetting('genie-mesh-resolution', 128, 16, 192); }
}
