// SPDX-License-Identifier: GPL-2.0-or-later
// Derived from macos-genie (https://github.com/SekiroKenjii/macos-genie)
// © Thuong Vo (SekiroKenjii) — GPL-2.0-or-later.
// Merged into macos-dock@local and maintained by © SHADE-glitch.
//
// genieGeometry.js — the genie's funnel math. Pure functions and constants
// only: no GNOME/GI imports, so this module is safe to use from any process
// (and trivial to reason about in isolation).

// Funnel axis: which screen edge the dock icon sits on.
export const Side = {BOTTOM: 0, TOP: 1, RIGHT: 2, LEFT: 3};

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t); // smoothstep

// Cubic Bézier through (0, c1, c2, 1) — shapes the funnel's side curves.
export function sideCurve(t, c1, c2) {
    const mt = 1 - t;
    return 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t;
}

// 3x3 matrix multiply, column-vector convention (M·[x,y,1]).
export function mul3(A, B) {
    const R = new Array(9);
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            R[3 * r + c] =
                A[3 * r] * B[c] + A[3 * r + 1] * B[3 + c] + A[3 * r + 2] * B[6 + c];
        }
    }
    return R;
}

// Local <-> funnel coordinate transforms per dock side (all linear).
export const LOCAL_TO_FUNNEL = {
    [Side.BOTTOM]: [1, 0, 0,  0, 1, 0,  0, 0, 1],
    [Side.TOP]:    [1, 0, 0,  0, -1, 0,  0, 0, 1],
    [Side.RIGHT]:  [0, 1, 0,  1, 0, 0,  0, 0, 1],
    [Side.LEFT]:   [0, 1, 0,  -1, 0, 0,  0, 0, 1],
};
export const FUNNEL_TO_LOCAL = {
    [Side.BOTTOM]: [1, 0, 0,  0, 1, 0,  0, 0, 1],
    [Side.TOP]:    [1, 0, 0,  0, -1, 0,  0, 0, 1],
    [Side.RIGHT]:  [0, 1, 0,  1, 0, 0,  0, 0, 1],
    [Side.LEFT]:   [0, -1, 0,  1, 0, 0,  0, 0, 1],
};

// Build the static funnel field, in window-local coordinates.
// `knobs` carries the user-tunable shape values, resolved by the caller:
// {curvature, absorb, leadFrac, trailFrac, tailFade}.
export function funnelGeometry(win, icon, knobs) {
    // Dock side = dominant direction from the window center to the icon.
    const dx = icon.x + icon.width / 2 - (win.x + win.width / 2);
    const dy = icon.y + icon.height / 2 - (win.y + win.height / 2);
    let side;
    if (Math.abs(dy) >= Math.abs(dx))
        side = dy >= 0 ? Side.BOTTOM : Side.TOP;
    else
        side = dx >= 0 ? Side.RIGHT : Side.LEFT;

    // Transform a window-local rect into funnel coords (a across, b toward
    // the dock), returning [a0, a1, b0, b1].
    const toFunnel = (x, y, w, h) => {
        switch (side) {
        case Side.BOTTOM: return [x, x + w, y, y + h];
        case Side.TOP:    return [x, x + w, -(y + h), -y];
        case Side.RIGHT:  return [y, y + h, x, x + w];
        default:          return [y, y + h, -(x + w), -x]; // LEFT
        }
    };

    const [wa0, wa1, wb0, wb1] = toFunnel(0, 0, win.width, win.height);
    const [ia0, ia1, ib0, ib1] = toFunnel(
        icon.x - win.x, icon.y - win.y, icon.width, icon.height);

    return {
        side,
        wa0, wa1, wb0, wb1,
        ia0, ia1,
        ib: ib0,
        funnelDepth: Math.max(1, ib0 - wb0),
        bEnd: ib0 + knobs.absorb * Math.max(0, ib1 - ib0),
        // Funnel profile (cubic Bézier through 0, c1, c2, 1 — the sideways
        // narrowing factor). Lower c1/c2 keep the funnel WIDE for longer, so
        // the body stays full and rounds off into a plump "belly" before it
        // necks into the icon — the fuller, rounder genie the reference shows.
        // At curvature 1 it converges harder (a tighter gather).
        c1: 0.04 + 0.10 * (1 - knobs.curvature),
        c2: lerp(0.55, 0.24, knobs.curvature),
        leadFrac: knobs.leadFrac,
        trailFrac: knobs.trailFrac,
        tailFade: knobs.tailFade,
    };
}

// Convert a funnel-coords rect (a0..a1 × b0..b1) into a window-local rect.
export function funnelRectToLocal(g, a0, a1, b0, b1) {
    let x0, y0, x1, y1;
    switch (g.side) {
    case Side.BOTTOM: [x0, x1, y0, y1] = [a0, a1, b0, b1]; break;
    case Side.TOP:    [x0, x1, y0, y1] = [a0, a1, -b1, -b0]; break;
    case Side.RIGHT:  [x0, x1, y0, y1] = [b0, b1, a0, a1]; break;
    default:          [x0, x1, y0, y1] = [-b1, -b0, a0, a1]; break; // LEFT
    }
    return {x: x0, y: y0, w: Math.max(x1 - x0, 1e-4), h: Math.max(y1 - y0, 1e-4)};
}
