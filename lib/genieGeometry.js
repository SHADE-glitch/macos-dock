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

// DockManager.POSITIONS (0=bottom, 1=left, 2=right, 3=top) -> funnel Side.
// The two enums are NOT in the same order — Side is BOTTOM/TOP/RIGHT/LEFT
// while POSITIONS is BOTTOM/LEFT/RIGHT/TOP — so this must be an explicit
// table. Casting one to the other directly would swap left and top.
export const DOCK_POSITION_TO_SIDE = [Side.BOTTOM, Side.LEFT, Side.RIGHT, Side.TOP];

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = t => t * t * (3 - 2 * t); // smoothstep

// Amplitude of the timeline progress remap. 0 = linear, 1 = maximal
// fast-slow-fast (but the curve stops being monotonic at exactly 1).
export const EASE_AMPLITUDE = 0.5;

// Remap the timeline's linear progress: fast at both ends, gliding in the
// middle. macOS starts the shrink immediately and gives a quick final suck;
// sine (the previous progress_mode) is slow at BOTH ends instead.
//
// t + a*sin(2*pi*t)/(2*pi) has slope 1 + a*cos(2*pi*t), so it is monotonic
// for a < 1 and passes exactly through (0,0) and (1,1).
export function easeProgress(t, a = EASE_AMPLITUDE) {
    return t + a * Math.sin(2 * Math.PI * t) / (2 * Math.PI);
}

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
// {dockPosition, curvature, absorb, leadFrac, trailFrac, tailFade}.
export function funnelGeometry(win, icon, knobs) {
    // Funnel axis = the dock's own edge, so the window always pours toward the
    // edge the dock is attached to. Deriving it from the window->icon vector
    // instead sends the funnel sideways when a short window sits near a bottom
    // dock, and to the wrong edge entirely for a left/right/top dock.
    // `dockPosition` is optional: without it (standalone use) fall back to the
    // old dominant-direction heuristic.
    let side;
    if (knobs.dockPosition === undefined || knobs.dockPosition === null) {
        const dx = icon.x + icon.width / 2 - (win.x + win.width / 2);
        const dy = icon.y + icon.height / 2 - (win.y + win.height / 2);
        if (Math.abs(dy) >= Math.abs(dx))
            side = dy >= 0 ? Side.BOTTOM : Side.TOP;
        else
            side = dx >= 0 ? Side.RIGHT : Side.LEFT;
    }
    else {
        side = DOCK_POSITION_TO_SIDE[clamp(knobs.dockPosition | 0, 0, 3)];
    }

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

    const iconDepth = Math.max(0, ib1 - ib0);
    const winAxis = Math.abs(wb1 - wb0);
    // Depth over which the taper develops. Taking at least the window's own
    // axial length keeps the belly intact when the window sits close to (or
    // over) its icon; otherwise tau saturates immediately and the whole window
    // is squeezed to icon width for its entire height.
    const funnelDepth = Math.max(1, ib0 - wb0, winAxis);
    // Always sink at least a little into the icon, even at absorb = 0 or with a
    // tiny icon, so the window reads as pouring in rather than vanishing.
    const sink = Math.max(knobs.absorb * iconDepth, Math.min(iconDepth, 6));

    // Sanitize the curvature knob exactly once. c1/c2 (the lateral profile) and
    // the axial bunching in layoutStrips() must agree on the same value, and a
    // standalone caller that omits the knob must not leak NaN: it would run
    // through sideCurve -> lerp -> Math.max(NaN, 0.01) and silently turn every
    // strip transform into NaN.
    const curvature = clamp(Number(knobs.curvature) || 0, 0, 1);

    return {
        side,
        wa0, wa1, wb0, wb1,
        ia0, ia1,
        ib: ib0,
        funnelDepth,
        bEnd: ib0 + sink,
        // Funnel profile (cubic Bézier through 0, c1, c2, 1 — the sideways
        // narrowing factor). Lower c1/c2 keep the funnel WIDE for longer, so
        // the body stays full and rounds off into a plump "belly" before it
        // necks into the icon — the fuller, rounder genie the reference shows.
        // At curvature 1 it converges harder (a tighter gather).
        c1: 0.04 + 0.10 * (1 - curvature),
        c2: lerp(0.55, 0.24, curvature),
        leadFrac: knobs.leadFrac,
        trailFrac: knobs.trailFrac,
        tailFade: knobs.tailFade,
        // The sanitized 0..1 value, shared with c1/c2 above and read by the
        // axial bunching in layoutStrips(). "Tighter gather" should mean both a
        // harder lateral converge AND more material piled at the neck, so one
        // slider drives both.
        curvature,
    };
}

// Composite transform for one strip: fromF · H · pre, written into `scratch`
// (a caller-owned 9-element buffer) and returned. Allocation-free, so the
// per-frame strip loop does not churn the GC.
//
// `b0`/`b1` are the strip's funnel-axis positions and `sLead` is the leading
// edge's progress — both computed once per frame by the caller, since they are
// shared by every strip.
export function stripTransform(g, b0, b1, sLead, pre, scratch) {
    // widthAt(b) inlined for b0 and b1 (no per-call arrays).
    let tau = (b0 - g.wb0) / g.funnelDepth;
    tau = tau < 0 ? 0 : tau > 1 ? 1 : tau;
    let c = sideCurve(tau, g.c1, g.c2) * sLead;
    const aL0 = lerp(g.wa0, g.ia0, c);
    const aR0 = lerp(g.wa1, g.ia1, c);

    tau = (b1 - g.wb0) / g.funnelDepth;
    tau = tau < 0 ? 0 : tau > 1 ? 1 : tau;
    c = sideCurve(tau, g.c1, g.c2) * sLead;
    const aL1 = lerp(g.wa0, g.ia0, c);
    const aR1 = lerp(g.wa1, g.ia1, c);

    const w0 = Math.max(aR0 - aL0, 0.01);
    const w1 = Math.max(aR1 - aL1, 0.01);
    const h = w0 / w1 - 1;

    // H (row-major, column-vector convention) has only six non-zero entries:
    //   [ w0, aL1*(1+h) - aL0, aL0 ]
    //   [  0, b1*(1+h) - b0,    b0 ]
    //   [  0, h,                1  ]
    const h01 = aL1 * (1 + h) - aL0;
    const h10 = b1 * (1 + h) - b0;

    // Q = H · pre, expanded so the zero row is skipped entirely.
    for (let col = 0; col < 3; col++) {
        const p0 = pre[col];
        const p1 = pre[3 + col];
        const p2 = pre[6 + col];
        scratch[col] = w0 * p0 + h01 * p1 + aL0 * p2;
        scratch[3 + col] = h10 * p1 + b0 * p2;
        scratch[6 + col] = h * p1 + p2;
    }

    // M = fromF · Q. fromF is always a row permutation with ±1 signs (see
    // FUNNEL_TO_LOCAL), so this is a row swap/scale rather than a full
    // multiply. fromF[0] is 1 for the identity-shaped matrices (BOTTOM/TOP)
    // and 0 for the axis-swapping ones (LEFT/RIGHT).
    const fromF = FUNNEL_TO_LOCAL[g.side];
    if (fromF[0] === 0) {
        // Rows 0 and 1 swap, each carrying its own sign (RIGHT is [+,+],
        // LEFT is [-,+]).
        const s0 = fromF[1];
        const s1 = fromF[3];
        for (let col = 0; col < 3; col++) {
            const r0 = scratch[col];
            const r1 = scratch[3 + col];
            scratch[col] = s0 * r1;
            scratch[3 + col] = s1 * r0;
        }
    }
    else {
        const s = fromF[4];
        if (s !== 1) {
            for (let col = 0; col < 3; col++)
                scratch[3 + col] = s * scratch[3 + col];
        }
    }
    return scratch;
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
