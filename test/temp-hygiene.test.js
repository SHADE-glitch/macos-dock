// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — the harness's own temp hygiene, asserted offline.
//
// Tier 3 writes real shell log lines into a journal cache in /tmp. Two defects
// were found by counting what runs left behind (83 accumulated files, one nine
// days old, all mode 0664): the harness created its temp files under the default
// umask, and `common.sh` reset JOURNAL_CACHE to "" on source, which clobbered the
// path the runner pins inside the evidence directory it reaps on exit — so a load
// that happened inside a command substitution was orphaned. Both are one-liners
// whose regression is invisible to every other check, hence asserted here.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const bash = (script, env = {}) =>
    execFileSync("bash", ["-c", script], {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, ...env },
    }).trim();

describe("harness temp hygiene", () => {
    it("narrows the umask so nothing the harness writes is group- or world-readable", () => {
        assert.equal(bash("source test/common.sh; umask"), "0077");
    });

    it("leaves the journal cache owner-only after the write-and-move it actually does", () => {
        // `mktemp` makes a 0600 file no matter what, so that half proves nothing.
        // The exposure came from the redirect: `> "$JOURNAL_CACHE.part"` obeys the
        // umask (0002 here, so 0664), and `mv -f` carries that mode onto the cache
        // the next refresh replaces. This mirrors journal_load step for step.
        const mode = bash(`source test/common.sh
            JOURNAL_CACHE=$(mktemp "\${TMPDIR:-/tmp}/hygiene-probe-XXXXXX")
            printf '1\\tx\\n' > "$JOURNAL_CACHE.part"
            mv -f "$JOURNAL_CACHE.part" "$JOURNAL_CACHE"
            stat -c %a "$JOURNAL_CACHE"; /bin/rm -f "$JOURNAL_CACHE"`);
        assert.equal(mode, "600");
    });

    it("honours a JOURNAL_CACHE handed down by the runner instead of blanking it", () => {
        // This is the leak: the blank made every tier process pick its own path,
        // and the ones chosen inside a subshell were invisible to the cleanup.
        const out = bash("source test/common.sh; echo \"${JOURNAL_CACHE:-<empty>}\"",
            { JOURNAL_CACHE: "/tmp/pinned-by-runner.tsv" });
        assert.equal(out, "/tmp/pinned-by-runner.tsv");
    });

    it("still starts empty when nothing pinned it, so journal_load can supply a default", () => {
        const out = bash("source test/common.sh; echo \"${JOURNAL_CACHE:-<empty>}\"",
            { JOURNAL_CACHE: "" });
        assert.equal(out, "<empty>");
    });
});
