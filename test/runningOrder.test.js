// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — suites for lib/runningOrder.js. Pure Node: no gjs, no shell.
//
// The owner's report: after a lock/suspend the unpinned icons came back in an
// order nobody chose, because the row was re-derived from the window stack.
// These rules are what replaces that source — append on first sight, sort by
// the remembered rank, unknown ids last and stable — plus the settle clock that
// keeps a tray helper's one-frame window out of the row.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { forgetRunning, holdNewId, rememberRunning, sortByRunningOrder } from "../lib/runningOrder.js";

const id = (app) => app.id;
const apps = (...ids) => ids.map((appId) => ({ id: appId }));

describe("rememberRunning", () => {
    it("appends an id it has not seen", () => {
        assert.deepEqual(rememberRunning(["a"], "b"), ["a", "b"]);
    });

    it("keeps the first slot when the id is already known", () => {
        assert.deepEqual(rememberRunning(["a", "b"], "a"), ["a", "b"]);
    });

    it("ignores a missing id", () => {
        assert.deepEqual(rememberRunning(["a"], null), ["a"]);
    });

    it("returns the same array when nothing changes", () => {
        const order = ["a"];
        assert.equal(rememberRunning(order, "a"), order);
    });

    it("does not mutate its input", () => {
        const order = ["a"];
        rememberRunning(order, "b");
        assert.deepEqual(order, ["a"]);
    });
});

describe("forgetRunning", () => {
    it("removes the id and keeps the rest in order", () => {
        assert.deepEqual(forgetRunning(["a", "b", "c"], "b"), ["a", "c"]);
    });

    it("returns the same array when the id is not there", () => {
        const order = ["a"];
        assert.equal(forgetRunning(order, "b"), order);
    });

    it("ignores a missing id", () => {
        const order = ["a"];
        assert.equal(forgetRunning(order, null), order);
    });

    it("does not mutate its input", () => {
        const order = ["a", "b"];
        forgetRunning(order, "a");
        assert.deepEqual(order, ["a", "b"]);
    });
});

describe("sortByRunningOrder", () => {
    it("sorts known ids by their remembered rank", () => {
        assert.deepEqual(sortByRunningOrder(apps("c", "a", "b"), ["b", "c", "a"], id),
            apps("b", "c", "a"));
    });

    it("puts unknown ids after every known rank, in input order", () => {
        assert.deepEqual(sortByRunningOrder(apps("x", "b", "y", "a"), ["a", "b"], id),
            apps("a", "b", "x", "y"));
    });

    it("is the identity when nothing is remembered", () => {
        assert.deepEqual(sortByRunningOrder(apps("c", "a", "b"), [], id), apps("c", "a", "b"));
    });

    it("keeps input order when every rank is unknown", () => {
        assert.deepEqual(sortByRunningOrder(apps("x", "y"), ["a"], id), apps("x", "y"));
    });

    it("does not mutate its input", () => {
        const list = apps("b", "a");
        sortByRunningOrder(list, ["a", "b"], id);
        assert.deepEqual(list, apps("b", "a"));
    });
});

describe("holdNewId", () => {
    it("holds a first sight and records its clock", () => {
        const pending = new Map();
        assert.equal(holdNewId(pending, "a", 1000, 400), true);
        assert.equal(pending.get("a"), 1000);
    });

    it("keeps holding before the settle window ends", () => {
        const pending = new Map([["a", 1000]]);
        assert.equal(holdNewId(pending, "a", 1399, 400), true);
        assert.equal(pending.get("a"), 1000);
    });

    it("releases at the deadline and drops the entry", () => {
        const pending = new Map([["a", 1000]]);
        assert.equal(holdNewId(pending, "a", 1400, 400), false);
        assert.equal(pending.has("a"), false);
    });

    it("starts a new clock when the app is seen again after a release", () => {
        const pending = new Map();
        holdNewId(pending, "a", 1000, 400);
        assert.equal(holdNewId(pending, "a", 1400, 400), false);
        assert.equal(holdNewId(pending, "a", 2000, 400), true);
        assert.equal(pending.get("a"), 2000);
    });

    it("leaves other pending ids alone", () => {
        const pending = new Map([["a", 1000]]);
        holdNewId(pending, "b", 1100, 400);
        assert.deepEqual([...pending.keys()], ["a", "b"]);
        assert.equal(pending.get("a"), 1000);
    });
});
