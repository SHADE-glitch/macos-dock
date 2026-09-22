import Clutter from "gi://Clutter";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { IconManager } from "./iconManager.js";

/**
 * Non-invasive Show Apps button fix for the companion.
 *
 * User-confirmed behaviour:
 *   - Clicking the Dock's Show Apps button while IN OVERVIEW must ENTER the
 *     all-apps grid (Main.overview.showApps()), NOT hide() back to desktop.
 *   - From the desktop it must also enter the grid.
 *   - Inside the grid, clicking again hides back to desktop (mirror stock).
 *   - Clicking an app icon (separate _onAppClicked wrap in fixManager) exits
 *     the overview. These two paths intentionally differ.
 *
 * Branding (user request):
 *   - icon_name = 'start-here-symbolic' (classic Ubuntu logo)
 *   - CSS color:white in stylesheet.css forces white rendering for
 *     the -symbolic suffix icon; no SVG override needed.
 *   - no tooltip text at all (original showed 'Applications'; we remove it)
 *
 * Root cause the previous captured-event approach never fixed:
 *   IconManager._addAppButton() connects the button's 'button-press-event' to
 *   `overview.visible ? overview.hide() : overview.showApps()`. While in the
 *   overview this hides back to the desktop — the opposite of what we want.
 *   The old stage 'captured-event' interceptor relied on event.get_source()
 *   to identify the button, but in the capture phase get_source() does not
 *   resolve to the appButton actor, so it always missed.
 *
 * Fix strategy (no original file writes): wrap the LIVE IconManager methods
 *   on the instance, exactly like applyAddIconOrder, and patch any already
 *   existing button in place:
 *   - Replace the button's original 'button-press-event' handler (via
 *     im._signals.disconnect(btn)) with our toggle handler.
 *   - Swap the icon to 'start-here-symbolic' (set_icon_name only; the
 *     trailing '-symbolic' suffix makes St re-colour it per theme CSS).
 *   - Removing the original hover handler and NOT re-adding one leaves the
 *     button with no tooltip text.
 * Wrapping methods (not stage events) survives _reload / IconManager
 *   recreation because applyIconFix re-applies the whole patch on a fresh
 *   instance.
 */

const TAG = "[macos-dock-local][appsbtn]";
const BRAND_ICON = IconManager.BRAND_ICON;
const BRAND_LABEL = "Show Apps";

function _inGrid() {
    // Authoritative source: the overview pagination stateAdjustment. The Dash
    // button's `checked` can drift stale (e.g. after dockManager._hideDefaultDash
    // or detaches), so trust the real view state first.
    try {
        const v = Main.overview?._overview?.controls?._stateAdjustment?.value;
        if (typeof v === "number")
            return v === 2;
    } catch (e) { /* ignore */ }
    try {
        const sab = Main.overview?.dash?.showAppsButton ?? null;
        if (sab && typeof sab.checked === "boolean")
            return sab.checked;
    } catch (e) { /* ignore */ }
    return false;
}

function _overviewOpened() {
    try {
        return Main.overview?.visible === true;
    } catch (e) { /* ignore */ }
    return false;
}

// Three-stage toggle, keyed on the "eyes-open" overview state:
//   (1) in grid            -> close overview back to desktop
//   (2) overview open, not grid -> flip the Dash showApps checkbox (notify::
//                                   checked repaginates the already-open view)
//   (3) overview closed    -> Main.overview.showApps() opens it, then pin the
//                                  checkbox so the Grid view is active afterwards.
// Root cause fixed: previously we ONLY flipped the checkbox. From the desktop
// the overview never opened, so the internal pagination moved but the screen
// never showed the grid.
function _toggleHandler(_btn, event) {
    try {
        const evBtn = event.get_button ? event.get_button() : Clutter.BUTTON_PRIMARY;
        if (evBtn !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        const over = _overviewOpened();
        const wasGrid = _inGrid();
        const sab = Main.overview?.dash?.showAppsButton ?? null;
        const before = sab && typeof sab.checked === "boolean" ? sab.checked : null;
        let action = "none";

        // Stage 1: grid open -> close to desktop.
        if (wasGrid) {
            Main.overview.hide();
            action = "close";
        }
        // Stage 3: overview closed -> open the full grid.
        else if (!over) {
            Main.overview.showApps();
            action = "open-grid";
            try { if (sab) sab.checked = true; } catch (e) {}
        }
        // Stage 2: overview open but not grid -> flip pagination into grid.
        else {
            const target = true;
            if (sab && sab.checked !== target) {
                sab.checked = target;
                action = "flip-grid";
            } else {
                Main.overview.showApps();
                action = "fwd-grid";
            }
        }
        console.log(`${TAG} toggle action=${action} over=${over} wasGrid=${wasGrid}` +
            (before === null ? " no-sab" : ` checked ${before}->${sab ? sab.checked : "?"}`));
        return Clutter.EVENT_STOP;
    } catch (e) {
        return Clutter.EVENT_PROPAGATE;
    }
}

/**
 * Patch a live button in place: drop the original press handler, attach our
 * toggle, and set the Ubuntu icon.
 */
function patchLiveButton(im) {
    const btn = im?._appButton;
    if (!btn)
        return;

    // Remove the original 'button-press-event' handler from im._signals so it
    // can never hide() the overview behind our back. disconnect(btn) drops
    // every connection registered against this actor (press + hover) without
    // reaching into SignalManager's internals.
    try {
        im._signals?.disconnect?.(btn);
    } catch (e) { /* ignore */ }

    // Attach our toggle. Guard against double-patching (idempotent).
    if (!btn._dockFixToggleBound) {
        try {
            btn.connect("button-press-event", _toggleHandler);
            btn._dockFixToggleBound = true;
        } catch (e) { /* ignore */ }
    }

    // The disconnect above also removed the original 'notify::hover' that fed
    // _showTooltip('Applications'). Re-connect our own hover handler that
    // mirrors the other app icons exactly (see IconManager._addIcon):
    //   hover=true  -> _showTooltip(actor, text)   ("Show Apps")
    //   hover=false -> _hideTooltip()              (tooltip vanishes on leave)
    // This gives the Show Apps button the same sliding-tooltip behaviour as
    // every running/favourite app icon, positioned above it by the shared
    // _showTooltip. Guard against double-connect.
    if (!btn._dockFixHoverBound && typeof im._showTooltip === "function") {
        try {
            btn._dockFixHoverBound = btn.connect("notify::hover", () => {
                try {
                    if (btn?.hover) {
                        im._showTooltip(btn, BRAND_LABEL);
                    } else if (typeof im._hideTooltip === "function") {
                        im._hideTooltip();
                    }
                } catch (e) { /* tooltip is best-effort */ }
            });
        } catch (e) { /* ignore */ }
    }

    // Brand icon: swap the icon_name only. The '-symbolic' suffix makes St
    // re-colour via CSS; our stylesheet.css sets color:white on this class.
    ensureAppButtonBrand(im);
}

/**
 * Idempotent self-heal: if the live button's icon is not our brand icon,
 * assign it via set_icon_name. Safe to call repeatedly. Returns true if the
 * icon now matches, false if unavailable.
 */
export function ensureAppButtonBrand(im) {
    try {
        const ic = im?._appButtonIcon;
        if (!ic || typeof ic.set_icon_name !== "function") {
            console.log(`${TAG} brand-sweep: no icon (button=${!!im?._appButton})`);
            return false;
        }
        if (ic.icon_name === BRAND_ICON)
            return true; // already brand
        ic.set_icon_name(BRAND_ICON);
        console.log(`${TAG} brand-sweep: re-swapped now=${ic.icon_name}`);
        return true;
    } catch (e) {
        console.warn(`${TAG} brand-sweep failed:`, e);
        return false;
    }
}

/**
 * Apply the whole Show Apps button fix to a live IconManager instance.
 * Returns a revert closure (delete wrapped instance methods).
 */
export function applyAppButtonFix(iconManager) {
    const noop = () => {};
    if (!iconManager)
        return noop;
    // Only patch a given instance once (companion re-applies on recreation).
    if (iconManager._dockFixAppBtnWrapped)
        return noop;

    // Wrap _addAppButton so every freshly built button is fixed too.
    const origAddAppButton = iconManager._addAppButton;
    iconManager._dockFixAppBtnWrapped = true;
    iconManager._addAppButton = function () {
        const r = origAddAppButton.call(this);
        try {
            patchLiveButton(this);
        } catch (e) {
            console.warn(`${TAG} patch failed in _addAppButton:`, e);
        }
        return r;
    };

    // Wrap _showTooltip is intentionally NOT done: we want NO tooltip text.
    // The disconnect loop in patchLiveButton already detaches the original
    // 'notify::hover' -> _showTooltip('Applications') path.

    // Patch the button if it already exists.
    try {
        patchLiveButton(iconManager);
    } catch (e) { /* next _addAppButton will handle it */ }
    // Immediately try the brand heal; if the icon wasn't mounted yet it will
    // be picked up by the periodic sweep (see ensureBrand below).
    try {
        ensureAppButtonBrand(iconManager);
    } catch (e) { /* logging only */ }

    console.log(`${TAG} applied (icon=${BRAND_ICON}, label=none)`);

    // Verify the patch actually landed on the live button and log evidence.
    try {
        const im = iconManager;
        const btn = im?._appButton;
        const ic = im?._appButtonIcon;
        const togglRe = !!(btn && btn._dockFixToggleBound);
        const hoverRe = !!(btn && btn._dockFixHoverBound);
        console.log(`${TAG} verify live iconName=${ic?.icon_name ?? "none"} toggle=${togglRe} hover=${hoverRe}`);
    } catch (e) { /* logging only */ }

    const revert = () => {
        try {
            if (iconManager._dockFixAppBtnWrapped)
                delete iconManager._addAppButton;
        } catch (e) {}
        try {
            iconManager._dockFixAppBtnWrapped = false;
        } catch (e) {}
        // Leave the icon/icon-name and our toggle handler attached; restore by
        // the next full _reload. Full un-patch is out of scope; companion
        // disable() just lets the dock rebuild itself on next reload.
        console.log(`${TAG} wrapped methods reverted`);
    };
    return { revert, ensureBrand: () => ensureAppButtonBrand(iconManager) };
}