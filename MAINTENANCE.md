<p align="right"><a href="MAINTENANCE.md"><b>English</b></a> | <a href="MAINTENANCE.zh-CN.md">简体中文</a></p>

# Maintenance Guide

Procedures for keeping this fork working across GNOME releases. [`AGENTS.md`](AGENTS.md)
holds the *rules* (what never to do); this file holds the *workflow* (how to tell whether a
change is safe). Nothing here duplicates a rule.

## 0. Thirty-second orientation

| Question | Answer |
|---|---|
| Run everything that is safe unattended | `npm run test:static` then `npm run test:live` |
| Run the private throwaway compositor | `npm run test:headless` (~60 s) |
| Run the live A/B that opens windows | `npm run test:live-trigger` (needs an idle session) |
| Pure unit coverage | `npm test` — 72 assertions, 20 suites, no desktop needed |
| The fact that governs everything | `disable`+`enable` does **not** reload edited JS; only log out / log in does |
| Where the code lives | everything is in `lib/` — print `wc -l lib/*.js`; no build step, no dependencies |

## 1. Scope and ground rules

- A "test" here means one of three things, because the majority of the code cannot be
  imported outside the shell: text guards on the repository, a private headless
  compositor, and the live session's own log lines.
- The extension's unconditional log output is the oracle for tiers 2 and 3. It is an
  interface in the same sense as a function signature: renaming or gating a line
  silently removes coverage, so `test/repo.test.js` guards the ones the harness reads.
- An assertion that cannot distinguish "regression" from "this machine was busy" is
  reported as `ENV`, never as `PASS`.

## 2. The three tiers at a glance

| Tier | Files | Needs desktop | Mutates anything | Typical runtime | npm script |
|---|---|---|---|---|---|
| 1 static | `test/repo.test.js`, `test/static-checks.sh` | no | no | ~5 s | `test:static` |
| 2 headless | `test/headless-checks.sh` | no (private shell) | no (memory backend) | ~60 s | `test:headless` |
| 3 live A | `test/live-checks.sh` | yes | no | ~10 s | `test:live` |
| 3 live B | same, with `--trigger` | yes | settings, always restored and proven | ~120 s | `test:live-trigger` |

`test/run-all.sh` aggregates them; exit `0` no FAIL, `1` any FAIL, `77` everything ENV,
`2` usage. Every tier also runs standalone.
**Naming.** The tiers called `Tier 1 / Tier 2 / Tier 3` here are written
**`L0` / `L1` / `L2`** in `CHANGELOG.md` and in the other four extension repos. The mapping is
`Tier 1 = L0` (static, offline), `Tier 2 = L1` (throwaway headless shell), `Tier 3 = L2` (real
session). Definitions are by *what environment a claim needs*, not by the tool that runs it.


## 3. Tier 1 — static and offline

`test/repo.test.js` (runs inside `npm test`) and the shell-side checks in
`test/static-checks.sh`, numbered `S1`… in file order. Each guard exists because its failure
is invisible to every other check:

| Guard | Rule it protects | What a failure means |
|---|---|---|
| pure modules carry no GI or `resource://` imports | `AGENTS.md` hard rule | `npm test` breaks for everyone, including reviewers with no GNOME |
| genie SPDX + attribution lines; GPL set equals `LICENSES.md` | licence obligation on a public repo | legal exposure, not a style complaint |
| `DODGE_DEBUG` is `false` | dodge's `_dbg`/`hide-trigger` log real window titles | the journal starts collecting private titles, and any future log paste leaks them |
| schema keys minus `prefs.js` keys equals exactly 12 pinned names (the ten `keynav-app-N` + `keynav-stock-backup`/`-dirty`) | settings surface completeness | a new key with no row is a silent feature gap; a row without a key throws in the prefs window |
| every schema key appears in backticks in **both** READMEs | the settings reference is the only place a user can learn a key exists | a key was added to the schema and documented nowhere (it proves the row exists, not that the prose is right) |
| `metadata.json` uuid / schema id / plain numeric `shell-version` | load-time wiring | wrong schema id puts the extension in ERROR at login |
| bilingual pairs have equal `##` counts and the switcher line | documentation convention | the two files drifted apart |
| no task checkboxes in markdown | house convention across all four forks | committed docs read as unfinished work |
| no resolved temp paths, wayland slot names, home/host/user | this repo is public | a per-machine fingerprint got committed |
| harness greps stay anchored to `[macos-dock-local]`, or carry `ANCHOR-EXCEPTION` | a loose `macos-dock` match once returned 847 lines from a clipboard manager's history | a check is silently reading someone else's log |
| nothing matching `*.test.js` imports GI; the GI probe keeps its name | `npm test` stays runnable under plain Node | renaming `probe-window.js` into the glob breaks every run |
| `package.json` has no dependencies and no `node_modules` | the no-build-step story | tests stop being offline-runnable |

Shell side: toolchain presence (missing → ENV), unit floors (72 assertions / 20 suites —
floors, so adding tests never fails), `node --check` over **every** tracked `.js`, `bash -n`
over the harness, `glib-compile-schemas --strict --dry-run`, compiled-binary freshness,
`gjs -c 'true'` smoke, that `docs/reports/` is ignored and holds nothing tracked, and as the last
check an assertion that the run left the working tree untouched.

`node --check` on the GI-bound files is the highest value-per-second check in the repo:
`package.json` sets `type: module`, so a syntax error in `lib/dodge.js` parses cleanly here
and nowhere else until you log out and find the extension in ERROR.

## 4. Tier 2 — headless shell

`test/headless-checks.sh` boots a private compositor in a clean room; the table below is the
whole list of what it asserts, and `test/run-all.sh` prints the count for the run (a number
copied into this file goes stale the first time a check is added).
The isolation is not optional and every line of it is load-bearing:

```
GSETTINGS_BACKEND=memory      no dconf client exists: reads return schema defaults,
                              every write is discarded
XDG_DATA_HOME=$T2             the shell scans this dir only, so the symlinked fork is
                              the ONLY extension loaded; otherwise all of the user's
                              extensions boot in here and pollute every oracle
XDG_CONFIG_HOME/XDG_CACHE_HOME  nothing lands in the real ~/.config or ~/.cache
GSETTINGS_SCHEMA_DIR=$REPO/schemas  the settings schema is extension-local
gnome-shell --headless --unsafe-mode --wayland-display=wayland-$UNIQ --virtual-monitor=1280x800
```

- Never `gnome-extensions install` or `pack` inside this directory (follows symlinks,
  wipes the source). Never `gnome-extensions enable` under the memory backend either: it
  is a separate process whose write dies with it, so the real shell never sees it and the
  readiness poll spins to its timeout. Enable from inside with
  `_callExtensionInit(uuid)` then `_callExtensionEnable(uuid)`, which also exercises
  `_loadExtensionStylesheet` and is therefore closer to a real login than
  `stateObj.enable()`.
- `--unsafe-mode` is what serves `org.gnome.Shell.Eval`. There is no `--devkit` option in
  this build, and GNOME 50 removed the `org.gnome.desktop.interface unsafe-mode` gsettings
  key entirely. `--nested` is gone too. If a release changes the flags, the harness reports
  ENV with the shell's own words and a human re-checks `gnome-shell --help`.
- A unique `--wayland-display` is required: otherwise mutter tries `wayland-0`, fails to
  lock, and the failure cascades into `AddMatch(): The connection is closed`,
  `StartServiceByName for org.gnome.SessionManager` and `free(): invalid pointer`, which
  reads like a shell bug. The run's lockfile and socket are removed by the trap and nothing
  else is ever touched outside `$T2`.
- Code goes into Eval from a **file**, and results come back from a **file**: the Eval
  reply is ASCII-escaped and unparseable. Eval runs as a classic script, so `imports.gi.*`
  works, `imports.ui.*` does not, and `ui/main.js` needs `await import('resource:///…')`.
  `imports.gi.Config` has no typelib inside Eval here — probe symbols individually so one
  failure does not lose the rest.
- Readiness is `extensionManager.lookup(uuid).stateObj` existing, not `gnome-extensions
  info` reporting ACTIVE. `state 6` means metadata only, extension.js not yet imported.
- What headless **can** prove: reaching ACTIVE, `genie`'s `_validate()` result against this
  exact shell build, that the icon table enumerates, that dodge started, and that no error
  block names this extension. What it **cannot** prove: any map/minimize/restore animation
  path — counters wrapped onto the live instances stayed at 0 even with
  `--force-animations`. Do not add animation assertions here.
- Headless numbers are **not** comparable to the live session (measured here: `enable()`
  25 ms headless vs 30 ms live, but a sibling fork showed 5355 ms vs 757 ms for the same
  work). Tier 2 therefore asserts presence, never a threshold.
- Error counting is path-scoped: `JS ERROR` and friends are only blamed on this fork when
  the stack names `macos-dock@local/`, because a bare headless boot already emits ~90
  shell-internal "already disposed" lines that have nothing to do with us.
- The last check (`dock-monitor-geometry`) covers a class that is **invisible on a
  single-panel machine**: it fabricates two vertically stacked monitors inside the running
  shell with `primaryMonitor` pointing at the far one, then asserts dodge's edge maths
  follows the dock's own monitor. Verified red-then-green: with the old
  `primaryMonitor`-based code it reports `pickedPrimaryInstead=true` and
  `farFromEdgeAtDockEdge=true` (the pointer at the dock's edge reads as "far away", so the
  poll would park and the peek zone would sit on the other screen).
- The `overview-band` check guards a class that only appears **once the stock dash is
  hidden**. GNOME 50 derives the overview's bottom band from the stock dash's preferred
  height (`overviewControls.js` `vfunc_allocate`), computed even while the dash is hidden;
  hiding it leaves the dash empty, so that height collapses to the theme padding (36 px) and
  a dock taller than that padding overlaps the window picker / app grid. The check asserts
  the reserved band (dash preferred height + the shell's own spacing) clears the dock's
  occupied height. Verified red-then-green: pre-fix `band=51 < dock=70`, post-fix
  `band=85 >= dock=70` (headless monitor, icon-size default 48).
- The `overview-window-inset` check guards a class that only appears **once the dock is
  visible in the overview**. The shell lays the window previews out with
  `WorkspaceLayout._getWindowSlots`, fed the whole window-picker box, while the desktop
  background is inset inside that box (theme: 20 px sides / 12 px top+bottom) — so previews
  poke past the desktop edge, worst for the window counts whose content sits flush to the
  bottom. `lib/overviewLayout.js` wraps that private method to pass the background rect
  instead; the check is a **presence** oracle (like `genie-apis`), asserting the wrapper
  logged `[overviewlayout] enabled` and not the one-line `disabled — missing/changed private
  APIs` degrade. It proves the wrapper reached and accepted this shell's private surface, not
  the pixels — visual confirmation is manual (see §10).
- Teardown reaps the **whole subtree**, not just `dbus-run-session`. That process forks two
  children — a private `dbus-daemon` and the command (`gnome-shell`) — and killing only it
  reparents both to systemd, where they keep running: a day of runs left 7 headless shells +
  18 private dbus-daemons (~580 MB) alive. `t2killtree` walks children-first (before any
  reparent can hide them), TERM then KILL, and the `teardown` check proves every pid in the
  pre-kill snapshot is gone.
- A **stale-sandbox sweep** runs before the sandbox is created. `t2cleanup` removes `$T2` on
  every normal exit, but a run that is `SIGKILL`ed (or a host that loses power) leaves its
  `/tmp/macosdock-t2-*` behind and nothing else ever reclaims it — 16 of them (2.9 MB) had
  accumulated before the sweep existed. Only dirs older than an hour are removed, so a
  concurrent run's fresh sandbox is never touched. It is hygiene, not an assertion: it prints
  no report line, which is why the list above gains no row from it.

## 5. Tier 3 — live session, pointer-free

`test/live-checks.sh` splits into a passive group and a triggered group.

**Group A** reads the journal this boot already wrote. Safe any time, changes nothing:
session-shell identity, the stale-code gate, journal access, a boot inventory (values, never
raw lines), the startup invariant, and two tripwires.

- **The stale-code gate** compares the newest tracked `.js` mtime against the running
  shell's start time. If the shell predates the edits, group B is refused: otherwise every
  live assertion certifies code that is not loaded. This is the single most common way to
  fool yourself in this repo.
- **`pgrep -x gnome-shell` is not enough.** Other agents' harnesses run
  `gnome-shell --headless` on this machine, and picking one of those silently reads the
  journal of a compositor unrelated to the session. `common.sh` rejects any command line
  containing `--headless`.
- **The startup invariant** is the permanent regression check for the boot twitch: no
  `-> hide` line may be timestamped before dodge's `grace released at`.
- **The privacy tripwire**: any `hide-trigger` line in the journal means `DODGE_DEBUG` is
  on and real window titles are being recorded.
- **Anchor hygiene** counts journal lines that mention the fork *without* the tag and
  contain an error verb — those are complaints about the extension that the anchored greps
  cannot see. Only counts are printed; an untagged line may contain a title.

**Group B** is the pointer-free A/B. Same window timeline, run twice, differing only in the
flag under test; the readout is whether dodge's own `uncovered -> show` line appears:

1. control (`nofs`): maximize over the dock → dock hides; a small, non-overlapping window
   takes focus → `uncovered -> show` **must** appear (measured 16–39 ms).
2. treatment (`fullscreen`): same, plus `fullscreen()`. Inside the silence window anchored
   on the probe's own `small-present` STEP stamp, **no show and no peek** may appear.
3. release: after the fullscreen window is destroyed, the show **must** come back
   (measured 8–20 ms). Without this, silence proves nothing.
4. flag control: with `hide-in-fullscreen` off, the show returns during the *same*
   fullscreen timeline — this is what makes step 2's silence attributable to the setting
   rather than to the moment.
5. genie revalidation: toggling `genie-enabled` off/on re-runs `_validate()` on the live
   shell with no logout (`dockManager` listens for `changed::genie-enabled` →
   `_refreshGenie()` → `_startGenie()`).
6. separator oracle, when a non-favorite app is running.

Three rules that took real failures to learn:

- **Anchor on the probe's own STEP timestamps, never on "now".** The dock can transition the
  instant a focus change lands; measuring from after the activation returns reads a show
  that really happened as "no show", and produced two false FAILs before this was fixed.
- **Confirm focus with `xprop` before asserting anything about it.** A new window usually
  takes focus by itself, and sometimes does not; `xdotool windowactivate --sync` plus a
  `_NET_WM_STATE_FOCUSED` read turns "no show" from a wrong verdict into an honest ENV.
- **A sample containing unrelated dock activity is void, not failed.** dodge gives an
  in-flight genie animation priority over fullscreen force-hide (`_animPeek` is checked
  first in `_check`), so any minimize during the window legitimately produces a show. Group
  B retakes up to three times and only three consecutive violations are a regression.

Settings protocol for group B, all of it enforced in `common.sh`:

- One writer, `set_key`, which rejects any name outside
  `org.gnome.shell.extensions.macosdock`, and additionally refuses `keynav-*` (those keys
  drive takeover and backup of real system keybindings) and `dodge-enabled` (its failure
  mode leaves the user with a dock that never dodges).
- `dconf dump` before, restore after, `dconf dump` again and **byte-compare**; any drift is
  the highest-severity FAIL and names the keys. A key that was originally unset is
  `dconf reset`, not written back, because leaving it explicitly set is itself pollution.
- Never `dconf reset -f`: this user's subtree contains two orphan keys from the v9 naming
  (`auto-hide`, `enable-keyboard-nav`) that are user data.
- Never `gnome-extensions disable`/`enable` from the harness — it round-trips keynav.
- Redirecting `XDG_CONFIG_HOME` does **not** isolate a write: `gsettings`/`dconf` are D-Bus
  clients served by the already-running dconf-service, which uses the real path. Snapshot
  and restore instead.

## 6. Reading a report: PASS, FAIL, ENV

- `PASS` — the assertion held on this machine at this time.
- `FAIL` — a regression, or an assertion that cannot be satisfied here; the message says
  which, and the code comment says what the check was for.
- `ENV` — the machine or session could not answer the question today. **Never a pass.**
  Every ENV line names its detector (locked session, busy mouse, shell predates edits,
  flags changed, missing tool) and each has a documented way to make it answerable.
- A run where everything is ENV exits `77` so it cannot be mistaken for a clean pass.

## 7. Per-GNOME-release regression playbook

1. **Before** upgrading, add the new major to `metadata.json` `shell-version`. The shell's
   `_isOutOfDate` is `some(v => v.startsWith(major))`, so on an unlisted major the
   extension becomes `OUT_OF_DATE` and simply never loads — no error, no log line, the dock
   is just gone. Do not "fix" this with a wildcard such as `"5"`: `startsWith` would then
   also claim 52–59.
2. `npm test` and `npm run test:static`.
3. `npm run test:headless`. `genie-apis` is the release-day verdict on genie: if a private
   symbol moved, it names which. The fallback is already by design — `_validate()` failure
   logs one loud warning and the native animation plays, so a regression there is cosmetic
   and never blocks shipping.
4. Log out and in, then `npm run test:live`. Group A reads the boot: grace timings drift
   with every release, so only ranges are asserted, never a value (observed releases of the
   same code: 3673 ms, 6106 ms, 2450 ms quiet path).
5. `npm run test:live-trigger` once, on an **idle** session, for the fullscreen branch.
6. To re-check genie without another logout, use the `genie-enabled` toggle (step 5 of group
   B) rather than a restart.
7. If `genie-apis` named a symbol, the places to look are `genieController._validate()` and
   `genieEngine.validateRuntime()`.

## 8. The breakage surface

Everything that a GNOME update can take away:

- `Main.wm._minimizing`, `Main.wm._unminimizing` — the private animation lists genie lifts the
  actor out of. `_validate()` probes both; absent, genie falls back to the native animation.
- `WorkspaceLayout.prototype._getWindowSlots` — the overview window-preview inset (D-057) wraps
  this private layout method and feeds it the desktop background's rect. It also reads the
  `Workspace` child structure: `Workspace._container` (the preview container, whose layout
  manager is the `WorkspaceLayout`) and its `workspace-background` sibling. A rename of any of
  these degrades to the native layout with one warn line — never a crash.
- `Main.overview.dash.get_preferred_height` — the overview bottom-band override (D-054) shadows
  this on the stock dash instance; it now lives in `lib/overviewPatches.js` behind the
  `overview-patches-enabled` toggle (D-058). It is an own-property override on a live actor,
  removed with `delete`. A shell rename degrades to the native height (the band collapses and a
  tall dock may overlap the overview) but cannot crash — installation is probe-gated and in
  try/catch, and the only dock coupling is an injected `getBandMetrics()` provider.
- `dash._dashSpacer` (`dockManager.js:661` and `:682`) — **absent from the installed 50.1**: the
  string does not occur anywhere in the shell's `dash.js` or its other `ui/*.js`. Both the enable
  and the disable path read it behind `if (dashSpacer)`, so this is a permanent silent no-op, not an
  upgrade casualty. Dead weight: removing it is a decision, and no check notices either way.
- `Main.overview._overview.controls._stateAdjustment` (`overviewApps.js:59`), with the grid state
  hardcoded as the bare number `2` at `:61`. A rename degrades to the `showAppsButton.checked`
  fallback (try/catch, no crash) — but that fallback is exactly the stale source the code comments
  say it stopped trusting. If the enum is ever *reordered* rather than removed, the check answers
  the wrong state with nothing logged. The only dependency in the fork that can be wrong silently.
- `Main.uiGroup` (`iconManager.js:1262`) — public, but the shell's own `main.js` labels it a
  back-compat alias kept "until it's updated", which makes it the least durable public dependency
  here.
- Behaviour cap rather than a rename risk: the shell clamps the overview dash to
  `box.height * DASH_MAX_HEIGHT_RATIO` (0.16) and takes `Math.min(dashHeight, maxDashHeight)`
  (`overviewControls.js:23,174-178`), so a dock taller than ~16% of the work area is capped in the
  overview band no matter what `get_preferred_height` returns. Related and unresolved: `Dash` defines
  `vfunc_get_preferred_height` (`dash.js:82`) while our override is an own-property on
  `get_preferred_height` — which of the two the C allocation path consults was never established
  here, so if the band ever stops tracking the dock height, check that first.
- A **behaviour dependency nobody wrote down**, found by testing rather than reading: the shell's
  `Layout._trackActor()` connects the chrome actor's own `destroy` to `_untrackActor`
  (`layout.js:962-965`), so an actor the C side destroys leaves `layoutManager._trackedActors`
  **even though** `dockManager.js:287` skips `removeChrome` when the container was destroyed first
  (`:74` nulls `_container`). Measured in the private shell — destroy, then `disable()`, then ask the
  registry: the actor is gone (tier-2 `chrome-untracked`). Today that is not a leak; it is the reason
  a shell that ever drops that auto-connect turns `:287` into one, and `_findActor()` scans that
  array on every layout query. The check is the sentinel, not the fix.
- `global.window_manager.connect`, `completed_minimize`, `completed_unminimize` — public
  but reshaped before.
- `genieEngine.validateRuntime()`: `global.window_group.add_child`, `Clutter.Timeline`,
  `Clutter.Clone`, `Graphene.Matrix`.
- Public-but-shifting shapes: `Main.layoutManager.monitors` (and `monitor.inFullscreen`),
  `global.get_window_actors()`, `Meta.Window.is_fullscreen` / `get_frame_rect()`,
  `Shell.BlurEffect`, and the `global.display` signal set dodge wires in `start()`. Also public but
  load-bearing in a way an upgrade can quietly change: `Main.wm.addKeybinding` / `removeKeybinding`
  (`hotkeyNav.js:83,98,117` — argument shape *and* the uuid-derived binding name), the
  `PopupMenu.PopupMenuManager` / `PopupMenu` / `PopupMenuItem` constructor signatures
  (`iconManager.js:185,1256,1284`), `Main.modalCount` (the `dodge.js:571` overview-busy canary) and
  `global.window_group.get_children()` (`genieEngine.js:58`, a name-based sweep of the actor group).
- Not a risk: every other underscore name in the fork (`actor._genieSquash`,
  `actor._dockRemovalPending`, `wrapper._dockFixDestroyId`) is our own bookkeeping attached
  to foreign objects, and cannot break on upgrade.

## 9. Log-line oracle map

| Line (`file:line`) | Proves | Does not prove | Tier |
|---|---|---|---|
| `[macos-dock-local] enable() total Xms` (`dockManager.js:226`) | the whole enable chain ran | any comparable speed | 2, 3A |
| `[icons] reload: N icons in Xms (reason=startup)` (`iconManager.js:560`) | favourites and running apps enumerated; `N>0` | visual correctness | 2, 3A |
| `[icons] startup grace ended early at Xms` / `reason=startup-grace-end` (`iconManager.js:221`) | the icons grace ended and updates resumed | whether it ended early or at the cap matters not | 2, 3A |
| `[dodge] started (onlyFocused=…, watching N windows)` (`dodge.js:595`) | dodge wired up and its poll exists | that it will decide correctly | 2, 3A |
| `[dodge] grace released at Xms (window quiet Yms)` (`dodge.js:1000`) | first moment a hide was allowed; `quiet 0ms` means the cap path | that a hide then happened | 3A |
| `[dodge] {overlap,uncovered,overview,fullscreen} -> {hide,show}` (`dodge.js:1197,1243`) | every real transition; the reason names the branch | dock position or opacity | 2, 3A, 3B |
| an `overview -> show` within ~300 ms *after* a hide | nothing good: the tick raced the overview exit animation and re-showed a dock that had just been put away. Group A counts it as `overview-flicker`; a healthy boot scores 0 (a buggy one scored 40) | — | 3A |
| `[dodge] peek show (edge=N)` | the pointer reveal path works (only a real cursor can trigger it) | anything about fullscreen, unless paired with group B | 3A |
| `[icons] +separator at=N (…)` / `-separator (…)` (`iconManager.js:1358,694,737`) | separator state changes and why | the absence of jitter (needs the pair) | 3A, 3B |
| `[genie] enabled` (`genieController.js:62`) | `_validate()` accepted this shell build | that an animation looks right | 2, 3A, 3B |
| `[genie] disabled — missing/changed private APIs: …` (`genieController.js:43`) | a symbol moved; the line names it | a crash — the fallback works | 2, 3A, 3B |
| `[genie] effect ended without completing mutter:` (`genieController.js:393`) | the exactly-once completion latch was bypassed | — this is the point of it | permanent warning |
| `[appsbtn] applied (icon=…, label=none, grid=<n>)` (`overviewApps.js:257`) | which `ControlsState` value the grid test resolved **in this shell** — tier 2 compares `<n>` against the number the shell itself reports | that a click lands in the right state (needs a real cursor, tier 3 only) | 2 |
| `_dbg` output, `hide-trigger` | nothing: gated by `DODGE_DEBUG=false`, only while hidden, rate-limited to one line per second, and **prints window titles** | — | never an oracle |

## 10. What cannot be automated here, and why

Each of these was tested directly and failed. Do not spend time retrying them.

- **Screenshots / visual verification.** `org.gnome.Shell.Screenshot.Screenshot` and
  `.ScreenshotArea` both answer `AccessDenied: Screenshot is not allowed`;
  `gnome-screenshot` and `grim` are not installed. Whether the genie funnel *looks* right is
  a human judgement, full stop.
- **Pointer input.** `xdotool mousemove` moves only the XWayland-internal pointer; mutter
  ignores it (14 held positions at the dock edge produced zero `peek show`, while the user's
  real mouse produced six in the preceding minutes). `/dev/uinput` is `0600 root:root`, and
  there is no EI/Ember injection portal — only `InputCapture`. Anything gated on pointer
  position (peek, hover magnification, tooltips) cannot be exercised from inside the session.
  Keyboard `windowactivate` via client message *does* work, which is what group B uses.
- **Animation timing from window state.** `_NET_WM_STATE_HIDDEN` flips 10–40 ms after
  `minimize()`, and `_NET_WM_STATE_FULLSCREEN` about 91 ms after `fullscreen()`, because
  mutter publishes state at request time while the 560 ms actor animation is still running.
  Polling window state proves the state machine, never the animation length.
- **Headless animations.** mutter does not run the map/minimize path there at all.
- **`org.gnome.Shell.Eval` on the live session.** Needs unsafe mode, which cannot be enabled
  (the gsettings key no longer exists). Live introspection only ever goes through a
  temporary log line plus a logout.
- **Dock actor geometry/opacity on the live session** — not observable without Eval. The log
  lines are the only channel.
- **`disable` + `enable` as a reload.** It runs `stop()` and `enable()` again, which makes it
  a valid cost probe, but the ES module cache means edited code never loads.

## 11. Settled decisions (need new data to reopen)

- dodge's edge tests use **the monitor the dock is on** (`_dockMonitor()`, resolved from
  the dock's own rect, falling back to primary), never `Main.layoutManager.primaryMonitor`.
  The peek trigger zone, the far-from-edge/un-peek test and the fast-vs-slow poll decision
  all consult it; with a single panel primary *is* that monitor, which is exactly why the
  bug stays hidden until a second display is made primary.
- dodge's overview state is reconciled from `Main.overview.visibleTarget`, **never
  `visible`**: the shell's own comment defines `visible` as "animating to overview, in
  overview, animating out", so reading it contradicts the `hiding` signal, which fires on
  the first frame of the exit animation. Measured on one boot: 40 `hide → overview -> show`
  pairs under 300 ms, i.e. the dock collapsing, popping back out, then collapsing again.
  Entering the overview is unaffected — `_animateVisible()` sets both flags on the same
  frame, so nothing was added to the show latency.
- The overview's bottom band is sized from the **stock dash's** preferred height
  (`overviewControls.js` `vfunc_allocate`), computed even while the dash is hidden. Hiding
  the stock dash leaves it empty, so that height collapses to the theme padding (36 px) and
  this dock — taller than the padding — overlapped the window picker / app grid. So the band
  shadow reports the dock's occupied height via the dash's `get_preferred_height`; the shell
  then reserves `occupied + spacing`. It lives in `lib/overviewPatches.js` (D-058), which reads
  the dock's height only through an injected `getBandMetrics()` provider. Do **not** "restore"
  the stock dash to fix this: a populated dash reserves far more than the dock needs.
- Non-dock concerns are isolated **in place**, one extension / one uuid (D-058): each is a `lib/`
  module with a boundary header, its OWN `*-enabled` setting and a REAL start/stop in
  `dockManager`, and probe→warn-once→fallback. The overview layout patches (band D-054 + inset
  D-057) are one such concern behind `overview-patches-enabled`; the Show Apps button fix
  (`lib/overviewApps.js`) is decoupled from `icons-fix-enabled` behind `apps-button-fix-enabled`
  (its stop triggers an IconManager `reload`, because the fix replaced the button's stock press
  handler). genie and keynav already met this standard. Do not re-bundle these back under the
  dock's own toggles.
- The overview window previews are laid out in a container that **fills the whole window-picker
  box**, while the desktop background is inset inside that box (measured 20 px sides / 12 px
  top+bottom on GNOME 50.1) — so previews poke past the desktop edge, worst for the window
  counts whose content sits flush to the bottom (the "1 window obvious / 2 none / 3 slight"
  report). This is **shell layout, independent of the dock**: it is identical with the dock on
  or off, which is why the earlier dash-height change (D-054) did not touch it. The fix
  (`lib/overviewLayout.js`, D-057) wraps the private `WorkspaceLayout._getWindowSlots` and hands
  it the background's rect. The inset is read from the live allocations, never hardcoded, so it
  follows theme/monitor changes. Reopen only if a shell release changes that private method
  (the wrapper degrades to native, one warn line).
- Leaving the overview with a fullscreen window hides the dock for reason `overlap`, not
  `fullscreen`, because the shell itself clears `monitor.inFullscreen` while the overview is
  up. Both branches hide, so the outcome is identical; do not "fix" the label with a timing
  guess — that is exactly the fixed-delay hack this fork avoids.
- The startup dodge grace is a **re-armable gate**, not a one-shot timer: floor 2000 ms,
  500 ms of window quiet to release, hard cap 6000 ms (`dodge.js:65-67`). Latching it fails
  the sparse-event boot (simulated: 1 hide vs 0). Both exits have real-boot evidence.
- `_noteWindowEvent()`'s conditional `_wake()` is load-bearing. Without it the poll parks at
  the floor and a re-armed gate is never re-evaluated, so the dock stops dodging **forever**.
- Stamps are taken **before** `doTick()`, so the event that would trigger a hide closes the
  gate first. That ordering is the fix, not a detail.
- genie: `_steal()` must precede `finishFor()`, and `record.finish()` restores only actors it
  parked — otherwise Clutter's implicit transition removal emits `stopped` and fires the
  shell's `completed_minimize` a second time.
- `AXIAL_BUNCH` is the single feel knob for the funnel. If it reads wrong, retune that
  constant; do not redesign, and do not touch `leadFrac`/`trailFrac` defaults, which were
  measured.
- Separator visibility derives from the **settled** icon set (skipping
  `_dockRemovalPending`), because an icon kept in `_icons` while fading otherwise raises a
  separator 200 ms before the dock shrinks.
- SPDX is settled as `GPL-2.0-or-later`: genie upstream's own `README.md` states it, which is
  the author's election. Do not tighten it.
- Withdrawn, do not re-propose on a saving argument: dodge's hidden-state heartbeat as a CPU
  cost (measured enabled 556 → disabled 524 → enabled 518 ticks, i.e. under noise), and an
  ease-in on the genie trailing edge (measured visible motion within ~3 frames).
- `dash._dashSpacer` in `dockManager.js` is **inert on 50.1 and stays anyway** (D-064): the field
  exists nowhere in this shell's sources, but 48/49 are declared and cannot be run here, so
  deleting it would be an untested behaviour change on a version the fork claims to support.
  Remove it only after checking it is really gone on 48/49 — do not treat "dead on 50" as
  licence.
- The magnification tick is single-pass by measurement, not by taste: 12 position reads per frame
  for 6 icons before D-063, 6 after (`tick-geometry-reads`). Anyone re-splitting that loop is
  re-introducing the thing the check counts.
- On a dense boot the dock deliberately does **not** dodge for up to ~6 s. That is the chosen
  cap, not a bug. The knob is `STARTUP_GRACE_CAP_MS` alone.

## 12. Schema, settings and the compiled binary

- Key count: `test:static` prints it (`compiled-fresh`), because a number copied into this file
  would only go stale — it is 57 here and grew with D-058's two toggles. `prefs.js` binds 45 of
  them; the 12 it does not are pinned by name in the guard (the ten `keynav-app-N` slots the
  keyboard code steals from the shell, plus `keynav-stock-backup` / `keynav-stock-dirty`, its
  crash-recovery bookkeeping) — note that `keynav-enabled` and the two `keynav-peek-*` keys
  **are** bound, so "everything except `keynav-*`" is not the rule. Tier 1 asserts that set
  difference exactly, so a new key cannot silently skip the prefs window, and both READMEs must
  carry a row for every key.
- `schemas/gschemas.compiled` is a **tracked binary**. Regenerate with
  `glib-compile-schemas schemas/` after any XML edit — the shell reads defaults from the
  compiled file, so a stale one means running defaults differ from what the XML says.
  `static-checks.sh` S6 recompiles into a temp dir and compares: byte-identical when
  reproducible (it was on this box), otherwise it falls back to comparing the key sets the
  two sources expose.
- Startup timing constants are **code constants, not settings** (`dodge.js:65-67`,
  `iconManager.js:28,32,33`). Changing them needs an edit and a logout.
- The `gsettings` CLI cannot even see this schema without
  `GSETTINGS_SCHEMA_DIR=<repo>/schemas`.

## 13. Privacy rules for a public repository

- Commit messages may quote **tags and numbers**, never raw journal lines and never a window
  title. Precedent: `f93ef54` turned `DODGE_DEBUG` on for one boot and `5c84880` reverted it;
  both bodies quote real titles, and they are now public. Write "a mail client window" or
  "an autostart entry" instead.
- `hide-trigger` and any `DODGE_DEBUG = true` must never reach a commit. Tier 1's `DODGE_DEBUG`
  guard and group A's tripwire exist to make that mechanical.
- No resolved temp paths, wayland slot names, host names, user names or mail addresses in
  tracked files. Tier 1's machine-fingerprint guard checks exactly those, and prints nothing it
  finds.
- Report output is value-only: counts, extracted numbers, and never a message body.
- Phase evidence (`PROFILE`/`AUDIT`/`PLAN`/`VERIFY`/`STATE`/`REVIEW-PACK`) lives in `docs/reports/`,
  which is gitignored — tier 1 tests two halves, in this order: nothing under it is tracked, **then**
  the ignore rule is present. The order is not cosmetic: `git check-ignore` reports a path already in
  the index as not ignored, so leading with the rule would mis-diagnose a force-added evidence file
  as "the rule is missing". The pattern is `reports/` with no leading slash, so it matches at any
  depth. Journal lines, window titles and resolved paths may appear **there** and nowhere else; the
  standard for tracked files and commit bodies is the value-only rule above, not the `docs/reports/`
  exemption.
- Evidence directories stay under `$TMPDIR`, mode 700, deleted at the end; `--keep` is for
  humans reading them locally, not for committing them.

## 14. Known issues (recorded, not fixed)

- `metadata.json` declares 48 and 49, and **neither has ever been run here**. Everything the fork
  claims about those majors is inference from 50.1 (see §15). Closing this needs a machine or an
  image with 48/49, not more reading.
- The idle-cost baseline in §16 does not exist yet: the only sample taken so far was on a busy
  machine (27.5 s CPU per 60 s, which measures other work). A real baseline needs the A/B arms on a
  quiet session, which is the user's to run.
- Group B's release confirmation depends on the compositor letting the probe window hold
  focus. When it cannot, the check reports ENV. Running it on an idle session answers it.
- Genie's *visual* correctness is unverifiable here (no screenshots, no injection) and is
  covered only structurally: `_validate()` in headless and live, plus the eight failure logs
  and the permanent `end-without-complete` latch staying silent across real minimize and
  restore cycles.
- The pointer-gated peek suppression inside `_onPointer` is proven by construction — same
  predicate, evaluated before the hold can fire — but never observed, because pointer input
  is unavailable.
- `gschemas.compiled` byte reproducibility is only known to hold on this box, and only for
  this glib version.
- Group A's `overview-flicker` count describes **the code that ran this boot**, not the
  working tree: the journal it reads was written before any logout. Until a fix is loaded it
  reports the old boot's 40 as `ENV`, which is correct behaviour and not a pass — a real
  verification needs a logout plus a reproduction, and then the number must be 0.
- Tier 1's counts are floors, so coverage can regress by *renaming* a suite rather than
  breaking it.


## 15. GNOME compatibility matrix

Two columns matter and they are not the same thing: what `metadata.json` **claims** and what has
been **measured on this machine**. Keeping them in one column is how a fork ends up shipping
support it never tested.

| Shell | Declared | Measured here | Facts this fork depends on, per that build |
|---|---|---|---|
| 45–47 | no | no | Not supported. The ES-module rewrite, `Meta.get_window_actors()` shapes and `St`/`Clutter` versioning all moved before 48; nothing here is aimed at them. |
| 48, 49 | **yes** | **no** | Untested. The one known divergence is `dash._dashSpacer`: absent in 50.1 (so the branch in `dockManager.js` is inert here) and unverified on 48/49, which is why D-064 kept the branch instead of deleting it. Anything else claimed for 48/49 is inference from 50.1, nothing more. |
| 50.1 (mutter-18, gjs 1.88) | yes | **yes — the shipping target** | `Main.overview.visibleTarget` exists (dodge's overview reconcile reads it, with a `visible` fallback). `ControlsState = {HIDDEN:0, WINDOW_PICKER:1, APP_GRID:2}` and the fork now resolves it from the module instead of hardcoding `2` (D-061). `dash._dashSpacer` does not exist. `Layout._trackActor()` auto-untracks on `destroy` (`layout.js:962-965`) — see §8. The overview clamps the dash to `box.height * DASH_MAX_HEIGHT_RATIO` = 0.16 (`overviewControls.js:23,174-178`). `Main.uiGroup` is a documented back-compat alias. Shell JS lives in `/usr/lib/gnome-shell/libshell-18.so` as a GResource (111 `ui/*.js`), **not** in `/usr/share/gnome-shell`. |
| 51 and later | — | — | See the procedure below. Expect the library name to change (`libshell-19.so`), which breaks every source-lookup command in this file. |

**When a new major appears** (the full playbook is §7; this is the version-specific part):

1. Add the new major to `metadata.json` **before** upgrading. `extensionSystem.js` decides
   `_isOutOfDate` with `v.startsWith(major)`, so an unlisted major means the extension silently
   never loads — you would be debugging an extension that was never running.
2. Find the shell sources: `ls /usr/lib/gnome-shell/libshell-*.so`, then
   `gresource list <that file> | grep '/ui/'`. Do not assume the number from the last row.
3. Re-check §8 symbol by symbol against the extracted files, in this order (each one has already
   moved at least once in this fork's history): `Main.wm._minimizing`/`_unminimizing`,
   `WorkspaceLayout.prototype._getWindowSlots`, `Main.overview.dash.get_preferred_height`,
   `ControlsState`, `Layout._trackActor`'s destroy connect.
4. Run tier 1 then tier 2 **on the new shell** — `test:headless` is the only place the private
   symbols get probed for real, and it needs no logout.
5. Tier 3 stays the arbiter of what users actually feel, and it is the one tier that reads a
   session you must not mutate unattended.

## 16. Fixed method: idle CPU, memory and leaks

Written as a procedure with a *witness* step because a single sample of a busy machine is
worthless: one 60 s read taken while writing this section reported **27.5 s of CPU in 60 s
(45.8% of one core)** for the session shell — that was other work on the box, not the dock. The
pass/fail question is never "how many ms" but "how much more with the extension on than off".

**Arms.** A/B on the same timeline, one variable: extension enabled vs disabled. `disable`+`enable`
does re-run `stop()`/`enable()` on the cached classes, so it is a valid arm switch even though it
never loads edited code. Every arm needs the session otherwise untouched: no typing, no video, no
agent running a build, at least 60 s per arm, two repeats.

```sh
# identity: never pgrep -x gnome-shell blind — other agents run --headless shells
pid=$(bash -c 'source test/common.sh; shell_pid'); HZ=$(getconf CLK_TCK)
cpu(){ awk -v h="$HZ" '{print ($14+$15)/h}' "/proc/$pid/stat"; }   # seconds of CPU
rss(){ awk '/VmRSS/{print $2}' /proc/$pid/status; }                # kB
fds(){ ls "/proc/$pid/fd" | wc -l; }
t0=$(cpu); r0=$(rss); f0=$(fds); sleep 60; t1=$(cpu); r1=$(rss); f1=$(fds)
python3 -c "print('cpu_ms_per_min=%.0f rss_delta_kb=%s fd_delta=%s' % (($t1-$t0)*1000, $r1-$r0, $f1-$f0))"
```

**Memory points.** Sample at three fixed points, always in this order: after login + settle, after
N `enable`/`disable` cycles, after N minimize/restore cycles. Report the deltas against the first
point. Do not invent a threshold before a baseline exists: the band comes from the first measured
run, and a `MAINTENANCE` number that was not printed by a run is a guess.

**Witness — this is the step that gets skipped.** A flat RSS curve proves nothing if nothing
happened during it. Each round must record evidence that the work occurred: the count of
`[dodge] … -> …` transition lines, `enable() total` lines, `minimize`/`unminimize` pairs. If the
witness count is 0, the sample is discarded, not reported as clean — the same rule as §1's
"an assertion that cannot distinguish regression from a busy machine is `ENV`".

**Actor/source leaks.** Alongside RSS, count what should have been freed:
`global.get_window_actors().length` and, in a private shell only,
`Main.layoutManager._trackedActors.length` before and after an enable/disable cycle (tier 2's
`chrome-untracked is the assertion of record there). fd counts catch D-Bus and file-descriptor
leaks that RSS hides.

**What this cannot measure here.** Hover feel, genie's visual quality and anything needing a real
cursor: pointer injection is unavailable (`/dev/uinput` is `0600 root:root`, XTEST warps never
reach the compositor cursor, no EI/Ember portal), and screenshots are `AccessDenied`. For those
the tick *counts* are the honest proxy — `tick-geometry-reads` proves the per-frame work shrank —
and the perceptual question stays with the user (§10).
