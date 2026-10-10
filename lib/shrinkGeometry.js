// © SHADE-glitch — shrink mode geometry for macos-dock@local.
//
// Own code, part of the MIT side of the repo (lib/genie*.js is the GPL side and
// the licence-set guard in test/repo.test.js keeps those two sets exact), so
// this file carries no GPL SPDX header on purpose.
//
// Pure functions and constants only: no GObject-introspection module and no
// shell resource import, so Node can read this file and CI can unit-test it on
// any machine — the same rule that keeps genieGeometry.js importable (and the
// reason this comment describes those schemes instead of writing them out: the
// guard is a plain substring test, and naming them here would fail it). All the
// Clutter work lives in genieEngine.js.
//
// What "shrink" is: the REAL window actor scales uniformly about its own centre
// while its centre travels to the dock icon, under a gravity curve (slow start,
// fast finish). No snapshots, no strips, no clones — that is what makes it the
// cheapest path in the repo, and it is deliberately not the funnel.

// Fraction of the *shaped* progress at which the window is fully inside the
// icon box; the remainder collapses the scale to nothing inside that box.
// Exported because the engine's hard rule — every frame with p < 1 must paint a
// visible actor — is defined against it, and a test must be able to say so.
export const VANISH_AT = 0.88;

// Gravity: q = p ** (1 + 1.5 * g). Endpoints are pinned by construction
// (0**k = 0, 1**k = 1), the function is monotonic for any g >= 0 because the
// exponent is >= 1, and g = 0 degenerates to the identity — which is what makes
// the knob worth having: 0 is "no gravity", not "a different curve".
//
// p is clamped because a caller handing back a timeline progress outside 0..1
// (a stalled frame, a rounding nudge) must not produce a negative base with a
// fractional exponent, which would be NaN and would silently freeze the actor.
export function gravityProgress(p, g = 0) {
    const x = p < 0 ? 0 : p > 1 ? 1 : p;
    const e = 1 + 1.5 * (g > 0 ? g : 0);
    return e === 1 ? x : x ** e;
}

// Uniform scale that inscribes the window into the icon box. One scalar for both
// axes is the whole point: aspect ratio cannot drift, so the window never looks
// squashed on the way in.
export function shrinkEndScale(win, icon) {
    return Math.min(icon.width / win.width, icon.height / win.height);
}

// Per-frame state for the real actor. Writes into `out` (a caller-owned object)
// so the animation loop allocates nothing: `x`, `y` are the actor POSITION to
// write, `scale` the uniform scale. The actor must be set up with pivot (0.5,
// 0.5): scaling about the centre leaves the centre invariant, which is exactly
// why position and scale can be interpolated independently here.
//
// opts: {gravity, reverse}. `reverse` is a TIME mirror, not a spatial one — the
// restore path plays the same shapes backwards, which is what keeps the two
// directions exact mirrors of each other (a property the tests assert).
export function shrinkFrame(win, icon, p, opts = {}, out = {}) {
    const g = opts.gravity === undefined ? 0.6 : opts.gravity;
    const q = opts.reverse ? 1 - gravityProgress(p, g) : gravityProgress(p, g);
    const sEnd = shrinkEndScale(win, icon);

    // Two segments on the SAME shaped progress q: gather (1 -> sEnd, centre ->
    // icon centre), then collapse inside the icon (sEnd -> 0). Splitting on q
    // rather than on p is what makes the collapse survive the gravity curve —
    // with the fast tail, most of wall-clock time is spent in the gather.
    //
    // `t` is the gather interpolant and it SATURATES at 1: the centre reaches the
    // icon and stays there while the scale keeps falling to nothing. Reusing the
    // second segment's own 0..1 ramp for the position (which the first version of
    // this function did) sends the actor back toward the window's old centre the
    // frame it crosses VANISH_AT — a teleport, caught by the monotonicity test.
    const t = q <= VANISH_AT ? q / VANISH_AT : 1;
    const scale = q <= VANISH_AT
        ? 1 + (sEnd - 1) * t
        : sEnd * (1 - (q - VANISH_AT) / (1 - VANISH_AT));

    const wc = { x: win.x + win.width / 2, y: win.y + win.height / 2 };
    const ic = { x: icon.x + icon.width / 2, y: icon.y + icon.height / 2 };
    const cx = wc.x + (ic.x - wc.x) * t;
    const cy = wc.y + (ic.y - wc.y) * t;

    out.scale = scale;
    out.x = cx - win.width / 2;
    out.y = cy - win.height / 2;
    return out;
}

// Project an icon rect onto the dock's screen edge — shrink's answer to a dock
// that dodge is hiding and that must NOT be peeked (shrink-peek-hidden-dock off).
// The icon's position ALONG the edge is kept; the coordinate across it becomes
// the edge line, so a bottom dock keeps the horizontal spot and a left dock
// keeps the vertical one. Same idea as the funnel's `_dockEdgeAt`, but preserving
// the icon's real size, because shrink needs a real box to inscribe into.
//
// `dockPosition` is DockManager.POSITIONS (0 bottom, 1 left, 2 right, 3 top) —
// NOT genieGeometry's `Side`, whose enum is in a different order. The table here
// is explicit for the same reason DOCK_POSITION_TO_SIDE is.
export function shrinkTargetRect(icon, dockPosition, monitor) {
    const cx = icon.x + icon.width / 2;
    const cy = icon.y + icon.height / 2;
    let x = cx;
    let y = cy;
    switch (dockPosition) {
    case 1: x = monitor.x; break;                    // LEFT
    case 2: x = monitor.x + monitor.width; break;    // RIGHT
    case 3: y = monitor.y; break;                    // TOP
    default: y = monitor.y + monitor.height; break;  // BOTTOM
    }
    return {
        x: x - icon.width / 2,
        y: y - icon.height / 2,
        width: icon.width,
        height: icon.height,
    };
}
