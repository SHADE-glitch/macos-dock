// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — fixtures for the two overview shapes counted by test/common.sh.
//
// jflicker_count is the verdict-bearing helper, and its rule is subtle: the race
// and a genuine overview entry can sit the same two log lines apart by the same
// number of milliseconds, and what separates them is whether an *entry witness*
// fires between the show and the hide. Subtle rules rot silently unless the
// separation itself is asserted, so every case below is a shape measured from a
// real boot (2026-10-10) next to the shape the D-051 bug produced, and the pair
// helper is asserted too — it is deliberately demoted to context, and a test is
// what keeps it from creeping back into a verdict.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const TAG = "[macos-dock-local]";

/** Run one of the journal helpers over a synthetic cache in `<ms>\t<line>` shape. */
function count(fn, win, lines) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "flicker-fixture-"));
    const cache = path.join(dir, "journal");
    try {
        writeFileSync(cache, lines.map(([ms, text]) => `${ms}\t${TAG} ${text}\n`).join(""));
        return execFileSync("bash", ["-c",
            `source test/common.sh; JOURNAL_CACHE=${JSON.stringify(cache)}; ${fn} ${win}`,
        ], { cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8" }).trim();
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const HIDE = "[dodge] overlap -> hide";
const SHOW = "[dodge] overview -> show";
const CANARY = "[dodge] canary overlay-key (modalCount=1, OVERVIEW_MODAL_BUSY)";

describe("jflicker_count — a show contradicted by an unwitnessed hide", () => {
    it("counts the exit-animation race: hide, stale show, hide, with no press in between", () => {
        // The shape D-051 removed, from the boot that measured 40 of these: the
        // show comes from a tick inside the exit animation, so the very next tick
        // corrects it and the dock hides again — no user event separates the two.
        const n = count("jflicker_count", 600, [
            [1000, "[dodge] started (onlyFocused=true, watching 3 windows)"],
            [2000, CANARY],                       // the press that *closed* the overview
            [2200, HIDE],
            [2400, SHOW],                         // stale read: dock pops out
            [2600, HIDE],                         // corrected: dock goes back — one flicker
            [2800, SHOW],
            [3000, HIDE],                         // and again
        ]);
        assert.equal(n, "2");
    });

    it("does not count a rapid Super toggle, where the next press lands between show and hide", () => {
        // Measured 10:42:09 on a healthy boot: the user hammered Super and every
        // show was followed 2-3 ms later by another overlay-key, 342 ms before the
        // hide. Real entries, real hides — and the old pair rule counted them.
        const n = count("jflicker_count", 600, [
            [5000, HIDE],
            [5003, CANARY],
            [5406, SHOW],
            [5408, CANARY],
            [5742, HIDE],
        ]);
        assert.equal(n, "0");
    });

    it("does not count a real entry through a path with no witness, because nothing contradicts it", () => {
        // Measured 10:40:44: hide, then the overview genuinely started entering
        // 205 ms later (hot corner or gesture, so no overlay-key), and the dock
        // stayed up for 56 s. The pair rule failed the boot on exactly this.
        const n = count("jflicker_count", 600, [
            [9000, HIDE],
            [9205, SHOW],
            [65000, HIDE],
        ]);
        assert.equal(n, "0");
    });

    it("counts a show that really is contradicted inside the window and honours the boundary", () => {
        assert.equal(count("jflicker_count", 600, [[1000, SHOW], [1600, HIDE]]), "1");
        assert.equal(count("jflicker_count", 600, [[1000, SHOW], [1601, HIDE]]), "0");
    });

    it("takes the Show Apps press as an entry witness but not a close", () => {
        assert.equal(count("jflicker_count", 600, [
            [1000, SHOW],
            [1100, "[appsbtn] toggle action=open-grid over=false wasGrid=false checked false->true"],
            [1300, HIDE],
        ]), "0");
        assert.equal(count("jflicker_count", 600, [
            [1000, SHOW],
            [1100, "[appsbtn] toggle action=close over=true wasGrid=true checked true->true"],
            [1300, HIDE],
        ]), "1");
    });

    it("counts a contradiction under any hide reason, and a peek line is not a contradiction", () => {
        assert.equal(count("jflicker_count", 600, [
            [1000, SHOW], [1300, "[dodge] fullscreen -> hide"],
        ]), "1");
        assert.equal(count("jflicker_count", 600, [
            [1000, SHOW], [1300, "[dodge] peek show (edge=0)"],
        ]), "0");
    });

    it("counts nothing over an empty cache — the check must not pass by having no data", () => {
        assert.equal(count("jflicker_count", 600, []), "0");
    });
});

describe("jpair_count — context only, and provably blind", () => {
    it("fires on both the race and a genuine entry, which is why it cannot carry a verdict", () => {
        // Two shapes, opposite meanings, identical count. If someone re-wires the
        // verdict to this helper, the healthy boot fails again — that is D-072.
        const race = count("jpair_count", 300, [
            [2200, HIDE], [2400, SHOW], [2600, HIDE], [2800, SHOW], [3000, HIDE],
        ]);
        const genuine = count("jpair_count", 300, [
            [9000, HIDE], [9205, SHOW], [65000, HIDE],
        ]);
        assert.equal(race, "2");
        assert.equal(genuine, "1");
    });

    it("counts nothing over an empty cache", () => {
        assert.equal(count("jpair_count", 300, []), "0");
    });
});
