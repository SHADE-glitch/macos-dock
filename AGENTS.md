# AGENTS.md

Guidance for agents working inside `macos-dock@local` — a local maintenance
fork of MacOSDock (v9) with the macOS Genie animation merged in.

## Critical Rules
- **NEVER run `gnome-extensions install` or `gnome-extensions pack` from within this repo directory.** The install tool follows symlinks and will wipe the source directory contents.
- **Do not load ESModules via legacy `imports`** (e.g. `imports.ui.main` throws `SyntaxError` in GNOME 45+). Use static `import` or dynamic `await import()`.
- **Do not reassign ESModule exports directly** (e.g. `Main.notify = ...`). Monkeypatch mutable prototypes instead.
- **GJS constraint**: no `fetch`/`URLSearchParams` inside the shell process. Use `Soup.Session` + `GLib.Bytes`.
- **`disable` + `enable` does NOT reimport modules.** A cached ESModule keeps its old code, so a change to a `lib/*.js` file only takes effect after a **log out / log in**. Never claim a reload activated an edit.
- **Keep `genieGeometry.js` and `signalManager.js` free of `gi://` imports.** They are the only pure modules and the only ones testable under plain Node. Any `gi://`/`resource://` import there breaks `npm test`.

## Tests
- **Run `npm test`** (i.e. `node --test test/*.test.js`) after editing a pure module. No gjs, no dependencies, no build step.
- Pure modules and their suites:
  - `lib/genieGeometry.js` → `test/genieGeometry.test.js`
  - `lib/signalManager.js` → `test/signalManager.test.js`
- GI-bound modules (`dockManager`, `dodge`, `genieController`, `genieEngine`, `hotkeyNav`, `iconFix`, `iconManager`, `magnification`, `mediaManager`, `overviewApps`, `windowPreview`) cannot be imported by Node; verify them live in the shell instead.
- When fixing a bug, add a regression test that **fails against the pre-fix code** before making it pass.
- Three tiers of checks exist because the GI-bound modules cannot be imported: `npm run test:static` (offline, also guards licence headers, the `gi://`-free pure modules, repo privacy and schema/prefs key coverage), `test:headless` (private throwaway compositor), `test:live` (reads this boot's journal). `test:live-trigger` runs the pointer-free A/B but **opens probe windows on the user's desktop** — only on an idle session and with approval.
- A live assertion is worthless if the running shell predates the edit: `test/live-checks.sh` gates on that, and so must you.

## Docs & Commits
- **[`MAINTENANCE.md`](MAINTENANCE.md) is the procedure file** (how to verify a change, the per-release playbook, what can never be automated here and why). This file is rules; do not restate procedures here.
- `MAINTENANCE.md` / `MAINTENANCE.zh-CN.md` are a bilingual pair like the READMEs — keep their `##` sections in lockstep (`test/repo.test.js` enforces it).
- `README.md` and `README.zh-CN.md` are a **two-file bilingual pair** — edit both together, keeping section order aligned.
- **Do not touch the `Credits & Attribution` / `Changes vs upstream (v9)` sections** unless the change actually affects attribution or the upstream diff.
- Commit code first, docs in a separate commit.
- Live logs: `journalctl -f -o cat /usr/bin/gnome-shell`

## Recording conventions
- Behaviour changes land in [`CHANGELOG.md`](CHANGELOG.md) as `D-###` entries — kind, evidence
  tier and commit for each. `npm run check:log` proves the record covers every commit in the
  declared window that touched `extension.js`, `lib/` or `stylesheet.css`.
- **`README.md` / `README.zh-CN.md` § Changes vs upstream is not the record and stays untouched**
  (see the rule above): this repo's protected-section rule outranks the cross-repo convention that
  other forks got a pointer paragraph in. Division of labour: README = user-facing summary
  (protected), CHANGELOG = machine-checked per-commit index, MAINTENANCE = how to verify.
- Ids are monotonic and **never reused**; a gap is a failure, not a cleanup. A window with zero
  entries is a failure too — a check over an empty set proves nothing.
- `kind` ∈ `fix` | `perf` | `taste` | `guard` | `revert` | `chore`, cut by **who may demand a
  revert**. Animation *feel* is `taste`: zero obligation, discardable wholesale on an upgrade.
- An entry is an assertion **as of its commit**, not current state. Never re-verify an old entry;
  never hand-copy an aggregate count into the file — `check:log` and the tier commands print them.
- Known-but-not-fixed issues stay in `MAINTENANCE.md` §14; they have no commit, so no entry.
- `Symptom` names the mechanism, never the session: no window titles, no application names from a
  real desktop.
- Run `npm run check:log` before committing docs; `test/repo.test.js` keeps the two MAINTENANCE
  files and the two READMEs in section lockstep, so never add a heading to one side alone.
