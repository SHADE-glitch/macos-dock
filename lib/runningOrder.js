// © SHADE-glitch — the running-icon order rule for macos-dock@local.
//
// Own code, part of the MIT side of the repo (lib/genie*.js is the GPL side and
// the licence-set guard in test/repo.test.js keeps those two sets exact), so
// this file carries no GPL SPDX header on purpose.
//
// runningOrder.js — the unpinned segment remembers the order its apps were
// first seen in, for the life of the shell process. The window stack is not an
// order: `global.get_window_actors()` answers stacking order, so re-deriving
// the row from it after a lock/suspend shuffle is what moved icons. Three plain
// array rules replace that source — append on first sight, forget on close,
// sort by rank — and test/runningOrder.test.js pins all three under plain Node.

/**
 * Append `appId` to the remembered order unless it is already there.
 *
 * Returns the same array when nothing changes, so a steady-state sync allocates
 * nothing. The input is never mutated.
 *
 * @param {string[]} order remembered ids, oldest first
 * @param {string|null} appId the id that just got an icon
 * @returns {string[]}
 */
export function rememberRunning(order, appId) {
    if (!appId || order.includes(appId))
        return order;
    return [...order, appId];
}

/**
 * Drop `appId` from the remembered order.
 *
 * Called when the app's icon leaves the row: closed is closed, so the next
 * launch appends at the end instead of returning to the old slot. The 200ms
 * fade-out is the only grace — a removal that is cancelled before it completes
 * never reaches this call.
 *
 * @param {string[]} order remembered ids, oldest first
 * @param {string|null} appId
 * @returns {string[]} the same array when the id was not there
 */
export function forgetRunning(order, appId) {
    if (!appId || !order.includes(appId))
        return order;
    return order.filter((id) => id !== appId);
}

/**
 * Sort `items` by the remembered order of `keyOf(item)`.
 *
 * Known ids come first in remembered order; unknown ids keep their input order
 * and land after every known one. That is the whole rule: a re-added app has a
 * remembered slot, and an app the dock has never seen is appended in the order
 * the caller found it. The sort is stable for equal ranks.
 *
 * @template T
 * @param {T[]} items
 * @param {string[]} order remembered ids, oldest first
 * @param {(item: T) => string|null|undefined} keyOf
 * @returns {T[]} a new array; the input is never mutated
 */
export function sortByRunningOrder(items, order, keyOf) {
    const rank = new Map();
    order.forEach((id, i) => rank.set(id, i));
    return items
        .map((item, index) => ({ item, index, rank: rank.get(keyOf(item)) }))
        .sort((a, b) => {
            const ar = a.rank ?? Infinity;
            const br = b.rank ?? Infinity;
            if (ar === br)
                return a.index - b.index;
            return ar - br;
        })
        .map((entry) => entry.item);
}
