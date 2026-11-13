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
Symptom  The owner disliked the funnel's look and asked for an alternative animation — "proportional shrink + gravity acceleration, landing exactly on the real icon" — without changing the existing funnel's appearance
Change   Added `genie-mode` (`funnel` default | `shrink`, unknown falls back to funnel) and four `shrink-*` keys; a pure module `lib/shrinkGeometry.js` (`gravityProgress` / `shrinkFrame` / `shrinkTargetRect` / `VANISH_AT=0.88`); `genieEngine.js` gains a `ShrinkManager` that only writes the real actor's scale and position — no snapshot, no clone, no strips — with the completion signal still emitted only at the animation's end; `genieController.js` reads the mode on every animation to route, the hidden-dock peek switch is independent per mode (`shrink-peek-hidden-dock` default false), and the landing point still shares `_resolveTarget`'s existing fallback chain with no new window×dock intersection test; `dockManager.js` logs one line on `changed::genie-mode`, so a settings change is no longer silent
Evidence L0: 20 pure-geometry unit tests (endpoints, monotonicity, `gravity=0` degenerating to linear, restore direction as a time mirror, edge projection for the four dock positions, no distortion under scaling, NaN/out-of-range clamping), `npm test` 129 assertions / 32 suites, tier 1 9/9, tier 2 24/24, `check:log` PASS. L1 (private compositor + real `MetaWindowActor`, 38 sampled frames across both directions): `wantScale==actor.scale_x` and `wantX/Y==actor.x/y` equal frame by frame, `actorVisible=1 actorMapped=1 actorOpacity=255` throughout, drawn size 646×428→12×8 (forward) and 0.7×0.4→621×411 (reverse), never zero; `finish reason=completed p=1.0000` once per direction; the restore tail returns to `get_buffer_rect()`'s (316,204), `scale_x=1`, `pivot=(0,0)`. Three rapid clicks (requests landing inside the previous animation): `reason=finishFor` ×2 + a closing `completed`, `Error in (un)?minimize accounting` count 0. L2 not run: `genie-mode`'s routing branch needs a real session (change the setting or use the prefs page), judgeable only after a log-out
Cost     One more animation mode adds one more teardown path that must mirror `enable()`: `disable()` calls `_shrink.finishAll()` alongside the funnel, restoring scale and pivot but not position (the minimize direction leaves the actor at the collapsed position, mutter then hides it, and the next restore rewrites position from `get_buffer_rect()` first). The time mirror makes the restore direction's frame-0 scale 0 (`sEnd × (1 − (q−0.88)/0.12)` is 0 at q=1; measured frame 5 = 0.0008 = 0.7×0.4 px); 0<p<1 is drawn throughout, but "emerging from nothing" vs "growing from the icon size" is a spec trade-off — see MAINTENANCE §14. On multi-monitor, `_shrinkEdgeRect` still follows `primaryMonitor`
Commit   a5540ba

### D-077 · 2026-10-10 · chore · v1
Symptom  The owner reported that "the window vanishes before it reaches the icon inside the funnel", offering three candidates: (a) `_fireComplete()` right after the snapshot, (b) `genie-tail-fade` 0.08 with `genie-lead-fraction` 0.58, (c) a 1px overlapping seam between strips. The rule required frame-level diagnosis before touching code, and forbade falling back to the native animation to mask the symptom
Change   **No funnel behaviour was changed**, because all three candidates were excluded by frame-level numbers. The new diagnostic capability is written into MAINTENANCE §14: the private compositor drives the Clutter timeline as usual (600 ms → 37 frames) and can open a real Wayland window into that one-shot socket, so the full minimize/restore path (real snapshot + real actor) runs under L1 — overturning half of the "headless cannot capture animation frames" premise. `genie-tail-fade`'s default stays 0.08
Evidence L1 real window (648×429, 560 ms, snapshot mode 43 strips): `finish reason=completed p=1.0000`, no watchdog, no early container teardown; at p=0.17…0.80 every sampled frame has `stripsOpacity=255..255`, and only the p=1.0000 frame shows `0..255` ⇒ (b) doesn't hold (the 0.08 fade eats only the last ~30 ms and acts only on the final 8% of strips); `shared=0`, the snapshot object is a `Clutter_TextureContent` 648×429 unchanged in size on every frame, even though `actorVisible=0 actorMapped=0` holds from frame 0 ⇒ (a) doesn't hold (an early `_fireComplete()` does hide the real actor, but the strips draw a copy). (c) is not numerically observable and is excluded by construction — adjacent strips share one trapezoid edge (`gamma` monotonic, pinned at v=0/v=1). **What could be measured is the landing-point problem**: when no app icon resolves, the fallback is a 64×12 patch and `sink = absorb × iconDepth` squeezes the whole window into a 12 px band (fallback `sink=10.2` vs a real 54 px icon `sink=45.9`). No funnel-side regression: `GenieManager` and `lib/genieGeometry.js` have **zero deleted lines** against HEAD (this commit adds only two pure additions to genieEngine.js — the import and the new class), and an A/B with the same instrument against a HEAD copy shows 47 same-order ticks all aligned, the fade start at n=230 in both (p≈0.948/0.950), only two opacity deltas of 8/7, and those deltas equal the prediction of the same smoothstep curve at that p jitter (≤0.0129)
Cost     "Vanish early" therefore **remains unfixed**, with only the attribution done: the remaining discriminating quantities are `icon=` / `peek=` / per-frame `pixels=` in a real session, and the owner's dconf has `genie-peek-hidden-dock=false` (a user value, not the default true), so once the dock is dodge-hidden it takes the 64×12 band fallback — consistent with the symptom, but only L2 numbers can settle it. The diagnostic instrument has been removed from the tree (`grep FRAME_PROBE lib/` = 0) and saved as `docs/reports/genie-frame-probe.patch`; after a log-out/log-in, `git apply` reinstalls it and `git apply -R` removes it
Commit   a5540ba

### D-078 · 2026-10-10 · chore · v1
Symptom  `metadata.json` declared `shell-version` 48/49/50, but this machine has only ever run GNOME 50 (50.1); the 48/49 side cannot be verified here, and D-064 had kept the `dash._dashSpacer` branch explicitly "for the majors we declare but cannot run here". Separately, the D-076/D-077 entries had been written in Chinese, while the shared standard requires CHANGELOG to be English
Change   Narrowed `shell-version` to `["50"]` — the only major actually run — and updated the `lib/dockManager.js` comment that had cited the 48/49 declaration, keeping the guarded no-op branch itself (D-064 defers its removal to real-machine verification). Reworded the D-076/D-077 entries into English; no technical content changed
Evidence L0: `test/repo.test.js` "metadata.json matches the schema and declares plain majors" green on the narrowed array (`"50"` is a plain major, and `_isOutOfDate`'s `startsWith("50")` still matches 50.1); `npm test` 129/129; `check:log` PASS. The D-076/D-077 reword is text-only, byte-identical in meaning
Cost     The extension can no longer be installed on GNOME 48/49. That is the point: declaring support that was never run is the claim being removed, and re-adding the two majors is a two-line edit if they are ever tested. The `_dashSpacer` branch stays inert on 50 (the field is absent from this shell's `ui/*.js`)
Commit   fd3a5ea

### D-079 · 2026-10-10 · guard · v1
Symptom  `STANDARD.md` §7 (machine-wide) requires every `.gitignore` to carry at least the runtime ignore list `.venv/ venv/ __pycache__/ *.db *.db-wal *.db-shm .pytest_cache/ reports/`. This repo carried `reports/`, `node_modules/` and the editor cruft, but none of the Python-tooling or database entries, so a stray `.venv/`, `__pycache__/` or `*.db` dropped beside the extension during testing would have shown up as untracked and been committable
Change   Added the seven missing entries under a labeled block citing STANDARD §7. Every existing rule is left byte-identical: `node_modules/`, the `reports/` rule with its Tier 1 S8 note, and the editor/OS cruft
Evidence L0: `git check-ignore -v .venv/x __pycache__/x.py foo.db .pytest_cache/x` now names `.gitignore` for all four paths (before the change none resolved); `node --test test/repo.test.js` 26/26; `npm run check:log` PASS
Cost     The block is a rule, not a check — only `reports/` is pinned by `test/repo.test.js`, so the full list can still drift (the very gap this closes for this repo). No `.venv` or `*.db` is produced by this extension's tooling, so the entries are prophylactic
Commit   db46b64

### D-080 · 2026-10-13 · guard · v1
Symptom  `CONVENTIONS.md` (machine-wide) asks a dimension-A repository's `AGENTS.md` to name its
         dimension. This one pointed at `STANDARD.md` for the rules and never said which dimension
         they were, so a reader could not tell A was a floor rather than a shared list. Nothing
         asserted the finalized root-file layer either: `LICENSE`, the manifest, the `MAINTENANCE`
         pair, `docs/` and `.github/workflows/` could each be deleted and the whole suite would
         stay green
Change   `AGENTS.md` gains one blockquote naming dimension A and pointing at `CONVENTIONS.md` (the
         "Shared standard" block below it untouched, no rule text restated). New
         `test/conventions.test.js`, four cases: the root-file layer present at the root, exactly
         one manifest and it is `package.json`, no `AGENTS.zh-CN.md` (dimension B's shape), the
         dimension pointer present with none of the standard's own section headings reproduced, and
         the `STANDARD.md` §7 ignore list in `.gitignore` with no tracked runtime file and nothing
         tracked under `reports/` or `docs/reports/`. Failures name the file and where it goes
Evidence L0: `npm test` **134/134** (4 from the new file); `npm run check:log` PASS. Negative run:
         `git mv LICENSE /tmp/opencode/provoked-LICENSE`, then the suite — red with `- LICENSE:
         create this file at the repository root`; restored, `git status --porcelain LICENSE` empty
Cost     The `node --test test/*.test.js` glob picks the file up, so no CI change. The tiered
         `test/run-all.sh` Tier 1 already asserts the `reports/` rule and is left in place: that one
         checks the ignore rule, this one checks the ignore list and the tracked state, and the
         overlap is deliberate rather than deduplicated. Reads the working tree, so an uncommitted
         file passes. Presence only, not content. No network and no read of agent-standards — a
         private repository this CI cannot see
Commit   d622aa3

### D-081 · 2026-10-14 · fix · v1
Symptom  `test/conventions.test.js` requires a `docs/` directory at the repository root, but nothing
         under `docs/` was ever tracked: its only content is `docs/reports/`, which the unanchored
         `reports/` rule ignores. The guard therefore passed on the maintainer's tree (the directory
         is there on disk) and failed in CI, where a fresh clone has no `docs/` at all — red on
         every push since the guard landed (`d622aa3`)
Change   Track `docs/README.md`. It states the layout: `docs/reports/` is per-phase evidence that
         stays local-only and must never be tracked, and this `README.md` exists because git cannot
         carry an empty directory. The guard is unchanged — it was right, the tree was incomplete
Evidence L0: `git ls-files docs` now prints `docs/README.md`; `npm test` **134/134** and `npm run
         check:log` PASS. On the preceding commit CI was red with `- docs/: create this directory at
         the repository root`
Cost     One tracked file. Its text is deliberately link-free and section-free, so the doc gates
         that walk every tracked `.md` stay silent, and `docs/reports/` stays untracked as the
         guard's fourth case requires
Commit   fc1f9c1

### D-082 · 2026-10-16 · chore · v1
Symptom  The pointer in AGENTS.md is followed only by an agent that chooses to; nothing made the
         standard reach the context, and the section list had drifted — §5 (the conflict rule) was
         missing.
Change   End the pointer block with two bare `@` imports (`@~/.agents/standards/STANDARD.md`,
         `@~/.agents/standards/dimensions/a.md`) and add `opencode.json` naming the same two files in
         its `instructions` array; add `§5 conflict rule`. Local overlay only — no upstream file moved.
Evidence 2026-10-16: CodeBuddy CLI with every tool disabled printed the tokens the imports carried;
         opencode `run` printed the token its `instructions` named, with no tool call.
Cost     Both hooks name `~/.agents`, absent in another clone, so they are skipped there.
Commit   8715062

### D-083 · 2026-10-19 · chore

Symptom  AGENTS.md said CI runs "exactly two offline commands", but ci.yml has three steps — the
         third, npm run test:coverage, is a reading with no threshold. The same file cited the
         standard by bare filename.
Change   The sentence now names two gates plus the non-gating coverage read; bare standard
         references carry the full path.
Evidence 2026-10-19: .github/workflows/ci.yml has three run: steps, one commented "not a gate".
Cost     None; wording only.
Commit   cbbf936

### D-084 · 2026-10-19 · fix

Symptom  Two rows of the maintenance record broke their table. The `50.1` row was split across
         three lines, and the `[overviewpatches]` row carried an unescaped `|` inside a code
         span (`band=ok|skipped`). GFM reads a bare pipe as a cell separator, so both rows
         rendered with extra cells; the Chinese file had the same two defects.
Change   Both rows are single lines again, and the two pipes that are content — `band=ok\|skipped`
         and the `gresource list … \| grep` command — are escaped, which renders as a literal
         pipe inside the code span. Nothing else in either row changed.
Evidence 2026-10-19: every table block in MAINTENANCE.md and MAINTENANCE.zh-CN.md has a uniform
         pipe count; `npm test` — 134 passed; `npm run check:log` — PASS.
Cost     None; no test or CI file was touched.

Commit   f74d51c


### D-085 · 2026-10-27 · fix

Symptom  The icon-quality preference did nothing. `IconManager`'s constructor took the value and
         dropped it, `setQuality()` re-applied the unchanged icon size, and every icon was built
         with `icon_size: this._iconSize` -- the logical edge. The schema key, the preferences row
         and the `changed::icon-quality` handler were all present, so the setting looked live.
Change   Store the multiplier, ask St for a texture that many times the logical edge and scale the
         actor back to the logical size (`_textureSize()` / `_applyIconTexture()`), at both icon
         creation sites and in `_applyIconSize()`. Wrapper geometry, layout and magnification are
         untouched. This is the shape upstream settled on for v1.2.7.
Evidence L? No test reaches the rendering path: the modules import `gi://` and the suite covers
         only GI-free files. `node --check` on the file; `npm test` 134/134; `npm run test:static`
         9/9 including `syntax-all-js` (27 files).
Cost     One extra texture per icon at `quality` times the edge: at the default 2 that is four
         times the pixels, at 4 it is sixteen. Icons are rebuilt on every quality change, which is
         a preferences action, not a hot path.

Commit   db045d8

### D-086 · 2026-10-27 · fix

Symptom  When `DockManager.enable()` threw, the catch block only dropped the reference. By then
         the container was mounted in `Main.layoutManager`, the settings handlers were connected
         and the debounce timer was running, so the dock stayed on screen and `disable()` could
         never undo any of it -- only a logout cleared it.
Change   Call `this._dockManager?.disable()` before nulling the field, and keep a failure in that
         cleanup inside the catch block. `disable()` already null-checks every component it
         touches, so it is safe against a partially enabled manager.
Evidence L? The failure path needs `enable()` to throw, which no harness provokes. `node --check`;
         `npm test` 134/134; `npm run test:static` 9/9.
Cost     None on the success path; a failed enable now logs a second line if the cleanup itself
         throws.
Commit   f7928ca
### D-087 · 2026-10-27 · fix

Symptom  D-085 wired `icon-quality` into every `St.Icon`, the app button's brand icon
         included. That icon sits in a `St.BoxLayout`, which allocates the child's preferred
         size, so the doubled `icon_size` was given a doubled cell and the `1/quality` scale
         painted the brand icon into that cell's top-left corner instead of filling the button.
Change   The app button's icon keeps the logical size (`set_icon_size`) and is left unscaled.
         The multiplier also bought nothing there: the brand icon is the symbolic
         `start-here-symbolic` SVG, which St rasterises at any requested edge.
         `_applyIconTexture` now documents that it requires a `Clutter.FixedLayout` parent,
         which is what makes the dock icons' scaled paint fill their wrapper exactly.
Evidence L0: `npm run test:static` — tier 1 9/9, including 134 unit assertions and the 27-file
         syntax pass; `npm run check:log` resolves this SHA. The button's on-screen geometry was
         not observed on a live session — that needs a logout.
Cost     The brand icon is rasterised at 1x like it was before D-085; at `icon-quality=1` the
         two paths are identical.
Commit   eb71b31

### D-088 · 2026-10-27 · fix

Symptom  After the dock's first peek it stayed about 20px below its resting position: the app
         label sat inside the bar instead of above it, and the icons' bottoms were cut by the
         screen edge. Moving the pointer along the dock brought it back.
Change   `_show()` and `_hide()` take their animation endpoint from
         `DockManager.getRestingContainerRect()` instead of reading the live container position,
         and the animation watchdog now applies the transition's end state (position,
         visibility, opacity) when an interrupted ease never fires its onComplete.
Evidence L0: `npm test` 134/134 and `npm run test:static` tier 1 9/9 (including the 27-file
         syntax pass); `npm run check:log` resolves this SHA. L1: `npm run test:headless` still
         reports the dock enabling and building its icons. The 20px offset itself was not
         reproduced live -- that needs a logout, and its trigger is an interrupted ease.
Cost     One extra rect computation per show and per hide; `_computeContainerRect()` is pure
         arithmetic over the monitor and the icon count.
Commit   f6d8efd

### D-089 · 2026-10-27 · taste

Symptom  Once `icon-quality` took effect, dock icons carried a dark rim rather than a shadow:
         the 2px/3px `icon-shadow` was painted on the oversized texture and scaled down with it,
         so it collapsed to about half a pixel.
Change   Removed the rule. The dock's icons now render flat, the way the app grid's do.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9, `npm run check:log` resolves this
         SHA. The result was not observed on screen -- it needs a logout.
Cost     Icons lose the macOS-style drop shadow; nothing else referenced that class.
Commit   1e0ff41

### D-090 · 2026-10-27 · fix

Symptom  After the dock was hidden and the pointer brought it back for the first time, the app
         label sat inside the bar instead of above the icon, about 20px low, and stayed there
         until the pointer moved to another icon.
Change   `_showTooltip()` positioned the label from `actor.get_transformed_position()` once and
         never updated it. The dock enters from 20px below its resting rect over
         `animation-duration` (200ms), and the pointer is already over an icon while that runs,
         so the label was anchored to a mid-slide position. It now follows the container's
         `notify::x`/`notify::y` while visible, through `_positionTooltip()`.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9, `npm run test:headless` tier 2
         24/24, `npm run check:log` resolves this SHA. Tier 2 cannot assert this itself -- it
         forbids animation assertions, and the trigger is a pointer entering during the entry
         ease -- so the on-screen result was not observed here.
Cost     One `get_transformed_position()` + `set_position()` per frame while a label is visible
         and the dock is moving; the label is hidden the rest of the time.
Commit   ad3c596

### D-091 · 2026-10-27 · taste

Symptom  With the label no longer parked mid-slide (D-090), its 40px offset read as too far
         above the icon.
Change   Offset lowered to 34px.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9, `npm run check:log` resolves this
         SHA. The value was chosen by eye on the live session; no automated check covers label
         placement.
Cost     None.
Commit   d22d821

### D-092 · 2026-10-27 · fix

Symptom  The app label was anchored to the icon's pre-magnification top edge, so it sat over
         the enlarged icon instead of above it. Worst on the first reveal after the dock had
         hidden, where the entry slide put it lower still.
Change   The label is now placed from geometry that has already settled: the dock's resting
         rect, plus `(magnification-scale - 1) * slotHeight * pivotY` above the resting top,
         minus the label's own height and a fixed 8px gap. The pivot comes from the same switch
         in `_applyDockPosition` that feeds `Magnification`, so a top or side dock measures the
         edge its icons actually keep. Also restores the app button's label, which the previous
         change left calling `get_id()` on a string.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9, `npm run test:headless` tier 2
         24/24, `npm run check:log` resolves this SHA. The pixel result was not observed here --
         tier 2 forbids animation assertions and the trigger is a pointer entering during the
         entry ease.
Cost     None at rest: the label is placed once per show, and once per dock move while it is
         visible.
Commit   83e022e

### D-093 · 2026-11-05 · fix

Symptom  The dock had no Trash. A Trash window was also indistinguishable from any other
         file-manager window, so it counted against the file-manager icon, appeared in its
         previews and answered its focus click. This entry covers the Trash button only;
         pinning and unpinning are D-094, and drag-reordering is still unbuilt.
Change   New `lib/trashManager.js` tracks the Trash location independently: it watches
         `trash:///` for the empty/full icon, resolves which windows a file manager shows for
         the Trash over an explicit `Properties.Get` of `OpenWindowsWithLocations`, and maps
         those windows back by `get_gtk_window_object_path()`. `IconManager` adds one button
         to the tail -- Trash before the applications button, both pinned by position rather
         than walked, so steady state still costs zero moves -- and gains
         `representsTrashWindow()`, the single predicate every filter now goes through: with
         `show-trash` off nothing represents that window, so it returns to the file-manager
         icon and the dock behaves like a stock one. The same predicate is applied to window
         counts, running indicators, focus tracking, previews, the close-all action and
         `iconFix`'s replacement of `_getRunningApps`, which otherwise bypassed the filter
         under the default settings.
         Four APIs were measured before use, because the first draft of this code had
         invented all of them: `Meta.WorkspaceManager` has no `get_workspaces()` (only
         `get_n_workspaces()` plus `get_workspace_by_index()`, which is what the shell itself
         uses); a `DO_NOT_AUTO_START` proxy reports no init error while the name is unowned
         yet caches nothing, and `Gio.DBusProxy.prototype.refresh` does not exist here, so
         ownership is read from `get_name_owner()` and the property is fetched over the bus
         when it appears; GJS unpacks `a{sas}` into entries whose array member is an empty
         object, so the reply is walked by child index instead of unpacked. Window previews
         needed a `setWindowFilter()` that `dockManager` was already calling, whose absence
         threw in `enable()` and stopped the dock from appearing at all.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9 (schema strict, 63 compiled keys),
         `npm run test:headless` 24/24 including `enable` ACTIVE and `no-js-errors`. The kept
         tier-2 log shows `[icons] +trash` on both enable cycles with zero `[trash]` warnings
         and `reorder:no` in steady state. Run-verified on this machine: `trash::item-count`
         answers, `OpenWindowsWithLocations` has type `a{sas}`, the file manager's `EmptyTrash`
         takes `ba{sv}`. L1 gap: no file manager runs in the tier-2 sandbox, so the name is
         never owned and the window-separation path was never executed -- the Trash button
         renders, but the claim that a Trash window stops counting as a file-manager window is
         unverified until a logout. The pre-fix double move in `_enforceOrder` is an
         index-level inference, not an A/B.
Cost     One extra dock slot and one D-Bus property read per file-manager window event, both
         coalesced; the proxy never auto-starts a file manager, so enabling the extension
         launches nothing. Stages 2 and 3 of the approved plan are still unbuilt.
Commit   6b80798

---

### D-094 · 2026-11-05 · fix

Symptom  The pinned set could only be changed outside the dock: an icon offered New Window,
         media controls and Close, but no way to pin the application it stood for or to drop
         it from the pinned row.
Change   The right-click menu now carries one state-dependent row between the media items and
         Close -- `Unpin from Dock` when the application is already a favorite, `Pin to Dock`
         when it is not -- and the write goes through the shell's own favorites object rather
         than a hand-written `set_strv` of `favorite-apps`. The dock already read that key and
         already reloaded on it, so no new store, setting or lifecycle was needed: reading
         `ui/appFavorites.js` first confirmed the export is `getAppFavorites()` (not an
         instance getter), that `addFavorite()` maps to the `pos === -1` branch which appends
         rather than splicing before the last entry, and that both add and remove come with the
         native Undo notification that re-inserts the application at the position it left --
         the feedback a manual key write would have thrown away. Adding a favorite that is not
         running stays the shell's own app-grid action, since both lists are the same key.
Evidence L0: `npm test` 134/134, `npm run test:static` 9/9. L1: tier 2 24/24 with `enable`
         ACTIVE and `no-js-errors` clean -- a static import of a shell module that failed to
         resolve would throw during `enable()` and stop the dock from appearing at all, so that
         run does prove the module path and the export name on this shell. Nothing here is L2:
         every part of it needs a pointer, so the menu row, the write, the Undo notification and
         the pinned-to-running demotion of an icon are all unverified until a logout.
Cost     One extra menu row per icon. `AppFavorites` is the shell's process-wide singleton and
         is already built by the overview, so this adds no resident object. Drag-reordering and
         drop-to-pin from the app grid remain unbuilt.
Commit   6b80798

---

### D-095 · 2026-11-05 · fix

Symptom  Three defects in the Trash button once it ran on the live session: its label kept the
         position of whatever icon was hovered last; it never showed a running indicator, so an
         open trash window was invisible to the row; and its icon skipped the texture pipeline
         the rest of the row uses, so it neither scaled with `icon-size` nor sharpened with
         `icon-quality`.
Change   `_positionTooltip()` treats the Trash actor as a valid anchor next to the applications
         button -- the `appId === null` branch only recognised the latter, so the Trash was
         declared dead, the label was left at the previous icon's X, and the `show()` that
         followed made the stale position visible. The button now repeats an app icon's
         two-child shape (`macos-dock-icon-wrapper` then `macos-dock-indicator-box`), drawing
         one dot per open trash window in the dock's current indicator style, and
         `_applyTrashIconSize()` runs through `_applyIconTexture` from `setIconSize()` and
         `setQuality()` like every other icon. Ubuntu's dash gets the same result by faking a
         `Shell.App` for the Trash; that needs a synthetic app and injected methods, and the
         dock-level separation here already knows the window count, so the indicator is drawn
         directly instead.
Evidence L0: `npm test` 134/134, tier 1 9/9. L1: tier 2 24/24 with `enable` ACTIVE and
         `no-js-errors`. L2, live session after the logout: `[icons] +trash (empty=false)` in
         the journal proves the item-count read works on the real trash, and zero `JS ERROR`
         blocks named this extension across the boot. The dot and the label position are not
         covered by any tier -- both need a pointer and an open trash window.
Cost     One allocation pass per trash-window change, guarded by a state key so a steady
         indicator rebuilds nothing.
Commit   6b80798

---

### D-096 · 2026-11-05 · fix

Symptom  The favorites separator appeared only while a non-favorite app was running, so it
         vanished and reappeared as windows opened and closed -- and every one of those toggles
         snapped the dock 15px wider or narrower. Ubuntu's dash shows the line permanently in
         the same situation.
Change   The rule is now the favorites boundary, matching Ubuntu's `nFavorites > 0 && nFavorites
         < nIcons` (which counts the Trash inside `nIcons`): shown whenever something is pinned
         and a tail exists -- a running non-favorite, the Trash button or the applications
         button. `_reload()` had a second copy of the old condition and ran it *before* the tail
         buttons existed; it now calls `_updateSeparator()` after them, so one rule decides the
         line. Both tail setters re-evaluate it, so switching the Trash and the applications
         button off can still leave no line at all. The settled-icon count that D-017/D-037/
         D-041 exist to protect keeps deciding the case where both tail buttons are off.
         `MAINTENANCE.md` / `.zh-CN.md` and the tier-3 B6 comment and ENV text moved with it.
Evidence L0: `npm test` 134/134, tier 1 9/9. L1: tier 2 24/24, and the kept sandbox log shows
         `+separator at=6 (favs=8 running=0 reason=reload)` -- a separator with zero running
         non-favorites, which the old rule could not produce, on the reload path that used to
         carry its own copy of the condition. B6 was re-read rather than re-run: it flips
         `show-running-apps`, which still takes the line down and back up.
Cost     The dock is ~15px wider whenever anything is pinned, permanently. `at=6` with `favs=8`
         is not an off-by-one: two pinned ids do not resolve through AppSystem here, and the
         index counts rendered leading favorites.
Commit   6b80798

---

### D-097 · 2026-11-05 · taste

Symptom  The icon label sat closer to the row than Ubuntu's dash label does, which read as
         crowded next to the magnified icon.
Change   `TOOLTIP_GAP` 8 → 10, the gap Ubuntu's `.dash-label.bottom` gets from `margin-bottom`
         (its `shrink` variant is 3px). Supersedes D-091's by-eye 8px; the placement formula
         from D-090/D-092 (settled rect plus the magnification rise) is untouched.
Evidence L0: `npm test` 134/134. No check covers label placement -- tier 2 forbids animation
         assertions -- so this is by eye on the live session, same as D-091.
Cost     None.
Commit   6b80798

---

### D-098 · 2026-11-05 · fix

Symptom  The pinned row could not be reordered, an application could not be pinned by dragging,
         and nothing in the dock could unpin by dragging: the only way to change the order was
         outside the dock.
Change   New `lib/dockDnd.js`, gated by `dock-dnd-enabled` (default on). Every icon actor gets a
         drag source -- a `_delegate` with `getDragActor`/`getDragActorSource` plus the gesture
         `DND.makeDraggable` hangs on it -- and two drop targets exist: the container, which
         clamps the drop position into the favourites range and writes through
         `moveFavoriteToPos` or `addFavoriteAtPos`, and the applications button, which accepts a
         pinned icon and removes it, the way the shell's own Show Apps button does. Running
         unpinned icons are draggable on purpose: dropping one in the favourites range pins it,
         which is the only thing that makes their order persist. The write is deferred to a
         BEFORE_REDRAW later because the drop animation is still resolving, and the whole row is
         frozen for the gesture -- `_doSync` and `_reload` record one deferred reason and replay
         it when the drag releases, so a drag delays a sync but can never drop it. The dragged
         icon hides and the placeholder fills one slot, so the dock keeps its width throughout.
         The gesture is captured by diffing the actor's action list around the call rather than
         by testing a gesture type name, so switching drag off does not depend on what that class
         is called this cycle; `Clutter.Action` removal is the only API used on it.
Evidence L0: `npm test` 134/134, tier 1 9/9 including the new key's schema strict compile and its
         two README rows. L1: tier 2 24/24, kept log shows `started (enabled)` then `stopped`
         then started again across enable cycles, zero `could not capture` warnings -- every
         icon's gesture was found -- and zero JS errors. The separator and Trash lines did not
         regress. Nothing here is L2: tier 2 forbids pointer assertions, so the long press, the
         placeholder landing where the drop applies, the unpin drop and a grid-to-dock pin are
         all unverified until a logout.
Cost     One action and one delegate per icon, both dropped when the setting is off. Dragging
         suppresses icon-row syncs for its duration only.
Commit   6b80798

---

### D-099 · 2026-11-05 · taste

Symptom  Four details read as this dock rather than as a macOS-style dock: an application with a
         dozen windows drew a dozen dots and lengthened the indicator row, the separator was a
         fixed 32px bar that lay wrong on a side dock and was three times too bright, and the
         name label appeared the instant the pointer touched an icon -- so sweeping the row
         flashed every name -- in a rounded rectangle instead of a pill.
Change   Dots cap at 4, matching the shell's own `MAX_WINDOWS_CLASSES`, and the cap is applied
         before the indicator state key is built so 5 and 6 windows no longer each rebuild the
         widgets; the Trash indicator is capped the same way. The separator now spans the current
         icon size, lies down when the dock is on a left or right edge, and drops to
         `rgba(255,255,255,0.1)`; a new `applySeparatorGeometry()` runs on creation, on
         `icon-size` and on dock-position changes. The label waits 300ms of steady hover and
         fades in over 150ms -- the shell dash's own two constants -- with its timer id stored so
         `_hideTooltip` and `stop()` can cancel it, and it is styled as a pill: 999px radius, a
         1px hairline border and full black, the padding having matched all along.
Evidence L0: `npm test` 134/134, tier 1 9/9. No check covers any of these four -- tier 2 forbids
         animation and pixel assertions -- so the judgement is by eye on the live session, the
         same basis D-089/D-091 were set on, and it stays discardable on that basis.
Cost     The label is now invisible for the first 300ms of a hover, which reads as slower if you
         expect the old instant name.
Commit   6b80798

---

### D-100 · 2026-11-05 · fix

Symptom  Dragging a pinned icon did nothing. The live journal was the evidence: it carried
         `[dnd] started (enabled)` and no `could not capture` warning, so every icon had its
         gesture installed and enabled, yet `drag-begin` never fired once across the whole boot.
Change   The icon's left button no longer acts on press. Pressing had been launching the
         application and returning EVENT_STOP right there, so the press itself activated the
         window, dodge hid the dock under it (the same journal is full of `overlap -> hide`
         lines), and the icon moved out from under the pointer before the gesture could
         recognise -- the drag died on its own first event. Activation now happens on release,
         only when the same actor is still hovered and no drag is in progress, which is the
         semantics the shell's own icon has: `AppViewItem extends St.Button`
         (appDisplay.js:1847) fires `clicked` on release, and that is why the identical
         200ms drag works there. A `recognize` probe was added on the captured gesture because
         the two remaining silent failure modes print nothing on their own -- no recognise at
         all, versus recognising and then losing the grab, since `_gestureRecognized()` returns
         before emitting drag-begin when Main.pushModal yields nothing (dnd.js:144-147).
Evidence L0: `npm test` 134/134, tier 1 9/9. L1: tier 2 24/24. The causal chain from the live
         journal is L2 for the *symptom* (no drag-begin in a boot where the gesture was
         installed on every icon); the fix itself is unverified -- it needs a pointer, and the
         journal after the next logout is what decides whether the gesture now recognises.
Cost     Launching an icon now happens on release rather than press. That is the standard
         semantics and the shell's, but it is a feel change for the whole row.
Commit   6b80798

---

### D-101 · 2026-11-05 · fix

Symptom  Opening the icon context menu could throw `Object Gjs_ui_boxpointer_BoxPointer has
         been already disposed` from popupMenu.js, live in the journal, when the menu was
         opened around a favorites change.
Change   `_showMenu()` defers its `open()` to an idle and guarded only the opacity line, so
         `open()` ran unguarded on a menu that had already been disposed in between -- the
         identity check `this._contextMenu !== menu` cannot see that, because the field still
         points at the disposed menu. The whole open sequence is now inside the try, the field
         is cleared on failure, and one warn line replaces the raw throw into the shell.
Evidence L0: `npm test` 134/134. The throw itself is L2 -- read out of this boot's journal --
         and the fix is unverified: reproducing it needs a favorites change landing inside the
         same idle window as the right-click.
Cost     None.
Commit   6b80798

---

### D-102 · 2026-11-05 · fix

Symptom  Clicking the Trash more than once did nothing visible, and the dock had no way to
         open a second trash window at all.
Change   The click rule moved out of the app-icon path into a new pure module,
         `lib/clickAction.js` -- `clickActionFor(window)` decides minimize / restore / activate /
         open-new-window, `applyClickAction()` carries it out with the caller's timestamp and
         launch callback. `DockManager._onAppClicked` now runs through it (same four branches it
         already had, one less copy) and `TrashManager.activate()` runs through the same rule, so
         "the Trash answers a click like an app" is enforced by construction rather than by a
         comment saying so. `openNewWindow()` launches the URI: the measured Exec in
         org.gnome.Nautilus.desktop is `nautilus --new-window %U` and `-w` is documented as
         "Always open a new window for browsing specified URIs", so a launch is always another
         window -- reachable by middle-click and by a New Window menu row, while Open Trash became
         `reveal()` (always raises, never carries the click's toggle). The menu row and the
         overview teardown for the Trash route through `DockManager._onTrashClicked`, which shares
         the extracted `_exitOverview()` with the app path.
Evidence L0: `test/clickAction.test.js` -- 10 assertions over the whole focus x minimized table,
         the restore ordering (unminimize before activate), that only the windowless case may
         reach the launch callback, and the action each call reports back. `lib/clickAction.js`
         added to the PURE_LIBS guard. Tier 1 floor raised to 144/36 in the same change that added
         the suite. L1: tier 2 24/24. One journal line records which branch every Trash click took
         (`[trash] click -> activate|minimize|restore|open-new-window (open=N)`) because the screen
         cannot tell "nothing happened" from "minimized the window you could not see" -- that is the
         instrument the post-logout round reads. The behavior on screen is still L2.
Cost     A left-click on an app icon can now minimize the focused window in one more case than
         before (the branch table is unchanged, but the Trash now shares it). The pure module is
         one more file in the Node-importable set.
Commit   6b80798

---

### D-103 · 2026-11-05 · fix

Symptom  Minimizing or restoring a trash window animated into and out of the **Files** icon,
         and the icon squash fired there too.
Change   `IconManager.iconIdForWindow(metaWin)` is now the single answer to "which dock icon owns
         this window": the `TRASH_ICON_ID` sentinel when the dock is showing that window on its
         own Trash button, otherwise the tracker's app id. `GenieController._appIdForWindow` asks
         the dock first and falls back to the tracker when the method is missing, which is the
         file's existing degradation style. On the dock side a new `_iconWrapperFor(appId)`
         resolves the sentinel to the Trash button's icon wrapper (and merges the duplicated
         wrapper lookup in `getIconRectForAppId` / `squashForAppId`), so the rect chain, the rect
         cache, the dodge-peek fallbacks and the squash all aim at the Trash without a single
         genie-side special case. With `show-trash` off `representsTrashWindow()` is false, the
         sentinel is never returned and the animation goes back to Files by itself.
Evidence L0/L1: `npm test` 144/144, tier 1 9/9, tier 2 24/24 (genie `_validate()` still accepts
         the private API surface). Where the animation actually lands is L2 -- it needs the logout.
Cost     `TRASH_ICON_ID` is a dock-internal id that appears in the genie rect cache. It cannot
         collide: real app ids end in `.desktop`.
Commit   6b80798

---

### D-104 · 2026-11-05 · fix

Symptom  Hovering the Trash gave no window preview, unlike every other icon.
Change   The preview popup only ever asked an app for `get_id()` and `get_windows()`, so the
         Trash is fed to it through a two-method stand-in built fresh on each hover (it must read
         the live window list, which the popup re-reads when a thumbnail is closed). The preview
         window filter now receives `(window, app)` and lets the Trash's own windows through for
         the Trash subject only -- everything else keeps dropping them, which is the phase-1 rule.
         Focus highlighting moved from `tracker.focus_app === thumb.app && has_focus()` to
         `metaWindow.has_focus()`: that matches what `_createThumb` already did on the first paint,
         and a stand-in object can never equal the real Files app, so the old condition would have
         left every trash thumbnail unhighlighted. `thumb.app` and the `Shell` import went with it.
Evidence L1: tier 2 24/24 with the popup wired; thumbnails, click-to-activate and the highlight
         are L2 -- pointer and the logout.
Cost     A duck-typed stand-in for something the popup documents as an app. The contract is two
         methods and it is stated at both ends.
Commit   6b80798

---

### D-105 · 2026-11-05 · taste

Symptom  No icon in the dock had a "new window" gesture; Ubuntu's dash has one on middle-click.
Change   Middle-click opens another window on every icon, consumed on press (the left button
         stays free for the drag gesture, which is release-based and must not be starved). The
         Trash answers the same button with another trash window through the same route.
         Guarded by `_dragInProgress` so a middle-click cannot land inside a live drag.
Evidence L1 only: tier 2 24/24. Whether the button reaches the icon at all -- rather than the
         shell or a grab -- is L2 and is on the post-logout checklist with the rest.
Cost     One more button bound. Nothing was rebound that a user might already rely on: middle
         click did nothing before.
Commit   6b80798

---

### D-106 · 2026-11-05 · fix

Symptom  The owner restarted, drag worked, and a dropped icon **disappeared from the dock**.
         Journal fingerprint, for every drop that landed on a new slot:

           [dnd] drop <id> at slot=13
           [icons] incremental: +0 -1 reorder:yes (reason=favorite-apps)
           [icons] incremental: +0 -0 reorder:yes (reason=favorite-apps)

         `-1` then `+0 -0` -- the icon was removed and the pass that should have
         put it back added nothing.
Change   Two defects, one write and one render, both had to go.
         (1) `AppFavorites.moveFavoriteToPos` is `_removeFavorite` + `_addFavorite`
         (appFavorites.js:115-118): it publishes a `favorite-apps` value with NO
         entry for the app between the two writes. The reorder now writes the key
         itself, once, rebuilt from the key's current value
         (`lib/dockDndSlots.js:moveInFavoriteList`), so there is no intermediate
         state for anyone to render. Pin and unpin keep going through AppFavorites
         -- one write each, and the native Undo toast comes with them.
         (2) Even with one write, the render path was broken on its own: a removed
         favorite fades out over 200ms and keeps its entry in `_icons` until the
         tail runs (deliberately, so the dock width matches the still-visible child),
         so a re-add inside that window concluded "the icon already exists", added
         nothing, and the fade's tail then destroyed the actor. `_keepExistingIcon()`
         now cancels the pending fade and reuses the actor -- and it is used by BOTH
         add paths (`_syncFavorites` and `_doWindowChange`), because a stopping and
         restarting app falls into the same trap.
         The second defect is the one that could bite anything that re-adds an id
         within 200ms of losing it; the first is what made every drop hit it.
Evidence L0: 19 new assertions in `test/dockDndSlots.test.js` (see D-107) over the write shape --
         forward and backward moves, an out-of-range position clamping to the end, the id being
         absent, the input list not being mutated, and an id that resolves to nothing surviving
         the write untouched. L1: tier 1 9/9 (164/42), tier 2 24/24, `check:log` PASS. The
         disappear itself is L2 from the journal above and its fix is unverified until the next
         logout.
Cost     The reorder bypasses AppFavorites, so it produces no Undo notification -- the shell
         produces none for a move either, so nothing the owner had is lost. The bystander hazard
         described in D-107's note still applies to pin/unpin, which stay on AppFavorites.
Commit   6b80798

---

### D-107 · 2026-11-05 · fix

Symptom  Dragging an icon out of the app grid, the drop indicator appeared **after the Show
         Applications button** while the icon actually landed at the end of the pinned run,
         before the separator. Indicator and result disagreed.
Change   `_containerIndexForFavoriteSlot()` fell through its loop and returned the end of the
         child list when the slot ran past the last favourite -- which in this dock's container
         means after the separator, the running icons, the Trash and the applications button.
         It now returns the boundary right after the last favourite icon, so the gap is always
         where the drop will land. The rule and its siblings were extracted into the pure
         `lib/dockDndSlots.js` (`slotAt`, `clampToFavoriteSlots`, `isSelfPosition`,
         `containerIndexForFavoriteSlot`, `favoriteIndexAtGap`, `moveInFavoriteList`) with
         `DockDnd` keeping only the projection from actors to `{start,size}` / app-id rows.
         Also recorded, and NOT fixed here: every AppFavorites write rebuilds the list from
         `_getIds()`, which holds only the ids AppSystem resolves at that instant
         (appFavorites.js:46-62,124) -- so a pin or unpin can silently drop an unrelated
         favourite whose .desktop is mid-rewrite. One of the two browser-generated entries the
         owner had been dropping was gone from `favorite-apps` after the session, while its
         .desktop file is still on disk. Going through the key for the move is what keeps the
         reorder clear of it; §14 carries the rest.
Evidence L0: the boundary case is asserted directly -- a row of `[fav, fav, separator, running,
         trash, show-apps]` with slot 2 and slot 5 both returning index 2, plus a favourite with
         no icon in the row. L1: tiers 1 and 2 green. The indicator position on screen is L2.
Cost     One more pure module. It is in the Node-importable guard list, so the split is enforced.
Commit   6b80798

---

### D-108 · 2026-11-05 · fix

Symptom  The owner asked for Ubuntu Dock's drag behaviour specifically ("他的移动就非常棒").
Change   `DockDnd` now runs the shell dash's algorithm, which is what Ubuntu Dock inherits
         (its `DockDash` only forwards to `Dash.prototype` and swaps the axis). Four behaviours
         that the previous version did not have, each with the shell's own number or guard:
         - the slot under the pointer is a proportional partition of the row
           (`floor((coord-origin)*n/extent)`, placeholder and separator subtracted from both,
           RTL mirrored) rather than a nearest-edge scan;
         - a slot at or immediately after the dragged item's own favourite position withdraws
           the gap and drops nothing (dash.js:910) -- before, a drop in place wrote the list;
         - the gap grows in over 200ms when it first appears and shrinks out when it is cleared,
           and every move is refused while one is still shrinking (dash.js:841-851,906), which
           is what stops it buzzing across the row when the pointer sits on a boundary;
         - transient (window-backed) apps and a read-only `favorite-apps` key are refused up
           front, the way dash.js:860-868 does.
         The one divergence recorded here -- dimming the dragged icon instead of hiding it, and
         the gap therefore always widening the dock -- was reversed by the owner in D-111, after
         this entry was written. Read D-109 and D-111 for the live behaviour.
Evidence L0: the slot/gate/self-position rules are the 19 assertions of D-107. L1: tier 2 24/24.
         Feel is L2 and is exactly the thing that needs the owner's hand on the pointer.
Cost     The proportional partition reads `child.x/width` per drag-motion event (already the
         case before); it is one walk of a row of a dozen children.
Commit   6b80798

---

### D-109 · 2026-11-05 · fix

Symptom  Dropping an icon from the app grid adds a child to the row and removes none, so the
         row becomes one slot wider than the width the dock computed for itself -- the trailing
         icons sit past the calculated background for the whole gesture.
Change   `IconManager.setDragGap()/hasDragGap()` records that a gap is occupying a slot, and
         `_computeContainerRect()` adds one padded slot plus spacing while it is set. As first
         written the flag was raised only when the drag had no local source (`_dragging === null`),
         because a drag from the dock's own row hid its icon -- invisible children leave the
         layout, the gap took that freed slot, and the net width was zero. D-111 moved the source
         icon to opacity 50 instead of hiding it, which removes the case distinction: the gap now
         always reserves its slot. The flag routes through `_onIconsChanged` either way, so the
         position update happens on gap create and destroy, not per motion event.
Evidence L1: tier 2 24/24; the geometry itself is not exercised by any offline tier, and the
         overflow it fixes was inferred from the width formula, not measured. L2 on the next
         logout, with the pointer.
Cost     Two more public methods on IconManager for one layout fact.
Commit   6b80798

---

### D-110 · 2026-11-05 · fix

Symptom  This boot's journal carries the same error twice, each time within a second of a
         favorites write (a drop, or an unpin while a menu was open):

           Object Gjs_ui_boxpointer_BoxPointer (…), has been already disposed —
           impossible to get any property from it. …destroyed from C code…
           #0 popupMenu.js:1085   (close() reading `this._boxPointer.visible`)
           #1 popupMenu.js:1468   (_onMenuOpenState: `oldMenu?.close(FADE)`)
           #4 popupMenu.js:1078   (open() emitting `open-state-changed')
           #5 …/macos-dock@local/lib/iconManager.js:1724   (our `menu.open()`)

         with a `PopupMenuItem … already disposed` block right behind it. The D-101 guard
         did not help because the throw is not in our `open()` -- it is the MenuManager
         closing a *previous* menu of ours that had already been destroyed.
Change   Read popupMenu.js instead of guessing. Three facts decided the fix:
         `MenuManager.removeMenu()` pops the modal and unlinks the menu but never assigns
         `activeMenu = null` (1438-1456); the only place that clears `activeMenu` is
         `_onMenuOpenState` on the CLOSE (1486-1487); and `close()` emits that state change
         synchronously and only then starts its animation (1083-1094). So
         "removeMenu() + destroy(), closed with the FADE default, from the item's activate
         handler" destroyed the actor while its own close animation still held it, and left
         the manager pointing at the corpse for the next `open()` to trip over.
         `_finalizeContextMenu()` now goes: our references down first (so nothing re-enters)
         → `close(PopupAnimation.NONE)`, which is what makes the manager let go → disconnect
         our handlers → `destroy()`, leaving `removeMenu` to the manager's own destroy hook
         (`addMenu` connects it, 1428). Two more pieces: the item's activate handler no longer
         closes the menu at all, because the shell's own handler is connected AFTER and does
         it (785-787) while an action that writes favorites kills the anchor underneath us;
         and a destroy hook on the menu actor releases our references for the path where the
         shell disposes the menu with no state change for us to see.
         Removed as a side effect: `setOnContextMenuActorChanged` / `_onContextMenuActorChanged`,
         which had no caller anywhere in the repo -- an unread contract, not a feature.
Evidence L2 for the symptom, both stacks above are this boot's journal. The fix is L1:
         tiers 1 (164/42, 9/9) and 2 (24/24) green with the new teardown, and nothing offline
         opens a context menu over a row rebuild -- that is one right-click during a pin/unpin
         round trip on the post-logout checklist.
Cost     A replaced menu no longer fades out (the destroy cut that animation short anyway), and
         the `removeMenu()` call that used to sit in our teardown is gone: it is now reached
         only through the manager's own destroy hook.
Commit   6b80798

---

### D-111 · 2026-11-05 · taste

Symptom  The owner asked to copy Ubuntu Dock's drag completely ("他的移动就非常棒"), and was
         offered the choice of what the source icon does during a gesture. Two options were on
         the table: hide it (what D-108 shipped, width rock-steady, hole under the pointer) or
         dim it and let the dock grow (what Ubuntu does). Chosen: **dim + grow**.
Change   `_onDragBegin` sets `actor.opacity = DRAGGED_OPACITY` (50) and `_finishDrag` restores
         255, which are Ubuntu's own two numbers and its own two hook points
         (ubuntu-dock `dash.js:519-526` -- its `_createAppItem` connects drag-begin/drag-end and
         nothing else). Hiding has nothing to do with opacity, so `_dragging` stays whatever the
         actor is and `_clearPlaceholder(true)`/`setDragInProgress(false)` still close the
         gesture. The consequence is D-109's flag becoming unconditional: the source icon never
         leaves the layout now, so the gap always occupies a slot nobody gave up and
         `_relocatePlaceholder` always calls `setDragGap(true)`. The row is therefore one padded
         slot wider than resting for the whole gesture, exactly as Ubuntu's dash grows by a slot.
         An actor destroyed mid-gesture is caught rather than allowed to throw -- the opacity
         write is the only thing left in that path.
Evidence L1: tiers 1 (9/9) and 2 (24/24) with the drag live in the sandbox; the opacity and the
         width are not asserted offline, and no tier moves a pointer. Ubuntu's number is read
         from the installed extension, not from memory. L2 on the next logout.
Cost     A drag now visibly widens and narrows the dock -- correct per Ubuntu, but new motion for
         this fork's owner to judge, and it moves the dock's neighbours by one slot mid-gesture
         on a `!hide-dock` layout.
Commit   6b80798

---

### D-112 · 2026-11-05 · fix

Symptom  Clicking an icon with several windows acted on one window (minimize if focused, else
         activate), so the only way to reach the third window of an app was the keyboard or the
         overview. Ubuntu's default click action opens the window picker instead.
Change   `showsPreviewsOnClick(windowCount, focused)` in `lib/clickAction.js` encodes the half of
         Ubuntu's `FOCUS_OR_PREVIEWS` that this fork uses -- `windowCount > 1 && focused`, the
         `(windows.length > 1 || modifiers || button !== 1)` test with the modifier and non-left
         button branches removed (ubuntu-dock `appIcons.js:618-627`); middle-click keeps its own
         meaning, opening a new window. `dockManager._onAppClicked` tries the preview first and
         falls through to `applyClickAction` if the icon declines, so previews switched off, or no
         actor to hang the popup on, costs the click nothing rather than swallowing it. The Trash
         goes through the same branch with its own duck-typed subject.
         The holding open is the actual work: `WindowPreviewPopup.togglePinned()` pins the popup
         and takes `Main.pushModal` on it, dismissing on Escape, on a press anywhere outside it,
         or on the same icon clicked again. That is the behaviour-level shape of Ubuntu's
         `WindowPreviewMenu`, which is a real PopupMenu under a `PopupMenuManager` and so inherits
         MenuManager's grab and outside-press dismissal (`popupMenu.js:1501-1529`); this popup is
         not a menu, so it takes the grab itself and copies the dismissal *rules*, not the code
         (GPL-3). A refused pushModal drops the pin and hands the popup back to the hover rules --
         an un-grabbable pinned popup would be undismissable. Selecting a thumbnail activates and
         closes, as a menu item would.
Evidence L0: 5 assertions over the window-count x focus table in `test/clickAction.test.js` --
         3 and 2 windows focused open previews, an unfocused app does not, and a single focused
         window must NOT (the row that would silently change every existing click).
         L1: tiers 1 (9/9) and 2 (24/24). The grab, the dismiss paths and the fall-through when
         previews are off are all L2 -- tier 2 forbids pointer and pixel assertions.
Cost     Two fields and four methods on the popup for one interaction, and a click that used to
         minimize now opens a picker when the app has more than one window -- minimising from the
         dock is then one click inside the picker, or the preview's own close button.
Deliberate Not done   The owner was asked whether the click actions should become a `click-action`
         setting like Ubuntu's ten-mode enum, and said no: the behaviour stays hardcoded, so no
         new schema keys (the count stays 64) and no prefs UI.
Commit   6b80798

---

### D-113 · 2026-11-05 · fix

Symptom  The owner's screenshot: the dark background stops roughly a third of the row short,
         and the last icons, the separator, the Trash and the applications button sit on the
         bare desktop. A live boot that had just done nine drags and six favorites writes.
Change   `_computeContainerRect()` no longer ESTIMATES the dock's length. It used to add up
         `iconCount × (icon-size+12) + gaps + separatorWidth + tailCount + a flag for the drag
         gap` -- a second description of the row, maintained by hand, which is wrong the moment
         the row contains a child the estimate does not name. Now it measures: sum the visible
         children's own requests, add the layout's spacing and the container's padding, and take
         `MIN_DOCK_WIDTH` as a floor. Ubuntu's dash has never had this bug because it has never
         had this estimate -- the box is sized by its content.
         Two facts measured before writing the sum, because both were guessed wrong first:
         the gap between requests lives on the layout manager (`container.spacing` is not a
         thing, and reading it as one produced a NaN width), and a child's CSS margin is already
         inside its own request -- adding `margin_left/right` again overshoots the separator by
         8px per row.
         `IconManager.setDragGap()/hasDragGap()` and the `_dragGap` field are gone: they existed
         only to feed the estimate. `notifyRowChanged()` replaces them.
Evidence L2 for the symptom (the screenshot). L1 for the fix, and it is the kind of L1 that
         separates regression from coincidence: the new tier-2 `dock-extent-tracks-row` compares
         the computed length against the row's real allocation in six states, and run against
         the pre-change estimate it FAILS with `557` where the row measured `623` (gap open),
         `583` (gap shrinking) and `603` (a child the estimate never knew). Post-change:
         557/557, 623/623, 584/583, 557/557, 603/603, 557/557.
Cost     One walk of a dozen children per position update, which already happened per icons
         change; and the width now follows anything that lands in the row, which is the point
         but also means a stray child shows up as a wider dock instead of as icons outside it.
Commit   6b80798

---

### D-114 · 2026-11-05 · fix

Symptom  The drag gap jumped in and out at full size -- one whole slot, instantly -- instead of
         growing the way Ubuntu's dash does.
Change   The gap animates its WIDTH now, not its scale. Scale is a transform: it moves pixels
         and leaves the layout alone, so an eased scale cannot make the row grow, which is why
         the dock had to be told about the gap out of band (see D-113). Animating the request
         makes the row itself grow, and with the length measured from the row the background
         breathes with it. The shell reaches the same result from the other direction: its
         placeholder reports a preferred width already multiplied by its own animation.
         `notify::width` on the placeholder is what asks the dock to re-measure, so the growth
         is sampled per frame rather than per drag event; a gap born at full size asks once
         directly, because no notify is coming for it. The shrink's destroy hook also asks, so
         the slot is handed back exactly when the child leaves the row rather than 200ms early.
Evidence L1: the same tier-2 check samples `gap-open` (623/623) and `gap-shrinking` (583 row,
         584 computed) -- the intermediate value is the proof the animation is in the layout and
         not in a flag. Feel is L2.
Cost     One more `set_size` per animation frame for 200ms at a time, and the background now
         visibly resizes during a drag -- which is what the owner asked for in D-111.
Commit   6b80798

---

### D-115 · 2026-11-05 · fix

Symptom  Two separate things, one cause: the separator, the Trash and the applications button
         magnify when the pointer passes them (they are not app tiles), and an icon can stay
         enlarged after the pointer has left it.
Change   The tick walks ICON actors only -- whatever the icon manager tagged `_appData` -- and
         the per-actor scale lives on the actor instead of in a positional array. The array was
         the second bug: it was indexed by child position, so every insertion into the row
         (a drag gap, an icon appearing) shifted the whole array and handed one icon's scale to
         its neighbour. `_collectIcons()` reuses one array across frames, so this costs no
         allocation on the hot path.
         This also removes a collision: the tick wrote `scale_x` on every child, and the drag
         gap is a child whose `scale_x` is its own animation.
Evidence L1: `tick-geometry-reads` now reports "6 for 6 icons of 9 children" and its assertion
         was rewritten to the new contract (one read per icon, none per non-icon child) -- the
         old assertion counted all nine children and would have called the fix a regression.
         Whether the separator visibly stops bulging is L2.
Cost     A `filter` over the children per frame, into a reused array. Strictly fewer geometry
         reads and fewer property writes than before.
Commit   6b80798

---

### D-116 · 2026-11-05 · fix

Symptom  Two. (a) In the sandbox, ten drags with one interrupted left FIVE icons at opacity 50
         for the rest of the session. (b) On the live session, nine `drag begin`/`drag end`
         pairs and not one `drop` line -- the gesture runs, nothing is written, and no log says
         why.
Change   (a) The dim is a Set of actors, not a single "currently dragged" field. `_finishDrag`
         restores everything in it, and `stop()` reaches `_finishDrag` on the disable path. A
         gesture can end without ever calling the finish of the previous one (the dock sliding
         out from under the pointer is the live case, and dodge logs `overlap -> hide`
         constantly in this boot), so one slot is not enough state.
         (b) Every silent exit in `_handleDragOver`/`_acceptDrop` now says what it decided:
         `over gap@pos=… slot=… favPos=… favs=…`, `over self-slot`, `over refused by
         canDrop`, `drop in place, nothing written (animating=…)`, `drop refused (…)`. Throttled
         to one line per distinct verdict per drag, because `handleDragOver` runs per motion
         event. This is an instrument, not a feature: the sandbox proves the API path does drop
         (`drop move to fav#4`), so what is missing is the reason the real pointer path does not
         reach it, and that reason is currently invisible from outside.
Evidence L1 for (a): the new tier-2 `drag-dim-released` FAILS against the single-slot version
         ("1 icon(s) stuck at drag opacity after two begins and one finish") and passes against
         the Set. (b) RESOLVED by the instrument on the next boot: 15 `drag begin`, 112 gap
         moves, and `2 drop move + 5 drop pin + 6 drop in place` -- reorders and grid-pins both
         reach the write, and the six silent ones are the owner releasing on the icon's own slot,
         which is what the shell persists nothing for (dash.js:974-976). The old "nine drags,
         zero drops" boot had no such lines at all.
Cost     A Set of at most a couple of actors for the length of a gesture; one journal line per
         slot change during a drag.
Commit   6b80798

---

### D-117 · 2026-11-06 · fix

Symptom  The owner: the Trash menu's "Open Trash" and "New Window" do the same thing.
Change   "Open Trash" is gone, and with it `TrashManager.reveal()` and dockManager's
         `reveal` branch -- not left as an unreached method. Ubuntu's Trash is an
         AppInfo whose only advertised action is `empty-trash`
         (ubuntu-dock `locations.js:797-806`), so its menu is New Window plus that
         row when the trash is non-empty; opening the trash is what *clicking the
         icon* does, and a second row that also brought it forward reads as a
         duplicate. The click keeps the toggle rule the owner asked for, and the
         multi-window picker still applies when previews are on.
Evidence L1: tiers 1 (9/9) and 2 (26/26); the sandbox probe asserts
         `typeof trashManager.reveal === 'undefined'`. The menu itself is L2
         (one right-click).
Cost     One row fewer. Nothing is lost that the icon click does not already do.
Commit   6b80798

---

### D-118 · 2026-11-06 · fix

Symptom  Two, from the same gesture. (a) The owner tried to unpin by dragging an icon
         onto the app grid, because the Show Apps button gives no sign that it is the
         unpin target -- only a background highlight. (b) That attempt threw four
         times inside the shell in one boot:
           TypeError: icon.get_parent is not a function
           _getViewFromIcon@resource:///org/gnome/shell/ui/appDisplay.js:108
           _canAccept@resource:///org/gnome/shell/ui/appDisplay.js:3108
Change   (a) The shell answers the same problem by relabelling its own button:
         `setDragApp()` shows "Unpin" while a favorite hovers it (dash.js:237-246).
         `IconManager.setUnpinLabel()` does the equivalent here through the existing
         tooltip, revealed without the 300ms hover delay because mid-drag this is the
         only signal there is; leaving the button with the pointer still on it falls
         back to the normal label rather than blanking a legitimate tooltip. The
         style-class highlight stays.
         (b) The grid's probe assumes the drag source is an actor, because the shell's
         own grid icons set `_delegate = this` (appDisplay.js:1857). Ours is a plain
         object, so `source.get_parent()` was undefined. The delegate now answers
         `get_parent()` with the real actor's parent, so the walk climbs to the stage,
         finds no `BaseAppView`, and `_canAccept` returns false -- the refusal the
         shell intended, instead of an exception on our drag's behalf.
         Deliberately NOT implemented, at the owner's choice: "drag out of the dock
         to unpin". Neither the shell nor Ubuntu has that target, the overview is
         usually closed during a dock drag, and it would unpin on any release outside
         the dock.
Evidence L1: sandbox probe -- `typeof delegate.get_parent === 'function'`, the parent
         walk completes in 3 hops with no throw, and the cue reports
         `visible=true, text="Unpin"` on and `visible=false` off. Tiers 1 (9/9) and
         2 (26/26). Whether the word is readable during a real drag is L2.
Cost     One more label while dragging (it reuses the tooltip actor, so no new chrome
         and no new teardown path); one method on the delegate.
Commit   6b80798

---

### D-119 · 2026-11-06 · fix

Symptom  A live boot's teardown ended with `reload: 16 icons in 33.5ms
         (reason=apps-button-fix-disabled)` between the revert and `[dnd] stopped`:
         `disable()` was rebuilding the whole icon row on its way out.
Change   `_stopAppButtonFix(rebuild = true)`; `disable()` passes false. The rebuild
         is not decoration on the settings path -- the patch detaches the button's
         original press/hover connections through SignalManager and cannot re-attach
         them (the ids are gone with the bookkeeping), so turning the fix OFF
         mid-session has to rebuild the row to get the stock handlers back. During
         teardown the container is destroyed moments later, so the same rebuild is
         pure cost: 33.5ms and a burst of `[icons]` lines in the middle of a disable,
         which is exactly the kind of journal noise that makes a teardown regression
         impossible to read.
Evidence L1: the sandbox probe calls `stateObj.disable()` and the log now goes
         `wrapped methods reverted` -> `[dnd] stopped` with zero
         `apps-button-fix-disabled` lines (it was one). Tiers 1 (9/9), 2 (26/26).
Cost     The OFF-mid-session path keeps its rebuild, so nothing about the fix's own
         revert contract changes.
Commit   6b80798

---

### D-120 · 2026-11-06 · fix

Symptom  The post-logout journal showed two `drag end` lines for one `drag begin`.
Change   `bindIcon` connects `drag-end` only. The shell's `_cancelDrag()` emits
         `drag-cancelled` AND `drag-end` for the same gesture (dnd.js:592 then
         597/535), so wiring both signals ran `_finishDrag()` twice per cancelled
         drag. It was harmless -- `_dimmed` is already cleared, `_clearPlaceholder`
         early-returns on a null gap, and `setDragInProgress(false)` replays nothing
         the second time -- but it doubled the work and, worse, put a shape in the
         journal that is indistinguishable from a real double teardown, which is the
         thing I read when a drag goes wrong.
Evidence L1: tiers 1 (9/9) and 2 (26/26) unchanged. The live shape is L2: one
         `drag begin` must now have exactly one `drag end`.
Cost     Nothing: one signal connection fewer. The second teardown was harmless, which is
         exactly why it is easy to leave in -- and why the log line it fabricated is the cost.
Commit   6b80798

---

### D-121 · 2026-11-06 · guard

Symptom  The dock's background covering its own row is the bug class the owner has
         photographed twice, and it is the one thing with **no live detector**: the
         screenshot API answers `AccessDenied` in a normal session, and tier 2 has
         no fractional scaling, no user theme and no live drag -- so a length that
         disagreed only on this machine would have passed 26/26 forever.
Change   `_updatePosition()` schedules one debounced check (400ms, one pending at a
         time, id stored and removed in `disable()`), which compares the length we
         just set against the row's **painted** extent -- `max(child.x + child.width)
         + min(child.x)` over visible children -- and warns only when they differ by
         more than 2px. The settle delay is the whole design: during the gap's 200ms
         growth the request legitimately runs a frame ahead of the allocation, and a
         check that fires mid-animation would call correct layout a bug.
         `[layout] background <len> does not cover the row's <painted> (<n> children,
         position=<p>)`
Evidence L1, and the instrument is proved in both directions on the private
         compositor: mutate the length by 180px and it speaks exactly once
         (`background 377 does not cover the row's 557 (9 children, position=0)`);
         replay a real drag -- 8 slot moves and a drop -- and it stays silent.
         Mutation is the only honest way to test a check that is silent by design.
Cost     One walk of the children per settled position update. Skipped entirely
         while a check is already pending.
Commit   6b80798

---

### D-122 · 2026-11-06 · chore

Symptom  Four public accessors on IconManager had no caller left.
Change   `getIconCount()`, `hasSeparator()`, `hasAppButton()` and `hasTrash()` were
         read by exactly one thing: the count-based width estimate deleted in
         D-113. They are gone rather than kept as a public surface nobody
         compiles against. The comment at the fade-out path still explained the
         keep-the-entry rule in terms of `getIconCount()` and "the dock width" --
         rewritten to say what is actually true now: the fading child stays in the
         row the length is measured from, or the dock shrinks ~200ms before the
         icon leaves the screen and yanks the trailing buttons past the background.
Evidence L1: tier 1's parse/coverage guards plus 166 unit assertions and 26 tier-2
         checks green with the methods deleted.
Cost     Nothing at runtime. What is paid is that a future caller must go through an accessor
         that answers a question someone actually asks, rather than one of the four deleted names.
Commit   6b80798

---

### D-123 · 2026-11-06 · fix

Symptom  The owner moved an icon, felt something wrong at the end of the row, and
         did not describe it. The journal described it: the 22s drag
         07:59:34→07:59:56 spent its last seven seconds alternating, ~5×/s,
           [dnd] over gap@pos=15 slot=15 favPos=13 favs=15
           [dnd] over self-slot pos=14 favPos=13
         and ended `drop in place, nothing written`. The gap was being offered and
         withdrawn under a pointer that had not moved. Two other drags that boot
         were clean, so this was a place, not a gesture.
Change   The partition counted the Trash as a slot. It cannot hold a favourite, so
         `_slotChildren()` skips it exactly as it already skips the Show Apps
         button -- in the shell's dash neither of those is inside `_box` at all
         (dash.js:212). The arithmetic is the whole bug: `slotAt` divides the row's
         extent into `n` equal slots, so adding one slot to 15 icons stretched the
         extent by the Trash's ~81px and moved the boundary between "this is your
         own position, gap withdrawn" and "drop after the last favourite" off the
         last icon's right edge and ~16px to its right (arithmetic on the live
         row's own numbers -- 15 favourites, the pointer parked in the padding at
         the end -- not a measured pixel) -- which is precisely the
         strip of padding the pointer occupies whenever someone aims at the END of
         the row. Magnification shifts the icons several px as the pointer
         approaches them, so a pointer parked in that strip crosses the boundary
         back and forth under itself, several times a second.
         Nothing in this shell or Ubuntu Dock counts a tail button as a slot; the
         exclusion list here had simply never been asked whether the Trash is one.
Evidence L1 for the rule, and the pre-fix code is proved to break it: tier 2's new
         `drag-slots-are-icons-only` reads the partition while a drag is live and
         compares it against the row -- post-fix `{slots:6, icons:6, boundary:400,
         lastIconEdge:400}`, pre-fix `{slots:7, icons:6, boundary:481,
         lastIconEdge:400}` (481 is the Trash's right edge). This round's two fixes
         were reverted together and tier 2 came back 26 pass / 2 fail, the two
         failures being exactly this check and D-124's. Whether the buzzing stopped
         is L2: it needs the owner's pointer at the end of a real row on a real
         monitor, which no sandbox can supply.
Cost     One fewer child examined per motion event; nothing to pay.
Commit   6b80798

---

### D-124 · 2026-11-06 · fix

Symptom  D-121's own instrument cried at login, once, and lied:
           [layout] background 1066 does not cover the row's 55 (18 children, position=0)
         07:59:17.404 -- 1.5s after the shell started. Eighteen children had been
         added; none had been allocated yet, so "the row" was measured as the one
         icon that happened to have a size, and the dock was accused of being
         1011px too long. A warning that is wrong once is worse than no warning: it
         teaches whoever reads the journal to ignore the class of bug it names.
Change   `_checkExtentAgreement()` returns without an opinion when a visible child
         reports zero extent along the dock's axis, because that is not a layout
         disagreement but the absence of one. The gap is exempted by identity: it
         is the only child that is legitimately 0px wide on purpose, widening in and
         shrinking out (D-113), and the check runs 400ms after `_updatePosition()`
         precisely to land inside such an animation some days.
         The fix is a bail-out, so the bail-out itself has to be proved not to be a
         mute button. `console.warn` cannot be reassigned in GJS -- measured, it
         throws `"warn" is read-only` -- so the new tier-2 assertion counts
         `[layout]` lines in the private shell's own log across two fabricated
         states: an unallocated child (must add 0) and a laid-out row whose
         background is then claimed to be 300px longer than it paints (must add
         exactly 1). `{ghostDelta:0, speakDelta:1}` green; with the guard removed
         `{ghostDelta:1, speakDelta:1}` red, which is the same mutation that made
         D-121's instrument trustworthy in the first place.
Evidence L1 for both halves, from the same probe as D-123 (`28 checks — 28 pass`,
         and 26 pass 2 fail against pre-fix). Whether login is now quiet is L2, and
         it is checkable with one finite journal query.
Cost     One extra comparison per child in a check that already walked them.
Commit   6b80798

---

### D-125 · 2026-11-06 · fix

Symptom  The owner's screenshot: a large empty rounded slot sitting between two icons, with
         nothing dragging. Reproduced from this boot's journal -- `[dnd] over gap@pos=15
         slot=15 favPos=-1 favs=15` with no `drag begin` before it and no `drop`/`drag end`
         after it. `favPos=-1` means the source is the app grid, not a dock icon.
Change   `DockDnd` now installs a DND drag monitor for as long as it owns a visible cue
         (`_ensureDragMonitor` / `_removeDragMonitor` / `_syncDragMonitor`, called from the gap's
         create and clear paths and from the Unpin cue). `dragMotion` compares the pointer against
         the container's transformed rect and withdraws the gap the moment the pointer is outside
         it -- the same rule the shell's own dash applies (dash.js:403-406, 420-443), which is why
         the native dash never shows this. A monitor only fires on motion, so Escape is covered by
         a `captured-event` handler on the stage that clears the cues and returns
         `EVENT_PROPAGATE`; the shell still cancels its own drag. Both are removed together in
         `_finishDrag`, so no path leaves a monitor installed on a dock that is not dragging.
         Why the shell cannot tell us: `dnd.js` notifies a target only while the pointer is over
         it, and there is no drag-leave callback -- an external source emits no `drag-end` this
         class can connect to either.
Evidence L1: new tier-2 assertion `external-drag-placeholder-clears` drives
         `_handleDragOver` with an out-of-dock event and requires the gap destroyed, the actor
         gone and the monitor removed. It was one of the 3 FAILs of the pre-fix run
         (`tier 2: 31 checks -- 31 pass, 0 fail` after). L2 pending: it is the owner's own gesture.
Cost     One rect comparison per pointer motion event, only while a cue is on screen.
Commit   6b80798

---

### D-126 · 2026-11-06 · fix

Symptom  "Icon and its name are too far apart." The gap grew toward the ends of the row, worst on
         the first icon, and did not depend on the pointer being over anything magnified.
Change   `_positionTooltip()` subtracted `(this._magScale - 1) * actor.height * pivotY` -- the
         configured *maximum* scale -- while the icon under the pointer settles at whatever the
         falloff curve hands it, stored per actor as `_dockMagnifyScale` (magnification.js:344).
         It now reads that value (`Math.max(1, Number(actor._dockMagnifyScale) || 1)`), so the
         anchor is the height this icon actually reaches. With the old formula a 64px slot was
         lifted ~25px even where the wave never grows the icon, which is the distance photographed.
         `TOOLTIP_GAP` 10 -> 6 and became the `tooltip-gap-px` setting (D-128), the measured
         glyph-to-bubble gap being gap + label padding, not gap alone.
Evidence L1: new tier-2 assertion `tooltip-settled-scale` places the label through the real
         `_positionTooltip` and compares it against the settled top edge -- reported delta 0px.
         It was one of the 3 pre-fix FAILs. L2: the owner's eye, next login.
Cost     One property read per label placement.
Commit   6b80798
### D-127 · 2026-11-06 · fix

Symptom  "Moving dock icons themselves has bugs." Journal shape: `[dnd] drop move to fav#15`
         followed by two `[icons] incremental ... reason=favorite-apps` lines in a row, the second
         `+0 -1` -- an icon vanishing right after a successful reorder.
Change   `_acceptDrop` ran `_finishDrag()` for every accepted drop, but `dnd.js` emits the
         source's `drag-end` *after* `acceptDrop` returns. Clearing `_dragInProgress` inside the
         drop therefore let the deferred favourites write replay the sync once, and the second
         pass ran while the drag teardown was still settling. Dock-owned sources now finish only
         their own cues -- the Unpin highlight and the gap -- and leave the gesture to
         `drag-end`; the applications-button target makes the same split, and an app-grid source,
         which has no dock-side `drag-end` at all, still gets the full `_finishDrag()`. A refused
         drop now clears the cues instead of leaving them painted.
Evidence L1: new tier-2 assertion `drag-guard-through-drop` asserts `_dragInProgress` is still
         set and the monitor still installed immediately after `acceptDrop`, and gone after the
         source's `drag-end`. It was the third pre-fix FAIL. The `+0 -1` itself stays L2-shaped:
         it is a real-desktop log, and the double-sync is only its explanation.
Cost     No extra work; one cleanup moved from the drop to the drag's own end.
Commit   6b80798

---

### D-128 · 2026-11-06 · chore

Symptom  Four behaviours the owner asked to tune were compile-time constants: the label's distance
         and its delay, the cap on running dots, and the press-and-hold that starts a drag.
Change   New schema keys `tooltip-gap-px` (0-30, default 6), `tooltip-delay-ms` (0-2000,
         default 300), `max-indicator-dots` (1-10, default 4), `drag-hold-ms` (100-1000,
         default 200). `IconManager` gained `setTooltipGap` / `setTooltipDelay` /
         `setMaxIndicatorDots` and `DockDnd` gained `setDragHoldMs`; each clamps to the schema
         range, ignores a no-op write, and re-anchors what it changes (the label is repositioned,
         the indicators and the Trash indicator are refreshed, `DND.makeDraggable` picks the value
         up when the next icon is built). `DockManager` reads all four at start and reconnects on
         `changed::`, so a settings edit takes effect without a reload. Fixed geometry
         (icon vpad, dock height extra, minimum width) deliberately stayed constants -- see the
         conventions note in `dockManager.js` about formerly-companion settings.
Evidence L1: tier 1 `schema-valid` + `compiled-fresh` (68 keys, compiled == XML == what the shell
         reads), and the settings-surface guard, which pins the bound set to everything except the
         twelve keynav-owned keys -- so a key with no prefs row is red. Rows for all four exist in
         both READMEs, which that same guard requires. `npm test` 166/166. L2: a live slider
         nudge, which needs no logout.
Cost     Four keys, four setters, four connections; nothing read per frame.
Commit   6b80798

---

### D-129 · 2026-11-06 · taste

Symptom  The prefs window was one "General" page holding fourteen groups -- a scroll, not a
         set of categories -- and most groups explained nothing.
Change   Eight `Adw.PreferencesPage`s, which is what makes `AdwPreferencesWindow` show a sidebar:
         Dock, Behavior, Magnification, Auto-hide, Genie Animation, Keyboard, System, Performance.
         Twenty-two groups inside them, each with a one-line description of what the defaults
         assume. Rows moved to the category a reader would look in rather than staying where they
         were written: `show-threshold` from Behavior to Auto-hide (it is a reveal rule),
         `apps-button-fix-enabled` from Behavior to System (it patches the shell, not the dock),
         the genie shape numbers out of the on/off group into "Funnel Shape", and the shrink keys
         into "Shrink Mode" so they read as belonging to the non-default mode.
Evidence   L0: `node --check`, plus a derived audit -- every declared group is added to a page,
         every page has at least one group, and the schema-minus-prefs key difference is exactly
         the pinned twelve. The settings-surface guard is the mechanical half and it is green.
         The window itself is unverified: nothing here opens it, so the layout is
         needs-manual-confirmation until the owner looks at it. It needs no logout.
Cost     Structure only; no row was added, removed or re-bound.
Commit   6b80798

---

### D-130 · 2026-11-06 · fix

Symptom  The owner's report was that the icon *after* the one being moved animates oddly,
         and that the drop indicator itself now misbehaves -- hard to describe, which is
         why the journal was the only way in.
         This boot (code fresh, shell 12:08:49, edits 10:57-11:37): six drags produced
         **202 `over gap@pos=N` verdicts against 89 `over self-slot pos=N`** -- a still
         pointer changing its mind hundreds of times. The pairs are adjacent
         (`gap@pos=10` then `self-slot pos=9`, favPos=8), and each pair costs a
         destroy-and-recreate of the gap plus a 200ms widen/shrink of the row, which is
         the animation the owner could not describe. The neighbour icon is the one that
         moves, because it is the one sitting on the boundary that flips.
Change   The gap was being measured as part of the row it was deciding.
         `_slotChildren()` returned the live allocations, so opening a gap pushed every
         icon after it right -- measured in the sandbox: extent **390 → 456**, one slot
         plus the layout spacing -- and `slotAt` divides by that extent, so the same
         pointer coordinate answered one slot *lower* the next time round. Answering
         lower can land on `favPos + 1`, which is the self-slot branch, which withdraws
         the gap, which restores the old extent, which answers higher again.
         The shell cannot do this: `dash.js:879-885` subtracts the placeholder's width
         (and one child) from the box before dividing. The new pure function
         `restingSlots(children, spacing)` does the same thing -- drop the gap, and pull
         everything positioned after it back by `gap.size + spacing`, i.e. answer from
         the geometry the row returns to when the gap goes away. `spacing` matters: a
         child brings one with it, and the live tables read 66 = 60 + 6, not 60.
         Also honest about the shrinking gap: width 0 still occupies a spacing.
         `dockDndSlots.js` gained the function, `DockDnd._slotChildren()` became the
         adapter that flags the gap and delegates; nothing else reads live geometry for
         a verdict, and the drop path already reads `_placeholderPos` rather than the
         pointer (D-113), so indicator and write still agree.
Evidence L1: 5 new pure cases in `test/dockDndSlots.test.js` (identity without a gap;
         the measured closed/open tables; `slotAt` agreement for every 2px across the
         whole row; gap at index 0 shifting the origin; a 0-width gap still costing a
         spacing) -- `npm test` 166→**171**, 44 suites, tier-1 floor raised to match.
         L1: new tier-2 stage `drag-slot-partition-gap-invariant` replays what the shell
         actually does -- ask from a closed row, let the gap open and the row relayout,
         then ask the *same coordinate* again without resetting anything. Against the
         pre-fix code: **6 of 18 sample points moved their own gap**, one of them to
         `-1` (self-slot withdrawn), which is the live pair. After: 0 flips, and
         `extentClosed == extentOpen == 390` while the container itself is 623.
         tier 2 **32/32**. The `dock-extent-tracks-row` and `drag-slots-are-icons-only`
         probes did not move, so the background maths and the slot partition are
         unchanged. L2: the owner's pointer -- the description was "the animation of the
         icon after the one I moved", and only a hand can say whether that is now calm.
Cost     One pass over the child list per verdict, which it already did.
Commit   6b80798

---

### D-131 · 2026-11-06 · fix

Symptom  D-121's instrument spoke ten times this boot, and the numbers climbed a
         ladder: 19 children at login, then 20, 21, 22, 23 after the drags, with the
         row's painted length frozen at **930** while the computed background grew by
         **61px per extra child** -- exactly one gap's width. Reported as
         `[layout] background 1127/1188/1249/1310/1371 does not cover the row's 930`.
Change   Two things, and the second is a negative result worth keeping.
         (a) The check testified about a dock that was **hidden**. `hide()` freezes the
         children's allocations, while `_computeContainerRect()` keeps recomputing the
         length from their requests, so the pair disagrees by whatever changed while the
         dock was away -- and dodge hides the dock the moment the pointer leaves it,
         which is exactly when a drag ends. `_checkExtentAgreement()` now returns
         without an opinion when `!c.visible`, and `notify::visible` re-arms the 400ms
         check so the row is still judged once it is actually painted -- the bail-out
         defers the testimony, it does not silence it.
         (b) The ladder itself was D-130, not a leak. The obvious story -- a gap cleared
         while hidden never gets destroyed -- was tested and **rejected**: in the
         sandbox, `_clearPlaceholder(true)` on a hidden container takes the child count
         from 10 back to 9, releases `_animatingPlaceholders` to 0, and stays at 9 after
         the dock is shown again. What the ladder actually was is the flip storm: every
         withdrawn gap leaves a shrinking actor for 200ms, five of them overlapping add
         3-5 × 61px to the request sum, and the hidden row (a) made that visible.
Evidence L1: the hidden-row state is now a fourth gate inside
         `extent-check-silent-unallocated`: hide the container, change its length, run
         the check, count `[layout]` lines in the private shell's own log. **Before the
         fix: +1 line** (that is the pre-fix red run, `hiddenDelta: 1`); after: 0, while
         the two older gates still hold (`ghostDelta: 0`, `speakDelta: 1`) -- so the new
         bail-out is not a mute button. The no-leak half is measured, not asserted: the
         child-count triple (10 → 9 → 9) is printed in the gap probe's JSON.
         L2: after the next login, the finite query is
         `journalctl --user -b -o cat _PID=$(bash -c 'source test/common.sh; shell_pid') | grep -a '\[macos-dock-local\] \[layout\]'`
         -- the claim is that it prints nothing.
Cost     One visibility read per check, one signal connection per enable cycle.
Commit   6b80798

---

### D-132 · 2026-11-06 · fix

Symptom  Four reports of one gesture, and my first three answers were wrong. (1) "移动一个图标到他
         后面一个应用上面，并不会显示占用位置；移动到后两个应用就正常显示占位" — the cell right of
         the held icon drew nothing. (2) I fixed that cell; "反方向问题有了" — the left neighbour then
         drew nothing. (3) I generalised it to "every cell right of self answers one gap further";
         the owner's verdict was "感觉不行啊，越改越糟糕"，并给出了自己的模型：
         "移动到前一个图标靠左还是靠右自动显示往靠近方向的地方的占位，唯一的例外就是移动图标的左右
         两个图标，他们需要显示一个占位就行，因为移动图标原来的占位本身还在，就是没有完成移动，完成
         移动后才不在"。The pointer wants the nearest edge; the held icon's own slot is what makes the
         two neighbours different — and they are different from **each other** only because a cell is
         read from one side.
Change   The pointer is now read as the nearest **line** between two icons rather than as the cell it
         happens to sit in. `slotAt`'s proportional partition (dash.js:876-901, one cell per icon,
         whole cell = "insert before that icon") is replaced by `boundaryAt(coord, slots, rtl)`,
         which answers `{boundary, cell}` over n+1 lines: the row's outer edge, the midpoint of every
         gap between two icons, the far outer edge. An icon's left half therefore inserts before it
         and its right half after it, which is what the hand means and what the shell's cell-sized
         dead zone refused to say. `offerGapForSlot`'s offset is gone: `offerGapForBoundary` keeps
         that same nearest line **except** where the line is one of the two that touch the held
         icon's slot — the held icon is dimmed to 50, not removed (D-111), so both of those lines
         name the position it already has, and they are spent. Aiming at a spent line from the held
         icon's own cell is the real no-op and `isSelfPosition` withdraws it (nothing drawn, exactly
         as the owner asked); aiming at one from a neighbour's cell pushes it to that neighbour's
         **outer** line, so both neighbours become a swap. The two no-ops are derived from the write
         semantics rather than special-cased: gap g writes `g > p ? g-1 : g`, and only g = p and
         g = p+1 leave the list unchanged. RTL stopped being a mirror: `slotAt` mirrored an index and
         its `extent <= 0` guard meant a row whose starts decrease answered the end of the row for
         every coordinate; a nearest line is a physical place either way, so only the two **outer**
         lines consult `rtl` and the interior ones need no direction at all.
         The write path, `isSelfPosition`, `clampToFavoriteSlots`, the gap geometry and the drop
         mapping are untouched — an offer correction, not a persistence one.
Evidence L1: the rule asserted as a table over held position x icon x both halves (16 cells for a row
         of four), with the expectation written literally, not derived from the implementation.
         `npm test` **180/180 in 45 suites** (floor 176/45 -> 180/45): the four maps
         `p=0 [·,·][2,2][2,3][3,4]`, `p=1 [0,0][·,·][3,3][3,4]`, `p=2 [0,1][1,1][·,·][4,4]`,
         `p=3 [0,1][1,2][2,2][·,·]` (`·` = nothing drawn), the identity for an external drag
         (`favPos = -1`, which occupies no slot), the "each neighbour gives one line for its whole
         cell" and "own cell draws nothing, either half" invariants, the clamp for a row with more
         favourites than icons, the composed writes through `favoriteIndexAtGap` ->
         `moveInFavoriteList` including the two halves of one far icon being two **different**
         orders, and the honesty check that `isSelfPosition` fires exactly where the write changes
         nothing. `restingSlots`' invariance gate now compares `boundaryAt` and additionally asserts
         the raw live row **does** disagree, so the gate cannot pass by proving nothing.
         L1: the tier-2 stage inside `drag-slot-partition-gap-invariant` walks the same grid in the
         real shell with real actors — 6 held positions x 6 icons x 2 halves = **72 cases**, each
         checked against the expected favourite index AND the actual container index of the gap,
         with the expectation recomputed from the row's own geometry inside the probe. Green: 32/32
         with `dock-extent-tracks-row`, `drag-slots-are-icons-only`, the zero-flip partition gate
         (D-130) and the hidden-gap lifecycle (D-131) all unmoved.
         Both tiers red against the rejected rule, by mutation (Edit, not a shell copy): the
         "+1 right of self" offer fails **4 tier-1 tests** and **30 of the 72 tier-2 cases**, and
         the shapes are the reported symptoms verbatim — `p0k0@0.8 want=null got=2` (a gap drawn
         where the owner says nothing should be) and `p0k2@0.8 want=3 got=4` (one slot further than
         the pointer asked).
         The sandbox still ships eight favourites for six icons, so cell space and favourite space
         disagree; the stage pins exactly the icons it can see through the in-memory settings
         backend, asserts they are aligned, and writes the original list back.
         L2: pending, one logout. Checkable by hand, ten seconds per direction: hold an icon over
         its left neighbour's left side and its right neighbour's right side — one gap each, on the
         far side; hover the middle of a far icon and walk across it — the gap must follow the
         pointer from one side of that icon to the other.
Cost     One pass over n+1 lines and one over n cells per verdict instead of one division; both are
         bounded by the row's own length and only run on a drag. The verdict line gained `boundary=`
         and `cell=` and lost `slot=`, which MAINTENANCE §7 records.
Commit   ca020d1

---

### D-133 · 2026-11-06 · chore

Symptom  Nothing was broken: the batch since the frozen upstream anchor added six schema keys,
         a Trash icon, the drag feature family and a settings reorganisation, while the version
         pair still said it was the import.
Change   `metadata.json` `version` 1 -> 2 and `package.json` `version` 1.0.0 -> 1.1.0, kept
         consistent as AGENTS.md requires (the integer is what an updater compares, the semver
         string is this repo's own). Minor, not patch: new keys and new behaviour, no breakage.
         Checked first that nothing reads them -- `repo.test.js` only asserts `shell-version`
         entries are plain majors, and no `extension.js`/`lib/` site reads the version field, so
         the bump is declarative.
         `shell-version` stays `['50']`: 48 and 49 have never been run here, which is the owner's
         call in `MAINTENANCE.md` §13, not something a bump decides.
Evidence L0: `npm test` 180/180 and `npm run check:log` resolve after the edit; tier 1's
         `schema-valid`/`compiled-fresh` are unaffected. Whether an updater surface reads the
         integer is not testable here (this fork is not published to EGO) -- needs-manual.
Cost     None.
Commit   ca020d1

---

### D-134 · 2026-11-06 · fix

Symptom  The owner's verdict on the offer work was still "还是不行", and the comparison that came
         with it named the fix: "能不能模仿从应用网格拖取图标进入dock那样丝滑，并且如果在dock中长按
         应用图标就不进行不长按的那些动画如放大啊，但是需要有适当的过度动画". Two things happen in
         an in-dock drag that do not happen in a drag in from the grid: the hover magnification keeps
         running under the pointer for the whole gesture, and every move of the gap re-flows the row in
         one allocation, so both neighbours teleport while the gap itself eases.
         Then the owner tried it: "动画方向不对，能不能如果我往右移动，被代替原来位置的就往左，
         而不是突然从左边出来" -- the crossed icon was drawn a whole extra slot outward and slid
         home, so it looked like it appeared out of nowhere. That was my sign: `gapSlide` computed
         the layout's own delta and `_slideRow` painted it as a translation, which puts the child
         one slot further out than where it started.
Change   (1) `Magnification.suspend(ms)` sits next to `pause()`: it stops the pointer poll the same way,
         but eases every icon back to rest over 150ms instead of snapping. The genie needs resting
         geometry for its target rect, a drag does not, and a dock collapsing under the pointer the
         instant it is picked up reads as a glitch. `DockDnd` keeps it suspended for the whole gesture
         (`_onDragBegin` -> `_suspendMagnification`, `_finishDrag` -> `_resumeMagnification`) and the
         tick's own smoothing brings the hover scale back, so there is no exit animation to write. The
         tooltip is hidden at drag begin and `_showTooltip` refuses while `_dragInProgress`, so nothing
         that belongs to mere hovering appears over a row that is moving. The manager hands the
         instance over once it exists: `DockDnd` is constructed before `Magnification`.
         (2) `gapSlide(index, oldGap, newGap, oldWidth, newWidth, spacing)` answers how far a child of
         the row *as it stood* has to be shifted for the re-flow to be invisible -- positive away from
         the row's start, the caller flips the sign for RTL. `_relocatePlaceholder` captures the row
         and the old gap's current width (it may still be growing), inserts the new gap at the index
         `containerIndexForFavoriteSlot` returns, then paints the shift back on each child's
         `translation_x`/`translation_y` and eases it out over 180ms. The helper returns the offset
         to **paint by**, which is the opposite sign of the distance the layout moved the child --
         its doc says so, because using the layout delta directly is what shipped first and what the
         owner saw. Translation is a transform, so the layout keeps owning `x` and magnification
         keeps owning `scale`; a child still mid-slide from a previous move keeps its current
         translation and the new shift is added to it, so a fast sweep across several icons cannot
         accumulate error.
Evidence L1: `npm test` **184/184 in 46 suites** (floor 180/45 -> 184/46). `gapSlide` is asserted two
         ways: a table of the four shapes (full move right, full move left, first insertion at zero
         width, half-grown gap replaced) and a property test that rebuilds both rows and requires every
         moving child to be exactly where it was -- `old position + shift === new position` -- for
         every possible move of the gap in a six-child row. That is the property the numbers exist
         for, not a copy of them.
         L1: tier 2 `drag-slot-partition-gap-invariant` now also holds the gesture's two feel gates on
         the real row: with a drag begun, `Magnification._pauseCount > 0` and every icon at scale
         1.00 (the icon was forced to 1.6 first, so the ease has something to undo), and the counter
         back to 0 after the drop; and after a one-slot gap move the crossed icon carries **+66px**
         (gap width plus spacing, *toward the row's end*, held at its old place) on its translation,
         the icon on the other side stays at 0, and the translation is back under 0.5px 320ms later.
         The first version of this gate checked the magnitude only (`|shift| >= 20`), which is
         exactly why the sign could ship wrong; it now pins the signed value against the gap width
         plus spacing read from the row. 32/32 green with the 72-case table, the zero-flip gate and
         the hidden-gap lifecycle unmoved.
         Mutation (Edit, not a shell copy): `_slideRow` reduced to an early return turns the gate red
         with `slideShift: 0`, so the slide assertion is not passing on the placeholder's own grow
         animation. Negating the helper again turns the property test red (`newPos + shift === oldPos`)
         and the tier-2 gate red at `slideShift: -66` against `slideExpect: 66`. `_onDragBegin`'s
         suspend is proven by the counter, which cannot be non-zero without the call.
         L2: pending, one logout -- this is feel, and only the pointer can judge it.
Cost     One array copy and one ease per gap move, one eased scale per icon per drag begin; nothing on
         the idle path. The slide is cosmetic and its catch only guards actors rebuilt mid-gesture.
Commit   ca020d1

---

### D-135 · 2026-11-06 · fix

Symptom  With the dock hidden and `genie-peek-hidden-dock` off, `_dockEdgeAt()` discarded the
         resolved icon rect's dimensions and replaced them with a fixed 64x12 patch. Even when the
         real icon box was known, the funnel's closing aspect ratio was therefore rewritten.
Change   `_dockEdgeAt()` now delegates to `_shrinkEdgeRect()`, sharing `shrinkTargetRect()`'s edge
         projection: the centre lands on the dock's screen edge while the input width and height
         survive, including on a non-zero monitor origin. Shrink's own path is unchanged. The
         centre and last-resort 64x12 fallbacks deliberately remain outside this fix.
Evidence L0: the controller delegation guard was red against the old fixed-size return and is green
         now; `shrinkGeometry.test.js` 20/20 covers all four edges, real dimensions and non-zero
         origins. Final run: `npm test` 191/191 in 48 suites, tier 1 9/9. Actual peek-off funnel
         pixels remain L2 and need a session that has loaded the new modules.
Cost     The shared projection keeps the existing `primaryMonitor` limitation recorded in
         MAINTENANCE §14. This changes only the funnel's hidden-dock, peek-off target.
Commit   2bf01c1

---

### D-136 · 2026-11-06 · fix

Symptom  `IconManager._doSync()` notified layout listeners for additions and removals, but a sync
         that only reordered existing actors merely logged `reorder:yes`. Genie's icon-rect cache
         could consequently retain old slots when the dock was hidden or live rect resolution failed.
Change   When `_enforceOrder()` reports a reorder, `_doSync()` now invokes the existing
         `_onIconsChanged` callback. The established chain reaches `dockManager._updatePosition()`
         and `genie.onLayoutChanged()`; DnD itself and the add/remove paths are unchanged.
Evidence L1: the new `genie-reorder-invalidation` probe drives the real sync and callback chain.
         Pre-fix it was red with reorder notifications/invalidations 0/0; post-fix they are exactly
         1/1, and a steady-state second sync stays silent at 0/0. Tier 2 is 33/33. A real pointer
         drag followed by minimize/restore remains an L2 visual check, not something this probe claims.
Cost     One existing layout notification per actual reorder; no notification in steady state and no
         new signal subscription.
Commit   2bf01c1

---

### D-137 · 2026-11-06 · taste

Symptom  The funnel used 560/480 ms defaults, one shared easing curve in both directions, and
         `AXIAL_BUNCH = .35`; the owner asked for a more decisive minimize and a brief restore hold.
Change   Defaults are now 420 ms minimize / 460 ms restore in the schema, compiled schema and
         controller fallbacks. Funnel-only `genieEaseProgress()` uses amplitude .65 for minimize;
         restore raises the existing forward ease to 1.2 before reversing it. `AXIAL_BUNCH` is .45,
         making the maximum default-curvature gamma .6175 instead of .7025. Lead/trail fractions,
         tail fade, absorb, curvature, mesh, squash, dodge and shrink behaviour are unchanged.
Evidence L0: `genieGeometry.test.js` 47/47 checks endpoints, monotonicity over 1000 steps per
         direction, finite values, minimize's stronger ends and restore's initial hold; shrink geometry
         remains 20/20. Schema/controller defaults and the bunching constant have guards. Final run:
         `npm test` 191/191 in 48 suites, tier 1 9/9, tier 2 33/33 with clean import and no fork-owned
         JS errors. Headless does not execute the real animation, and visual feel remains L2.
Cost     The direction mapping adds one pure maths call per timeline frame, outside the strip loop;
         no settings key, per-strip heap allocation or scratch-buffer change was added. This is taste
         and an upgrade may discard it wholesale.
Commit   2bf01c1

---

### D-138 · 2026-11-06 · fix

Symptom  With the dock hidden and `genie-peek-hidden-dock` off, the funnel projected the icon box
         onto the screen edge, centring it on the edge so half lay outside the monitor; the closing
         footprint was the clipped half. A window overlapping its icon could also keep the taper
         above icon width because `funnelDepth` used the window's axial length as a floor.
Change   The hidden-dock target now keeps the resolved icon rect unchanged instead of projecting it.
         `funnelDepth` ends exactly at `bEnd`, and the end control point `c2` settles at the icon
         width instead of pinching on the closing frame.
Evidence L0: `npm test` 193/193 in 48 suites; `test/genieGeometry.test.js` covers the overlap case
         on all four dock edges, and `test/repo.test.js` guards the controller target. Visual feel
         remains L2 and needs a session that has loaded the new modules.
Cost     No settings key, per-frame allocation or scratch-buffer change. The final closing shape is
         a deliberate feel trade; an upgrade may discard it.
Commit   ff631ed

---

### D-139 · 2026-11-06 · fix

Symptom  Rapid left clicks on the Trash icon opened one Nautilus window per click while the first
         window was still absent from the asynchronous FileManager1 window map.
Change   `TrashManager.activate()` now arms a 2 s pending-launch guard before opening the trash. A
         mapped trash window clears it, and `stop()` clears it; a failed launch releases it
         immediately. Middle-click and the menu's explicit New Window path remain unguarded.
Evidence L0: `npm test` 194/194 in 49 suites; a wiring guard in `test/repo.test.js` was red before
         the field existed. The rapid-click result itself is L2 and needs a real session — the
         headless harness does not drive Nautilus windows or this click path.
Cost     One `get_monotonic_time()` read per click, no timeout source and no per-frame work. A
         launch failure suppresses further left-click launches only for the guard's short window.
Commit   4f4a072

---

### D-140 · 2026-11-06 · chore

Symptom  The shrink animation mode duplicated the funnel behind a second engine, a pure geometry
         module, five settings keys, a prefs group and a mode switch in the controller and
         dockManager. The owner asked for it to be removed rather than maintained as a second path.
Change   Deleted `lib/shrinkGeometry.js` and its suite, `ShrinkManager`, `genie-mode` and the four
         `shrink-*` keys, the controller branches and helpers, the dockManager listener, and the
         prefs group. Hidden-dock targeting now has one path: `genie-peek-hidden-dock` decides
         whether the dock peeks, and the resolved icon rect is kept as-is.
Evidence L0: `npm test` 173/173 in 44 suites; tier 1 9/9 with 63 schema keys compiled == XML ==
         what the shell reads; no `shrinkGeometry`, `ShrinkManager` or shrink setting-key identifier
         remains under `lib/`, `prefs.js`, `schemas/` or `test/`. The mode's absence in a running
         shell is L2 and needs a logout; the schema change is not live in the current session.
Cost     The alternate mode is gone and stale dconf values are ignored. The static suite floor drops
         from 174/44 to 173/44 because the deleted suite and pure-lib guard were intentional.
Commit   02208a1

---

### D-141 · 2026-11-06 · fix

Symptom  The pending-open guard in `TrashManager` treated every launch as successful because
         `Gio.AppInfo.launch_default_for_uri()` returns FALSE on failure instead of throwing. A
         failed launch therefore suppressed left-click launches for the full 2 s guard.
Change   `openNewWindow()` now returns the launch result, and `activate()` clears the guard when it
         is false. The hidden-target comment is corrected to describe the one-path behaviour.
Evidence L0: `npm test` 173/173 in 44 suites; tier 1 9/9; the Trash wiring guard now also asserts
         the launch result is returned. The live journal already shows one launch followed by three
         coalesced clicks and a one-window toggle; this follow-up only changes the failure branch.
Cost     One boolean return through the existing launch path; no new state, allocation or source.
Commit   e30fea8

---

### D-142 · 2026-11-06 · taste

Symptom  The shipped defaults still reflected the original upstream tune, while the owner's working
         configuration had nine deliberate differences; there was also no way to return every
         setting to the shipped state.
Change   Frozen the current values as the new defaults for `icon-size` (43), `icon-quality` (1),
         `dock-opacity` (57), `dock-blur-enabled` (true), `window-previews` (false),
         `media-indicator` (false), `peek-hold-ms` (70), `keynav-peek-duration` (530) and
         `genie-peek-hidden-dock` (false). Added a destructive Restore Defaults control at the
         bottom of the System page; it confirms first, then calls `GSettings.reset()` for every
         explicitly set user value, excluding only `keynav-stock-backup`/`-dirty`. System is now
         the last sidebar page.
Evidence L0: `npm test` 175/175 in 45 suites; tier 1 9/9 with 63 keys; the reset wiring guard covers
         the exclusion set, the confirmation response and `get_user_value`/`reset`. L1: tier 2
         33/33 after the default change (`overview-band band=80 >= dock=65`). L2: opening the prefs
         window and clicking the reset remain manual.
Cost     Nine defaults move away from upstream; a fresh install starts from the owner's current
         look. The reset cannot be undone and removes every user override except the two keynav
         sentinels.
Commit   fed3bff

---

### D-143 · 2026-11-06 · taste

Symptom  The two surfaces the owner had just used -- the preferences sidebar and the genie
         minimize/restore effect -- were still recorded as unconfirmed: D-129 ended in
         "needs-manual-confirmation until the owner looks at it" and D-137 in "visual feel remains
         L2". Nothing in the tree recorded that the owner had looked and approved them.
Change   No code change. Recorded the owner's sign-off: the eight-page sidebar order (Dock,
         Behavior, Magnification, Auto-hide, Genie Animation, Keyboard, Performance, System) and
         the D-137 funnel feel (420/460 ms, direction-specific easing, `AXIAL_BUNCH` .45) are the
         accepted shipped experience. The page order is frozen in MAINTENANCE §11/§12 and listed
         in both READMEs; the minimize feel sits in §11 with an explicit reopen rule.
Evidence L2: the owner confirmed both by hand on 2026-11-06 -- the tabs "特别好用，现在体验感
         很好" and the minimize effect "体验感很好" -- so the manual checks pending in D-129 and
         D-137 are satisfied for the shipped layout and feel. This entry records the sign-off; it
         does not rewrite those entries' assertions as of their own commits.
Cost     None in code. Both surfaces remain taste: an upstream upgrade may still discard them,
         and the invariant table stays unchanged because taste entries are not invariants.
Commit   fed3bff

### D-144 · 2026-11-07 · taste
Symptom   The README pair carried no table of contents, and it ran Troubleshooting between Testing and
          Changes vs upstream while its three sibling forks run it before Testing — the same fork read by
          a different map each time.
Change    Both sides open with a table of contents under the four-part lead, and the sections take the
          fork order: About · Features · Genie animation · Prerequisites · Installation · Usage ·
          Preferences · Settings reference · Testing · Troubleshooting · Changes vs upstream · Contributing
          · Credits & Attribution · License. No section text moved.
Evidence  L0 2026-11-07 `npm test` green and `npm run check:log` PASS; `audit-layout.sh` reports this
          repository compliant; no committed document cited a section that moved.
Cost      Two sections change position, so two anchors move; nothing cited them.
Commit    4bc2c64

### D-145 · 2026-11-07 · guard
Symptom   The STANDARD_HEADINGS list is an anti-copy check: AGENTS.md must not restate a section of the
          machine-wide standard. It stopped at the audit-anchor section, so the standard's four newest
          sections (profile listing, retirement, About, citation stability) were never checked — a copy of
          them here would have passed.
Change    Added the four missing titles. The unnumbered short words stay out on purpose: the check is a
          substring test, so an entry like the CI section title would fire on any mention of CI in
          AGENTS.md (measured, it turned all five forks red when it was added).
Evidence  `npm test` green (see the totals below), `npm run check:log` PASS.
Cost      The snapshot cannot be read from ~/.agents at CI time, so this list is a copy by design; section 13
          of the machine-wide audit checks it and reports drift.
Commit    f8bb995


### D-146 · 2026-11-12 · guard
Symptom   The snapshot was one title short of the standard and wrote the common-core rule in shortened
          form, so a copy of the standard's full title, or of the CI section, was never caught. The CI
          entry was held back on purpose: the check is a substring test, so a bare "CI" fired on every
          prose mention, which left the snapshot silently incomplete.
Change    Listed all twenty standard titles in the standard's own order, including the CI section in its
          numbered form (`## 5. CI`). The loop is back to a single `agents.includes(heading)`: the
          numbered form keeps a one-word title from matching prose, and section 13 of the machine-wide
          audit normalises it before comparing, so no repository needs a matcher of its own.
Evidence  `npm test` green, `npm run check:log` PASS. The numbered form was negative-tested in
          macos-dock: a real `## 5. CI` heading in AGENTS.md turned the check red, then was reverted
          byte-for-byte (sha256 identical).
Cost      The snapshot is still a copy by design (CI cannot read `~/.agents`); drift is caught by
          audit section 13, which now also reports a snapshot that names CI only in prose form.
Commit    ff988ed

### D-147 · 2026-11-12 · chore
Symptom   The project-level rules pointer block in AGENTS.md used bare `@~/.agents/standards/...` imports to pull in the machine-wide standard. That only delivers the rule text to agents that expand `@` imports or read `opencode.json`; an agent that does neither holds the pointer and none of the rule text.
Change    Replaced the two `@` imports with plain backticked absolute paths (`~/.agents/standards/STANDARD.md`, `~/.agents/standards/dimensions/<tier>.md`). The rule text is now delivered by the tool-neutral global behavior contract (GLOBAL.md) before the first edit, so the pointer works for every agent regardless of import expansion. No rule text was duplicated or changed — only the pointer form.
Evidence  `npm test` green: 175 pass, 0 fail (exit 0). The change sits inside the pointer block and does not touch heading counts or section structure, so the machine-wide audit that reads AGENTS.md sees the same headings as before.
Cost      The pointer is a local copy of the instruction; the tool-neutral contract is what carries the rule text. Whether that text actually reaches a session is a per-tool check, not a repository guard.
Commit    48faf8b

---

### D-148 · 2026-11-13 · chore

Symptom   The root layer carried an `opencode.json` whose only content was the two standard pointers
          `AGENTS.md` already lists — one delivery instruction stored twice, with nothing watching the copy.
Change    Removed it from the root layer and dropped it from the layout guard's root-file list; the
          standard no longer requires the file, and the pointer block plus the machine-level
          `GLOBAL.md` contract are the whole delivery path.
Evidence  `bash ~/.agents/scripts/audit.sh` exits 0 (every governed repository passes the layout check);
          this repository's own guard did not reference the file.
Cost      No per-assistant config remains to drift, and no local guard can observe an agent that skips
          the pointer — the same blind spot the removed file had.
Commit    7964a4a
