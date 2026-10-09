// SPDX-License-Identifier: GPL-2.0-or-later
// © SHADE-glitch — repository-level guards for macos-dock@local.
//
// These tests assert nothing about runtime behaviour. They guard *invariants of
// the repository itself* — the ones where a silent violation costs far more than
// a failing test: a broken `npm test` for everyone, a license regression on a
// public repo, or a personal-data leak into published history.
//
//   npm test          (desktop-free: no gjs, no GNOME, no network)
//
// Each describe names the rule it protects, and every assertion message says
// what a failure MEANS, so a red run is self-explanatory. Runtime facts that
// cannot be observed from outside the shell live in test/live-checks.sh instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every file in the working tree, skipping VCS and install noise. This is a
 * directory walk rather than `git ls-files` on purpose: the guards must also see
 * a brand-new harness script one second before it is committed, because a
 * pre-commit scan is the only moment a leak can still be stopped.
 */
function listFiles() {
    const out = [];
    // `reports` is skipped on purpose (the walk matches basenames, so docs/reports
    // too): it holds local-only phase evidence that is
    // ALLOWED to quote journal lines and window titles precisely because it can
    // never be committed. Scanning it here would make the privacy guard fail on
    // the one directory whose whole job is to hold that data. The guarantee that
    // it stays out of the repository is not asserted here — `static-checks.sh`
    // S8 does that against git itself (ignore rule present, nothing tracked).
    const skip = new Set([".git", "node_modules", ".gitignore", "__pycache__", "reports"]);
    const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(REPO, rel), { withFileTypes: true })) {
            if (skip.has(e.name))
                continue;
            const r = rel ? `${rel}/${e.name}` : e.name;
            if (e.isDirectory())
                walk(r);
            else if (e.isFile())
                out.push(r);
        }
    };
    walk("");
    return out.sort();
}

const FILES = listFiles();
const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");
const line1 = (rel) => read(rel).split("\n", 1)[0];

const GPL_HEADER = "// SPDX-License-Identifier: GPL-2.0-or-later";
const GENIE_LIBS = [
    "lib/genieController.js",
    "lib/genieEngine.js",
    "lib/genieGeometry.js",
];
// The two modules that must stay importable by plain Node. This is the AGENTS.md
// hard rule; breaking it does not fail a feature, it fails *every* test run on
// every machine, including CI-less reviewers who only ever run `npm test`.
const PURE_LIBS = ["lib/genieGeometry.js", "lib/signalManager.js"];

// The only settings keys prefs.js legitimately does not mention: keynav owns
// them (lib/hotkeyNav.js reads and writes them directly, and a prefs row for a
// per-app slot would duplicate a UI that already exists elsewhere).
const EXPECTED_UNBOUND = [
    ...Array.from({ length: 10 }, (_, i) => `keynav-app-${i + 1}`),
    "keynav-stock-backup",
    "keynav-stock-dirty",
];

describe("pure modules stay Node-importable", () => {
    // A GI or resource import here means `npm test` throws for everyone. Tokens
    // are assembled at runtime because this file *is* what these guards scan —
    // writing the URI scheme out in full would make every guard fail on itself.
    const GI = ["gi", "://"].join("");
    const RES = ["resource", "://"].join("");
    for (const rel of PURE_LIBS) {
        it(`${rel} has no GI or resource imports`, () => {
            const src = read(rel);
            assert.ok(!src.includes(GI),
                `${rel} gained a GI import — npm test now fails on every machine`);
            assert.ok(!src.includes(RES),
                `${rel} gained a resource import — npm test now fails on every machine`);
        });
    }
});

describe("genie attribution headers are preserved", () => {
    // Upstream macos-genie is GPL-2.0-or-later and the merge obligation is to
    // keep the copyright notice. A failure here is a LICENSE regression, not a
    // formatting complaint.
    for (const rel of GENIE_LIBS) {
        it(`${rel} carries the SPDX header and both attribution lines`, () => {
            assert.equal(line1(rel), GPL_HEADER,
                `${rel} line 1 must stay the GPL SPDX header`);
            const src = read(rel);
            assert.match(src, /Derived from macos-genie/,
                `${rel} lost its upstream provenance line`);
            assert.match(src, /© Thuong Vo \(SekiroKenjii\)/,
                `${rel} lost the upstream author's copyright line`);
        });
    }

    it("the GPL file set in lib/ equals the set LICENSES.md declares", () => {
        const gpl = FILES.filter(f => f.startsWith("lib/"))
            .filter(f => line1(f) === GPL_HEADER)
            .sort();
        assert.deepEqual(gpl, [...GENIE_LIBS].sort(),
            "a lib/ file changed license header status without LICENSES.md being updated");
        const licenses = read("LICENSES.md");
        for (const rel of GENIE_LIBS)
            assert.ok(licenses.includes(rel),
                `LICENSES.md no longer names ${rel} — legal exposure on a public repo`);
    });

    it("test files carry the same SPDX header as the modules they cover", () => {
        for (const rel of FILES.filter(f => f.startsWith("test/") && f.endsWith(".test.js")))
            assert.equal(line1(rel), GPL_HEADER, `${rel} lost its SPDX header`);
    });
});

describe("dodge debug switch stays off", () => {
    // dodge.js `_dbg`/`hide-trigger` print real window titles and rectangles.
    // Committed `true` publishes nothing by itself, but it makes every future
    // log paste a privacy incident — and this repo is public. Precedent:
    // f93ef54 turned it on for one boot, 5c84880 reverted it.
    it("DODGE_DEBUG is declared exactly once and is false", () => {
        const src = read("lib/dodge.js");
        const decls = src.match(/^const DODGE_DEBUG = .*$/gm) || [];
        assert.equal(decls.length, 1, "expected exactly one DODGE_DEBUG declaration");
        // The trailing comment is part of the line, so match the value, not the
        // whole line: `const DODGE_DEBUG = false; // set true only when …`.
        assert.match(decls[0], /^const DODGE_DEBUG = false;(\s*\/\/.*)?$/,
            "DODGE_DEBUG must stay false in the tree — it logs window titles");
    });
});

describe("settings surface is complete", () => {
    const schemaXml = () => read("schemas/org.gnome.shell.extensions.macosdock.gschema.xml");
    const schemaKeys = () => [...schemaXml().matchAll(/<key\s+name="([^"]+)"/g)].map(m => m[1]);

    it("every schema key except the keynav-owned set appears in prefs.js", () => {
        const prefs = read("prefs.js");
        const unbound = schemaKeys().filter(k => !prefs.includes(`"${k}"`)).sort();
        assert.deepEqual(unbound, [...EXPECTED_UNBOUND].sort(),
            "a new key with no prefs row is a silent feature gap; a row whose key was deleted makes the prefs window throw");
    });

    it("metadata.json matches the schema and declares plain majors", () => {
        const meta = JSON.parse(read("metadata.json"));
        assert.equal(meta.uuid, "macos-dock@local",
            "uuid drift breaks disable/enable, settings lookup and this repo's own tooling");
        const id = schemaXml().match(/<schema[^>]*\spath="([^"]+)"/)[1]
            .replace(/^\/+|\/+$/g, "").replace(/\//g, ".");
        assert.equal(meta["settings-schema"], id,
            "a wrong settings-schema makes getSettings() throw and the extension land in ERROR at login");
        for (const v of meta["shell-version"])
            assert.match(v, /^\d+$/,
                `shell-version entry "${v}" is not a plain major — _isOutOfDate uses startsWith(), so "5" would falsely claim 50-59`);
    });
});

describe("README documents every settings key", () => {
    // The schema is the only complete list of what a user can turn. prefs.js shows
    // a row per key it binds, but a row without documentation is still a feature
    // nobody can discover — so the docs are asserted against the schema, not
    // against the settings window. Keys are matched as `key` in backticks, which is
    // how the reference tables write them.
    const xml = read("schemas/org.gnome.shell.extensions.macosdock.gschema.xml");
    const keys = [...xml.matchAll(/<key\s+name="([^"]+)"/g)].map(m => m[1]);

    it("the schema list is non-empty and unique", () => {
        assert.ok(keys.length >= 40, `only ${keys.length} keys parsed — the regex or the schema moved`);
        assert.equal(new Set(keys).size, keys.length, "a key name appears twice in the schema");
    });

    for (const rel of ["README.md", "README.zh-CN.md"]) {
        it(`${rel} names every schema key`, () => {
            const body = read(rel);
            const missing = keys.filter(k => !body.includes("`" + k + "`"));
            assert.deepEqual(missing, [],
                `${rel} documents no row for: ${missing.join(", ")} — a key a user cannot find is a silent feature gap`);
        });
    }
});

describe("documentation conventions hold", () => {
    // House convention across every fork in this workspace: user-facing docs are
    // a two-file bilingual pair with mirrored section order, English first.
    // Heading LINE numbers are reported, not asserted — they cannot survive
    // prose edits. Section COUNT and order can, and that is the enforceable
    // version of the same rule.
    const pairs = FILES
        .filter(f => f.endsWith(".md") && path.dirname(f) === ".")
        .filter(f => f.endsWith(".zh-CN.md"))
        .map(zh => [zh.replace(/\.zh-CN\.md$/, ".md"), zh]);

    it("every Chinese doc has an English twin with the same section count", () => {
        assert.ok(pairs.length >= 1, "no bilingual pairs found");
        for (const [en, zh] of pairs) {
            assert.ok(FILES.includes(en), `${zh} has no English twin (${en})`);
            const h2 = (f) => (read(f).match(/^## /gm) || []).length;
            assert.equal(h2(en), h2(zh),
                `${en} has ${h2(en)} sections but ${zh} has ${h2(zh)} — keep the pair in step`);
            for (const f of [en, zh])
                assert.match(read(f), /^<p align="right"><a href=/,
                    `${f} must open with the language switcher so the pair stays navigable`);
        }
    });

    it("no tracked markdown uses task checkboxes", () => {
        // All four sibling forks use bullets, tables or prose. Checkboxes in a
        // committed doc read as unfinished work and never get cleaned up.
        for (const f of FILES.filter(x => x.endsWith(".md")))
            assert.ok(!/^\s*- \[[ xX]\]/m.test(read(f)), `${f} contains a task checkbox`);
    });
});

describe("no machine-specific or personal data is committed", () => {
    // This repository is public. The fingerprints are discovered at runtime so
    // the guard adapts to whatever machine runs it, and this file never contains
    // a literal private path that would trip its own patterns.
    const home = os.homedir();
    const host = os.hostname();
    const user = os.userInfo().username;
    // Only addresses that can only ever be a person's. Extension UUIDs look
    // similar (`macos-genie@thuongvo.dev` is one, in README) so a naive email
    // regex would fight legitimate content forever.
    const PERSONAL_MAIL = /@(?:gmail|qq|163|126|outlook|hotmail|foxmail|sina|protonmail|icloud)\.(?:com|cn|me)\b/i;
    const BINARY_EXT = /\.(png|jpg|jpeg|compiled|db|db-wal|po|mo|gresource|zip)$/;

    it("no tracked text file embeds this machine's home path, host or user name", () => {
        const offenders = [];
        for (const rel of FILES.filter(f => !BINARY_EXT.test(f))) {
            let body;
            try {
                body = read(rel);
            } catch (e) {
                continue;
            }
            if (home && body.includes(home))
                offenders.push(`${rel} contains the home path`);
            if (host && body.includes(host))
                offenders.push(`${rel} contains the host name`);
            if (user && new RegExp(`\\b${user}\\b`).test(body))
                offenders.push(`${rel} contains the login name as a standalone word`);
            // Only *resolved* per-run names are fingerprints: a mktemp template
            // (`…-XXXXXX`) and ordinary words (`macosdock`, `display`) are code
            // that belongs in a script, while a token with both an uppercase
            // letter and a digit is what a pasted leftover path or wayland slot
            // looks like. One rule, applied to both. No example is written out
            // here — an example would match the rule it illustrates.
            const randomish = (t) => t.length >= 6 && /[A-Z]/.test(t) && /[0-9]/.test(t);
            const tmps = [...body.matchAll(/\/tmp\/([\w-]{6,})/g)].map(m => m[1]).filter(randomish);
            if (tmps.length)
                offenders.push(`${rel} hardcodes a resolved temp path`);
            const slots = [...body.matchAll(/wayland-([\w-]{6,})/g)].map(m => m[1]).filter(randomish);
            if (slots.length)
                offenders.push(`${rel} names this machine's wayland slot`);
            if (PERSONAL_MAIL.test(body))
                offenders.push(`${rel} contains a personal mail address`);
        }
        assert.deepEqual(offenders, [],
            "personal or per-machine data must not reach a public repo: " + offenders.join("; "));
    });

    it("no log capture or private-title evidence is tracked", () => {
        // hide-trigger lines carry real window titles; a committed journal
        // excerpt is exactly how f93ef54's boot evidence could have leaked.
        const logs = FILES.filter(f => /\.(log|journal|txt|bak|orig|copy)$/.test(f));
        assert.deepEqual(logs, [], "log captures must never be committed");
        // A journal *capture*, not the logger's own source: dodge.js legitimately
        // contains the format string `hide-trigger ::`, while a pasted line always
        // carries a journald prefix or millisecond timestamps next to geometry.
        const journalled = FILES.filter(f => !BINARY_EXT.test(f))
            .filter(f => /gnome-shell\[\d+\]:/.test(read(f))
                || /\d{2}:\d{2}:\d{2}\.\d{3}.*dock=\{/.test(read(f)));
        assert.deepEqual(journalled, [],
            "journal captures must not be tracked — they carry window titles");
    });
});

describe("harness files cannot break npm test", () => {
    // probe-window.js imports GI on purpose. npm test globs test/*.test.js, so
    // the rule is: nothing matching *.test.js may import GI, and the probe may
    // not be renamed into that glob.
    // The tokens are assembled at runtime: this file *is* the thing it scans, so
    // writing a literal here would make every guard below fail on itself.
    const GI = ["gi", "://"].join("");
    const RES = ["resource", "://"].join("");
    it("no *.test.js file imports GI or resource URIs", () => {
        for (const rel of FILES.filter(f => f.endsWith(".test.js"))) {
            const src = read(rel);
            assert.ok(!src.includes(GI), `${rel} imports GI — npm test would need gjs`);
            assert.ok(!src.includes(RES), `${rel} imports a resource URI — npm test would need the shell`);
        }
    });

    it("every GI-bound file under test/ is outside the *.test.js glob", () => {
        for (const rel of FILES.filter(f => f.startsWith("test/"))) {
            const src = read(rel);
            if (!src.includes(GI) && !src.includes(RES))
                continue;
            assert.ok(!rel.endsWith(".test.js"),
                `${rel} imports GI and matches npm test's glob — rename it away from *.test.js`);
        }
    });
});

describe("harness greps stay anchored", () => {
    // A loose `macos-dock` grep once matched 847 lines in a single run, because a
    // clipboard manager had the fork's name inside stored history. So: every line
    // in test/ that greps for the name must carry the [macos-dock-local] anchor,
    // or be explicitly marked ANCHOR-EXCEPTION with a reason. The token makes an
    // intentional loosening a deliberate, reviewable act instead of an accident.
    const shell = FILES.filter(f => f.startsWith("test/") && f.endsWith(".sh"));
    it("every name-matching grep in the harness is anchored or exempted", () => {
        const offenders = [];
        for (const rel of shell) {
            const lines = read(rel).split("\n");
            lines.forEach((ln, i) => {
                if (/^\s*#/.test(ln))
                    return;                       // prose is not a grep
                if (!/\bgrep\b/.test(ln) || !/macos-dock/.test(ln))
                    return;
                // The tag itself, or an exemption declared on this line or the one
                // immediately above it (that is where the reason belongs).
                if (ln.includes("\\[macos-dock-local\\]") || ln.includes("ANCHOR-EXCEPTION")
                    || (i > 0 && lines[i - 1].includes("ANCHOR-EXCEPTION")))
                    return;
                offenders.push(`${rel}:${i + 1}`);
            });
        }
        assert.deepEqual(offenders, [],
            `under-anchored grep at ${offenders.join(", ")} — add the tag or an ANCHOR-EXCEPTION note`);
    });

    it("the two untagged-count helpers are still marked exempt", () => {
        // Guards against someone deleting the tokens and silently turning the
        // privacy-safe counters back into a content-printing grep.
        const body = read("test/common.sh");
        const marks = (body.match(/ANCHOR-EXCEPTION/g) || []).length;
        assert.ok(marks >= 2,
            "common.sh's untagged counters lost their ANCHOR-EXCEPTION markers");
        assert.ok(!/grep[^|]*macos-dock[^"]*"[^"]*\$\{?MESSAGE/.test(body),
            "a helper appears to print untagged message bodies — never do that, titles live there");
    });
});

describe("the no-build-step story holds", () => {
    // The fork's whole testing story is "no gjs, no dependencies, no build".
    // A devDependency would silently make npm test unrunnable offline.
    it("package.json declares no dependencies", () => {
        const pkg = JSON.parse(read("package.json"));
        assert.ok(!pkg.dependencies, "package.json grew dependencies — npm test is no longer offline-safe");
        assert.ok(!pkg.devDependencies, "package.json grew devDependencies — npm test is no longer offline-safe");
        assert.match(pkg.scripts.test, /node --test test\/\*\.test\.js/,
            "npm test must keep running the pure suites with plain Node");
    });

    it("no node_modules or build output is present", () => {
        assert.ok(!fs.existsSync(path.join(REPO, "node_modules")),
            "node_modules exists in the tree — npm test is no longer dependency-free");
        const artifacts = FILES.filter(f => /\.(zip|tar|tar\.xz|out|pyc)$/.test(f));
        assert.deepEqual(artifacts, [], "packaging output must not live in the source tree");
    });
});
