// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — tests for signalManager.js, part of macos-dock@local.
//
// SignalManager has no GNOME/GI imports: it only ever calls source.connect /
// source.disconnect, so a plain fake source stands in for a GObject and the
// whole bookkeeping contract can be checked under Node with no gjs:
//
//   npm test
//
// The contract these tests pin down (from the module's own comments):
//   - connect() returns the id the source handed back, and records it;
//   - disconnect(source) removes *only* that source's records;
//   - disconnectAll() clears everything, survives a dead source, and is
//     idempotent so disable() can call it without guarding.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SignalManager } from "../lib/signalManager.js";

/**
 * Minimal stand-in for a GObject signal source. Hands out auto-incrementing
 * ids and records every connect/disconnect so a test can assert exactly which
 * signal ids were torn down. `throwOnDisconnect` mimics a source that has
 * already been destroyed by the time we try to disconnect it.
 */
function fakeSource({ throwOnDisconnect = false } = {}) {
    const calls = { connect: [], disconnect: [] };
    let nextId = 1;
    return {
        calls,
        connect(signal, callback) {
            const id = nextId++;
            calls.connect.push({ signal, callback, id });
            return id;
        },
        disconnect(id) {
            calls.disconnect.push(id);
            if (throwOnDisconnect)
                throw new Error("Object has been already destroyed");
        },
    };
}

const noop = () => {};

describe("SignalManager.connect", () => {
    it("returns the id from source.connect and records the connection", () => {
        const mgr = new SignalManager();
        const src = fakeSource();

        const id = mgr.connect(src, "clicked", noop);

        assert.equal(id, 1, "should return the id the source handed back");
        assert.equal(src.calls.connect.length, 1);
        assert.equal(src.calls.connect[0].signal, "clicked");
        assert.equal(src.calls.connect[0].callback, noop);
    });

    it("records one entry per connect on the same source", () => {
        const mgr = new SignalManager();
        const src = fakeSource();

        mgr.connect(src, "clicked", noop);
        mgr.connect(src, "destroy", noop);

        assert.equal(src.calls.connect.length, 2);
        assert.deepEqual(
            src.calls.connect.map((c) => c.signal),
            ["clicked", "destroy"]
        );

        // Both ids must be torn down, not just the last one.
        mgr.disconnectAll();
        assert.deepEqual(src.calls.disconnect, [1, 2]);
    });
});

describe("SignalManager.disconnect", () => {
    it("disconnects only the given source's records", () => {
        const mgr = new SignalManager();
        const srcA = fakeSource();
        const srcB = fakeSource();

        mgr.connect(srcA, "clicked", noop); // srcA id 1
        mgr.connect(srcB, "clicked", noop); // srcB id 1
        mgr.connect(srcA, "destroy", noop); // srcA id 2

        mgr.disconnect(srcA);

        assert.deepEqual(
            srcA.calls.disconnect.slice().sort((a, b) => a - b),
            [1, 2],
            "every srcA connection should be disconnected"
        );
        assert.deepEqual(
            srcB.calls.disconnect,
            [],
            "srcB must be untouched"
        );
    });

    it("drops the records so disconnectAll does not re-disconnect them", () => {
        const mgr = new SignalManager();
        const srcA = fakeSource();
        const srcB = fakeSource();

        mgr.connect(srcA, "clicked", noop);
        mgr.connect(srcB, "clicked", noop);
        mgr.disconnect(srcA);

        mgr.disconnectAll();

        assert.deepEqual(srcA.calls.disconnect, [1], "srcA torn down once");
        assert.deepEqual(srcB.calls.disconnect, [1]);
    });

    it("is a no-op for a source with no recorded connections", () => {
        const mgr = new SignalManager();
        const src = fakeSource();

        assert.doesNotThrow(() => mgr.disconnect(src));
        assert.deepEqual(src.calls.disconnect, []);
    });
});

describe("SignalManager.disconnectAll", () => {
    it("disconnects every recorded connection and clears the table", () => {
        const mgr = new SignalManager();
        const srcA = fakeSource();
        const srcB = fakeSource();

        mgr.connect(srcA, "clicked", noop);
        mgr.connect(srcB, "clicked", noop);
        mgr.connect(srcB, "destroy", noop);

        mgr.disconnectAll();

        assert.deepEqual(srcA.calls.disconnect, [1]);
        assert.deepEqual(srcB.calls.disconnect, [1, 2]);
    });

    it("is idempotent — a second call touches nothing", () => {
        const mgr = new SignalManager();
        const src = fakeSource();
        mgr.connect(src, "clicked", noop);

        mgr.disconnectAll();
        mgr.disconnectAll();

        assert.deepEqual(src.calls.disconnect, [1], "no duplicate disconnects");
    });

    it("keeps cleaning after a source throws (dead object cannot abort disable)", () => {
        const mgr = new SignalManager();
        const dead = fakeSource({ throwOnDisconnect: true });
        const alive = fakeSource();

        mgr.connect(dead, "clicked", noop);
        mgr.connect(alive, "clicked", noop);

        assert.doesNotThrow(() => mgr.disconnectAll());
        assert.deepEqual(dead.calls.disconnect, [1], "it still tried");
        assert.deepEqual(
            alive.calls.disconnect,
            [1],
            "the healthy source must still be disconnected"
        );
    });

    it("leaves the manager reusable afterwards", () => {
        const mgr = new SignalManager();
        const src = fakeSource();

        mgr.connect(src, "clicked", noop);
        mgr.disconnectAll();

        const id = mgr.connect(src, "clicked", noop);
        mgr.disconnectAll();

        assert.equal(id, 2, "source keeps issuing fresh ids");
        assert.deepEqual(
            src.calls.disconnect,
            [1, 2],
            "the second batch is tracked independently"
        );
    });
});
