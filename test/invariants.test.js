// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — suites for test/invariants.mjs. Pure Node: no gjs, no shell.
//
// These fixtures exist so that every rule 6.x is proved to FIRE, not just to be
// silent on the good table. The real INVARIANTS.md is asserted separately in
// test/repo.test.js; here each case builds a CHANGELOG + table pair that violates
// exactly one rule and checks the problem comes back labelled with that rule.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { changelogEntries, harnessCheckNames, validateInvariants } from "./invariants.mjs";

const CHANGELOG = [
    "# CHANGELOG",
    "",
    "### D-001 · 2026-01-01 · fix · v1",
    "Symptom  the dock popped back out mid-animation on every overview exit",
    "Commit   aaaaaaa",
    "",
    "### D-002 · 2026-01-02 · taste · v1",
    "Symptom  the funnel read as too linear",
    "Commit   bbbbbbb",
    "",
    "### D-003 · 2026-01-03 · perf · v1",
    "Symptom  two geometry reads per icon per frame",
    "Commit   ccccccc",
    "",
].join("\n");

const CHECKS = new Set(["overview-band", "tick-geometry-reads"]);

const table = (...rows) => [
    "# INVARIANTS",
    "",
    "| Id | Rule | Evidence tier | Reverting it costs |",
    "|---|---|---|---|",
    ...rows,
    "",
].join("\n");

const codes = (problems) => problems.map(p => p.split(" ")[0]);

function run(text) {
    return validateInvariants({
        text,
        entries: changelogEntries(CHANGELOG),
        checkNames: CHECKS,
        changelog: CHANGELOG,
    });
}

describe("invariants validator fires on each documented violation", () => {
    it("a well-formed table reports nothing (control group)", () => {
        const good = table(
            "| D-001 | the dock keeps its overview state correction | L2, measured 40 → 0 | the pop-back comes back |",
            "| D-003 | the hover tick reads each icon once | L1 (`tick-geometry-reads`) | double allocation traffic |",
        );
        assert.deepEqual(run(good), [], "the good table must not be flagged");
    });

    it("6.0 an empty table is a failure, not a green", () => {
        const problems = run(table());
        assert.equal(problems.length, 1);
        assert.match(problems[0], /^6\.0/);
    });

    it("6.1 a row with the wrong number of cells is reported", () => {
        const problems = run(table("| D-001 | only three cells | L0 |"));
        assert.deepEqual(codes(problems), ["6.1"], problems.join("\n"));
    });

    it("6.1 an empty cell is reported", () => {
        const problems = run(table("| D-001 | a rule || a cost |"));
        assert.ok(codes(problems).includes("6.1"), problems.join("\n"));
    });

    it("6.1 a placeholder cell is reported", () => {
        const problems = run(table("| D-001 | TODO | L0 | a cost |"));
        assert.ok(codes(problems).includes("6.1"), problems.join("\n"));
    });

    it("6.2 an id with no CHANGELOG entry is reported", () => {
        const problems = run(table("| D-077 | a rule | L0 | a cost |"));
        assert.ok(codes(problems).includes("6.2"), problems.join("\n"));
    });

    it("6.3 ids must strictly increase down the file", () => {
        const problems = run(table(
            "| D-003 | later first | L0 | cost |",
            "| D-001 | then earlier | L0 | cost |",
        ));
        assert.ok(codes(problems).includes("6.3"), problems.join("\n"));
    });

    it("6.3 a duplicated id is reported", () => {
        const problems = run(table(
            "| D-001 | once | L0 | cost |",
            "| D-001 | twice | L0 | cost |",
        ));
        assert.ok(codes(problems).some(p => p.startsWith("6.3")), problems.join("\n"));
    });

    it("6.4 a taste entry cannot be an invariant", () => {
        const problems = run(table("| D-002 | an animation feel preference | L0 | cost |"));
        assert.ok(codes(problems).includes("6.4"), problems.join("\n"));
    });

    it("6.5 an unknown evidence tier is reported", () => {
        const problems = run(table("| D-001 | a rule | L3 | a cost |"));
        assert.ok(codes(problems).includes("6.5"), problems.join("\n"));
    });

    it("6.5 the unattributed L? tier is accepted, because honesty needs a label", () => {
        assert.deepEqual(run(table("| D-001 | a rule | L? — never attributed | a cost |")).filter(p => p.startsWith("6.5")), []);
    });

    it("6.6 a cited check name that the harness no longer reports is caught", () => {
        const problems = run(table("| D-001 | a rule | L1 (`renamed-away-check`) | a cost |"));
        assert.ok(codes(problems).includes("6.6"), problems.join("\n"));
    });

    it("6.6 a half-renamed citation is caught too, not only a fully rewritten one", () => {
        // The realistic drift is a rename that changes case or adds a suffix. A
        // lowercase-only pattern silently skipped `tick-geometry-readX` when this
        // rule was first provoked, which is exactly the green that proved nothing.
        const problems = run(table("| D-003 | a rule | L1 (`tick-geometry-readX`) | a cost |"));
        assert.ok(codes(problems).includes("6.6"), problems.join("\n"));
    });

    it("6.6 words that are not check names are left alone", () => {
        const good = table("| D-001 | a rule | L2, measured via `disable+enable` on `test:live-trigger`, "
            + "reading `Main.overview.visibleTarget` and `lib/dodge.js` | a cost |");
        assert.deepEqual(run(good), []);
    });

    it("6.7 a rule column copied verbatim from CHANGELOG is caught", () => {
        const copied = table("| D-001 | the dock popped back out mid-animation on every overview exit | L0 | cost |");
        assert.ok(codes(run(copied)).includes("6.7"), "verbatim restatement must be flagged");
        // The same words under the limit are fine — it guards copying, not vocabulary.
        const short = table("| D-001 | mid-animation pop-back | L0 | cost |");
        assert.deepEqual(codes(run(short)).filter(c => c === "6.7"), []);
    });

    it("rules hold together on a multi-row table: only the bad row reports", () => {
        const problems = run(table(
            "| D-001 | fine | L0 | cost |",
            "| D-002 | taste row | L0 | cost |",
            "| D-003 | also fine | L1 (`overview-band`) | cost |",
        ));
        assert.deepEqual(problems, [problems[0]], "exactly one problem expected");
        assert.match(problems[0], /^6\.4 D-002/);
    });
});

describe("invariants helpers parse what the repo actually writes", () => {
    it("changelogEntries picks up id, kind and body", () => {
        const entries = changelogEntries(CHANGELOG);
        assert.deepEqual([...entries.keys()], [1, 2, 3]);
        assert.equal(entries.get(2).kind, "taste");
        assert.match(entries.get(3).body, /two geometry reads/);
    });

    it("harnessCheckNames reads names from the report lines, not from prose", () => {
        const script = [
            'report $T overview-band PASS "reserved band"',
            '    report $T tick-geometry-reads FAIL "too many reads"',
            'report $T some-quiet-check ENV "cannot measure here"',
            "# report $T commented-away PASS should not count",
            "report $T no_verdict_here",
        ].join("\n");
        assert.deepEqual([...harnessCheckNames(script)].sort(), ["overview-band", "some-quiet-check", "tick-geometry-reads"]);
    });
});
