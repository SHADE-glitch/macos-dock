// © SHADE-glitch — the dock icon click rule for macos-dock@local.
//
// Own code, part of the MIT side of the repo (lib/genie*.js is the GPL side and
// the licence-set guard in test/repo.test.js keeps those two sets exact), so
// this file carries no GPL SPDX header on purpose.
//
// clickAction.js — one rule, both callers. The Trash button and the app icons
// have to answer a click the same way, and that is the only reason this is a
// module: a policy that is copied is a policy that drifts. The shell clock and
// the launch arrive as arguments, so nothing here needs a shell — every branch
// is pinned by test/clickAction.test.js under plain Node.

/**
 * What a left-click on a dock icon does, given the window that icon picked.
 *
 * `null` means no window: the click launches one. A focused and visible window
 * is minimized, which is what makes a second click on an already-open app read
 * as a toggle instead of doing nothing at all.
 *
 * @param {object|null} metaWindow a Meta.Window, or the window the icon has
 * @returns {"minimize" | "restore" | "activate" | "open-new-window"}
 */
export function clickActionFor(metaWindow) {
    if (!metaWindow)
        return "open-new-window";
    if (metaWindow.has_focus() && !metaWindow.minimized)
        return "minimize";
    if (metaWindow.minimized)
        return "restore";
    return "activate";
}

/**
 * Ubuntu Dock's `focus-or-previews` rule, its default click action: a click on an
 * app that already has the focus AND has more than one window opens the window
 * list instead of acting on one window (appIcons.js:618-628). One window stays a
 * toggle, because that is what this dock has always done with it.
 *
 * @param {number} windowCount how many windows the icon owns
 * @param {boolean} focused whether one of them has the focus
 */
export function showsPreviewsOnClick(windowCount, focused) {
    return windowCount > 1 && focused;
}

/**
 * Carries out the decision above. `time` and `openNewWindow` are arguments
 * because the shell clock and the launch are not this module's business —
 * injecting them is what keeps the branch table importable by plain Node.
 *
 * @param {object|null} metaWindow the window the icon picked, or null
 * @param {number} time a shell timestamp for the activate calls
 * @param {Function} openNewWindow launches another window when there is none
 * @returns {string} the action that was taken, for the caller's logging
 */
export function applyClickAction(metaWindow, time, openNewWindow) {
    const action = clickActionFor(metaWindow);
    switch (action) {
        case "minimize":
            metaWindow.minimize();
            break;
        case "restore":
            metaWindow.unminimize();
            metaWindow.activate(time);
            break;
        case "activate":
            metaWindow.activate(time);
            break;
        default:
            openNewWindow();
    }
    return action;
}
