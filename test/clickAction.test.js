// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — suites for lib/clickAction.js. Pure Node: no gjs, no shell.
//
// The whole point of this rule is that a second click on an already-open icon
// does something visible. It is also the rule the Trash button and the app icons
// must agree on, so the branch table is asserted here rather than once per
// caller: the complete cross-product of (has focus) x (minimized), plus the
// no-window case, plus the toggle property that a click on what its own minimize
// produced is a restore.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyClickAction, clickActionFor, showsPreviewsOnClick } from "../lib/clickAction.js";

const window = ({ focused, minimized }) => ({
    minimized,
    has_focus: () => focused,
});

describe("clickActionFor branch table", () => {
    it("launches when the icon has no window", () => {
        assert.equal(clickActionFor(null), "open-new-window");
        assert.equal(clickActionFor(undefined), "open-new-window");
    });

    it("covers every focus/minimized combination exactly once", () => {
        const table = [
            [true, false, "minimize"],
            [true, true, "restore"],
            [false, false, "activate"],
            [false, true, "restore"],
        ];
        for (const [focused, minimized, expected] of table) {
            assert.equal(clickActionFor(window({ focused, minimized })), expected,
                `has_focus=${focused} minimized=${minimized} must be "${expected}"`);
        }
    });

    it("only minimizes a window that is both focused and visible", () => {
        // The focus half alone must not be enough: a focused window that is
        // somehow also minimized has to come back, not go away again.
        assert.equal(clickActionFor(window({ focused: true, minimized: true })), "restore");
        assert.equal(clickActionFor(window({ focused: false, minimized: false })), "activate");
    });
});

describe("clickActionFor is a toggle", () => {
    it("clicking what its own minimize produced restores it", () => {
        const w = window({ focused: true, minimized: false });
        assert.equal(clickActionFor(w), "minimize");
        // Mutter moves the focus away when a window goes; that state is exactly
        // what the next click sees.
        w.minimized = true;
        Object.assign(w, { has_focus: () => false });
        assert.equal(clickActionFor(w), "restore");
    });

    it("never returns an action outside the four it declares", () => {
        const allowed = new Set(["minimize", "restore", "activate", "open-new-window"]);
        for (const focused of [true, false])
            for (const minimized of [true, false])
                assert.ok(allowed.has(clickActionFor(window({ focused, minimized }))));
    });
});

// The executor is where a wrong order is invisible on the screen and obvious
// here: restore must unminimize BEFORE activating, and only the windowless case
// may reach the launch callback.
describe("showsPreviewsOnClick", () => {
    it("opens the window list only for a focused app with several windows", () => {
        // Ubuntu's focus-or-previews: the preview is a way of CHOOSING between
        // windows, so it needs both more than one window and an app that already
        // has the focus. Anything else is the plain toggle.
        assert.equal(showsPreviewsOnClick(3, true), true);
        assert.equal(showsPreviewsOnClick(3, false), false);
        assert.equal(showsPreviewsOnClick(1, true), false,
            "one window stays a toggle — that is what this dock has always done, and the owner kept it");
        assert.equal(showsPreviewsOnClick(0, false), false);
    });

    it("counts two windows as several", () => {
        assert.equal(showsPreviewsOnClick(2, true), true);
    });
});

describe("applyClickAction", () => {
    const spy = ({ focused, minimized }) => {
        const calls = [];
        return {
            calls,
            metaWindow: {
                minimized,
                has_focus: () => focused,
                minimize: () => calls.push("minimize"),
                unminimize: () => calls.push("unminimize"),
                activate: (time) => calls.push(`activate@${time}`),
            },
        };
    };

    it("minimizes a focused visible window and calls nothing else", () => {
        const { calls, metaWindow } = spy({ focused: true, minimized: false });
        const taken = applyClickAction(metaWindow, 111, () => calls.push("launch"));
        assert.deepEqual(calls, ["minimize"]);
        assert.equal(taken, "minimize", "the journal line depends on what it reports");
    });

    it("unminimizes before activating, with the caller's timestamp", () => {
        const { calls, metaWindow } = spy({ focused: false, minimized: true });
        const taken = applyClickAction(metaWindow, 222, () => calls.push("launch"));
        assert.deepEqual(calls, ["unminimize", "activate@222"]);
        assert.equal(taken, "restore");
    });

    it("activates a visible window it does not focus", () => {
        const { calls, metaWindow } = spy({ focused: false, minimized: false });
        const taken = applyClickAction(metaWindow, 333, () => calls.push("launch"));
        assert.deepEqual(calls, ["activate@333"]);
        assert.equal(taken, "activate");
    });

    it("launches when the icon picked no window", () => {
        const calls = [];
        const taken = applyClickAction(null, 444, () => calls.push("launch"));
        assert.deepEqual(calls, ["launch"]);
        assert.equal(taken, "open-new-window");
        // The three cases above each end with a deepEqual that has no "launch"
        // in it, which is what pins "only" — a window must never be launched.
    });
});
