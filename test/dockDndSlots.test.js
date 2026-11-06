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
    clampToFavoriteSlots,
    containerIndexForFavoriteSlot,
    favoriteIndexAtGap,
    isSelfPosition,
    moveInFavoriteList,
    restingSlots,
    slotAt,
} from "../lib/dockDndSlots.js";

// Sixty-pixel slots starting at x=10, which is how a dock row with padding reads.
const ROW = Array.from({ length: 6 }, (_, i) => ({ start: 10 + i * 60, size: 60 }));
const slots = (n) => ROW.slice(0, n);

describe("slotAt", () => {
    it("is empty-row safe", () => {
        assert.equal(slotAt(500, []), 0);
        assert.equal(slotAt(500, [{ start: 0, size: 0 }]), 0);
    });

    it("splits the row proportionally, anchored at the first slot", () => {
        assert.equal(slotAt(10, slots(6)), 0, "the left edge is slot 0");
        assert.equal(slotAt(69, slots(6)), 0, "still inside the first slot");
        assert.equal(slotAt(70, slots(6)), 1, "the first boundary");
        assert.equal(slotAt(370, slots(6)), 6, "the far edge is one past the last slot");
    });

    it("ignores anything before the row", () => {
        // Coordinates left of the row are the padding, and the pointer can be
        // there while still dragging over the dock's background.
        assert.equal(slotAt(-500, slots(6)), 0);
    });

    it("mirrors the row for RTL", () => {
        assert.equal(slotAt(70, slots(6)), 1);
        assert.equal(slotAt(70, slots(6), true), 5, "6 slots - 1");
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

    it("answers the same slot with the gap open as with it closed", () => {
        // This is the whole bug: measured on the live row, an undivided
        // `slotAt` over the shifted geometry moved its own answer at 6 of the
        // 18 sample points below, which is what made a still pointer flicker the
        // gap between "here" and "that is your own slot".
        const resting = restingSlots(WITH_GAP, SPACING);
        for (let x = REST[0].start; x < 466; x += 2) {
            assert.equal(slotAt(x, resting), slotAt(x, REST),
                `x=${x} must not depend on whether the gap is on screen`);
        }
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
