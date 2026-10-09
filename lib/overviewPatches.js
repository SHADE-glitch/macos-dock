import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { applyOverviewLayout } from "./overviewLayout.js";

/**
 * Overview layout patches (D-054 + D-057) — a SHELL-layout concern, not a dock.
 *
 * These two fixes change how the shell lays out its own overview:
 *   - inset (D-057, lib/overviewLayout.js): pull the window previews inside the
 *     desktop background's rect instead of the whole window-picker box.
 *   - band  (D-054): the overview reserves its bottom band from the stock dash's
 *     preferred height. Hiding the stock dash empties it, so that height
 *     collapses and a taller dock overlaps the window picker / app grid. We
 *     shadow the hidden dash's `get_preferred_height` to report the dock's
 *     occupied height instead.
 *
 * Neither is a dock's job; they live here, behind one `overview-patches-enabled`
 * toggle, so the whole concern can be switched off while the dock keeps running.
 * The band needs the dock's height, but this module never imports DockManager:
 * the caller injects a `getBandMetrics()` provider (the only coupling point).
 *
 * Degrade-safe: every shell symbol is probed; a miss warns once and falls back
 * to the native layout. It never throws into the shell.
 */

const TAG = "[macos-dock-local][overviewpatches]";
const POSITION_BOTTOM = 0; // == dockManager POSITIONS.BOTTOM

/**
 * Shadow the stock dash's preferred height so the overview reserves the dock's
 * occupied height as its bottom band. Returns { revert, applied }.
 */
function _applyBand(getBandMetrics) {
    const noop = () => {};
    const dash = Main.overview?.dash;
    if (!dash || typeof dash.get_preferred_height !== "function") {
        console.warn(`${TAG} band skipped — Main.overview.dash.get_preferred_height unavailable`);
        return { revert: noop, applied: false };
    }
    // Built before the already-applied return below. That branch is reached when
    // a previous revert threw and the caller swallowed it; handing back a noop
    // there would leave the shadow installed for the rest of the session with no
    // way to remove it. This revert is state-free — deleting our own-property
    // exposes the prototype method again — so it is correct whoever set the flag.
    const revert = () => {
        try {
            if (dash._dockBandApplied) {
                delete dash.get_preferred_height; // exposes the prototype method again
                dash._dockBandApplied = false;
            }
        } catch (_e) {}
    };
    if (dash._dockBandApplied)
        return { revert, applied: true };

    const orig = dash.get_preferred_height;
    dash.get_preferred_height = function (forWidth) {
        try {
            const m = getBandMetrics?.();
            if (m && m.position === POSITION_BOTTOM && m.occupiedHeight > 0)
                return [m.occupiedHeight, m.occupiedHeight];
        } catch (_e) {}
        return orig.call(dash, forWidth);
    };
    dash._dockBandApplied = true;

    return { revert, applied: true };
}

/**
 * Apply both overview patches. Returns ONE revert closure (band + inset).
 * opts.getBandMetrics() -> { position, occupiedHeight } supplied by dockManager.
 */
export function applyOverviewPatches(opts = {}) {
    const insetRevert = applyOverviewLayout();
    const band = _applyBand(opts.getBandMetrics);
    console.log(`${TAG} enabled (inset=ok band=${band.applied ? "ok" : "skipped"})`);
    return () => {
        try { band.revert(); } catch (_e) {}
        try { insetRevert(); } catch (_e) {}
    };
}
