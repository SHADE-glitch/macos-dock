// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — tests for genieGeometry.js, part of macos-dock@local.
//
// genieGeometry.js is deliberately free of GNOME/GI imports, so its invariants
// can be checked under plain Node with no gjs and no dependencies:
//
//   npm test
//
// The assertions below follow the invariants the module documents in its own
// comments (inverse coordinate transforms, monotonic easing, the explicit
// dock-position table, the allocation-free strip contract).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    Side,
    DOCK_POSITION_TO_SIDE,
    clamp,
    lerp,
    smooth,
    EASE_AMPLITUDE,
    easeProgress,
    sideCurve,
    mul3,
    LOCAL_TO_FUNNEL,
    FUNNEL_TO_LOCAL,
    funnelGeometry,
    stripTransform,
    funnelRectToLocal,
} from "../lib/genieGeometry.js";

const EPS = 1e-9;
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

/** Assert a number is finite (not NaN / ±Infinity). */
function finite(value, label) {
    assert.ok(
        Number.isFinite(value),
        `${label} must be finite, got ${value}`
    );
}

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Convenience builders so the intent of each case stays readable.
const rect = (x, y, width, height) => ({ x, y, width, height });
const knobs = (over = {}) => ({
    dockPosition: 0,
    curvature: 0.85,
    absorb: 0.6,
    leadFrac: 0.5,
    trailFrac: 0.5,
    tailFade: 0.5,
    ...over,
});

// A window that sits above a bottom-dock icon: the common case.
const WIN = rect(0, 0, 400, 300);
const ICON = rect(150, 310, 64, 64);

describe("scalar helpers", () => {
    it("clamp keeps in-range values and pins the bounds", () => {
        assert.equal(clamp(5, 0, 10), 5);
        assert.equal(clamp(-1, 0, 10), 0);
        assert.equal(clamp(11, 0, 10), 10);
        assert.equal(clamp(0, 0, 10), 0);
        assert.equal(clamp(10, 0, 10), 10);
    });

    it("clamp with an inverted range collapses to hi (documented degenerate)", () => {
        assert.equal(clamp(5, 10, 0), 0);
    });

    it("clamp propagates NaN rather than hiding it", () => {
        // This is why every caller must sanitize its input: clamp does not.
        assert.ok(Number.isNaN(clamp(NaN, 0, 10)));
    });

    it("lerp hits its endpoints and interpolates linearly", () => {
        assert.equal(lerp(0, 10, 0), 0);
        assert.equal(lerp(0, 10, 1), 10);
        assert.equal(lerp(0, 10, 0.5), 5);
        assert.equal(lerp(10, 0, 0.25), 7.5);
        assert.equal(lerp(2, 4, 0.5), 3);
    });

    it("lerp extrapolates outside [0,1]", () => {
        assert.equal(lerp(0, 10, 2), 20);
        assert.equal(lerp(0, 10, -1), -10);
    });

    it("smooth is smoothstep: endpoints, midpoint, known value", () => {
        assert.equal(smooth(0), 0);
        assert.equal(smooth(1), 1);
        assert.equal(smooth(0.5), 0.5);
        assert.ok(close(smooth(0.25), 0.15625), `got ${smooth(0.25)}`);
    });

    it("smooth is symmetric about t = 0.5", () => {
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            assert.ok(
                close(smooth(t) + smooth(1 - t), 1),
                `smooth(${t}) + smooth(${1 - t}) != 1`
            );
        }
    });

    it("smooth is monotonic non-decreasing on [0,1]", () => {
        let prev = -Infinity;
        for (let i = 0; i <= 100; i++) {
            const v = smooth(i / 100);
            assert.ok(v >= prev, `smooth dipped at t=${i / 100}`);
            prev = v;
        }
    });
});

describe("easing curves", () => {
    it("easeProgress defaults to EASE_AMPLITUDE and passes through both ends", () => {
        assert.equal(EASE_AMPLITUDE, 0.5);
        assert.equal(easeProgress(0), 0);
        assert.ok(close(easeProgress(1), 1), `got ${easeProgress(1)}`);
        assert.equal(easeProgress(0, EASE_AMPLITUDE), easeProgress(0));
    });

    it("easeProgress at a=0 is the identity", () => {
        for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            assert.ok(close(easeProgress(t, 0), t));
        }
    });

    it("easeProgress is strictly increasing for a < 1", () => {
        let prev = -Infinity;
        for (let i = 0; i <= 500; i++) {
            const v = easeProgress(i / 500, 0.5);
            assert.ok(v > prev, `not strictly increasing at t=${i / 500}`);
            prev = v;
        }
    });

    it("easeProgress stays monotonic (non-decreasing) at a = 1", () => {
        // f'(t) = 1 + a*cos(2*pi*t) touches 0 at t = 0.5 when a = 1.
        let prev = -Infinity;
        for (let i = 0; i <= 500; i++) {
            const v = easeProgress(i / 500, 1);
            assert.ok(v >= prev - EPS, `not monotonic at t=${i / 500}`);
            prev = v;
        }
        assert.ok(close(easeProgress(0.5, 1), 0.5), `midpoint is ${easeProgress(0.5, 1)}`);
    });

    it("sideCurve passes through (0,0) and (1,1)", () => {
        for (const [c1, c2] of [[0.04, 0.55], [0.14, 0.24], [1 / 3, 1 / 3]]) {
            assert.equal(sideCurve(0, c1, c2), 0);
            assert.equal(sideCurve(1, c1, c2), 1);
        }
    });

    it("sideCurve is monotonic across the documented c1/c2 ranges", () => {
        for (const c1 of [0.04, 0.09, 0.14]) {
            for (const c2 of [0.24, 0.395, 0.55]) {
                let prev = -Infinity;
                for (let i = 0; i <= 200; i++) {
                    const v = sideCurve(i / 200, c1, c2);
                    assert.ok(v >= prev - EPS, `dipped at c1=${c1} c2=${c2}`);
                    prev = v;
                }
            }
        }
    });

    it("sideCurve matches its closed form at t = 0.5", () => {
        // 3(1-t)^2 t c1 + 3(1-t) t^2 c2 + t^3  at t=0.5 -> 0.375(c1+c2) + 0.125
        assert.ok(close(sideCurve(0.5, 0.04, 0.55), 0.375 * 0.59 + 0.125));
    });
});

describe("mul3", () => {
    it("treats the identity as neutral on both sides", () => {
        const A = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        assert.deepEqual(mul3(A, IDENTITY), A);
        assert.deepEqual(mul3(IDENTITY, A), A);
    });

    it("composes a known scale and translation", () => {
        const translate = [1, 0, 5, 0, 1, 7, 0, 0, 1];
        const scale = [2, 0, 0, 0, 3, 0, 0, 0, 1];
        assert.deepEqual(mul3(translate, scale), [2, 0, 5, 0, 3, 7, 0, 0, 1]);
    });

    it("does not mutate its operands", () => {
        const A = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        const B = [9, 8, 7, 6, 5, 4, 3, 2, 1];
        const aCopy = [...A];
        const bCopy = [...B];
        mul3(A, B);
        assert.deepEqual(A, aCopy);
        assert.deepEqual(B, bCopy);
    });

    it("is associative", () => {
        const A = [1, 2, 3, 4, 5, 6, 7, 8, 9];
        const B = [9, 8, 7, 6, 5, 4, 3, 2, 1];
        const C = [1, 0, 2, 0, 1, 3, 0, 0, 1];
        const left = mul3(mul3(A, B), C);
        const right = mul3(A, mul3(B, C));
        for (let i = 0; i < 9; i++)
            assert.ok(close(left[i], right[i], 1e-6), `index ${i}: ${left[i]} vs ${right[i]}`);
    });
});

describe("local <-> funnel transforms", () => {
    // The whole point of keeping two tables is that one undoes the other.
    // If a side's pair ever drifts, every strip transform is silently wrong.
    for (const side of [Side.BOTTOM, Side.TOP, Side.RIGHT, Side.LEFT]) {
        it(`LOCAL_TO_FUNNEL and FUNNEL_TO_LOCAL are inverses (side ${side})`, () => {
            const forward = mul3(LOCAL_TO_FUNNEL[side], FUNNEL_TO_LOCAL[side]);
            const backward = mul3(FUNNEL_TO_LOCAL[side], LOCAL_TO_FUNNEL[side]);
            for (let i = 0; i < 9; i++) {
                assert.ok(
                    close(forward[i], IDENTITY[i]),
                    `L2F*F2L[${i}] = ${forward[i]}, want ${IDENTITY[i]}`
                );
                assert.ok(
                    close(backward[i], IDENTITY[i]),
                    `F2L*L2F[${i}] = ${backward[i]}, want ${IDENTITY[i]}`
                );
            }
        });
    }
});

describe("dock position mapping", () => {
    it("uses an explicit table, not a cast of the POSITIONS enum", () => {
        // DockManager.POSITIONS is BOTTOM/LEFT/RIGHT/TOP while Side is
        // BOTTOM/TOP/RIGHT/LEFT; casting would swap left and top.
        assert.deepEqual(DOCK_POSITION_TO_SIDE, [
            Side.BOTTOM, Side.LEFT, Side.RIGHT, Side.TOP,
        ]);
        assert.equal(DOCK_POSITION_TO_SIDE[1], Side.LEFT);
        assert.notEqual(DOCK_POSITION_TO_SIDE[1], Side.TOP);
    });
});

describe("funnelGeometry", () => {
    it("maps an explicit dockPosition through the table", () => {
        for (let pos = 0; pos <= 3; pos++) {
            const g = funnelGeometry(WIN, ICON, knobs({ dockPosition: pos }));
            assert.equal(g.side, DOCK_POSITION_TO_SIDE[pos], `dockPosition ${pos}`);
        }
    });

    it("clamps an out-of-range dockPosition", () => {
        assert.equal(funnelGeometry(WIN, ICON, knobs({ dockPosition: -1 })).side, Side.BOTTOM);
        assert.equal(funnelGeometry(WIN, ICON, knobs({ dockPosition: 7 })).side, Side.TOP);
        assert.equal(funnelGeometry(WIN, ICON, knobs({ dockPosition: 2.9 })).side, Side.RIGHT);
    });

    it("falls back to the dominant direction when dockPosition is omitted", () => {
        const below = rect(40, 200, 20, 20);
        const above = rect(40, -100, 20, 20);
        const right = rect(300, 40, 20, 20);
        const left = rect(-200, 40, 20, 20);
        const center = rect(0, 0, 100, 100);
        const noPos = knobs({ dockPosition: undefined });

        assert.equal(funnelGeometry(center, below, noPos).side, Side.BOTTOM);
        assert.equal(funnelGeometry(center, above, noPos).side, Side.TOP);
        assert.equal(funnelGeometry(center, right, noPos).side, Side.RIGHT);
        assert.equal(funnelGeometry(center, left, noPos).side, Side.LEFT);
    });

    it("keeps funnelDepth at least 1 and at least the window's axial length", () => {
        for (let pos = 0; pos <= 3; pos++) {
            const g = funnelGeometry(WIN, ICON, knobs({ dockPosition: pos }));
            const winAxis = Math.abs(g.wb1 - g.wb0);
            assert.ok(g.funnelDepth >= 1, `funnelDepth ${g.funnelDepth}`);
            assert.ok(
                g.funnelDepth >= winAxis,
                `funnelDepth ${g.funnelDepth} < winAxis ${winAxis}`
            );
        }
    });

    it("always sinks at least a little, and bEnd is ib0 + sink", () => {
        const tinyIcon = rect(150, 310, 2, 2);
        for (const absorb of [0, 0.6, 1]) {
            for (const icon of [ICON, tinyIcon]) {
                const g = funnelGeometry(WIN, icon, knobs({ absorb }));
                const iconDepth = Math.max(0, g.ia1 - g.ia0);
                const sink = g.bEnd - g.ib;
                assert.ok(
                    sink >= Math.min(iconDepth, 6) - EPS,
                    `sink ${sink} < min(iconDepth ${iconDepth}, 6)`
                );
            }
        }
    });

    it("derives c1/c2 from curvature within the documented ranges", () => {
        // c1 = 0.04 + 0.10*(1 - curvature), c2 = lerp(0.55, 0.24, curvature)
        const zero = funnelGeometry(WIN, ICON, knobs({ curvature: 0 }));
        const full = funnelGeometry(WIN, ICON, knobs({ curvature: 1 }));
        assert.ok(close(zero.c1, 0.14) && close(zero.c2, 0.55), `c=${zero.c1},${zero.c2}`);
        assert.ok(close(full.c1, 0.04) && close(full.c2, 0.24), `c=${full.c1},${full.c2}`);

        for (const curvature of [0, 0.25, 0.5, 0.85, 1]) {
            const g = funnelGeometry(WIN, ICON, knobs({ curvature }));
            assert.ok(g.c1 >= 0.04 - EPS && g.c1 <= 0.14 + EPS, `c1 ${g.c1}`);
            assert.ok(g.c2 >= 0.24 - EPS && g.c2 <= 0.55 + EPS, `c2 ${g.c2}`);
        }
    });

    it("clamps curvature and leaves no NaN for an omitted or junk knob", () => {
        // The module documents standalone use, so a missing knob must not
        // poison c1/c2 (they feed sideCurve -> every strip transform).
        // Built by hand: knobs() supplies a curvature, so it cannot express
        // "the caller omitted the key entirely".
        const omitted = {
            dockPosition: 0, absorb: 0.6,
            leadFrac: 0.5, trailFrac: 0.5, tailFade: 0.5,
        };
        assert.ok(!("curvature" in omitted), "fixture must genuinely omit curvature");

        const cases = [
            ["omitted", omitted, 0],
            ["undefined", knobs({ curvature: undefined }), 0],
            ["NaN", knobs({ curvature: NaN }), 0],
            ["null", knobs({ curvature: null }), 0],
            ["below", knobs({ curvature: -1 }), 0],
            ["above", knobs({ curvature: 5 }), 1],
            ["mid", knobs({ curvature: 0.5 }), 0.5],
        ];
        for (const [label, k, expected] of cases) {
            const g = funnelGeometry(WIN, ICON, k);
            assert.equal(g.curvature, expected, `${label}: curvature`);
            finite(g.c1, `${label}: c1`);
            finite(g.c2, `${label}: c2`);
            // c1/c2 must agree with the clamped curvature, not the raw knob.
            assert.ok(
                close(g.c1, 0.04 + 0.10 * (1 - expected)),
                `${label}: c1 ${g.c1} disagrees with curvature ${expected}`
            );
            assert.ok(
                close(g.c2, lerp(0.55, 0.24, expected)),
                `${label}: c2 ${g.c2} disagrees with curvature ${expected}`
            );
        }
    });

    it("returns only finite numbers for every side and curvature", () => {
        for (let pos = 0; pos <= 3; pos++) {
            for (const curvature of [0, 0.5, 1]) {
                const g = funnelGeometry(WIN, ICON, knobs({ dockPosition: pos, curvature }));
                for (const key of [
                    "side", "wa0", "wa1", "wb0", "wb1", "ia0", "ia1",
                    "ib", "funnelDepth", "bEnd", "c1", "c2",
                    "leadFrac", "trailFrac", "tailFade", "curvature",
                ])
                    finite(g[key], `pos ${pos} curvature ${curvature}: ${key}`);
            }
        }
    });

    it("passes the untransformed knobs through", () => {
        const g = funnelGeometry(WIN, ICON, knobs({ leadFrac: 0.2, trailFrac: 0.3, tailFade: 0.4 }));
        assert.equal(g.leadFrac, 0.2);
        assert.equal(g.trailFrac, 0.3);
        assert.equal(g.tailFade, 0.4);
    });
});

describe("stripTransform", () => {
    const pre = IDENTITY;

    it("writes into the caller's scratch buffer and returns it (allocation-free)", () => {
        const g = funnelGeometry(WIN, ICON, knobs());
        const scratch = new Array(9);
        const result = stripTransform(g, g.wb0, g.wb0 + 10, 1, pre, scratch);
        assert.equal(result, scratch, "must return the same buffer, not a copy");
    });

    it("fills all nine elements with finite numbers", () => {
        const g = funnelGeometry(WIN, ICON, knobs());
        const scratch = new Array(9);
        stripTransform(g, g.wb0, g.wb0 + 10, 1, pre, scratch);
        for (let i = 0; i < 9; i++)
            finite(scratch[i], `scratch[${i}]`);
    });

    it("degrades to an identity third row when sLead is 0", () => {
        const g = funnelGeometry(WIN, ICON, knobs());
        const scratch = new Array(9);
        stripTransform(g, g.wb0, g.wb0 + 10, 0, pre, scratch);
        assert.ok(close(scratch[6], 0), `[6]=${scratch[6]}`);
        assert.ok(close(scratch[7], 0), `[7]=${scratch[7]}`);
        assert.ok(close(scratch[8], 1), `[8]=${scratch[8]}`);
    });

    it("is deterministic for identical inputs", () => {
        const g = funnelGeometry(WIN, ICON, knobs());
        const a = new Array(9);
        const b = new Array(9);
        stripTransform(g, g.wb0, g.wb0 + 10, 0.5, pre, a);
        stripTransform(g, g.wb0, g.wb0 + 10, 0.5, pre, b);
        assert.deepEqual(a, b);
    });

    it("never produces NaN across sides, curvatures and progress", () => {
        for (let pos = 0; pos <= 3; pos++) {
            for (const curvature of [0, 0.5, 1]) {
                const g = funnelGeometry(WIN, ICON, knobs({ dockPosition: pos, curvature }));
                for (const sLead of [0, 0.25, 0.5, 1]) {
                    const scratch = new Array(9);
                    stripTransform(g, g.wb0, g.wb1, sLead, pre, scratch);
                    for (let i = 0; i < 9; i++)
                        finite(scratch[i], `pos ${pos} curv ${curvature} sLead ${sLead} [${i}]`);
                }
            }
        }
    });
});

describe("funnelRectToLocal", () => {
    const cases = [
        [Side.BOTTOM, (a0, a1, b0, b1) => ({ x: a0, y: b0, w: a1 - a0, h: b1 - b0 })],
        [Side.TOP, (a0, a1, b0, b1) => ({ x: a0, y: -b1, w: a1 - a0, h: b1 - b0 })],
        [Side.RIGHT, (a0, a1, b0, b1) => ({ x: b0, y: a0, w: b1 - b0, h: a1 - a0 })],
        [Side.LEFT, (a0, a1, b0, b1) => ({ x: -b1, y: a0, w: b1 - b0, h: a1 - a0 })],
    ];

    for (const [side, expected] of cases) {
        it(`maps a rect back to window-local coords (side ${side})`, () => {
            const got = funnelRectToLocal({ side }, 10, 40, 5, 25);
            const want = expected(10, 40, 5, 25);
            assert.ok(close(got.x, want.x), `x ${got.x} != ${want.x}`);
            assert.ok(close(got.y, want.y), `y ${got.y} != ${want.y}`);
            assert.ok(close(got.w, want.w), `w ${got.w} != ${want.w}`);
            assert.ok(close(got.h, want.h), `h ${got.h} != ${want.h}`);
        });
    }

    it("clamps a degenerate rect up to the 1e-4 floor", () => {
        const inverted = funnelRectToLocal({ side: Side.BOTTOM }, 40, 10, 25, 5);
        assert.equal(inverted.w, 1e-4, "negative width must clamp");
        assert.equal(inverted.h, 1e-4, "negative height must clamp");

        const zero = funnelRectToLocal({ side: Side.BOTTOM }, 10, 10, 5, 5);
        assert.equal(zero.w, 1e-4, "zero width must clamp");
        assert.equal(zero.h, 1e-4, "zero height must clamp");
    });
});
