# CHANGELOG — macos-dock@local

Personal maintenance fork of [MacOSDock](https://github.com/vinnytherobot) by vinnytherobot, frozen at
upstream **v9** and imported at `a2140d0` (with the genie animation merged in from the Genie
effect). This file records only deviations I introduced after that import.

Coverage: a2140d0..HEAD
Check with `npm run check:log`. Entries are `D-###`, monotonic, never reused.
An entry states what was true **as of its commit**, not current state: old entries are not
re-verified, and aggregate counts live in the checker's output, never in this file.

> **Why the window starts at the baseline and not at the `freeze-2026-09-23` tag.** That tag points
> at `85eb488`, an ordinary separator-line fix, not at a state boundary; anchoring there would have
> silently dropped the whole P1/P2 batch (`0a40055` … `bc924ad`) from the record. The tag is left
> alone — it is a release marker, not a coverage boundary.

> **How these were written.** `Symptom` / `Change` are compressed from commit subjects plus the
> state of the touched file at HEAD; diffs were not re-read one by one. `Evidence` names a test only
> where that suite was re-run in the session that wrote the entry (`test/static-checks.sh`, 5 checks
> pass at adoption); everything else is `L?`. Subjects carrying P1-x / P2-x are audit ids from
> `MAINTENANCE.md` and are kept verbatim so the two can be cross-read.

`kind`: `fix` bug · `perf` measurable degradation only · `taste` my preference, zero obligation ·
`guard` detects drift · `revert` withdraws earlier work · `chore` cleanup owed nothing either way.
Animation *feel* is `taste`, not `fix`: those entries are the ones an upgrade may discard wholesale.

---

### D-001 · 2026-09-22 · revert · v1
Symptom  The early performance optimizations and startup-timing changes went beyond what "frozen maintenance" should own
Change   Reverted that batch wholesale, tightening scope to frozen-maintenance standards
Evidence L?
Cost     **The scope ruling for this repo**: every later change is measured against this line. Before re-proposing similar optimizations, read MAINTENANCE §11
Commit   c35f763

### D-002 · 2026-09-22 · fix · v1
Symptom  After login the whole row of dock icons flickers
Change   Restored the `_started` startup guard
Evidence L?
Cost     Same startup-reveal chain as D-011 / D-022
Commit   85138ac

### D-003 · 2026-09-23 · fix · v1
Symptom  Show/hide logic was split across two places; plus five small startup-time and leak issues
Change   Merged the dodge show/hide logic and fixed those five
Evidence L?
Cost     This is a wip commit bundling several things; rolling back any one item means re-reading the diff
Commit   1c7e613

### D-004 · 2026-09-23 · perf · v1
Symptom  P2-8: dodge's hide log spams during animation-blocked periods
Change   Moved the hide log behind the `_hide()` guard
Evidence L?
Cost     Logging surface, no behavior change; but it is also the readout source for "animation blocked"
Commit   bc924ad

### D-005 · 2026-09-23 · fix · v1
Symptom  P2-7: dodge's `stop()` / `_refreshDodge()` force opacity to 255, interrupting the startup fade-in
Change   Respect the startup fade-in, no longer force the value
Evidence L?
Cost     Same class as D-002 — startup-phase mutual overwrite; both must be guarded
Commit   f32f185

### D-006 · 2026-09-23 · fix · v1
Symptom  P2-6: magnification polling and dockManager keep running after the container is destroyed
Change   Added a container-destroyed guard (mirroring dodge's approach)
Evidence L?
Cost     The guard pattern exists once in each of three modules; changing one means checking the other two
Commit   8dc784c

### D-007 · 2026-09-23 · fix · v1
Symptom  P2-9: the fade-out `onComplete` callback of `_doWindowChange` touches an already-destroyed actor
Change   Added a destroyed-guard in the callback
Evidence L?
Cost     Only triggers when the animation is interrupted; the static tier can't catch it
Commit   9c24e55

### D-008 · 2026-09-23 · chore · v1
Symptom  P2-12: iconFix uses a bare number to test the window type
Change   Switched to the `Meta.WindowType` symbol (no behavior change)
Evidence L0 Re-ran `test/static-checks.sh` this round (all 19 js files parse, schema compiles identically)
Cost     No behavior change; a readability edit that an upgrade is neither obliged to keep nor loses anything by dropping
Commit   e68a6e2

### D-009 · 2026-09-23 · fix · v1
Symptom  P1-1: `installed-changed` / `favorite-apps` always trigger a full rebuild, with flicker visible outside settle
Change   All switched to incremental sync
Evidence L?
Cost     Incremental correctness depends on D-014's `_enforceOrder` not false-positive; the two are a pair
Commit   0a40055

### D-010 · 2026-09-23 · fix · v1
Symptom  P1-3: the preview popup doesn't follow hovered-app switching, or reuses when it shouldn't
Change   Reuse only for the same app; can revive during the exit animation
Evidence L?
Cost     Cross-references the overview state; changing this means looking at D-050
Commit   cd4d56b

### D-011 · 2026-09-23 · perf · v1
Symptom  P1-2: magnification wakes at a constant 60Hz, running even when idle
Change   Stop the timer when idle, restart when approaching
Evidence L?
Cost     After stopping the timer, "approach" has only one wake path, which fails when the Dock appears — exactly the second path D-033 adds
Commit   35e7b59

### D-012 · 2026-09-23 · perf · v1
Symptom  P1-5: dodge polls at a fixed 500ms, sluggish when hidden and close to the edge
Change   Adaptive rate: 120ms when hidden near the edge, otherwise a 500ms heartbeat
Evidence L?
Cost     Both period values are compromises, not optimal; changes need re-measuring
Commit   1b6c0a7

### D-013 · 2026-09-23 · fix · v1
Symptom  P1-4 option A: when the stock shortcut schema is broken by an upstream change, the whole extension won't start
Change   Added a crash self-heal sentinel (own schema stores a backup + dirty flag)
Evidence L0 Re-ran `test/static-checks.sh` this round (schema-valid / compiled-fresh: 55 keys agree across three sides)
Cost     **A sentinel-class fix**: the criterion is "can a dirty state be induced on purpose", not "runs green"
Commit   2d12d57

### D-014 · 2026-09-23 · fix · v1
Symptom  `_enforceOrder` false-positive: index comparison counts separators and buttons as positions
Change   Index comparison excludes separator/button; zero movement in steady state
Evidence L?
Cost     A false-positive drags incremental sync (D-009) back to a full rebuild
Commit   b553792

### D-015 · 2026-09-23 · guard · v1
Symptom  Separator show/hide anomalies can't be located, lacking counts and a trigger source
Change   Added instrumented logging on separator add/remove (favs/running counts + trigger source)
Evidence L?
Cost     Pure observation; once removed, that class of show/hide problem goes back to guesswork
Commit   148ba0f

### D-016 · 2026-09-23 · perf · v1
Symptom  The grace period has a fixed cap, needlessly prolonging the dock reveal after boot
Change   Conditional early finish (floor 400ms + 500ms silence, cap 1200ms **early only, never late**)
Evidence L?
Cost     "Early only, never late" is this entry's constraint direction; relaxing it to allow lateness reintroduces flicker
Commit   868d2b9

### D-017 · 2026-09-23 · fix · v1
Symptom  Separator-line removal and icon fade-out are misaligned: fading icons aren't counted, settlement happens too early
Change   Count fading icons, settle on fade-complete
Evidence L?
Cost     The `freeze-2026-09-23` tag lands on this one; it is not a coverage boundary (see header)
Commit   85eb488

### D-018 · 2026-09-24 · perf · v1
Symptom  The dock's first frame is held back by grace; fully opaque only at T0+1440ms
Change   Reveal on the first frame; grace finish goes incremental (T0+1440ms → T0+250ms)
Evidence L?
Cost     Same startup-reveal chain as D-016 / D-002; the numbers are measured-at-the-time
Commit   3c0f611

### D-019 · 2026-09-24 · taste · v1
Symptom  Upstream has no genie minimize animation
Change   Introduced the genie animation engine and geometry module (GPL-2.0-or-later, see LICENSES.md)
Evidence L0 Re-ran `test/static-checks.sh` this round; `genieGeometry.test.js` covers the pure geometry functions
Cost     **This repo's largest piece of foreign lineage**: the license is GPL-2.0-or-later rather than upstream's GPL-3; read LICENSES.md before touching this
Commit   c372a51

### D-020 · 2026-09-24 · taste · v1
Symptom  genie needs the "icon square" rather than the whole button's rectangle
Change   Added an icon-rectangle resolver (reusing the appId→icon-actor map)
Evidence L?
Cost     Depends on the stability of the appId map; an upstream rename degrades silently
Commit   9ff76f4

### D-021 · 2026-09-24 · taste · v1
Symptom  genie wasn't wired into minimize/restore, and the completion callback fired more than once
Change   Wired into minimize/restore, callback fires exactly once
Evidence L?
Cost     "Exactly once" is the premise for park-and-restore (D-026)
Commit   dc54ac0

### D-022 · 2026-09-24 · taste · v1
Symptom  dodge receives no peek request during animation; a peek duration can also be collapsed early by a shorter later request
Change   Support peeking during animation (toggleable), and take the longest duration
Evidence L?
Cost     The toggle is a preference; taking the longest duration is a bug fix — two things in one commit, split later if ever needed
Commit   4a94512 32f1c3f

### D-023 · 2026-09-24 · taste · v1
Symptom  Super+number triggers don't pop the dock
Change   Pop the Dock on trigger, with its own toggle and duration
Evidence L?
Cost     Adds a configurable surface (schema key); reverting must revert the schema too
Commit   b02cb2c

### D-024 · 2026-09-24 · taste · v1
Symptom  genie's funnel axis, easing curve, tail fade-out range, squash and suction depth all needed to be pinned down
Change   Derive the funnel axis from the Dock edge; change easing to fast-in fast-out; tail fade-out applies only to the tail; squash/suction depth near icons pinned, finish changed to a smooth fade
Evidence L?
Cost     Pure look-and-feel, **droppable wholesale on upgrade**; the four commits are merged into one entry because together they constitute the single decision "what this motion looks like"
Commit   008fe04 70108bd 5a346eb 04a86de

### D-025 · 2026-09-24 · perf · v1
Symptom  genie allocates a new transform object every frame
Change   Zero allocation per-frame transform
Evidence L?
Cost     Same batch as D-024's look-and-feel tuning but a different criterion
Commit   7b3f41b

### D-026 · 2026-09-24 · taste · v1
Symptom  genie's grid count is fixed, so material density is inconsistent across window sizes
Change   Grid count adapts to the window
Evidence L?
Cost     A look-and-feel parameter
Commit   b19a4d0

### D-027 · 2026-09-24 · fix · v1
Symptom  genie's suction-depth default doesn't match the schema declaration
Change   Aligned the default with the schema
Evidence L0 Re-ran `test/static-checks.sh` this round (compiled-fresh: compiled artifact == XML == what the shell reads)
Cost     A schema/default mismatch is a silent defect, exposed only on first run
Commit   86cee0e

### D-028 · 2026-09-24 · perf · v1
Symptom  Magnification smoothing advances by frame count, so speed jumps on dropped frames
Change   Changed to time-based
Evidence L?
Cost     Same batch as D-024 but a different criterion
Commit   ae1b073

### D-029 · 2026-09-24 · taste · v1
Symptom  Magnification effects interfere with each other during the genie animation
Change   Pause magnification during the genie animation
Evidence L?
Cost     A look-and-feel decision
Commit   369e441

### D-030 · 2026-09-24 · perf · v1
Symptom  dodge still polls when static
Change   Stop polling when static
Evidence L?
Cost     After stopping the poll a wake path is needed; see D-033
Commit   19cc16f

### D-031 · 2026-09-24 · fix · v1
Symptom  dodge's slide direction is fixed, so the axis is wrong when the Dock is on the left/right/top edge
Change   Slide axis follows the Dock position
Evidence L?
Cost     Only exposed under multi-position configs
Commit   e56c3f7

### D-032 · 2026-09-24 · perf · v1
Symptom  On genie restore the source actor is still in the scene; restore runs per-frame
Change   Restore runs from a snapshot and parks the source actor
Evidence L?
Cost     Parking is coupled to mutter's count accounting; see D-035
Commit   1cf8628

### D-033 · 2026-09-24 · taste · v1
Symptom  During the genie animation dock icons are static, lacking a response
Change   Icons press down slightly and bounce back
Evidence L?
Cost     Look-and-feel; its liveness check was later guarded by D-036
Commit   b6ab9fb

### D-034 · 2026-09-24 · taste · v1
Symptom  Incrementally added icons just pop in hard
Change   Fade in new icons
Evidence L?
Cost     Look-and-feel
Commit   93998f4

### D-035 · 2026-09-24 · fix · v1
Symptom  dodge misses window drag and resize (polling can't see geometry events)
Change   Changed to per-window geometry listeners
Evidence L?
Cost     Listener lifecycle must pair with D-006's destroyed-guard
Commit   de39891

### D-036 · 2026-09-24 · fix · v1
Symptom  genie's takeover order and park-and-restore cause mutter actor-count underflow
Change   Fixed the takeover order and restore path, eliminating the underflow
Evidence L?
Cost     Count accounting must balance; the criterion is "the count returns to its original value after each animation round"
Commit   72771bb

### D-037 · 2026-09-24 · fix · v1
Symptom  Separators are decided by the un-settled icon count, producing orphan separators
Change   Decide by the real icon count
Evidence L?
Cost     Same problem's two faces as D-015's instrumentation
Commit   b772371

### D-038 · 2026-09-24 · perf · v1
Symptom  Running-indicator dots each walk the windows every refresh round
Change   Walk the windows only once per round
Evidence L?
Cost     Once the walk result is shared, a write in any one place affects the others
Commit   c010ce4

### D-039 · 2026-09-24 · fix · v1
Symptom  The icon-press liveness check doesn't tolerate an already-destroyed wrapper
Change   Tolerate an already-destroyed wrapper
Evidence L?
Cost     In GJS, accessing a disposed object is a runtime error, not a silent no-op
Commit   1fe7887

### D-040 · 2026-09-24 · fix · v1
Symptom  After the magnification poll stops, the Dock isn't woken when it appears (only one wake path)
Change   Added a second wake path (when the Dock appears)
Evidence L?
Cost     The number of paths is the criterion for this class of stop-the-timer logic; a single path means it will fail
Commit   709fe31

### D-041 · 2026-09-25 · fix · v1
Symptom  Separators are forced out while a fading icon hasn't yet disappeared
Change   Decide by settled state; fading icons no longer force out a separator
Evidence L?
Cost     Same separator-decision chain as D-017 / D-037; all three must agree
Commit   508efea

### D-042 · 2026-09-25 · perf · v1
Symptom  dodge's fullscreen test is guesswork and always listens to chrome windows
Change   Use mutter's authoritative state for fullscreen, stop listening to chrome
Evidence L?
Cost     One fewer listener class is one fewer wake class; going back to self-judging reintroduces false hides
Commit   161889d

### D-043 · 2026-09-25 · taste · v1
Symptom  genie material piles up uniformly along the axis, visually unlike being sucked into the dock
Change   Non-uniform axial pile-up, material converges toward the icon mouth
Evidence L?
Cost     Pure look-and-feel, zero obligation
Commit   a9b0625

### D-044 · 2026-09-25 · taste · v1
Symptom  genie's duration doesn't respect the accessibility slow-down setting
Change   Duration follows `slow_down_factor`
Evidence L?
Cost     This is where "look-and-feel" meets "accessibility compliance"; dropping it becomes an accessibility defect, not a preference
Commit   ec56b03

### D-045 · 2026-09-25 · chore · v1
Symptom  Temporary diagnostic probes left over from genie debugging are still in the code
Change   Cleaned up the temporary genie diagnostic probes
Evidence Not applicable (no behavior change)
Cost     Leftover probes distort the next readout; they must be removed cleanly and re-read
Commit   3051cd9

### D-046 · 2026-09-25 · fix · v1
Symptom  Show requests during the hide animation are simply dropped
Change   Show requests during the hide animation are no longer dropped
Evidence L?
Cost     Same show/hide state machine as D-005 / D-031
Commit   ae2993f

### D-047 · 2026-09-25 · fix · v1
Symptom  Boot avoidance uses a fixed 2-second grace, either too long or too short depending on machine speed
Change   Changed to a "window silence" criterion
Evidence L?
Cost     Once it's a criterion it can only be verified with D-015-style instrumentation; don't fall back to a constant
Commit   6b66a2a

### D-048 · 2026-09-25 · chore · v1
Symptom  A boot-scene evidence run is needed; dodge logs are off by default
Change   Temporarily turned on `DODGE_DEBUG` (only for that one verification)
Evidence L?
Cost     A **temporary** toggle; it is withdrawn by D-049, the two must be read as a pair
Commit   f93ef54

### D-049 · 2026-09-27 · fix · v1
Symptom  genie computes c1/c2 with an unclamped curvature, geometry breaks down under extreme settings
Change   Compute with a clamped curvature, and add this repo's first test suite
Evidence L0 Re-ran `test/static-checks.sh` and `npm test` this round (genieGeometry / signalManager / repo suites among them)
Cost     The tests and the fix are the same thing; rolling back the fix turns the suite red
Commit   f724c38

### D-050 · 2026-09-28 · revert · v1
Symptom  D-048's temporary debug toggle shouldn't stay in the tree
Change   Revert "chore(debug): temporarily turn on DODGE_DEBUG"
Evidence L?
Cost     Pairs with D-048. Recording one revert is more useful than recording ten successes — this is exactly that "why we tightened it back then" evidence
Commit   5c84880

### D-051 · 2026-10-07 · fix · v1
Symptom  The overview exit animation bounces the dock back (visibility target not corrected)
Change   Correct the overview state by `visibleTarget`
Evidence L?
Cost     The criterion is written in MAINTENANCE §11; the signature is "a single bounce when the exit animation ends"
Commit   6863e43

### D-052 · 2026-10-07 · fix · v1
Symptom  Edge detection and polling thresholds both assume the primary monitor, failing when the dock is on a secondary screen
Change   Use the geometry of the monitor the dock is on
Evidence L?
Cost     Only exposed with multiple monitors; conclusions verified on a single screen don't hold for this
Commit   c45b46f

### D-053 · 2026-10-07 · fix · v1
Symptom  On extension disable, writing back the overview dash values captured at enable overwrote the user's changes during the session
Change   On disable, restore shell defaults instead of writing back the captured values
Evidence L?
Cost     Same recovery semantics as D-013's "backup + dirty": the restore baseline should be the default value, not the value I happened to see
Commit   cb8a34a

### D-054 · 2026-10-09 · fix · v1
Symptom  Hiding the built-in dash leaves it empty, so the overview's bottom reserved band collapses to the theme's inner padding (36px), below this dock's occupied height, and the dock's top edge intrudes into the window picker / app grid
Change   `_hideDefaultDash` shadows `get_preferred_height` on the hidden dash instance, reporting the dock's occupied height; `_showDefaultDash` restores via `delete`
Evidence L1 overview-band
Cost     In GNOME 50 the overview's bottom reserved band is derived by the shell from the built-in dash's preferred height (`overviewControls.js`); hiding it leaves the dash empty — **hidden does not mean out of layout**; `_dashSpacer` was already removed in GNOME 50, so the old approach is dead code
Commit   023b739

### D-055 · 2026-10-09 · fix · v1
Symptom  `test/headless-checks.sh`'s teardown only `kill`ed `dbus-run-session`; its forked private dbus-daemon and gnome-shell kept living after being reparented to systemd; one day's runs left 7 headless shells + 18 private dbus-daemons (~580 MB)
Change   Added `t2descendants` (collect children before parents, while `pgrep -P` can still see them before reparenting) and `t2killtree` (whole subtree TERM→KILL); the trap now calls `t2killtree`; `teardown` changed from a constant PASS to a real assertion — snapshot the subtree, reclaim, prove each pid is gone via `/proc`
Evidence L1 teardown
Cost     `dbus-run-session`'s children are not just the command itself but also its own dbus-daemon; `kill $INNER` can't reach a single one. **The criterion must be "all snapshotted pids are gone", not the return code of `kill`** — the previous round was fooled by the return code (the loop reported gone while all 7 were in `ps`)
Commit   1f7d0d3

### D-056 · 2026-10-09 · chore · v1
Symptom  A `SIGKILL`ed `test/headless-checks.sh` run (or a host power loss) leaves its sandbox dirs under `/tmp/macosdock-t2-*` in place, with nothing reclaiming them afterward; a manual cleanup once accumulated 16 (2.9 MB)
Change   Before creating `$T2`, add a startup sweep: reclaim `macosdock-t2-*` dirs with mtime over an hour, printing one non-report line if anything was reclaimed
Evidence L1 sandbox
Cost     The sweep must carry an **age gate** — deleting indiscriminately by name would kill a concurrently running fresh sandbox (a run ≤150 s). It is a hygiene action, not an assertion, so it deliberately does not emit a `report` line, and MAINTENANCE's "16 assertions" count doesn't have to change with it
Commit   b71ace1

### D-057 · 2026-10-09 · taste · v1
Symptom  In the overview, window previews poke past the desktop edges (20px left/right, 12px bottom), most visible when the window count pushes content to the bottom ("1 obvious, 2 none, 3 slight")
Change   Added `lib/overviewLayout.js`: wraps `WorkspaceLayout._getWindowSlots` on the prototype, passing the measured rectangle of the desktop background `WorkspaceBackground` as the slot area; `dockManager` mounts on enable, restores on disable; missing symbols in the structure probe degrade to native
Evidence L1 overview-window-inset
Cost     This is **the shell's own layout** (the preview container fills the whole box, the background insets within it), unrelated to the dock — the same whether the dock is on or off, so last time's dash-height change (D-054) never touched it. The patch depends on the shell's private layout; an upgrade rename degrades (one warn line, no crash). A visual preference: previews lose 12px of usable height and 40px of width, scaling everything down a touch
Commit   980c4db

### D-058 · 2026-10-09 · chore · v1
Symptom  Four non-dock concerns (overview layout patch, genie window animation, global shortcut, Show Apps button patch) are mixed with the dock proper: the overview patches (D-054/D-057) are always on and hardcoded in `dockManager`, and the Show Apps button patch rides under `icons-fix-enabled` — neither can be turned off nor has a clear boundary
Change   The overview layout patch is extracted into a new `lib/overviewPatches.js` (`overview-patches-enabled` toggle; dock height read via an injected `getBandMetrics()`, so the module no longer imports DockManager back); the Show Apps button patch is decoupled from `iconFix`/`icons-fix-enabled` into `apps-button-fix-enabled` (stop triggers an IconManager reload to restore the stock button); genie/keynav get boundary header comments (each already had its own toggle). Every non-dock concern = one module + one `*-enabled` + real start/stop + probe→warn-once→degrade
Evidence L1 overview-patches, apps-button
Cost     **In-place isolation, not splitting the extension**: these pieces genuinely couple to the dock (genie needs icon rectangles, keynav needs icon order, the button patch needs the dock's button), and hard-splitting would require cross-extension interfaces, which is more expensive. Do **not** bundle them back under the dock's own toggles. New schema keys must sync prefs (guarded by repo.test.js); `overviewApps`'s stop causes one dock rebuild/flicker (rare, as settings changes are)
Commit   0e15fff

### D-059 · 2026-10-09 · perf · v1
Symptom  One motion event resolves the dock's monitor twice: `_onPointer` calls `_dockMonitor()` once, then `_pointerFarFromEdge(px,py)` resolves again internally; each time converts `Main.layoutManager.monitors` into a fresh JS array and scans it linearly
Change   `_pointerFarFromEdge(px, py, monitor = null)` — callers that already resolved the monitor pass it in, and when omitted it takes the original self-resolving path; the coordinate-less `_shouldPark` call and the H13 geometry cases are behaviorally unchanged
Evidence L1 motion-monitor-resolve (measured `calls=2` red on pre-fix code, `calls=1` green post-fix)
Cost     Deduplication on the call graph, **no L2 millisecond figure**: this machine can't inject a pointer. Still worth doing because this path isn't rate-limited and is exactly the "follows the hand" decision path; quantifying the gain stays on §10's manual checklist
Commit   73c2f55

### D-060 · 2026-10-09 · guard · v1
Symptom  Two things had no assertion: the motion path's duplicate resolution (exactly what D-059 fixed), and "after disable, is our chrome actor still in `layoutManager._trackedActors`" — the latter was only a **static inference** in the audit
Change   `test/headless-checks.sh` gains two: `motion-monitor-resolve` (calls `_onPointer` directly and counts `_dockMonitor()` calls), `chrome-untracked` (destroy container → `disable()` → ask the registry). The destructive probe must run last — on the first run the later probes got ENV "no dodge instance", which was an instrumentation problem, not a code problem
Evidence L1 chrome-untracked
Cost     The audit's P1 conclusion "chrome registration leaks after disable" is **withdrawn**: no residue measured, the reason being on the shell side (`Layout._trackActor()` connects the actor's `destroy` to `_untrackActor`, already recorded in MAINTENANCE §8). `chrome-untracked` stays as a sentinel — if the shell ever drops that automatic connection, `dockManager.js:287` deciding whether to `removeChrome` based on `_container` liveness becomes a real leak again
Commit   75f034c

### D-061 · 2026-10-09 · fix · v1
Symptom  The Show Apps button tests "am I in the app grid" with a bare number `v === 2` (the shell's `ControlsState.APP_GRID`). A rename degrades, but a **reorder** makes it confidently answer wrong without a single log line; and its fallback `showAppsButton.checked` is exactly the stale source the same file's comment says is "no longer trusted"
Change   At module load, resolve `ControlsState.APP_GRID` once from `ui/overviewControls.js`; if it can't be resolved, warn-once and explicitly take the fallback. The `applied` log gains `grid=<n>`, turning "which value was used" into a readable criterion
Evidence L1 grid-state-source (red pre-fix: the log line had no `grid=`; green post-fix, equal to the enum value the same shell run reported)
Cost     Adds an import of a shell module (`overviewControls.js`), which is a public export rather than a private field. The log line format changed — if the third layer has assertions matching `applied (`, they must be checked too
Commit   18c4d8b

### D-062 · 2026-10-09 · fix · v1
Symptom  Two overview patches return a **noop revert** when they detect their own flag already set. That branch is only reached when "the previous revert threw and the caller swallowed it"; once taken, the shadowed `get_preferred_height` and the prototype's `_getWindowSlots` wrapper can never be removed for the rest of the session — not even by disabling the extension
Change   Construct the revert before the early return and share it across both branches (it's stateless: deleting its own property restores the prototype method); `overviewLayout` stores the original method on the prototype as `_dockOverviewLayoutOrig`, so that when already applied it doesn't store its own wrapper back as "original". Also added one warn-once: when `WorkspaceLayout._container` is renamed, `_previewArea()` only returns null and quietly falls back to the native layout, while the module header says "any missing piece warns once" — honoring the promise it made
Evidence L1 patch-revert-idempotent (red pre-fix: `shadowStillInstalled=true`, `insetStillApplied=true`; green post-fix, and the probe's teardown re-applies successfully)
Cost     The normal toggle path can't reach this branch anyway (`dockManager._startOverviewPatches` early-returns while holding the revert), so this is **defense in depth**, not a current defect; the `noop` variable still serves other purposes in both paths
Commit   0380cf9

### D-063 · 2026-10-09 · perf · v1
Symptom  The hover tick reads each icon's geometry twice per frame: one pass of `get_position()+get_size()` to compute minDist, another for scaling; in pivot correction `get_pivot_point()` is called once each for [0] and [1]; the `smooth` closure is recreated every frame. Measured: 6 icons in one frame = **12** position reads, each a new GI array
Change   A single geometry pass writes centers into a reused `_centers` pair array, after which the two passes read plain numbers; `smooth` is hoisted to module scope. Pivot is still set this frame, and the far-away early-return criterion and threshold are untouched
Evidence L1 tick-geometry-reads (red pre-fix 12/6, green post-fix 6/6). Instrumentation note: `global.set_pointer` doesn't exist here, so it shadows `global.get_pointer()` for exactly one frame and restores it in a `finally`
Cost     Only covers one semantic difference — "the array keeps an old tail when the icon count changes" — and the extra numbers aren't read (the loop is bounded by children.length). The human-perceived part remains on §10's list of what can't be automated
Commit   259fe4f

### D-064 · 2026-10-09 · chore · v1
Symptom  The audit lists the `dash._dashSpacer` branch as "dead code, delete"
Change   Verified before deleting: the name isn't found in this machine's shell `ui/*.js` (50.1 indeed lacks it), but `metadata.json` still declares 48/49, two majors that can't run here and whose fields can't be verified. So the **branch is kept** and the fact boundary written into the code: it is inert here, and removing it needs real-machine verification first
Evidence L0 (grep of the local shell source); the 48/49 side is "needs manual confirmation"
Cost     The converse also holds: deleting outright would be a behavior change to an unverified major, violating "stability first". This entry's purpose is to stop the next round from deleting the same "dead code" again
Commit   e067e5c

### D-065 · 2026-10-09 · guard · v1
Symptom  D-061/D-062/D-063 were all invisible to any check before being fixed
Change   Added three to the second layer: `grid-state-source`, `patch-revert-idempotent`, `tick-geometry-reads`; also renumbered all the layer's `H` indices in file order (previously H18 came before H17, and newly inserted blocks collided)
Evidence L1 the three each red→green, see D-061/D-062/D-063
Cost     `tick-geometry-reads` depends on shadowing `global.get_pointer` — one frame at a time, restored in a `finally`; leaving it in place would let later probes read a fake pointer
Commit   2498a28

### D-066 · 2026-10-09 · guard · v1
Symptom  Of 57 schema keys, README names only 2; adding a key to the schema gives no hint that docs are behind. Also: the stage evidence directory was previously `reports/` (repo root), inconsistent with `docs/reports/` in other repos of the same workspace
Change   First layer gains `README documents every settings key` — each bilingual README must have a line per key (key name appearing in backticks), run red first then fill the table; `reports/` moves to `docs/reports/` (the ignore rule is still `reports/` without a leading slash, effective at any level; `listFiles()` skips by basename, one place covers both); the S8 probe path moves to `docs/reports/` accordingly, and the "tracked count" half is **moved** before "ignore rule exists" — measured `git check-ignore` answers "not ignored" directly for a path already in the index, so the original order misreported "evidence already added" as "rule missing"
Evidence L0/L1 red→green twice each: the guard is red before the table is written (`README documents no row for: icon-size, magnification-enabled, …`), green after with 75 assertions / 21 suites; S8 ran four states in a throwaway clone — no rule=red (rule missing), rule present=green, `git add -f docs/reports/STATE.md`=red ("1 file(s) … tracked"), unstage=green
Cost     Each added schema key touches three places (one line in each bilingual README; this half is guarded, but whether the description is correct isn't). The README key table and `prefs.js`'s subtitle are two parallel copy surfaces and will diverge — known and chosen at decision time
Commit   a6a17a1

### D-067 · 2026-10-09 · guard · v1
Symptom  INVARIANTS.md is a hand-written pointer table: if an entry is deleted, a check renamed, or `taste` treated as "must not revert", it will **still display as a normal table**. AGENTS.md says it "doesn't copy the body text", but no one can mechanically judge whether it has started to
Change   Added `test/invariants.mjs` (pure Node) carrying rules 6.0–6.7: the table is non-empty, all four cells present with no placeholders, ids resolve to real entries, strictly increasing top-down, `taste` must not be listed as an invariant, the evidence column starts with L0/L1/L2/L?, hyphenated tokens in backticks in the evidence column must be check names the harness still reports, and the body must not copy a whole passage from the CHANGELOG. Two consumers share one implementation and one entry regex: `check-log.mjs` as the 6th item (`--invariants` runs it alone, so a docs-only change needn't go through a commit window), and `repo.test.js` runs the same validation under `npm test`, so both the first layer and CI catch stale rows
Evidence L0/L1 each rule reddened individually: `test/invariants.test.js` builds one violating table per rule and asserts the rule reported is exactly that one, plus a green control (a correctly formatted table reports zero, and `visible`/`lib/dodge.js`/`test:live-trigger` aren't mistaken for check names). The real table was reddened once each by four kinds of corruption in a throwaway clone — a renamed check (6.6), an id pointing to a nonexistent entry (6.2 with 6.3), treating the taste entry D-057 as an invariant (6.4), copying a 336-char passage from the CHANGELOG (6.7) — each time restored and re-verified green; `repo.test.js` via the first-layer path likewise red 1 / green 0
Cost     One **true red** surfaced here: 6.6's first version matched only lowercase, so renaming `tick-geometry-reads` to `tick-geometry-readX` passed silently; changed to accept both cases and underscores. Conversely it is deliberately lenient — if a non-check-name word is wrapped in backticks in the evidence column (shaped like `some-phrase`), you get a false red, and the cost is just removing those backticks. The doc line "12 keys have no preference row" is now backed by `EXPECTED_UNBOUND.length === 12`
Commit   c425a44

### D-068 · 2026-10-09 · chore · v1
Symptom  Two aggregate numbers copied into docs had already diverged from reality: `test/check-log.mjs`'s header said "57 commits that change code" (actually 65, and it changes with every commit), and `MAINTENANCE.md` §0 said "72 assertions, 20 suites" (actually 95/24, reading like a freshly tested number). The same class of problem has now been hit twice this round
Change   Both changed to command-derived: the header keeps no number, leaving it to this run to print; §0 changes to "`npm test` prints it itself, the first layer guards a floor". Also raised the first-layer floor from 72/20 **to 95/24** — the floor is designed so "adding tests won't go red", but staying below the real value long-term leaves room for 23 assertions' worth of "some suite is no longer collected"
Evidence L0 the reproduction commands are written into §15 (`git rev-list --count a2140d0..HEAD -- extension.js lib/ stylesheet.css`; `gresource list … | grep -cE '^/org/gnome/shell/ui/.*\.js$'`). Raising the floor was reverse-verified: in a throwaway clone, removing `test/genieGeometry.test.js` → `FAIL coverage dropped to 52/16 (floor 95/24)`, putting it back → `ok 95 assertions in 24 suites`, clone deleted
Cost     From now on every added case must raise the floor in the same change, otherwise "added but not raised" means the next real suite loss still passes green. This is a **convention, not a guard** — no check can detect "the floor is set too low"
Commit   edc7706 e3159da

### D-069 · 2026-10-10 · fix · v1
Symptom  Group B's `flag-control` runs unconditionally. In the round where B3 reported ENV because mutter wouldn't give focus to the probe window, B4 ran the flag-off arm in the **same broken-focus environment**, got no show, and judged `FAIL still suppressed with the setting off — B3's silence was not the fullscreen branch` — worded as a product regression but actually instrumentation
Change   Record B3's return code (`B3_RC`); when non-zero, `flag-control` goes straight to ENV and **skips** the flag-off arm, and correspondingly doesn't write `hide-in-fullscreen`
Evidence L2 both paths really ran the same day: the pre-fix run was `ENV fullscreen-suppresses-show` + `FAIL flag-control` (15 pass / 1 fail); the post-fix rc=6 run reported `ENV flag-control — B3 gave no attributable sample (rc=6)`, and the normal-focus run had B3/B4/`fullscreen-reversible` in one PASS (20 pass / 0 fail / 1 env)
Cost     On B3 failure the flag-off independent information is no longer obtained (one less piece of evidence, but that evidence was unattributable anyway); `control`'s latency decision has another environmental noise source, see MAINTENANCE §14 (the first few minutes after login)
Commit   c5972fc

### D-070 · 2026-10-10 · guard · v1
Symptom  D-061 and D-062 had only headless-layer evidence: whether the enum really resolves in a live session, and whether the patch really re-installs after an idempotent revert, were never asserted by any log line
Change   Group A gains `grid-state-loaded` (`[appsbtn] applied (… grid=<n>)` must be an integer; `null` = fell back to the button's `checked` → ENV; missing line → ENV; wrong shape → FAIL), group B gains `overview-patches-roundtrip` (after a real `disable→enable` the `enabled (inset=ok band=ok)` must reappear, and the two degradations `band skipped` / `overviewlayout disabled` are checked). `preflight` also prints shell uptime seconds, with the reminder appearing only below 300 s
Evidence L2 real machine: `grid-state-loaded PASS (value 2)`, `overview-patches-roundtrip PASS (reinstalled 0 s after toggle)`. Branch coverage ran each of four synthetic journals once by extracting the source text, yielding PASS / ENV / ENV / FAIL; preflight's two branches each ran once with a stub clock
Cost     `grid-state-loaded` **deliberately doesn't cap 0/1/2** — D-061's reason for existing is distrusting the literal, and the criterion can't invite it back; the cost is that when the shell moves the enum elsewhere this only reports the shape. The first preflight version unconditionally appended an "under ~5 min" reminder, flagging its own 553 s as suspect — the check's text contradicting its own data — now made conditional
Commit   c5972fc

### D-071 · 2026-10-10 · chore · v1
Symptom  §16's witness step requires "each round, record evidence that the work was actually done", with the evidence being the extension's own log lines (`[dodge] … -> …`, `enable() total`). The off arm by construction emits no tagged log line — by this rule every control arm is automatically judged invalid, and A/B can never complete. The rule is unexecutable
Change   The witness changes to activity the harness **drives itself and counts independently** (probe-window mapping/unmapping, minimize/restore requests issued) plus the window's `load1`; extension logs are from then on the subject under test, not the witness. §16's "two arms" section also gains the premise that "the agent doing the measurement must not be running"
Evidence L1 the first six-arm A/B measurement (same code, `pid=3147`): each of A/B used about 25.6–29.7 s CPU / 60 s, paired diffs −1191 / +1020 / −1171 ms (sign-flipping), one pair's RSS +40264 kB unrelated to the dock, and 4 of 6 arms witnessed 0 → **all discarded** per the rule. `final state=ACTIVE enabled=Yes`, the teardown trap fired, and the extension wasn't left disabled
Cost     An idle baseline still doesn't exist, so §16 has process but no bandwidth, and no number is a threshold; and (a) this sampling **can't be done by the agent inside a session** — the moment I run I'm polluting it, only you can take it while the agent is stopped. The old-style §14 wording ("leave it for the user to run on an idle session") was insufficient to explain why this run still doesn't count, so it was rewritten
Commit   2b9cd8a

### D-072 · 2026-10-10 · guard · v1
Symptom  Group A treated "`overview -> show` appearing within 300ms after a hide" as the signature of exit-animation preemption and judged FAIL on it. This shape is not sufficient for flicker: the dock collapses due to occlusion and the overview then genuinely opens via a non-keyboard path, writing exactly the same two lines — dodge's log line records the decision, not the state backing it. This session's journal had 2 such pairs, both genuine entries, and the check reported red
Change   The verdict looks at only one shape: `overview -> show` overturned by a hide within 600ms, with no entry witness between them (`canary overlay-key`, Show Apps' open-grid). Every measured genuine entry received a witness 2–15ms after show; the defect shape occurred zero times. The old "pair" shape is kept as an independent count, printed only as context, and doesn't enter the verdict. Also added a blank guard: the sampling window is closed by `_PID=`, and if the session shell restarts with no overview entry in the window it's ENV rather than PASS
Evidence L1 added `test/flicker.test.js` with 9 cases, all shapes taken from measurement (defect chain / rapid double-hit / genuine entry without witness / 600 and 601ms boundary / difference between open-grid and close / empty cache); the code block extracted verbatim in `live-checks.sh` forced out ENV, FAIL, PASS branches one by one on synthetic caches; the same shapes compared old vs new — the defect shape is 2 under both, the genuine-entry shape old-judged 1 and new-judged 0. That day's three layers measured 9/9, 24/24, 9/9, `check:log` PASS. The blank guard's motivation was measured: after the shell restarted at 11:19:34, this check gave an impossible-to-go-red PASS on a 3-second window
Cost     The blind spot is written into the helper comment rather than hidden: entering the overview via hot corner or trackpad gesture produces no witness, and if closed within the same 600ms this check misjudges it as flicker; measured, such entries' subsequent hides fell 1.7–56 s later, far outside the window. Narrowing doesn't change historical conclusions — the original sample of that old boot, 40→0, is not reproducible, and wasn't re-measured this time
Commit   50ad4f0

### D-073 · 2026-10-10 · guard · v1
Symptom  The stale gate compares the shell process's start time against the newest mtime among `git ls-files '*.js'`. This glob includes js under the test directory, which the shell never loads: counting a new test file by post-commit state makes the gate permanently report "running code is older than disk", downgrading group A as a whole to an ENV that represents no risk
Change   Narrowed to `extension.js` and `lib/*.js`, i.e. the set the shell actually imports; `prefs.js` is excluded too — it runs in the prefs process, whereas group A asserts about the shell
Evidence L1 measured twice the same day: the old set (counting a new test file by post-commit state) had newest mtime 11:29:54 later than the shell start 11:19:34 → judged STALE (false alarm); the new set's newest mtime 17:54:12 (previous day) earlier than the shell start → judged fresh. The new set's arithmetic yields STALE / fresh on either side of started = newest±1, so the gate can still truly go red. The new set covers 16 files, 7 excluded
Cost     After editing the prefs page or a test file, group A no longer warns stale — correct behavior, but it means "is the code in the prefs process loaded" is outside group A's guarantee
Commit   50ad4f0

### D-074 · 2026-10-10 · guard · v1
Symptom  Tier 3's journal cache holds real shell log lines but lands in /tmp as 0664, with nothing guaranteeing reclamation: `common.sh` blanks `JOURNAL_CACHE` on source, overriding the path the runner pinned → each tier process picks its own mktemp name; and `shell_start_ms()` and preflight call `journal_load` inside command substitution, so the assignment lives only in the subshell and the parent's cleanup can't see the file
Change   Fixed all three together: `umask 077` at the top of `common.sh` (one line covering the three mktemp points and the `> "$JOURNAL_CACHE.part"` redirection, harder to miss than per-point chmod); `JOURNAL_CACHE='${JOURNAL_CACHE:-}'` respects an inherited value; `run-all.sh` pins the cache into the evidence dir it `rm -rf`s on exit
Evidence L1 one sweep cleared 83 `/tmp/macosdock-*` (oldest 2026-10-01, mode 0664), and after the fix each of the three layers left 0. Added `test/temp-hygiene.test.js` with 4 cases; the first three are red on the original file from `git show HEAD:test/common.sh` (umask 0002 / 664 after the write-move chain / the pinned path blanked) and 4/4 green on the new code; the fourth is a control (must be empty when nothing is pinned). Floor re-exported 108/27, tier 1 9/9, tier 2 24/24, tier 3 9/9
Cost     The harness process henceforth creates all files as 0700/0600 — currently it only writes its own temp files; if a future check must produce a user-readable report, the mode must be changed explicitly. The cache shares one path across tiers within a run, which is exactly what makes reclamation work
Commit   9932da2

### D-075 · 2026-10-10 · guard · v1
Symptom  The privacy guard takes an identity fingerprint at runtime (`os.userInfo().username`, `os.homedir()`, hostname) and scans all tracked text with it. On a hosted runner these three values belong to the batch machine, not to any person: the username is literally `runner` and home is `/home/runner`. So the ordinary word "test runner" in the docs triggers red (measured on CI run 38023874826, three hits: `CHANGELOG.md`, `test/common.sh`, `test/temp-hygiene.test.js`), while that machine had no way to know the developer's real fingerprint — this check is negative on CI and positive only locally
Change   Skip only the known build account `^runner\d*$`, and only the two derived from it (user and home); host, the personal email domain table, the resolved `/tmp` and wayland slots, and other patterns stay as before in any environment; a self-hosted runner logged in with a real account still takes effect throughout. It is not hanging the whole check on the `CI` env var — that would truly disable itself
Evidence L1 measured locally: `isBuildAccount=false` (the real username isn't runner), and the two predicates still each hit on a forged body containing the username/home → the narrowing didn't kill local capability; `npm test` 108/108. The red half is provided by that real CI failure (same code, same assertion, hosted environment), the green half is the next CI
Cost     The hosted environment no longer checks "did you write out the developer username/home" — it never did (it didn't know what to look for), and now merely stops false-positives; that line of defense actually rests on local tier 1 and the pre-commit `npm test`
Commit   e8f3605

### D-076 · 2026-10-10 · taste · v1
Symptom  车主对漏斗观感不满，要求一档"等比缩小 + 重力加速、精确落进真实图标"的替代动画，同时不许动现有漏斗的观感
Change   新增 `genie-mode`（`funnel` 默认 | `shrink`，未知值落回 funnel）与 4 个 `shrink-*` 键；纯模块 `lib/shrinkGeometry.js`（`gravityProgress` / `shrinkFrame` / `shrinkTargetRect` / `VANISH_AT=0.88`）；`genieEngine.js` 新增 `ShrinkManager`，只写真实 actor 的 scale 与 position，无快照、无克隆、无条带，完成信号仍只在动画末尾发出；`genieController.js` 每次动画现读 mode 路由，dock 隐藏时的 peek 开关两模式各自独立（`shrink-peek-hidden-dock` 默认 false），落点仍共用 `_resolveTarget` 的既有兜底链、未新增窗口×dock 相交判定；`dockManager.js` 监听 `changed::genie-mode` 打一行，设置变化不再沉默
Evidence L0：20 条纯几何单测（端点、单调、`gravity=0` 退化线性、还原方向时间镜像、四个 dock 位置投边、等比不变形、NaN/越界钳制），`npm test` 129 断言 / 32 套件、tier 1 9/9、tier 2 24/24、`check:log` PASS。L1（私有合成器 + 真实 `MetaWindowActor`，两个方向共 38 个采样帧）：`wantScale==actor.scale_x`、`wantX/Y==actor.x/y` 逐帧相等，全程 `actorVisible=1 actorMapped=1 actorOpacity=255`，绘制尺寸 646×428→12×8（正向）、0.7×0.4→621×411（反向），从未为零；`finish reason=completed p=1.0000` 两方向各一次；还原收尾回到 `get_buffer_rect()` 的 (316,204)、`scale_x=1`、`pivot=(0,0)`。快速连点三次（请求落在上一段动画内）：`reason=finishFor` ×2 + 收尾 `completed`，`Error in (un)?minimize accounting` 计数 0。L2 未跑：`genie-mode` 的路由分支需要真会话（改设置或走 prefs 页），注销后才可判
Cost     多一档动画就多一条必须与 `enable()` 对称的拆除路径：`disable()` 里 `_shrink.finishAll()` 与漏斗并列，恢复 scale 与 pivot 但不恢复 position（最小化方向会把 actor 留在塌缩位置，mutter 随即隐藏它，下一次还原先用 `get_buffer_rect()` 重写位置）。时间镜像让还原方向的第 0 帧尺度为 0（`sEnd × (1 − (q−0.88)/0.12)` 在 q=1 处即 0，实测第 5 帧 0.0008 = 0.7×0.4 px），0<p<1 全程被绘制，但"从虚无冒出"还是"从图标尺寸长出"是规格取舍，见 MAINTENANCE §14。多屏下 `_shrinkEdgeRect` 仍按 `primaryMonitor`
Commit   a5540ba

### D-077 · 2026-10-10 · chore · v1
Symptom  车主报"漏斗里窗口还没落到图标就提前消失"，给的三个候选是 (a) 快照后立刻 `_fireComplete()`、(b) `genie-tail-fade` 0.08 配 `genie-lead-fraction` 0.58、(c) 条带 1px 重叠接缝。规则要求先做帧级诊断再动代码，且不许退回原生动画来掩盖症状
Change   **没有改任何漏斗行为**，因为三个候选都被帧级数字排除了。新增的诊断能力写进 MAINTENANCE §14：私有合成器照常驱动 Clutter timeline（600 ms → 37 帧），并能把真实 Wayland 窗口开进那个一次性 socket，于是完整的最小化/还原路径（真快照 + 真 actor）可以在 L1 里跑通 —— 这推翻了一半"无头取不到动画帧"的前提。`genie-tail-fade` 默认值保持 0.08
Evidence L1 真窗口（648×429，560 ms，快照模式 43 条带）：`finish reason=completed p=1.0000`，无看门狗、无提前拆容器；p=0.17…0.80 每个采样帧 `stripsOpacity=255..255`，只有 p=1.0000 那帧出现 `0..255` ⇒ (b) 不成立（0.08 的淡化只吃掉最后约 30 ms，且只作用于末尾 8% 的条带）；`shared=0`、快照对象是 `Clutter_TextureContent` 648×429，在每一帧尺寸不变，尽管 `actorVisible=0 actorMapped=0` 从第 0 帧起成立 ⇒ (a) 不成立（提前 `_fireComplete()` 确实隐藏了真 actor，但条带画的是拷贝）。(c) 不可由数值观测，构造上相邻条带共享同一条梯形边（`gamma` 单调且钉住 v=0/v=1），静态推断排除。**能量到的是落点问题**：解析不到应用图标时兜底是 64×12 补丁，`sink = absorb × iconDepth` 把整扇窗压进 12 px 窄带（兜底 `sink=10.2` vs 真 54 px 图标 `sink=45.9`）。漏斗侧无回归：`GenieManager` 与 `lib/genieGeometry.js` 对 HEAD **零删除行**（本提交对 genieEngine.js 只有 import + 新类两处纯新增），并用同一台仪器对 HEAD 副本做过 A/B：47 个同序 tick 全部对齐，fade 起点同为 n=230（p≈0.948/0.950），仅两处 opacity 差 8/7，且差值等于同一条 smoothstep 曲线在那点 p 抖动（≤0.0129）下的预测值
Cost     "提前消失"因此**仍未修**，只完成归因：剩下的分辨量是真会话里的 `icon=` / `peek=` / 每帧 `pixels=`，而车主的 dconf 里 `genie-peek-hidden-dock=false`（用户值，不是默认 true），所以 dock 一旦被避让隐藏就会走 64×12 边带兜底 —— 这与症状吻合，但要 L2 数字才能定论。诊断仪器已从树里摘干净（`grep FRAME_PROBE lib/ = 0`），存成 `docs/reports/genie-frame-probe.patch`，注销登录后 `git apply` 装回、读完 `git apply -R` 卸掉
Commit   a5540ba
