// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — suites for lib/dockDndSlots.js. Pure Node: no gjs, no shell.
//
// Both drag bugs the owner reported live in this math: the drop indicator showing
// up past the applications button while the write landed before the separator, and
// a persisted order that did not match the gap. Neither is observable without a
// pointer, so the rules are asserted on arrays here. Citations are the installed
// shell's `ui/dash.js` — the algorithm Ubuntu Dock inherits.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    boundaryAt,
    clampToFavoriteSlots,
    containerIndexForFavoriteSlot,
    favoriteIndexAtGap,
    gapSlide,
    isSelfPosition,
    moveInFavoriteList,
    offerGapForBoundary,
    restingSlots,
} from "../lib/dockDndSlots.js";

// Sixty-pixel slots starting at x=10, which is how a dock row with padding reads.
const ROW = Array.from({ length: 6 }, (_, i) => ({ start: 10 + i * 60, size: 60 }));
const slots = (n) => ROW.slice(0, n);
// The measured row: 60px icons with 6px layout spacing, first icon at x=10.
const FOUR = [10, 76, 142, 208].map(start => ({ start, size: 60 }));
// The same four icons laid out right-to-left: list order runs against the pixels.
const FOUR_RTL = [268, 202, 136, 70].map(start => ({ start, size: 60 }));
// One sample per half of an icon, safely away from the line in the middle.
const LEFT = 12, RIGHT = 48;

describe("boundaryAt", () => {
    it("is empty-row safe", () => {
        assert.deepEqual(boundaryAt(500, []), { boundary: 0, cell: 0 });
    });

    it("answers the nearest line, not the icon the pointer is in", () => {
        // The lines are the midpoints of the gaps between icons, so an icon's own
        // pixels split in the middle: its left half means the line before it, its
        // right half the line after it.
        assert.deepEqual(boundaryAt(FOUR[0].start + LEFT, FOUR), { boundary: 0, cell: 0 });
        assert.deepEqual(boundaryAt(FOUR[0].start + RIGHT, FOUR), { boundary: 1, cell: 0 });
        assert.deepEqual(boundaryAt(FOUR[2].start + LEFT, FOUR), { boundary: 2, cell: 2 });
        assert.deepEqual(boundaryAt(FOUR[2].start + RIGHT, FOUR), { boundary: 3, cell: 2 });
        assert.deepEqual(boundaryAt(FOUR[3].start + RIGHT, FOUR), { boundary: 4, cell: 3 });
    });

    it("keeps the middle of an icon on the line before it", () => {
        // Equidistant from both lines; the tie has to land somewhere deterministic,
        // and one line per drag step is what makes a still pointer calm.
        assert.deepEqual(boundaryAt(FOUR[2].start + 30, FOUR), { boundary: 2, cell: 2 });
    });

    it("reads the spacing between two icons as the nearer icon's side", () => {
        // Icon 1 ends at 136 and icon 2 starts at 142, so x=138 sits in that 6px
        // gap: the line there is 139 (boundary 2) and the pointer is left of it,
        // which is icon 1's outer side. Same story on icon 2's right.
        assert.deepEqual(boundaryAt(138, FOUR), { boundary: 2, cell: 1 });
        assert.deepEqual(boundaryAt(203, FOUR), { boundary: 3, cell: 2 });
    });

    it("ignores anything outside the row", () => {
        // Coordinates past the row's edges are the dock's padding, and the pointer
        // can be there while still dragging over the dock's background.
        assert.deepEqual(boundaryAt(-500, FOUR), { boundary: 0, cell: 0 });
        assert.deepEqual(boundaryAt(900, FOUR), { boundary: 4, cell: 3 },
            "the far end is the line after the last icon");
    });

    it("mirrors the halves, not the answer, for RTL", () => {
        // The line between two icons is the same physical place whichever way the
        // row reads; only which pixel side is the icon's outer side flips.
        for (let k = 0; k < 4; k++) {
            const ltr = [boundaryAt(FOUR[k].start + LEFT, FOUR).boundary,
                boundaryAt(FOUR[k].start + RIGHT, FOUR).boundary];
            const rtl = [boundaryAt(FOUR_RTL[k].start + LEFT, FOUR_RTL, true).boundary,
                boundaryAt(FOUR_RTL[k].start + RIGHT, FOUR_RTL, true).boundary];
            assert.deepEqual([rtl[1], rtl[0]], ltr,
                `icon ${k}: RTL pixel-left is its inner side`);
            assert.equal(boundaryAt(FOUR_RTL[k].start + LEFT, FOUR_RTL, true).cell, k);
        }
    });
});

describe("clampToFavoriteSlots", () => {
    it("never offers a slot outside the favourites", () => {
        assert.equal(clampToFavoriteSlots(9, 4), 4);
        assert.equal(clampToFavoriteSlots(3, 4), 3);
        assert.equal(clampToFavoriteSlots(-2, 4), 0, "a negative guess is not a slot");
    });
});

describe("isSelfPosition", () => {
    it("withdraws the gap over the item's own two boundaries", () => {
        assert.equal(isSelfPosition(2, 2), true);
        assert.equal(isSelfPosition(3, 2), true);
        assert.equal(isSelfPosition(1, 2), false);
        assert.equal(isSelfPosition(4, 2), false);
    });

    it("never blocks a source that has no position of its own", () => {
        // A running-but-unpinned icon and a drag from the app grid both arrive
        // with favPos -1: pinning either is always a real change.
        for (const pos of [0, 1, 5])
            assert.equal(isSelfPosition(pos, -1), false);
    });
});

describe("containerIndexForFavoriteSlot", () => {
    // fav1, fav2 | separator | running | trash | show-apps
    const ROW_IDS = ["fav1.desktop", "fav2.desktop", null, "run.desktop", null, null];
    const FAVORITES = ["fav1.desktop", "fav2.desktop"];

    it("puts the gap before the favourite it displaces", () => {
        assert.equal(containerIndexForFavoriteSlot(ROW_IDS, FAVORITES, 0), 0);
        assert.equal(containerIndexForFavoriteSlot(ROW_IDS, FAVORITES, 1), 1);
    });

    it("stops at the favourites boundary when the slot runs past them", () => {
        // The reported bug: this used to return the end of the row, so the gap
        // sat after the applications button while the drop wrote before the
        // separator. Indicator and write must agree.
        assert.equal(containerIndexForFavoriteSlot(ROW_IDS, FAVORITES, 2), 2);
        assert.equal(containerIndexForFavoriteSlot(ROW_IDS, FAVORITES, 5), 2,
            "an over-clamped slot must not walk past the favourites");
    });

    it("skips the running icon when counting the boundary", () => {
        // fav1 | separator | run1, run2 — slot 1 means "after the only favourite".
        const ids = ["fav1.desktop", null, "r1.desktop", "r2.desktop"];
        assert.equal(containerIndexForFavoriteSlot(ids, ["fav1.desktop"], 1), 1);
    });

    it("handles a favourite with no icon in the row", () => {
        // An id AppSystem cannot resolve is still in `favorite-apps`, so the
        // favourites can outnumber the icons on screen. The gap then clamps to the
        // last favourite icon rather than aiming at a child that does not exist.
        const ids = ["a.desktop", null, "b.desktop", "run.desktop"];
        const favorites = ["a.desktop", "b.desktop", "unresolvable.desktop"];
        assert.equal(containerIndexForFavoriteSlot(ids, favorites, 1), 2);
        assert.equal(containerIndexForFavoriteSlot(ids, favorites, 2), 3,
            "a slot with no icon under it lands after the last favourite");
        assert.equal(containerIndexForFavoriteSlot(ids, favorites, 3), 3);
    });
});

describe("favoriteIndexAtGap", () => {
    const ROW_IDS = ["fav1.desktop", "fav2.desktop", null, "run.desktop", null];
    const FAVORITES = ["fav1.desktop", "fav2.desktop"];

    it("counts only the favourites before the gap", () => {
        assert.equal(favoriteIndexAtGap(ROW_IDS, FAVORITES, 0, null), 0);
        assert.equal(favoriteIndexAtGap(ROW_IDS, FAVORITES, 2, null), 2);
        assert.equal(favoriteIndexAtGap(ROW_IDS, FAVORITES, 3, null), 2,
            "the separator and the running icon add nothing");
    });

    it("excludes the app being dragged", () => {
        // Its own icon sits in the row; counting it would shift every position
        // after it by one.
        assert.equal(favoriteIndexAtGap(ROW_IDS, FAVORITES, 2, "fav1.desktop"), 1);
    });

    it("falls back to the end of the favourites when the gap is gone", () => {
        assert.equal(favoriteIndexAtGap(ROW_IDS, FAVORITES, -1, null), FAVORITES.length);
    });
});

describe("moveInFavoriteList", () => {
    const LIST = ["a.desktop", "b.desktop", "c.desktop", "gone.desktop"];

    it("moves forward without disturbing the rest", () => {
        assert.deepEqual(moveInFavoriteList(LIST, "a.desktop", 2),
            ["b.desktop", "c.desktop", "a.desktop", "gone.desktop"]);
    });

    it("moves backward the same way", () => {
        assert.deepEqual(moveInFavoriteList(LIST, "c.desktop", 0),
            ["c.desktop", "a.desktop", "b.desktop", "gone.desktop"]);
    });

    it("carries an id that resolves to nothing over untouched", () => {
        // This is the whole reason for writing the list here: AppFavorites
        // rebuilds it from the apps AppSystem currently resolves, which silently
        // deletes an entry whose .desktop is mid-rename.
        const out = moveInFavoriteList(LIST, "b.desktop", 0);
        assert.ok(out.includes("gone.desktop"), "an unresolvable favourite was dropped");
        assert.equal(out.length, LIST.length);
    });

    it("clamps a position past the end and refuses an id that is not there", () => {
        assert.deepEqual(moveInFavoriteList(LIST, "a.desktop", 99),
            ["b.desktop", "c.desktop", "gone.desktop", "a.desktop"]);
        assert.equal(moveInFavoriteList(LIST, "never.desktop", 1), null);
    });

    it("does not mutate the list it was given", () => {
        const source = [...LIST];
        moveInFavoriteList(source, "a.desktop", 3);
        assert.deepEqual(source, LIST);
    });
});

// The tables below are the ones the tier-2 probe reads off a real row: 60px
// icons, 6px layout spacing, the first icon at x=10 (the container's padding),
// and a gap inserted before the fourth icon. Measured, not imagined.
const SPACING = 6;
const REST = [10, 76, 142, 208, 274, 340].map(start => ({ start, size: 60 }));
const WITH_GAP = [
    { start: 10, size: 60 }, { start: 76, size: 60 }, { start: 142, size: 60 },
    { start: 208, size: 60, isGap: true },
    { start: 274, size: 60 }, { start: 340, size: 60 }, { start: 406, size: 60 },
];

describe("restingSlots", () => {
    it("hands back the row untouched when there is no gap", () => {
        const out = restingSlots(REST.map(s => ({ ...s })), SPACING);
        assert.deepEqual(out, REST);
        assert.notEqual(out[0], REST[0], "a copy, so a caller cannot write through it");
    });

    it("removes the gap and pulls everything behind it back to where it rests", () => {
        assert.deepEqual(restingSlots(WITH_GAP, SPACING), REST,
            "the gap costs its own width plus the spacing a child brings with it");
    });

    it("answers the same boundary with the gap open as with it closed", () => {
        // This is the whole bug: measured on the live row, the partition over the
        // shifted geometry moved its own answer at 6 of the sample points below,
        // which is what made a still pointer flicker the gap between "here" and
        // "that is your own slot".
        const resting = restingSlots(WITH_GAP, SPACING);
        let disagreed = 0;
        for (let x = REST[0].start; x < 466; x += 2) {
            assert.deepEqual(boundaryAt(x, resting), boundaryAt(x, REST),
                `x=${x} must not depend on whether the gap is on screen`);
            if (boundaryAt(x, WITH_GAP).boundary !== boundaryAt(x, REST).boundary)
                disagreed++;
        }
        assert.ok(disagreed > 0,
            "the live row must actually disagree, or this gate proves nothing");
    });

    it("shifts the origin too when the gap is the first child", () => {
        const gapFirst = [
            { start: 10, size: 60, isGap: true },
            { start: 76, size: 60 }, { start: 142, size: 60 },
        ];
        assert.deepEqual(restingSlots(gapFirst, SPACING),
            [{ start: 10, size: 60 }, { start: 76, size: 60 }]);
    });

    it("still subtracts the spacing while a gap is shrinking to nothing", () => {
        // Width 0 does not mean width 0 of layout: the child is still there, so
        // the row is still one spacing longer than the resting one.
        const shrinking = [
            { start: 10, size: 60 }, { start: 76, size: 0, isGap: true },
            { start: 82, size: 60 },
        ];
        assert.deepEqual(restingSlots(shrinking, SPACING),
            [{ start: 10, size: 60 }, { start: 76, size: 60 }]);
    });
});

describe("offerGapForBoundary", () => {
    // The icon being held keeps its own slot until the drop lands -- it is dimmed,
    // not removed -- so the two lines that touch it both name the position it
    // already has. Every other line means what it says. `null` is "draw nothing",
    // and the only place that happens is the held icon's own cell.
    const IDS = ["a.desktop", "b.desktop", "c.desktop", "d.desktop"];
    const WANT = [
        [[null, null], [2, 2], [2, 3], [3, 4]],
        [[0, 0], [null, null], [3, 3], [3, 4]],
        [[0, 1], [1, 1], [null, null], [4, 4]],
        [[0, 1], [1, 2], [2, 2], [null, null]],
    ];
    const offerFor = (p, k, half) => {
        const { boundary, cell } = boundaryAt(FOUR[k].start + (half ? RIGHT : LEFT), FOUR);
        return offerGapForBoundary(boundary, cell, p, IDS.length);
    };
    // What the user sees: the offered line, unless the refusal withdraws it.
    const drawnFor = (p, k, half) => {
        const g = offerFor(p, k, half);
        return isSelfPosition(g, p) ? null : g;
    };
    const writeFor = (p, g) =>
        moveInFavoriteList(IDS, IDS[p], favoriteIndexAtGap(IDS, IDS, g, IDS[p]));

    it("answers the whole table, held position by held position, half by half", () => {
        for (let p = 0; p < 4; p++)
            for (let k = 0; k < 4; k++)
                for (const half of [0, 1])
                    assert.equal(drawnFor(p, k, half), WANT[p][k][half],
                        `held ${IDS[p]}, over ${IDS[k]}, ${half ? "right" : "left"} half`);
    });

    it("is the plain nearest line for a drag that is not the dock's own", () => {
        // An app from the grid occupies no slot in this row, so no line is spent
        // and both neighbours behave like every other icon.
        for (let k = 0; k < 4; k++)
            for (const half of [0, 1])
                assert.equal(offerFor(-1, k, half), k + half,
                    `over ${IDS[k]}, ${half ? "right" : "left"} half`);
    });

    it("gives each neighbour one line, its outer one, for the whole cell", () => {
        for (const p of [1, 2]) {
            for (const half of [0, 1]) {
                assert.equal(drawnFor(p, p - 1, half), p - 1,
                    `held ${IDS[p]}: the whole left neighbour goes to the line before it`);
                assert.equal(drawnFor(p, p + 1, half), Math.min(p + 2, IDS.length),
                    `held ${IDS[p]}: the whole right neighbour goes to the line after it`);
            }
        }
    });

    it("draws nothing on the held icon's own cell, either half", () => {
        for (let p = 0; p < 4; p++)
            for (const half of [0, 1]) {
                const g = offerFor(p, p, half);
                assert.ok(g === p || g === p + 1,
                    `held ${IDS[p]} offers its own slot boundary (${g}), not a gap`);
                assert.equal(drawnFor(p, p, half), null,
                    `held ${IDS[p]}, ${half ? "right" : "left"} half of its own icon`);
            }
    });

    it("clamps a line the favourites cannot reach", () => {
        // 6 cells under 4 favourites (running icons, or a favourite whose
        // .desktop does not resolve): past the favourites is their end, never a
        // slot the write cannot address.
        assert.equal(offerGapForBoundary(6, 5, 2, 4), 4);
        const lastHeld = offerGapForBoundary(6, 5, 3, 4);
        assert.equal(lastHeld, 4, "the last favourite aimed past the end");
        assert.equal(isSelfPosition(lastHeld, 3), true,
            "and that is its own position, so the refusal withdraws it");
    });

    it("writes the swap the pointer asked for, on both sides and further out", () => {
        // b held: its left neighbour, its right neighbour, the far icon.
        assert.deepEqual(writeFor(1, drawnFor(1, 0, 0)), ["b.desktop", "a.desktop", "c.desktop", "d.desktop"]);
        assert.deepEqual(writeFor(1, drawnFor(1, 2, 0)), ["a.desktop", "c.desktop", "b.desktop", "d.desktop"]);
        assert.deepEqual(writeFor(1, drawnFor(1, 2, 1)), ["a.desktop", "c.desktop", "b.desktop", "d.desktop"]);
        assert.deepEqual(writeFor(1, drawnFor(1, 3, 1)), ["a.desktop", "c.desktop", "d.desktop", "b.desktop"]);
        // Inside a far icon the two halves are two different orders -- that is the
        // whole point of aiming at the nearer line instead of the icon.
        assert.deepEqual(writeFor(2, drawnFor(2, 0, 0)), ["c.desktop", "a.desktop", "b.desktop", "d.desktop"]);
        assert.deepEqual(writeFor(2, drawnFor(2, 0, 1)), ["a.desktop", "c.desktop", "b.desktop", "d.desktop"]);
        // d held (the last one): its own cell still writes exactly what it is.
        assert.deepEqual(WANT[3][3], [null, null], "no gap to write from");
    });

    it("keeps the refusal honest: it fires exactly where the order does not change", () => {
        for (let p = 0; p < 4; p++)
            for (let k = 0; k < 4; k++)
                for (const half of [0, 1]) {
                    const g = offerFor(p, k, half);
                    const wrote = JSON.stringify(writeFor(p, g)) !== JSON.stringify(IDS);
                    assert.equal(isSelfPosition(g, p), !wrote,
                        `held ${IDS[p]}, over ${IDS[k]}, ${half ? "right" : "left"} half: line ${g} writes ${wrote ? "a change" : "nothing"}`);
                    assert.equal(wrote, drawnFor(p, k, half) !== null,
                        `and the indicator agrees with the write (${g})`);
                }
    });
});

describe("gapSlide", () => {
    // While a drag is running the gap is a child of the row, and every move of it
    // re-flows the row in one frame: every icon on the crossed side jumps a whole
    // slot. This is the distance each child has to be painted *back* by at that
    // instant, so the jump reads as a slide -- not the distance the layout moved
    // it, which is the opposite sign and is what made the crossed icon pop out of
    // the far side and slide home. The assertion below is not a table of numbers
    // but the property the numbers exist for: after the shift, every surviving
    // child is exactly where it was before the gap moved.
    const S = 6;
    const layout = (widths) => {
        let x = 0;
        return widths.map(w => {
            const at = x;
            x += w + S;
            return at;
        });
    };
    const expectContinuous = (widths, gap, newGap, newWidth) => {
        const before = layout(widths);
        const moved = widths.filter((_, i) => i !== gap);
        moved.splice(newGap, 0, newWidth);
        const after = layout(moved);
        for (let i = 0; i < widths.length; i++) {
            if (i === gap)
                continue;
            const j = i < gap ? i : i - 1;
            const newIndex = j < newGap ? j : j + 1;
            const shift = gapSlide(i, gap, newGap, widths[gap], newWidth, S);
            assert.equal(after[newIndex] + shift, before[i],
                `child ${i}: gap ${gap}->${newGap} (${widths[gap]}->${newWidth}px)`);
        }
    };

    it("keeps every row continuous for every move of a full-size gap", () => {
        const widths = [60, 60, 66, 60, 60, 60];
        for (let g = 0; g < widths.length; g++)
            for (let j = 0; j <= widths.length - 1; j++)
                expectContinuous(widths, g, j, 66);
    });

    it("slides the row when the gap is first inserted at zero width", () => {
        // The gap costs its spacing even at width 0, so the row steps by 6px the
        // moment it appears; that step is part of the same slide.
        const widths = [60, 60, 60, 60];
        const before = layout(widths);
        for (let j = 0; j <= widths.length; j++) {
            const inserted = [...widths];
            inserted.splice(j, 0, 0);
            const after = layout(inserted);
            for (let i = 0; i < widths.length; i++)
                assert.equal(after[i < j ? i : i + 1] + gapSlide(i, null, j, 0, 0, S),
                    before[i], `first open at ${j}, child ${i}`);
        }
    });

    it("covers a half-grown gap being replaced by a full-size one", () => {
        expectContinuous([60, 60, 30, 60, 60], 2, 2, 66);
        expectContinuous([60, 60, 30, 60, 60], 2, 4, 66);
        expectContinuous([60, 60, 30, 60, 60], 2, 0, 66);
    });

    it("does not move the gap actor itself", () => {
        assert.equal(gapSlide(3, 3, 1, 66, 66, S), 0);
        assert.equal(gapSlide(3, 3, 3, 30, 66, S), 0);
    });
});
