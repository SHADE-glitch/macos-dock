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
// rules are pinned here instead. The write side is the shell dash's, which is
// what Ubuntu Dock inherits; reading the pointer off the row is not, and the
// place the two differ is documented on `boundaryAt`. The citations are
// `ui/dash.js` as installed.
//
// Row data reaches these functions as plain projections:
//   slots    — [{start, size}] on the dock's main axis, only the children that
//              can be a slot (see DockDnd._slotChildren), in list order — which is
//              the right-to-left order in an RTL row, not the pixel order
//   appIds   — the container's children in order, app id or null for anything
//              that is not an icon (separator, Trash, applications button)

/**
 * The line the pointer is nearest to, and the icon it belongs to.
 *
 * A drop lands *between* icons, so the row reads as n+1 lines: the outer edge of
 * the first icon, the midpoint of every gap between two icons, the outer edge of
 * the last one.
 * The shell's dash instead divides the row into one cell per icon and answers
 * "before that icon" for the whole cell (dash.js:876-901, the proportional
 * partition `floor((coord - origin) * n / extent)`), which is what makes its
 * indicator feel like it lags the pointer: an icon's right half is nearer the
 * line after it than the line before it, and the hand is asked to ignore that.
 *
 * Which line is nearest does not depend on which way the row reads — the lines
 * are physical places either way — so `rtl` moves only the two outer ones.
 *
 * @param coord the pointer's position on the dock's main axis
 * @param slots the resting row, see {@link restingSlots}
 * @param rtl whether the row reads right-to-left
 * @returns {{boundary: number, cell: number}} the nearest line, 0..n, and the
 *          icon the pointer is on — for a pointer in the space between two
 *          icons, the nearer one
 */
export function boundaryAt(coord, slots, rtl = false) {
    const n = slots.length;
    if (n === 0)
        return { boundary: 0, cell: 0 };
    const first = (i) => slots[i].start;
    const last = (i) => slots[i].start + slots[i].size;
    // The line before icon `i`; i === n is the line after the last one.
    const line = (i) => {
        if (i === 0)
            return rtl ? last(0) : first(0);
        if (i === n)
            return rtl ? first(n - 1) : last(n - 1);
        return (last(i - 1) + first(i)) / 2;
    };
    let boundary = 0, best = Infinity;
    for (let i = 0; i <= n; i++) {
        const d = Math.abs(coord - line(i));
        if (d < best) {
            best = d;
            boundary = i;
        }
    }
    let cell = 0, bestOff = Infinity;
    for (let i = 0; i < n; i++) {
        const a = Math.min(first(i), last(i)), b = Math.max(first(i), last(i));
        const d = coord < a ? a - coord : coord > b ? coord - b : 0;
        if (d < bestOff) {
            bestOff = d;
            cell = i;
        }
    }
    return { boundary, cell };
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
 * How far a child of the row has to be painted back so a gap that just moved
 * appears to slide instead of jumping.
 *
 * A box layout re-flows in one frame: destroying the gap and inserting it at its
 * new index moves every icon between the two places by one slot in a single
 * allocation, and the eye reads that as a jump. Painting the same distance back
 * on each child and easing it to zero turns the re-flow into a slide, without
 * touching the layout itself — `translation` is a transform, so the layout keeps
 * owning `x` and the magnification keeps owning `scale`.
 *
 * Returns the offset to *paint* by, in layout-axis pixels: positive toward the
 * row's end (right in LTR, down in a vertical row); the caller flips the sign
 * for RTL, where the end is the left edge. Note that this is the opposite sign
 * of the distance the layout moved the child — using the layout delta directly
 * makes the crossed icon start a whole extra slot out and slide home, which is
 * exactly the "it appears out of nowhere" the owner reported. `oldGap` is the
 * gap's index in the row as it stood, `newGap` the insertion index in the row
 * with the old gap removed — which is exactly what
 * `containerIndexForFavoriteSlot` returns.
 *
 * @param index the child's index in the row as it stood, gap included
 * @param oldGap the gap's index in that row, or null when it is being created
 * @param newGap where the gap is inserted, in the row without the old gap
 * @param oldWidth the old gap's current width (it may still be growing)
 * @param newWidth the new gap's width
 * @param spacing the container layout's spacing
 */
export function gapSlide(index, oldGap, newGap, oldWidth, newWidth, spacing) {
    if (oldGap === null)
        return index >= newGap ? -(newWidth + spacing) : 0;
    if (index === oldGap)
        return 0;
    if (newGap > oldGap)
        return index > newGap ? -(newWidth - oldWidth)
            : index > oldGap ? oldWidth + spacing : 0;
    if (newGap < oldGap)
        return index < newGap ? 0
            : index < oldGap ? -(newWidth + spacing) : -(newWidth - oldWidth);
    return index > oldGap ? -(newWidth - oldWidth) : 0;
}

/**
 * The line to open the gap on, in favourites space.
 *
 * The icon being held keeps its own slot until the drop lands -- Ubuntu dims it
 * to 50 rather than removing it (D-111) -- so the row the pointer is measured
 * against still counts it, while the order being written will not contain it
 * there. Both lines touching that slot, the one before it and the one after,
 * therefore name the position the item already has. They are spent, and a pointer
 * aimed at either of them gets nothing drawn: `isSelfPosition` withdraws the gap
 * the way dash.js:910 withdraws it.
 *
 * That is what makes the two neighbours unlike every other icon, and it is not a
 * special case: their inner line is one of the spent ones, so a pointer on the
 * side of a neighbour that faces the held icon cannot mean anything, and the
 * whole cell answers that neighbour's *outer* line -- which makes the gesture a
 * swap. Every other cell follows the pointer: left half of an icon inserts before
 * it, right half after it.
 *
 * `cell` and `favPos` are indices in the same space only when the pinned row is
 * the favourites in order, which is the precondition the tier-2 probe pins before
 * reading this table; a row of running icons in front of unpinned favourites is
 * answered by the clamp and by `containerIndexForFavoriteSlot` instead.
 *
 * @param boundary what {@link boundaryAt} found under the pointer
 * @param cell the icon the pointer is on
 * @param favPos the dragged app's index among the favourites, -1 if not one
 * @param numFavorites the favourites count, the last reachable line
 */
export function offerGapForBoundary(boundary, cell, favPos, numFavorites) {
    const b = clampToFavoriteSlots(boundary, numFavorites);
    if (favPos < 0 || (b !== favPos && b !== favPos + 1))
        return b;
    if (cell === favPos)
        return b;
    return cell < favPos ? cell : Math.min(cell + 1, numFavorites);
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
