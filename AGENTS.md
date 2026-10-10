# AGENTS.md

Guidance for agents working inside `macos-dock@local` — a local maintenance
fork of MacOSDock (v9) with the macOS Genie animation merged in.

> **Shared standard.** Root file names, the process-draft location (`docs/reports/`), the
> `CHANGELOG` entry format, CI version pinning and entry commands, the test entry command, and
> the runtime ignore list are defined once in the machine-wide `STANDARD.md` (outside this
> repository) and are not restated here.
>
> **Push over SSH, never HTTPS.** Verify `git remote get-url --push origin` starts with `git@`
> before pushing; if it starts with `https://`, fix it first — never push over HTTPS.

## Critical Rules
- **NEVER run `gnome-extensions install` or `gnome-extensions pack` from within this repo directory.** The install tool follows symlinks and will wipe the source directory contents.
- **Do not load ESModules via legacy `imports`** (e.g. `imports.ui.main` throws `SyntaxError` in GNOME 45+). Use static `import` or dynamic `await import()`.
- **Do not reassign ESModule exports directly** (e.g. `Main.notify = ...`). Monkeypatch mutable prototypes instead.
- **GJS constraint**: no `fetch`/`URLSearchParams` inside the shell process — measured here: `gjs -c 'print(typeof fetch)'` prints `undefined`, likewise `URL` and `URLSearchParams`. Use `Soup.Session` + `GLib.Bytes`.
- **`disable` + `enable` does NOT reimport modules.** A cached ESModule keeps its old code, so a change to a `lib/*.js` file only takes effect after a **log out / log in**. Never claim a reload activated an edit.
- **Keep `genieGeometry.js` and `signalManager.js` free of `gi://` AND `resource://` imports.** They are the only modules Node can import, hence the only ones unit-testable without a shell; either scheme added there breaks `npm test` on every machine, CI included. `resource://` matters exactly as much as `gi://` — `lib/overviewLayout.js` holds no `gi://` token at all yet is not Node-importable.

## Priorities & maintenance model
- Maintained **solo, for this machine**. Not published to extensions.gnome.org; EGO review rules
  are a reference, not a requirement.
- **stability > performance > appearance > code elegance.** A change that buys a lower-ranked
  property at the cost of a higher-ranked one is not an improvement.
- The performance questions that actually matter, in order: time from login to the first visible
  icon, icon flicker after login, how closely interaction tracks the pointer, idle CPU and memory
  while the dock is untouched. Genie's animation *feel* may change; its cost may not.
- Frozen fork, no upstream tracking, so **restructuring by function is allowed** — with evidence of
  the pain it removes, behaviour preserved, and a check that fails against the pre-change code.
  No architecture for its own sake: no DI container, no event bus, no extra layer for one caller.
- **No team-process files**: no CONTRIBUTING, no PR/issue templates, no CODEOWNERS. The audience is
  one maintainer and the agent reading this file.
- Keep both upstream copyright notices and licence headers exactly as they are (MIT dock,
  GPL-2.0-or-later for the three genie files). State the mixed licensing as fact and draw no legal
  conclusion; `LICENSES.md` plus the tier-1 licence guard are the mechanical half.

## Scope
- This extension is a **dock**, but it also carries non-dock concerns: overview layout patches, the genie window animation, global hotkeys, and the Show Apps button fix. They are kept, but must stay **isolated in place** — never entangled with the dock.
- Every non-dock concern is its own `lib/` module with: a boundary header (what it is, and whether it is dock-coupled), its OWN `*-enabled` setting, a REAL start/stop in `dockManager`, a `[macos-dock-local][<name>]` log tag, and probe → warn-once → fall back (never throw into the shell).
- Do **not** re-bundle a non-dock concern under the dock's own toggle, and do **not** add a new uuid / second extension: the pieces are coupled (genie reads the dock's icon rects, keynav the dock's icon order, the Show Apps fix the dock's button), so splitting costs more than it saves.
- A new shell-layout patch goes behind `overview-patches-enabled` (or its own toggle) with a structural probe and a native fallback; see `MAINTENANCE.md` §11.

## Runtime hygiene
- **Walk `enable()` against `disable()` line by line, in both directions.** Every resource needs a
  teardown reachable on *every* path: signal ids, timeouts and idle sources (a source whose id was
  never stored cannot be removed), actors added to chrome, D-Bus subscriptions, prototype patches.
- **A monkey-patch apply must be idempotent *and* revertible.** An "already applied" early return
  that hands back a no-op revert leaves the patch installed for the life of the process — module
  caches outlive enable/disable, so that state is reachable inside one session, not just across a
  logout.
- **New shell-private-symbol dependencies get recorded in [`MAINTENANCE.md`](MAINTENANCE.md) §8 in
  the same change**, and belong in the patch modules, not in ordinary code. Two existing dependencies
  sit outside them (`_dashSpacer` in `dockManager.js`, the `_stateAdjustment` chain plus a hardcoded
  enum value in `overviewApps.js`) — treat that as debt to avoid widening, not as licence to add more.
- No `gi://Gtk` / `gi://Gdk` in the shell process; those are for `prefs.js` only. Self-check:
  `grep -rn 'Gtk\|Gdk' extension.js lib/` prints nothing.
- **No synchronous IO and no recomputation in the main loop.** Pointer-motion handlers, animation
  ticks and the dodge heartbeat read cached state; scanning `global.get_window_actors()` per event
  or rebuilding a cache per layout signal is a bug to fix, not something to optimise later.
- **Do not add defensive noise**: no new empty `catch`, no optional chaining on a contract this repo
  owns. Guard real boundaries only — user settings, external D-Bus, shell-private symbols. The
  inherited density is high; it may fall, it must not rise.
- **Never write a GNOME/GJS API from memory.** The installed shell source is a GResource inside the
  shared library: `gresource list /usr/lib/gnome-shell/libshell-18.so | grep '/ui/'`, then
  `gresource extract` to read a file. `/usr/share/gnome-shell` holds no `ui/*.js` here, so the
  obvious path is a dead end. Cannot confirm it → say "needs manual confirmation".

## Tests
- **Run `npm test`** (i.e. `node --test test/*.test.js`) after editing a pure module. No gjs, no dependencies, no build step.
- `npm run test:coverage` — the same pure suites with Node's built-in coverage (`--experimental-test-coverage`). The report also lists the test files themselves; read the `lib/` rows for the product modules. A **reading, not a gate**: no threshold, and the shell-bound modules (`extension.js` and the rest of `lib/`) cannot appear because Node never imports them.
- Pure modules and their suites:
  - `lib/genieGeometry.js` → `test/genieGeometry.test.js`
  - `lib/signalManager.js` → `test/signalManager.test.js`
- Everything else under `lib/` is shell-bound: Node cannot import it, so verify those modules live in the shell instead. **Do not hand-copy that list into this file** — the enumeration kept here had already rotted (it missed `overviewLayout.js` and `overviewPatches.js`, both born with D-054/D-057). Derive it when you need it: `grep -lE 'gi://|resource://' lib/*.js`.
- When fixing a bug, add a regression test that **fails against the pre-fix code** before making it pass.
- Three tiers of checks exist because the shell-bound modules cannot be imported: `npm run test:static` (offline), `test:headless` (private throwaway compositor), `test:live` (reads this boot's journal). What each one guards is enumerated in `MAINTENANCE.md` §2–§5 — a list that grows, so do not copy it here. `test:live-trigger` runs the pointer-free A/B but **opens probe windows on the user's desktop** — only on an idle session and with approval.
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

## Evidence & verification
- Label every claim as one of **run-verified / static inference / needs manual verification**.
  "I looked at the code" is never "it works".
- PASS/FAIL/ENV semantics and the L0/L1/L2 evidence tiers are defined in
  [`MAINTENANCE.md`](MAINTENANCE.md) §6 and §2 — an assertion that cannot separate "regression" from
  "this machine happened to be busy" is reported ENV, not PASS.
- **Before asking for a logout, exhaust the checks that need none**, in this order: tier 1 (offline),
  `npm run test:headless` (private compositor, memory settings backend), a live assertion readable
  from this boot's journal, then a settings toggle that re-exercises the path inside the running
  shell — flipping `genie-enabled` re-runs `GenieController._validate()` without a reload, and
  `disable`+`enable` does re-run `stop()`/`enable()` on the *cached* classes, which makes it a valid
  cost A/B even though it never picks up edited code.
- A live assertion about edited code is worthless if the running shell predates the edit.
  `test/live-checks.sh` gates on exactly that (`stale_code()`); a report must do the same.
- **Live logs: finite queries only.** `journalctl -f` never returns, and an unfiltered `-b` spans the
  whole BOOT — which includes other agents' `gnome-shell --headless` runs writing the same
  `[macos-dock-local]` tag. `_PID=` is not optional, and the repo already knows how to pick the
  session shell (`test/common.sh` `shell_pid()`, which rejects anything whose cmdline mentions
  `--headless`):
  `journalctl --user -b -o cat _PID=$(bash -c 'source test/common.sh; shell_pid') | grep -a '\[macos-dock-local\]'`

## Actions reserved for the user
These end the session the agent is running in, or rewrite history the agent cannot see. Print the
exact command and wait — never substitute a workaround that touches the session instead.
- Log out / log in, reboot, killing or restarting `gnome-shell`.
- `git commit`, `git push`, and anything that discards work: `git checkout` / `reset` / `stash` /
  `clean`. The tree may hold the user's own uncommitted edits at any moment.
- `gsettings set` / `dconf write`. The one exception is this extension's own schema keys inside
  `test:live-trigger`, written only through `common.sh`'s `set_key` (whitelisted to `[a-z0-9-]`,
  refuses `keynav-*` and `dodge-enabled`, records whether the key was originally unset) with
  `restore_keys` + `dconf_verify` proving the tree came back identical.

## Workflow (A→D)
- **A** survey & audit (file:line evidence, no fixes) → **B** options: where a trade-off exists give
  2–3 alternatives with a recommendation, and list anything a well-maintained repo should have that
  this one lacks — what it is, why, cost, how much I recommend it — then **ask about each item**,
  never add one on your own → **C** implement one small change at a time, each with its diff and its
  verification, waiting between them → **D** run verification and write the maintenance assets.
- **Stop at the end of every phase and report.** Wait for the user's confirmation before starting the
  next one.
- Phase output goes in `docs/reports/` — `PROFILE.md`, `AUDIT.md`, `PLAN.md`, `VERIFY.md`,
  `REVIEW-PACK.md` — plus `docs/reports/STATE.md`, which a new session reads **first** and a
  session updates **before it ends** (decisions taken, invariants, open items, what the next step
  is). The ignore pattern is `reports/` with no leading slash, so it also covers `docs/reports/`,
  and tier 1 S8 proves nothing under it is tracked — the repository is public while phase evidence
  quotes raw log lines.
- **What may be written where**: `docs/reports/` may quote journal lines, window titles and
  resolved paths. Tracked files carry counts and extracted numbers only — never a journal line, a real
  application or window name, a host name, a user name or an absolute path. Commit bodies obey the
  same rule as tracked files, not the same rule as `docs/reports/`.
- The review pack is one page: what changed, files touched, invariants, self-check conclusions. It is
  written for an independent reviewer model, and anything it concedes as unfixed goes into
  `MAINTENANCE.md` §14 rather than staying only in `docs/reports/`.

## Docs & Commits
- **[`INVARIANTS.md`](INVARIANTS.md) is a pointer list** of fixes that must not be reverted, and
  it restates nothing: the mechanism lives in `CHANGELOG.md`, the reasoning in
  `MAINTENANCE.md` §11. When the three disagree, those two win and INVARIANTS is stale — so add
  its row in the same change that adds the entry, and never copy prose into it. This is
  **machine-checked** by `test/invariants.mjs`, which runs inside `npm test` (so tier 1 catches a
  stale row) and inside `npm run check:log`; `npm run check:log --invariants` runs that one check
  alone. Read the rules from the module's header instead of copying them here.
- **[`MAINTENANCE.md`](MAINTENANCE.md) is the procedure file** (how to verify a change, the per-release playbook, what can never be automated here and why). This file is rules; do not restate procedures here.
- `MAINTENANCE.md` / `MAINTENANCE.zh-CN.md` are a bilingual pair like the READMEs — keep their `##` sections in lockstep (`test/repo.test.js` enforces it).
- **Do not touch the `Credits & Attribution` / `Changes vs upstream (v9)` sections** unless the change actually affects attribution or the upstream diff.
- **Nothing guards this file.** The parity guard derives its bilingual pairs from the repo root and
  covers the MAINTENANCE and README pairs only, so `AGENTS.md` facts rot silently unless they are
  produced by a command. Hand-copied counts, module lists and line numbers do not belong here —
  write the command that prints them, or leave them out.
- Commit style: an English conventional prefix with an **English** body (`fix: …`, `docs: …`,
  `test: …`, `chore: …`). Code in one commit, docs in a separate commit. Stage explicit paths —
  never `git add -A` — and confirm with `git status` that nothing of the user's own was swept in.

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
