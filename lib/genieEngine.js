// SPDX-License-Identifier: GPL-2.0-or-later
// Derived from macos-genie (https://github.com/SekiroKenjii/macos-genie)
// © Thuong Vo (SekiroKenjii) — GPL-2.0-or-later.
// Merged into macos-dock@local and maintained by © SHADE-glitch.
//
// genieEngine.js — the animation engine. GenieManager owns every running
// genie's lifecycle (the record web: finish() idempotence, watchdog, destroy
// handlers). It knows nothing about GSettings or the shell's WindowManager:
// the caller resolves geometry, durations, strip count, and the capture hook,
// and tells us when/how to report completion via `complete`.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';

import {
    Side, clamp, lerp, smooth, mul3,
    LOCAL_TO_FUNNEL, stripTransform, funnelRectToLocal,
} from './genieGeometry.js';

// Namespaced so a leftover container from the old standalone macos-genie
// extension (which used 'macos-genie-strips') can never be mistaken for ours.
export const CONTAINER_NAME = 'macos-dock-genie-strips';

// Verify the Clutter/Graphene surface the engine needs. Returns an array of
// human-readable names for anything missing, so the controller can degrade to
// the native minimize animation instead of crashing at animation time.
export function validateRuntime() {
    const missing = [];
    try {
        if (!global.window_group || typeof global.window_group.add_child !== 'function')
            missing.push('global.window_group.add_child');
    } catch (_e) {
        missing.push('global.window_group');
    }
    if (typeof Clutter.Timeline !== 'function')
        missing.push('Clutter.Timeline');
    if (typeof Clutter.Clone !== 'function')
        missing.push('Clutter.Clone');
    if (!Graphene || typeof Graphene.Matrix !== 'function')
        missing.push('Graphene.Matrix');
    return missing;
}

export class GenieManager {
    constructor() {
        this._animations = new Map(); // actor -> record
    }

    // Heal any strip containers a crashed previous instance left behind.
    sweepLeftovers() {
        for (const child of global.window_group.get_children()) {
            if (child.name === CONTAINER_NAME)
                child.destroy();
        }
    }

    finishFor(actor) {
        this._animations.get(actor)?.finish();
    }

    finishAll() {
        for (const record of [...this._animations.values()])
            record.finish();
        this._animations.clear();
    }

    run(actor, {reverse, duration, complete, geom, strips: N, capture,
                content = null, winRect}) {
        const g = geom;

        // Container at the window's origin; strip coordinates are window-local.
        const container = new Clutter.Actor({
            name: CONTAINER_NAME,
            x: winRect.x, y: winRect.y,
            width: winRect.width, height: winRect.height,
        });

        // Slice the window into strips along the funnel axis. Each strip is a
        // full clone of the window clipped to its slice; per frame it gets a
        // projective transform mapping the slice onto its funnel trapezoid.
        // Slices overlap by a pixel so rounding never opens seams.
        const toF = LOCAL_TO_FUNNEL[g.side];
        const Ws = g.wa1 - g.wa0;
        const Bs = (g.wb1 - g.wb0) / N;
        const strips = [];
        for (let i = 0; i < N; i++) {
            // Static snapshot mode: plain actors sharing one texture content.
            // Live mode: clones of the (scale-parked) real actor.
            const clone = content
                ? new Clutter.Actor({width: winRect.width, height: winRect.height})
                : new Clutter.Clone({
                    source: actor,
                    width: winRect.width, height: winRect.height,
                });
            if (content)
                clone.set_content(content);
            const sb0 = g.wb0 + i * Bs;
            const sb1 = sb0 + Bs;
            const clip = funnelRectToLocal(g, g.wa0, g.wa1, sb0,
                sb1 + (i < N - 1 ? 1 : 0));
            clone.set_clip(clip.x, clip.y, clip.w, clip.h);
            container.add_child(clone);
            strips.push({
                clone,
                v0: i / N,
                v1: (i + 1) / N,
                // Static per strip: local -> normalized slice coords (u,v).
                // Float64Array so the per-frame transform can write into it
                // without touching the heap.
                pre: Float64Array.from(mul3([
                    1 / Ws, 0, -g.wa0 / Ws,
                    0, 1 / Bs, -sb0 / Bs,
                    0, 0, 1,
                ], toF)),
                mat: new Graphene.Matrix(),
                floats: new Array(16).fill(0),
                scratch: new Float64Array(9),
                _op: 255, // last opacity written, so we can skip no-op writes
            });
        }

        global.window_group.add_child(container);
        let foreignShadow = null;
        let shadowWasVisible = false;
        if (!content) {
            // Live mode: park the real actor at a microscopic scale — clones
            // ignore source transforms, so the strips still paint it, while
            // the window itself (and its shadow, which rounded-corner
            // extensions bind to our scale) disappears from the stage. Unlike
            // opacity, mutter never rewrites scale behind our back.
            actor.set_scale(1e-5, 1e-5);
            // Belt and braces for rounded-window-corners' companion shadow.
            foreignShadow = actor.rwcCustomData?.shadow ?? null;
            shadowWasVisible = foreignShadow?.visible ?? false;
            if (foreignShadow)
                foreignShadow.visible = false;
        }

        let layoutErrorLogged = false;
        const layout = p => {
            try {
                // Absorb: how far the tail has dissolved, 1 = fully solid.
                // Smoothstep (rather than linear) removes the slope kink at the
                // fade start, so the tail dissolves gently. Passed down to the
                // strip loop, which applies it to the trailing strips only.
                let f = 1;
                if (g.tailFade > 0) {
                    const fadeStart = 1 - g.tailFade;
                    f = p <= fadeStart ? 1 : 1 - smooth((p - fadeStart) / g.tailFade);
                    f = clamp(f, 0, 1);
                }
                layoutStrips(g, strips, p, f);
                if (capture) {
                    const passed = t => capture.reverse ? p <= t : p >= t;
                    while (capture.next < capture.thresholds.length &&
                           passed(capture.thresholds[capture.next])) {
                        capture.shoot(capture.next);
                        capture.next++;
                    }
                }
            } catch (e) {
                if (!layoutErrorLogged) {
                    layoutErrorLogged = true;
                    console.error(`[macos-dock-local][genie] layout failed: ${e}`);
                }
            }
        };
        layout(reverse ? 1 : 0);

        const timeline = new Clutter.Timeline({
            actor: container,
            duration,
            progress_mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
        });
        const record = {actor, done: false, actorGone: false, containerGone: false};
        record.finish = () => {
            if (record.done)
                return;
            record.done = true;
            this._animations.delete(actor);
            timeline.stop();
            if (record.watchdogId) {
                GLib.source_remove(record.watchdogId);
                record.watchdogId = 0;
            }
            if (record.destroyId && !record.actorGone)
                actor.disconnect(record.destroyId);
            if (record.containerDestroyId && !record.containerGone)
                container.disconnect(record.containerDestroyId);
            if (!record.actorGone) {
                actor.set_scale(1, 1);
                actor.set_opacity(255);
                if (foreignShadow && shadowWasVisible) {
                    // Its `visible` binding to the actor takes over from here
                    // (the actor is hidden by mutter right after a minimize).
                    foreignShadow.visible = true;
                }
                // Tell mutter the effect is over: it hides (minimize) or
                // keeps showing (unminimize) the real actor from here on.
                try {
                    complete();
                } catch (e) {
                    console.error(`[macos-dock-local][genie] completing effect failed: ${e}`);
                }
            }
            if (!record.containerGone)
                container.destroy();
        };
        record.destroyId = actor.connect('destroy', () => {
            // Window closed mid-animation: mutter cleans up the effect state
            // itself on destroy — do not touch the dying actor.
            record.actorGone = true;
            record.finish();
        });
        record.containerDestroyId = container.connect('destroy', () => {
            record.containerGone = true;
            record.finish();
        });
        // If the timeline ever stalls (frame clock hiccups, actor unmapped by
        // a workspace switch, …) this still completes the effect and cleans
        // up — leaked overlays would otherwise linger on screen forever.
        record.watchdogId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, duration + 500, () => {
                record.watchdogId = 0;
                record.finish();
                return GLib.SOURCE_REMOVE;
            });
        this._animations.set(actor, record);

        timeline.connect('new-frame', () => {
            const p = timeline.get_progress();
            layout(reverse ? 1 - p : p);
        });
        timeline.connect('completed', () => record.finish());
        timeline.start();
    }
}

// Position every strip: compute the funnel trapezoid for its slice and
// set a projective transform mapping slice -> trapezoid. Corners match
// exactly between neighbours, so the outline is continuous.
//
// `f` is the tail-absorb factor from the caller (1 = solid, 0 = fully
// dissolved). It is applied to the trailing strips only — see below.
function layoutStrips(g, strips, p, f = 1) {
    // The two sweeping edges. The leading edge (window edge nearest the
    // dock) arrives inside the icon at p = leadFrac; the trailing edge
    // departs at p = trailFrac and arrives at p = 1.
    const sLead = smooth(clamp(p / g.leadFrac, 0, 1));
    const sTrail = smooth(clamp((p - g.trailFrac) / (1 - g.trailFrac), 0, 1));
    const bLead = lerp(g.wb1, g.bEnd, sLead);
    const bTrail = lerp(g.wb0, g.bEnd, sTrail);

    // The tail is the LOW-index end: v0 = 0 sits at bTrail, i.e. the window's
    // far edge, which is the last part to be absorbed. Dimming those strips
    // (rather than the whole container) lets the tail dissolve into the icon
    // while the body stays solid.
    const tailSpan = g.tailFade > 0 ? g.tailFade : 0;

    for (const s of strips) {
        const b0 = lerp(bTrail, bLead, s.v0);
        const b1 = lerp(bTrail, bLead, s.v1);
        // Allocation-free: stripTransform writes into s.scratch.
        const M = stripTransform(g, b0, b1, sLead, s.pre, s.scratch);
        // Column-vector 3x3 -> graphene 4x4 (row-vector), z untouched.
        const fl = s.floats;
        fl[0] = M[0]; fl[1] = M[3]; fl[3] = M[6];
        fl[4] = M[1]; fl[5] = M[4]; fl[7] = M[7];
        fl[10] = 1;
        fl[12] = M[2]; fl[13] = M[5]; fl[15] = M[8];
        s.mat.init_from_float(fl);
        s.clone.set_transform(s.mat);

        if (tailSpan > 0) {
            const w = clamp((tailSpan - s.v0) / tailSpan, 0, 1);
            const alpha = Math.round(255 * lerp(1, f, w));
            // Opacity is a property notification, so only write on change:
            // most frames most strips are unchanged (f === 1 -> alpha 255).
            if (alpha !== s._op) {
                s.clone.set_opacity(alpha);
                s._op = alpha;
            }
        }
    }
}

// The Side enum is re-exported for callers that build geometry elsewhere.
export {Side};
