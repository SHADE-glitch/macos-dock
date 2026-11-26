// © SHADE-glitch — the running-icon order rule for macos-dock@local.
//
// Own code, part of the MIT side of the repo (lib/genie*.js is the GPL side and
// the licence-set guard in test/repo.test.js keeps those two sets exact), so
// this file carries no GPL SPDX header on purpose.
//
// runningOrder.js — the unpinned segment remembers the order its apps were
// first seen in, for the life of the shell process. The window stack is not an
// order: `global.get_window_actors()` answers stacking order, so re-deriving
// the row from it after a lock/suspend shuffle is what moved icons. Four plain
// rules replace that source — append on first sight, forget on close, sort by
// rank, hold a first sight for a settle window — and test/runningOrder.test.js
// pins them under plain Node.

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

/**
 * The settle rule for a newly seen running app: should its tile be held back?
 *
 * First sight records `nowMs` and answers true. The answer stays true until
 * `settleMs` has passed, then the id leaves the map and the caller may build
 * the tile. An id that stops running is dropped by the caller, which is what
 * makes a window that maps for a moment (a tray helper during lock/unlock)
 * leave no trace at all instead of flashing into the row.
 *
 * Mutates `pending` in place — it is the caller's per-instance map, and the
 * hot path must not allocate a copy per running app.
 *
 * @param {Map<string, number>} pending id -> monotonic ms of first sight
 * @param {string} appId
 * @param {number} nowMs monotonic ms
 * @param {number} settleMs
 * @returns {boolean} true while the tile should not be built yet
 */
export function holdNewId(pending, appId, nowMs, settleMs) {
    const first = pending.get(appId);
    if (first === undefined) {
        pending.set(appId, nowMs);
        return true;
    }
    if (nowMs - first < settleMs)
        return true;
    pending.delete(appId);
    return false;
}
