// © SHADE-glitch — drag-and-drop slot math for macos-dock@local.
//
// Own code, part of the MIT side of the repo (lib/genie*.js is the GPL side and
// the licence-set guard in test/repo.test.js keeps those two sets exact), so
// this file carries no GPL SPDX header on purpose.
//
// dockDndSlots.js — everything DockDnd has to get right about a row of slots,
// with the actors left outside. Both of the reported drag bugs lived in this
// math (the gap landing past the applications button, and the persisted order
// not matching the gap), and neither is observable without a pointer — so the
// rules are pinned here instead. The algorithm is the shell dash's, which is
// what Ubuntu Dock inherits; the citations are `ui/dash.js` as installed.
//
// Row data reaches these functions as plain projections:
//   slots    — [{start, size}] on the dock's main axis, only the children that
//              can be a slot (see DockDnd._slotChildren)
//   appIds   — the container's children in order, app id or null for anything
//              that is not an icon (separator, Trash, applications button)

/**
 * dash.js:876-901 — the slot under the pointer is a PROPORTIONAL partition of
 * the row, not a search for the nearest icon edge: `floor((coord - origin) * n
 * / extent)`. Equal-width slots make it exact. RTL mirrors it, which is the
 * shell's own handling.
 *
 * @returns {number} an index in [0, n]; callers clamp it to the favorites count
 */
export function slotAt(coord, slots, rtl = false) {
    const n = slots.length;
    if (n === 0)
        return 0;
    const origin = slots[0].start;
    const end = slots[n - 1].start + slots[n - 1].size;
    const extent = end - origin;
    if (extent <= 0)
        return 0;
    // Clamped at both ends before anything else reads it: the pointer can be over
    // the row's padding, and a negative slot is not a slot.
    const pos = Math.min(Math.max(Math.floor((coord - origin) * n / extent), 0), n);
    return rtl ? n - pos : pos;
}

/**
 * dash.js:879-885 — the gap is not part of the partition it is deciding.
 *
 * Opening a gap pushes everything after it right by the space it occupies, so a
 * partition measured through the live row gets a wider extent and divides the
 * same pointer position into a smaller index. The verdict then withdraws the gap
 * it just asked for, the extent shrinks back, and the next motion event asks
 * again: a still pointer hovering in that band alternates between `gap@pos` and
 * `self-slot`, with the neighbour icon sliding out and back every 200ms. The
 * shell cannot do this because it subtracts the placeholder before dividing;
 * doing the same here means answering from the geometry the row returns to when
 * the gap goes away, which is also the geometry the drop writes against.
 *
 * @param children `{start, size, isGap}` on the dock's main axis, in container
 *        order, the gap included and flagged. Non-slot children (separator,
 *        Trash, applications button) are not passed at all.
 * @param spacing the container layout's spacing: a child brings one with it, so
 *        the space the gap occupies is its width plus that, not its width alone.
 * @returns {{start, size}[]} the resting partition, gap removed
 */
export function restingSlots(children, spacing) {
    if (!children.some(c => c.isGap))
        return children.map(({ start, size }) => ({ start, size }));
    const gap = children.find(c => c.isGap);
    const shift = gap.size + spacing;
    return children
        .filter(c => !c.isGap)
        .map(c => ({ start: c.start > gap.start ? c.start - shift : c.start, size: c.size }));
}

/**
 * dash.js:903-904 — a slot past the last favorite is not offerable, because the
 * favorites range is the only order this dock persists.
 */
export function clampToFavoriteSlots(pos, numFavorites) {
    return Math.min(Math.max(pos, 0), numFavorites);
}

/**
 * dash.js:910-913 — offering the item's own neighbourhood is a no-op drop, so
 * the gap is withdrawn instead. `favPos` is the dragged app's index among the
 * favorites, or -1 when it is not a favorite (a running icon, or a drag from the
 * app grid) and has no own position to avoid.
 */
export function isSelfPosition(pos, favPos) {
    return favPos !== -1 && (pos === favPos || pos === favPos + 1);
}

/**
 * The child index the gap goes to for a favorites-space `slot`.
 *
 * Returning the row's end when the slot runs past the last favorite icon is what
 * put the indicator after the applications button while the drop wrote before the
 * separator. The gap must land where the drop lands, so the fallback is the
 * boundary of the favorites, not the end of the row.
 */
export function containerIndexForFavoriteSlot(appIds, favorites, slot) {
    let seen = 0;
    let index = 0;
    let afterLastFavorite = 0;
    for (const appId of appIds) {
        if (appId !== null && favorites.includes(appId)) {
            if (seen >= slot)
                return index;
            seen++;
            afterLastFavorite = index + 1;
        }
        index++;
    }
    return afterLastFavorite;
}

/**
 * dash.js:956-970 — the favorites-space index of the gap, walked out of the real
 * row so the write never has to trust the proportional guess. The dragged app is
 * skipped: it is about to move, and counting it would shift everything after it.
 */
export function favoriteIndexAtGap(appIds, favorites, gapIndex, draggingAppId) {
    if (gapIndex < 0)
        return favorites.length;
    let favPos = 0;
    for (let i = 0; i < gapIndex; i++) {
        const appId = appIds[i];
        if (appId === null || appId === draggingAppId)
            continue;
        if (favorites.includes(appId))
            favPos++;
    }
    return favPos;
}

/**
 * The new `favorite-apps` value for a move, or null when the id is not in the
 * list. Everything else is carried over exactly as it was, including ids the
 * caller has no icon for — which is the point of writing the list rather than
 * letting AppFavorites rebuild it from the apps it happens to resolve.
 */
export function moveInFavoriteList(ids, id, pos) {
    const from = ids.indexOf(id);
    if (from === -1)
        return null;
    const out = ids.slice();
    out.splice(from, 1);
    out.splice(Math.min(pos, out.length), 0, id);
    return out;
}
