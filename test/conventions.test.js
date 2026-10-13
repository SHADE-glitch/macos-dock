// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — dimension-A layout guard for macos-dock@local.
//
// CONVENTIONS.md and STANDARD.md live in a private repository that this repository's
// CI cannot read, so the dimension-A rules they carry are restated here as
// executable assertions. Nothing is fetched; only this tree is inspected, so the
// guard belongs to the offline CI layer and runs unchanged on a bare clone.
//
//   npm test
//
// Checked here:
//   1. the finalized root-file layer is present, and present in the right place
//   2. AGENTS.md names its dimension in one line instead of restating the standard
//   3. the runtime ignore list holds and no runtime state is tracked
//
// Every assertion says what is missing AND where it belongs, so a red run tells the
// next session how to fix itself instead of only that something broke. Repo-specific
// rules (the frozen upstream overlay, INVARIANTS, the database discipline) are NOT
// checked here — they stay in AGENTS.md and MAINTENANCE.md, and test/repo.test.js
// remains their enforcement.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const exists = (rel) => fs.existsSync(path.join(REPO, rel));
const isDir = (rel) => exists(rel) && fs.statSync(path.join(REPO, rel)).isDirectory();
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const git = (...args) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" }).trim();

// STANDARD.md §1, dimension A: the finalized layer. A plugin's manifest is
// package.json, and exactly one manifest may exist.
const ROOT_FILES = [
    "AGENTS.md",
    "README.md",
    "README.zh-CN.md",
    "CHANGELOG.md",
    "MAINTENANCE.md",
    "MAINTENANCE.zh-CN.md",
    "LICENSE",
    ".gitignore",
    "package.json",
];
const ROOT_DIRS = ["docs", ".github/workflows"];
const WORKFLOW = ".github/workflows/ci.yml";

// §7: the runtime ignore list, the minimum every repository carries.
const IGNORE_ENTRIES = [
    ".venv/",
    "venv/",
    "__pycache__/",
    "*.db",
    "*.db-wal",
    "*.db-shm",
    ".pytest_cache/",
    "reports/",
];

// §4: once aligned, AGENTS.md states its dimension in one line and points at the
// right page. These are the section headings of CONVENTIONS.md and STANDARD.md —
// a match means AGENTS.md restated the standard's body instead of referencing it,
// which the layout audit scores as a missing guard.
const STANDARD_HEADINGS = [
    "Repositories governed by this standard",
    "Root files (the finalized layer)",
    "Language policy",
    "Process-draft location",
    "CHANGELOG format",
    "Test entry commands",
    "Runtime ignore list",
    "Conflict rule",
    "Remotes and pushing",
    "The three dimensions",
    "The shared common core",
    "What each dimension requires",
    "Unify the common core",
    "Where a repository points",
];

const trackedRuntime = () =>
    git("ls-files", "-z")
        .split("\0")
        .filter(Boolean)
        .filter((f) =>
            /(^|\/)(__pycache__|\.pytest_cache|\.venv|venv)\//.test(f) ||
            /\.db(-wal|-shm|-journal)?$/.test(f));

describe("dimension-A layout invariants hold", () => {
    it("the finalized root-file layer is present and in the right place", () => {
        const missingFiles = ROOT_FILES.filter((rel) => !exists(rel));
        const missingDirs = ROOT_DIRS.filter((rel) => !isDir(rel));
        const missingWorkflow = !exists(WORKFLOW) ? [WORKFLOW] : [];
        const detail = [
            ...missingFiles.map((f) => `  - ${f}: create this file at the repository root`),
            ...missingDirs.map((d) => `  - ${d}/: create this directory at the repository root`),
            ...missingWorkflow.map((w) => `  - ${w}: name the CI workflow exactly this`),
        ].join("\n");
        assert.equal(detail, "",
            `the dimension-A root layer is incomplete; the repository root is the only correct location:\n${detail}`);

        const manifests = ["package.json", "pyproject.toml"].filter((m) => exists(m));
        assert.deepEqual(manifests, ["package.json"],
            `dimension A of a GNOME Shell extension carries exactly one manifest and it is package.json, but this repository has ${manifests.join(" + ") || "none"}`);

        assert.ok(!exists("AGENTS.zh-CN.md"),
            "AGENTS.zh-CN.md is the bilingual application shape, not this one — AGENTS.md is English-only here because every AGENTS.md outside the language whitelist is English");
    });

    it("AGENTS.md names its dimension in one line instead of restating the standard", () => {
        const agents = read("AGENTS.md");
        assert.match(agents, /^\s*>\s*\*\*Dimension\.\*\*/m,
            "AGENTS.md opens with no one-line dimension pointer. Add a blockquote line naming this repository as dimension A of the machine-wide CONVENTIONS.md, immediately above the existing shared-standard blockquote — name it, do not paste the rules");
        assert.match(agents, /CONVENTIONS\.md/,
            "the dimension pointer must name CONVENTIONS.md (outside this repository), which is where the dimension and its requirements are defined");
        for (const heading of STANDARD_HEADINGS) {
            assert.ok(!agents.includes(heading),
                `AGENTS.md restates the shared standard: "${heading}" is a section heading of CONVENTIONS.md or STANDARD.md. Keep the rule in the standard and leave a pointer here, so the two copies cannot drift`);
        }
    });

    it("the runtime ignore list holds and no runtime state is tracked", () => {
        const rules = read(".gitignore")
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith("#"));
        const missing = IGNORE_ENTRIES.filter((entry) => !rules.includes(entry));
        assert.deepEqual(missing, [],
            `.gitignore lost ${missing.length} machine-wide runtime entr${missing.length === 1 ? "y" : "ies"} (${missing.join(", ")}). Add each as its own uncommented line — a stray virtualenv or database beside the extension would otherwise become committable`);

        assert.deepEqual(trackedRuntime(), [],
            "runtime state is tracked; untrack it with `git rm --cached` and let the ignore rule above take over, otherwise a database or cache directory reaches the public remote");
    });

    it("phase evidence under reports/ stays untracked", () => {
        const tracked = git("ls-files", "--", "reports", "docs/reports");
        assert.equal(tracked, "",
            `reports/ holds PROFILE / AUDIT / PLAN / VERIFY / STATE, which quote live dconf values and the on-disk layout of the plaintext clipboard store. These tracked files would be pushed:\n${tracked}`);
    });
});