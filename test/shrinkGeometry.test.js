// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — suites for lib/shrinkGeometry.js. Pure Node: no gjs, no shell.
//
// These are the properties the animation is actually made of: the two endpoints,
// monotonicity (a frame must never jump backwards), the gravity knob's meaning,
// the mirror that makes restore the exact reverse of minimize, the aspect-ratio
// promise, and the edge-projection table for a hidden dock. Each is asserted on
// numbers, not on a snapshot of code.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    VANISH_AT, gravityProgress, shrinkEndScale, shrinkFrame, shrinkTargetRect,
} from "../lib/shrinkGeometry.js";

const WIN = { x: 400, y: 200, width: 800, height: 500 };
const ICON = { x: 900, y: 1020, width: 48, height: 48 };
const MON = { x: 0, y: 0, width: 1920, height: 1080 };

// Scaling about a (0.5, 0.5) pivot leaves the centre invariant, so the painted
// centre is the layout position plus half the UNSCALED size — never a function of
// the scale. Getting this wrong is the difference between "the window lands on its
// icon" and "it lands wherever the scale happened to be".
const center = f => ({ x: f.x + WIN.width / 2, y: f.y + WIN.height / 2 });
const nearly = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

describe("gravityProgress", () => {
    it("pins both endpoints for every gravity", () => {
        for (const g of [0, 0.25, 0.6, 1]) {
            assert.equal(gravityProgress(0, g), 0);
            assert.equal(gravityProgress(1, g), 1);
        }
    });

    it("is the identity at gravity 0", () => {
        for (const p of [0, 0.1, 0.5, 0.37, 0.9, 1])
            assert.equal(gravityProgress(p, 0), p);
    });

    it("rises monotonically", () => {
        let prev = -1;
        for (let i = 0; i <= 100; i++) {
            const q = gravityProgress(i / 100, 0.6);
            assert.ok(q >= prev, `dips at p=${i / 100}`);
            prev = q;
        }
    });

    it("slows the middle as gravity grows", () => {
        // "More gravity" has to mean "less done at half time", or the knob is
        // just another easing with no direction.
        const mid = g => gravityProgress(0.5, g);
        assert.ok(mid(1) < mid(0.6) && mid(0.6) < mid(0.3) && mid(0.3) < mid(0),
            `not ordered: ${[0, 0.3, 0.6, 1].map(mid).join(", ")}`);
        nearly(mid(0), 0.5);
    });

    it("clamps progress outside 0..1 instead of returning NaN", () => {
        // A negative base with a fractional exponent is NaN, and NaN written to
        // an actor's scale freezes it mid-air — the clamp is the guard.
        assert.equal(gravityProgress(-0.2, 0.6), 0);
        assert.equal(gravityProgress(1.3, 0.6), 1);
        for (const p of [-1, -0.001, 0, 0.5, 1, 1.001, 2])
            assert.ok(Number.isFinite(gravityProgress(p, 0.7)));
    });
});

describe("shrinkFrame — minimize", () => {
    it("starts as the untouched window", () => {
        const f = shrinkFrame(WIN, ICON, 0, { gravity: 0.6 });
        nearly(f.scale, 1);
        nearly(f.x, WIN.x);
        nearly(f.y, WIN.y);
    });

    it("ends collapsed to nothing, centred on the icon", () => {
        const f = shrinkFrame(WIN, ICON, 1, { gravity: 0.6 });
        nearly(f.scale, 0);
        const c = center(f);
        nearly(c.x, ICON.x + ICON.width / 2);
        nearly(c.y, ICON.y + ICON.height / 2);
    });

    it("inscribes the window into the icon at the end of the gather", () => {
        // The gather ends at q = VANISH_AT; solve p back out of the curve.
        const p = VANISH_AT ** (1 / (1 + 1.5 * 0.6));
        const f = shrinkFrame(WIN, ICON, p, { gravity: 0.6 });
        const w = WIN.width * f.scale, h = WIN.height * f.scale;
        assert.ok(w <= ICON.width + 1e-6 && h <= ICON.height + 1e-6,
            `does not fit: ${w}x${h} into ${ICON.width}x${ICON.height}`);
        nearly(Math.max(w / ICON.width, h / ICON.height), 1);
        nearly(f.scale, shrinkEndScale(WIN, ICON));
    });

    it("never gets bigger or further away as progress advances", () => {
        let prevScale = Infinity, prevDist = Infinity;
        for (let i = 0; i <= 200; i++) {
            const f = shrinkFrame(WIN, ICON, i / 200, { gravity: 0.6 });
            const c = center(f);
            const dist = Math.hypot(c.x - (ICON.x + ICON.width / 2),
                c.y - (ICON.y + ICON.height / 2));
            assert.ok(f.scale <= prevScale + 1e-12, `scale jumped at ${i / 200}`);
            assert.ok(dist <= prevDist + 1e-9, `moved away at ${i / 200}`);
            prevScale = f.scale; prevDist = dist;
        }
    });

    it("keeps the aspect ratio because one scalar drives both axes", () => {
        const ratio = WIN.width / WIN.height;
        for (let i = 0; i < 50; i++) {
            const f = shrinkFrame(WIN, ICON, i / 50, { gravity: 0.6 });
            nearly((WIN.width * f.scale) / (WIN.height * f.scale), ratio);
        }
        // The frame carries no per-axis scale at all, which is what makes the
        // loop above a tautology rather than a hope: there is nothing to drift.
        const keys = Object.keys(shrinkFrame(WIN, ICON, 0.3, { gravity: 0.6 })).sort();
        assert.deepEqual(keys, ["scale", "x", "y"]);
    });

    it("is still visible until the last frame", () => {
        // The hard rule the mode exists for: at every p < 1 the scale is
        // strictly positive, so mutter is painting a real actor right up to the
        // frame that completes the effect. A vanish that fires early is exactly
        // what scale<=0 before p=1 would mean.
        for (const p of [0.5, 0.9, 0.95, 0.99, 0.9999])
            assert.ok(shrinkFrame(WIN, ICON, p, { gravity: 0.6 }).scale > 0,
                `already gone at p=${p}`);
    });

    it("writes into the caller's object instead of allocating each frame", () => {
        const out = { sentinel: 1 };
        const f = shrinkFrame(WIN, ICON, 0.3, { gravity: 0.6 }, out);
        assert.equal(f, out);
        assert.equal(out.sentinel, 1);
    });
});

describe("shrinkFrame — restore is the time mirror", () => {
    it("swaps the two endpoints", () => {
        const a = shrinkFrame(WIN, ICON, 0, { gravity: 0.6, reverse: true });
        const b = shrinkFrame(WIN, ICON, 1, { gravity: 0.6, reverse: true });
        nearly(a.scale, 0);
        nearly(b.scale, 1);
        nearly(b.x, WIN.x);
        nearly(b.y, WIN.y);
        const ca = center(a);
        nearly(ca.x, ICON.x + ICON.width / 2);
        nearly(ca.y, ICON.y + ICON.height / 2);
    });

    it("visits the same shapes, in the opposite order, at the same shaped progress", () => {
        // Mirror means: the state the restore path shows at time p equals the
        // state the minimize path shows at 1 - G(p) shaped progress. Reproduce
        // it by inverting the curve on both sides, for several q values.
        const e = 1 + 1.5 * 0.6;
        for (const q of [0.1, 0.4, VANISH_AT, 0.93, 1]) {
            const fwd = shrinkFrame(WIN, ICON, q ** (1 / e), { gravity: 0.6 });
            const rev = shrinkFrame(WIN, ICON, (1 - q) ** (1 / e),
                { gravity: 0.6, reverse: true });
            nearly(fwd.scale, rev.scale, 1e-9);
            nearly(fwd.x, rev.x, 1e-7);
            nearly(fwd.y, rev.y, 1e-7);
        }
    });

    it("grows monotonically back to full size", () => {
        let prev = -1;
        for (let i = 0; i <= 200; i++) {
            const s = shrinkFrame(WIN, ICON, i / 200, { gravity: 0.6, reverse: true }).scale;
            assert.ok(s >= prev - 1e-12, `shrank during restore at ${i / 200}`);
            prev = s;
        }
    });
});

describe("shrinkTargetRect — projecting a hidden dock's icon onto its edge", () => {
    const iconMid = { x: ICON.x + ICON.width / 2, y: ICON.y + ICON.height / 2 };

    it("keeps the along-edge coordinate and snaps the across one to the edge, for all four positions", () => {
        // POSITIONS: 0 bottom, 1 left, 2 right, 3 top. Getting this table wrong
        // sends the window to the wrong edge, and left/top is the pair that
        // silently swaps when an enum is cast instead of mapped.
        const cases = [
            [0, { x: iconMid.x, y: MON.y + MON.height }],
            [3, { x: iconMid.x, y: MON.y }],
            [1, { x: MON.x, y: iconMid.y }],
            [2, { x: MON.x + MON.width, y: iconMid.y }],
        ];
        for (const [pos, want] of cases) {
            const r = shrinkTargetRect(ICON, pos, MON);
            nearly(r.x + r.width / 2, want.x);
            nearly(r.y + r.height / 2, want.y);
        }
    });

    it("preserves the icon's real size, because the inscribe needs a real box", () => {
        for (const pos of [0, 1, 2, 3]) {
            const r = shrinkTargetRect(ICON, pos, MON);
            assert.equal(r.width, ICON.width);
            assert.equal(r.height, ICON.height);
        }
    });

    it("places the target on a monitor offset by an origin, not only at 0,0", () => {
        const m = { x: 1920, y: 0, width: 1920, height: 1200 };
        const icon = { x: 2400, y: 1140, width: 48, height: 48 };
        const r = shrinkTargetRect(icon, 0, m);
        nearly(r.y + r.height / 2, m.y + m.height);
        nearly(r.x + r.width / 2, 2424);
    });
});

describe("shrinkEndScale", () => {
    it("takes the tighter of the two axes", () => {
        nearly(shrinkEndScale(WIN, ICON), Math.min(48 / 800, 48 / 500));
    });

    it("never enlarges a window that is already smaller than the icon", () => {
        const small = { x: 0, y: 0, width: 10, height: 10 };
        assert.ok(shrinkEndScale(small, { x: 0, y: 0, width: 48, height: 48 }) > 1,
            "a tiny window is allowed to grow: the icon is its target box");
    });
});
