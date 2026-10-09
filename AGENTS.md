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

## Scope
- This extension is a **dock**, but it also carries non-dock concerns: overview layout patches, the genie window animation, global hotkeys, and the Show Apps button fix. They are kept, but must stay **isolated in place** — never entangled with the dock.
- Every non-dock concern is its own `lib/` module with: a boundary header (what it is, and whether it is dock-coupled), its OWN `*-enabled` setting, a REAL start/stop in `dockManager`, a `[macos-dock-local][<name>]` log tag, and probe → warn-once → fall back (never throw into the shell).
- Do **not** re-bundle a non-dock concern under the dock's own toggle, and do **not** add a new uuid / second extension: the pieces are coupled (genie reads the dock's icon rects, keynav the dock's icon order, the Show Apps fix the dock's button), so splitting costs more than it saves.
- A new shell-layout patch goes behind `overview-patches-enabled` (or its own toggle) with a structural probe and a native fallback; see `MAINTENANCE.md` §11.

## Tests
- **Run `npm test`** (i.e. `node --test test/*.test.js`) after editing a pure module. No gjs, no dependencies, no build step.
- Pure modules and their suites:
  - `lib/genieGeometry.js` → `test/genieGeometry.test.js`
  - `lib/signalManager.js` → `test/signalManager.test.js`
- GI-bound modules (`dockManager`, `dodge`, `genieController`, `genieEngine`, `hotkeyNav`, `iconFix`, `iconManager`, `magnification`, `mediaManager`, `overviewApps`, `windowPreview`) cannot be imported by Node; verify them live in the shell instead.
- When fixing a bug, add a regression test that **fails against the pre-fix code** before making it pass.
- Three tiers of checks exist because the GI-bound modules cannot be imported: `npm run test:static` (offline, also guards licence headers, the `gi://`-free pure modules, repo privacy and schema/prefs key coverage), `test:headless` (private throwaway compositor), `test:live` (reads this boot's journal). `test:live-trigger` runs the pointer-free A/B but **opens probe windows on the user's desktop** — only on an idle session and with approval.
- A live assertion is worthless if the running shell predates the edit: `test/live-checks.sh` gates on that, and so must you.

## CI
- `.github/workflows/ci.yml` runs on every `push` and `pull_request`, and **must stay green**.
- It runs exactly two offline commands: `npm test` (the pure suites) and `npm run check:log` (recording coverage). Checkout uses `fetch-depth: 0` because `check:log` resolves the frozen-upstream anchor and walks `anchor..HEAD`, which a shallow clone lacks.
- CI covers the offline tier only. `test:headless` and `test:live` need a private compositor / the running session, so they are never run there — a green CI run does not stand in for them.
- Reproduce CI locally with the same two commands; a red CI run is a real regression, not an environment gap.
- **Keep CI in step with the code.** Update `.github/workflows/ci.yml` in the *same change* that
  makes it stale — never as a later cleanup.
- **New or renamed tests need no CI edit** as long as CI runs the suite command (`npm test`); it
  does, so it picks them up automatically. Only touch CI if the *command itself* changes.
- **Environment changes** — a new dependency, a Node version bump, or a new system tool — mean
  updating the workflow's setup/install steps.
- **Renamed or moved code**: `check:log` watches a declared list (`CODE_PATHS` in the checker). If a
  watched path moves, update that list; the check goes red until you do.
- **After a refactor**, confirm CI still exercises the real code and the declared paths still cover
  it. A green CI that no longer touches the changed code is worse than a red one.
- **A new verification tier** (headless / live) — decide explicitly whether CI runs it; do not add it
  silently. The tiered entries (`test:headless` / `test:live`) stay out of CI.
- If what CI runs changes, update this section too. CI is a signal, not a gate, until branch protection
  is enabled — read the result after every push.

## Docs & Commits
- **[`MAINTENANCE.md`](MAINTENANCE.md) is the procedure file** (how to verify a change, the per-release playbook, what can never be automated here and why). This file is rules; do not restate procedures here.
- `MAINTENANCE.md` / `MAINTENANCE.zh-CN.md` are a bilingual pair like the READMEs — keep their `##` sections in lockstep (`test/repo.test.js` enforces it).
- `README.md` and `README.zh-CN.md` are a **two-file bilingual pair** — edit both together, keeping section order aligned.
- **Do not touch the `Credits & Attribution` / `Changes vs upstream (v9)` sections** unless the change actually affects attribution or the upstream diff.
- Commit code first, docs in a separate commit.
- Live logs: `journalctl -f -o cat /usr/bin/gnome-shell`

## Release / version
- The release procedure is the **per-release playbook in [`MAINTENANCE.md`](MAINTENANCE.md) §7** — this file points to it and does not restate it.
- Version facts live in `metadata.json` (`shell-version`, and the integer `version`) and `package.json` (`version`); keep them consistent when cutting a release.
- Shipping does not replace the record: behaviour changes still carry a `CHANGELOG.md` `D-###` entry (see Recording conventions).

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
