#!/usr/bin/bash
# test/live-checks.sh — Tier 3: the user's real session.
#
#   bash test/live-checks.sh                      group A only (passive, safe)
#   LIVE_TRIGGER=1 bash test/live-checks.sh       group A + B (opens probe windows)
#   npm run test:live-trigger
#
# GROUP A reads the journal this boot already wrote. It changes nothing, opens
# nothing, and can run any time — it is the regression net for the startup grace,
# the boot twitch, the privacy tripwire and the log anchors.
#
# GROUP B is the pointer-free A/B: it opens a small X11 probe window, maximizes
# it over the dock, optionally fullscreenates it, then hands focus to a second
# window that provably does not overlap the dock. The discriminant is whether
# dodge prints `uncovered -> show` at that moment. Nothing here can inject a
# pointer, so no assertion depends on the mouse — see "what cannot be automated"
# in MAINTENANCE.md before adding one.
#
# B never calls `gnome-extensions disable`/`enable` (that would round-trip keynav
# and its system keybinding takeover), never touches `dodge-enabled` or any
# `keynav-*` key, and finishes by proving dconf came back byte-identical.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

T=3
init_results
TRIGGER=${LIVE_TRIGGER:-0}
HIDE_RE='\[dodge\] [a-z]+ -> hide'
SHOW_RE='\[dodge\] uncovered -> show'
SETUP_BOUND=1500      # measured +13 ms; 1500 ms is ~12 fast polls of slack
SILENCE_WINDOW=2000   # >= 16 ticks at POLL_MS=120

# ===== Group A — passive, always run ----------------------------------------

P=$(shell_pid) || { report $T session ENV "no session gnome-shell found"; exit 77; }
report $T session PASS "session shell pid $P"

# A2: stale-code gate. The running shell may predate the newest edit, because
# disable+enable never reimports ES modules. Group A is still valid (it reads the
# boot record); group B would be measuring code that is not the code on disk.
STALE=no
if stale_code; then
    STALE=yes
    report $T stale-code ENV "the running shell predates the newest JS edit — group B would measure old code; log out and back in"
else
    report $T stale-code PASS "shell started after the newest tracked .js"
fi

# A3: journal access and rate-limit degradation.
if ! journal_load; then
    report $T journal ENV "could not read the user journal for pid $P"
    exit 77
fi
[ -s "$JOURNAL_CACHE" ] || { report $T journal ENV "no [macos-dock-local] lines this boot — extension did not load"; exit 77; }
limited=$(journalctl --user -b --no-pager _PID="$P" 2>/dev/null | grep -acE 'Suppressed|RateLimitHit' | head -1)
if [ "${limited:-0}" -gt 0 ]; then
    report $T journal "ENV" "journal rate-limiter suppressed ${limited} line group(s) this boot — counts below are lower bounds"
else
    report $T journal PASS "$(wc -l < "$JOURNAL_CACHE" | tr -d ' ') tagged lines, no suppression"
fi

# A4: boot inventory. Values only — never a raw line, since titles ride in some.
# Patterns go to awk as ERE, so a literal parenthesis must be \( there, and the
# extractors run under `sed -nE` and must consume the WHOLE line (`s/.*x.*/\1/p`),
# because a partial substitution leaves the rest of the line in the report.
inv() { # inv <name> <ERE> <sed -nE script>
    local name=$1 re=$2 sx=$3 n
    n=$(jcount "$re")
    if [ "$n" = 0 ]; then
        printf '  absent  %s\n' "$name"
    else
        printf '  %4s ×  %-22s %s\n' "$n" "$name" "$(jfield "$re" "$sx")"
    fi
}
echo "  boot inventory:"
inv "enable() total"        '\[macos-dock-local\] enable\(\) total'           's/.*total ([0-9.]+)ms.*/first=\1ms/p'
inv "icon reload"           '\[icons\] reload: [0-9]+ icons .*reason=startup' 's/.*reload: ([0-9]+) icons.*/\1 icons/p'
inv "icons grace ended"     'startup grace ended early at'                    's/.*ended early at ([0-9]+)ms.*/first=\1ms/p'
inv "dodge started"         '\[dodge\] started \(onlyFocused='                's/.*watching ([0-9]+) windows.*/\1 windows at start/p'
inv "dodge grace released"  'grace released at'                               's/.*released at ([0-9]+)ms.*/first=\1ms/p'
inv "genie enabled"         '\[genie\] enabled'                               's/.*\[genie\] enabled.*/enabled/p'

grace_ms=$(jfield 'grace released at' 's/.*released at ([0-9]+)ms.*/\1/p')
if [ -z "$grace_ms" ]; then
    report $T dodge-grace FAIL "dodge never logged a grace release — no way to bound the startup window"
elif [ "$grace_ms" -lt 900 ] || [ "$grace_ms" -gt 6500 ]; then
    report $T dodge-grace ENV "grace released at ${grace_ms}ms, outside 900-6500 — clock or constants changed, not necessarily a regression"
else
    report $T dodge-grace PASS "grace released at ${grace_ms}ms"
fi

# The invariant the whole startup fix exists for: nothing may hide the dock
# before the grace released. This is the boot twitch, as a permanent check.
if [ -n "$grace_ms" ]; then
    gm=$(jfirst 'grace released at')
    early=$(jcount "$HIDE_RE" 0 "$gm")
    if [ "$early" != 0 ]; then
        report $T no-boot-hide FAIL "$early hide(s) before the grace released — the boot twitch is back"
    else
        report $T no-boot-hide PASS "zero hides in the first $(( (gm - $(jfirst '\[dodge\] started') ) / 1000 ))s of the session"
    fi
fi

# A4b: the overview-exit flicker. `overview -> show` arriving within a few hundred ms
# of a hide means dodge re-read the shell's transition state mid exit-animation and
# popped the dock back out — the bug the visibleTarget fix removed. Attributed to the
# code that actually ran: this boot's journal predates a fix that has not been loaded
# yet (only a logout loads it), so counting it while the shell is stale must be ENV.
flick=$(jflicker_count 300)
if [ "${flick:-0}" = 0 ]; then
    report $T overview-flicker PASS "no overview re-show within 300ms of a hide this boot"
elif [ "$STALE" = yes ]; then
    report $T overview-flicker ENV "$flick flicker signature(s) this boot, produced by code predating the fix — log out, reproduce the Super in/out, then re-run"
else
    report $T overview-flicker FAIL "$flick overview re-show(s) within 300ms of a hide — dodge is racing the overview exit animation again"
fi

# A5: privacy tripwire. `hide-trigger` prints real window titles; if it appears,
# someone left DODGE_DEBUG on and the journal now holds the user's window titles.
leak=$(jcount 'hide-trigger')
if [ "$leak" != 0 ]; then
    report $T privacy-logs FAIL "$leak hide-trigger line(s) in the journal — DODGE_DEBUG is on and window titles are being logged"
else
    report $T privacy-logs PASS "no hide-trigger lines this boot — title logging is off"
fi

# A6: are there complaints about this extension that our anchored greps cannot
# see? Untagged mentions are normal, so the assertion is only on the subset that
# also carries an error verb. Counts only — never the text.
un=$(junanchored); unerr=$(junanchored_errors)
if [ "${unerr:-0}" != 0 ]; then
    report $T anchor-hygiene FAIL "$unerr untagged error-bearing line(s) mention macos-dock — the shell is complaining about it in lines the tagged greps miss (text not printed: privacy)"
else
    report $T anchor-hygiene PASS "$(( ${un:-0} )) untagged mention(s), none error-bearing"
fi

bad=$(jcount 'missing/changed private APIs')
if [ "$bad" != 0 ]; then
    report $T genie-apis FAIL "genie degraded to native animation this boot — a shell private API moved"
fi

# A7: does D-061's enum actually resolve in the *running* shell? The module logs the
# number it read, so `grid=<n>` is live proof `ControlsState.APP_GRID` was reachable;
# `grid=null` is the documented degrade (it falls back to the button's `checked`,
# which overviewApps.js itself calls stale-prone); no line at all means the fix never
# ran this boot. Deliberately bounded only by "an integer" — pinning 0/1/2 here would
# re-hardcode the literal this fix exists to stop trusting.
gsel=$(jfield '\[appsbtn\] applied \(' 's/.*grid=([A-Za-z0-9]+)\).*/\1/p' | tail -1)
if [ -z "$gsel" ]; then
    report $T grid-state-loaded ENV "no [appsbtn] applied line this boot — the fix did not run (setting off, or the dock had no button yet)"
elif [ "$gsel" = "null" ]; then
    report $T grid-state-loaded ENV "grid state degraded to the button's checked flag — ControlsState.APP_GRID was not resolvable on this shell"
elif [[ "$gsel" =~ ^[0-9]+$ ]]; then
    report $T grid-state-loaded PASS "grid state resolved from the shell's own enum on the live session (value $gsel)"
else
    report $T grid-state-loaded FAIL "grid state printed as '$gsel', neither an integer nor null — the log field or the enum source changed shape"
fi

if [ "$TRIGGER" != 1 ]; then
    echo "  group B not run — it opens probe windows on the live desktop (LIVE_TRIGGER=1)"
    exit_code_from_results
fi
if [ "$STALE" = yes ]; then
    if [ "${FORCE_STALE:-0}" != 1 ]; then
        report $T triggered ENV "refusing group B while the shell predates the edits — log out and back in, or FORCE_STALE=1 to exercise this harness anyway"
        exit 77
    fi
    # The only reason to override: validating the harness itself. Results in this
    # mode describe the OLD code still in memory, never the tree on disk, and the
    # report says so on every line that would otherwise be read as a verdict.
    report $T forced ENV "FORCE_STALE=1 — group B below measures the code still in memory, NOT the working tree"
fi

# ===== Group B — triggered A/B ----------------------------------------------

TD=$(mktemp -d "${TMPDIR:-/tmp}/macosdock-t3-XXXXXX")
PREFIX="macosdock-t3-${TD##*-}"
SNAP="$TD/dconf.before"
dconf_snapshot "$SNAP"

bcleanup() {
    restore_keys
    for wid in $(xdotool search --name "^$PREFIX" 2>/dev/null); do xdotool windowkill "$wid" 2>/dev/null; done
    [ "${KEEP_T3:-0}" = 1 ] || rm -rf "$TD"
}
trap bcleanup EXIT INT TERM

# B0: is the user actually available? A locked screen or an active mouse makes
# every timing sample meaningless, and there is no way to tell from the inside
# except by observing that the log is quiet.
active=$(gdbus call --session -d org.gnome.ScreenSaver -o /org/gnome/ScreenSaver \
    -m org.freedesktop.DBus.Properties.Get org.gnome.ScreenSaver Active 2>/dev/null)
if grep -q 'true' <<< "$active"; then
    report $T preflight ENV "session is locked — probe windows would not map"
    exit 77
fi
quiet=no
for _ in 1 2 3; do
    n1=$(jcount '.')
    sleep 3
    journal_load
    n2=$(jcount '.')
    [ "$n2" = "$n1" ] && { quiet=yes; break; }
done
if [ "$quiet" != yes ]; then
    report $T preflight ENV "session is not idle (3 s produced new dodge/pointer activity) — retry when the mouse is still"
    exit 77
fi
# Session age is printed, never judged: group B measures dodge's *reaction* time,
# and in the first minutes after login the autostart churn (window events,
# installed-changed reloads) changes what the poll is doing. Measured on 2026-10-10:
# `control` took ~3 s and FAILed against a shell 1.5 min old, then 26 ms against the
# same code 20 min later. A bound violation without this number is unattributable.
shell_age=$(( $(now_ms) / 1000 - $(stat -c %Y /proc/$(pgrep -x gnome-shell | head -1)) ))
age_note=""
[ "$shell_age" -lt 300 ] && age_note=" — under 5 min old, treat latency verdicts as suspect"
report $T preflight PASS "screen unlocked and the log was quiet for 3 s (shell up ${shell_age}s${age_note})"

# One probe sample: run the window timeline, return its STEP stamps.
SAMPLE_LOG=""
SAMPLE_PID=""
run_sample() { # run_sample <mode> <tag> [nudge-x nudge-y]
    local mode=$1 tag=$2 nx=${3:-} ny=${4:-} wid pid
    SAMPLE_LOG="$TD/$tag.probe"
    : > "$SAMPLE_LOG"
    # In fullscreen mode the harness owns the ordering that makes reversibility
    # meaningful: the big window dies while the small (non-overlapping) one is
    # still mapped, and the harness then activates that window and CONFIRMS focus
    # before asserting. Closing the fullscreen window alone lets the compositor
    # pick focus, and if it picks one of the user's maximized windows a correct
    # "stay hidden" would read as a wedge.
    local -a steps=()
    [ "$mode" = fullscreen ] && steps=(PROBE_STEP_BIG_CLOSE=7600 PROBE_STEP_SMALL_CLOSE=13000 PROBE_STEP_QUIT=14000)
    timeout 45 env GDK_BACKEND=x11 PROBE_MODE="$mode" PROBE_PREFIX="$PREFIX" \
        ${steps[@]+"${steps[@]}"} gjs -m "$HERE/probe-window.js" > "$SAMPLE_LOG" 2>&1 &
    pid=$!
    SAMPLE_PID=$pid
    for _ in $(seq 1 120); do
        wid=$(xdotool search --name "^${PREFIX}-big$" 2>/dev/null | tail -1)
        [ -n "$wid" ] && break
        kill -0 $pid 2>/dev/null || break
        sleep 0.05
    done
    # Placement is the harness's job: GTK4 removed window positioning.
    [ -n "$wid" ] && [ -n "$nx" ] && xdotool windowmove "$wid" "$nx" "$ny" 2>/dev/null
    [ "${PROBE_BG:-0}" = 1 ] && return 0
    probe_finish
}

probe_finish() {
    wait $SAMPLE_PID 2>/dev/null
    grep -qa 'FAILED' "$SAMPLE_LOG" && return 1
    return 0
}

wait_step() { # wait_step <label> [timeout_ms] — block until the probe stamps it
    local label=$1 deadline=$(( $(now_ms) + ${2:-12000} ))
    while [ "$(now_ms)" -lt "$deadline" ]; do
        grep -qa " $label\$" "$SAMPLE_LOG" && return 0
        kill -0 "$SAMPLE_PID" 2>/dev/null || return 1
        sleep 0.1
    done
    return 1
}

# A client-message focus request, which mutter does honour for XWayland windows —
# unlike XTEST pointer warps, which never reach the compositor at all. Reading
# _NET_WM_STATE back is what makes a refused activation an ENV instead of a wrong
# verdict about the dock.
focus_probe_window() { # focus_probe_window <suffix>
    local wid
    wid=$(xdotool search --name "^${PREFIX}-$1$" 2>/dev/null | tail -1)
    [ -n "$wid" ] || return 1
    xdotool windowactivate --sync "$wid" 2>/dev/null || true
    for _ in $(seq 1 15); do
        if xprop -id "$wid" _NET_WM_STATE 2>/dev/null | grep -q FOCUSED; then
            FOCUS_WID=$wid
            return 0
        fi
        sleep 0.1
    done
    return 1
}

# Setup is satisfied either by a fresh `-> hide` after the maximize OR by the dock
# already being down: dodge logs transitions, not states, so a sample that starts
# hidden would otherwise be judged "setup failed" and read as ENV forever.
setup_hidden() { # setup_hidden <maximize_ms>
    local mx=$1 h
    h=$(wait_for "$HIDE_RE" "$mx" 2000)
    if [ -n "$h" ]; then SETUP_HIDE=$h; return 0; fi
    journal_load
    [ "$(dock_state)" = hidden ] || return 1
    SETUP_HIDE=$(jlast "$HIDE_RE")
    return 0
}

stamp() { # stamp <label> -> epoch ms of that STEP, empty if it never fired
    local raw
    raw=$(grep -a " $1\$" "$SAMPLE_LOG" | tail -1 | awk '{print $2}')
    [ -n "$raw" ] && stamp_to_ms "$raw"
}

# B1/B2: control run — maximized window covers the dock, small window steals
# focus, the dock must come back. This is also how the harness learns which
# monitor the dock is on: the setup assertion only holds there.
control_once() { # control_once [nudge]
    PROBE_BG=1 run_sample nofs "control${1:+-$1}" ${1:+"$2"} ${1:+"$3"} || return 2
    local mx sh
    wait_step big-maximize || { probe_finish; return 2; }
    mx=$(stamp big-maximize)
    setup_hidden "$mx" || return 3   # wrong monitor: the maximized window never covered the dock
    wait_step small-present || { probe_finish; return 2; }
    sh=$(stamp small-present)
    # The control is the reference for B3, so it must satisfy the same condition:
    # our non-overlapping window provably holds focus. Without that, "no show"
    # only means the user's maximized window was still focused.
    focus_probe_window small || { probe_finish; return 7; }
    xprop -id "$FOCUS_WID" _NET_WM_STATE 2>/dev/null | grep -q FOCUSED || { probe_finish; return 7; }
    sleep 2.5
    journal_load
    CONTROL_SHOWN_AT=$(jfirst "$SHOW_RE" "$sh")
    probe_finish
    [ -n "$CONTROL_SHOWN_AT" ] || return 4   # dodge stopped restoring on focus change
    CONTROL_DELTA=$(( CONTROL_SHOWN_AT - sh ))
    return 0
}
run_control() {
    local attempt rc
    for attempt in 1 2 3; do
        if [ "$attempt" = 1 ]; then control_once; else control_once nudge 0 0; fi
        rc=$?
        [ $rc = 0 ] && return 0
        [ $rc = 4 ] && return 4      # focus confirmed and still no show: a real regression
        [ $rc = 7 ] && echo "  (control: mutter would not focus the probe window, retaking)" && continue
        [ $rc = 3 ] && continue      # placement did not cover the dock on this attempt
        return $rc
    done
    return $rc
}
run_control
case $? in
    0) report $T control PASS "focus change restored the dock in ${CONTROL_DELTA}ms (bound ${SETUP_BOUND}ms)" ;;
    2) report $T control ENV "probe timeline did not complete — see $SAMPLE_LOG"; exit 77;;
    3) report $T control ENV "maximized window never overlapped the dock on any tried position — cannot locate the dock's monitor"; exit 77;;
    4) report $T control FAIL "dock never came back when OUR non-overlapping window held focus — dodge's show path is broken"; exit 1;;
    7) report $T control ENV "mutter would not give the probe window focus — the A/B has no reference, no verdict"; exit 77;;
    *) report $T control PASS "control ok" ;;
esac
[ "${CONTROL_DELTA:-0}" -le "$SETUP_BOUND" ] && CONTROL_LATENCY=ok || CONTROL_LATENCY=slow
if [ "$CONTROL_LATENCY" = ok ]; then
    report $T control-latency PASS "control within the ${SETUP_BOUND}ms bound"
else
    report $T control-latency FAIL "control took ${CONTROL_DELTA}ms — poll cadence or the show path regressed"
fi

# B3: treatment — same timeline with the big window fullscreen. The show line
# must NOT appear, and must return the moment the suppression condition goes.
#
# A sample is VOIDED and retaken (up to 3 attempts) when the dock legitimately
# reveals itself for an unrelated reason: dodge gives an in-flight genie
# animation priority over fullscreen force-hide (`_animPeek` is checked first in
# _check), so any minimize during the window — the user's own, or keynav —
# produces a real `uncovered -> show`. Only three consecutive violations are
# reported as a regression.
b3_attempt() {
    PROBE_BG=1 run_sample fullscreen treatment || return 2
    local mx sp bc
    wait_step big-maximize || { probe_finish; return 2; }
    mx=$(stamp big-maximize)
    setup_hidden "$mx" || { probe_finish; return 3; }
    wait_step big-fullscreen || { probe_finish; return 2; }
    wait_step small-present || { probe_finish; return 2; }
    sp=$(stamp small-present)
    # Focus is *confirmed*, never assumed: xprop must show our non-overlapping
    # window holding focus, or the silence proves nothing about dodge.
    focus_probe_window small || { probe_finish; return 6; }
    xprop -id "$FOCUS_WID" _NET_WM_STATE 2>/dev/null | grep -q FOCUSED || { probe_finish; return 6; }
    wait_step big-close 9000 || { probe_finish; return 2; }
    bc=$(stamp big-close)
    # Re-assert focus now that the fullscreen window is gone: mutter chooses its
    # own next focus target, and if that happens to be one of the user's
    # maximized windows the dock correctly stays hidden. Measuring from the
    # big-close stamp (not from "now") still catches a show that fired the
    # instant the window died, so the anchor and the confirmation are both right.
    focus_probe_window small || { probe_finish; return 6; }
    xprop -id "$FOCUS_WID" _NET_WM_STATE 2>/dev/null | grep -q FOCUSED || { probe_finish; return 6; }
    sleep 2.5
    journal_load
    T3_SHOWS=$(jcount "$SHOW_RE" "$sp" $(( sp + SILENCE_WINDOW )))
    T3_PEEKS=$(jcount 'peek show' "$sp" $(( sp + SILENCE_WINDOW )))
    T3_OTHER=$(jcount '\[keynav\]|\[appsbtn\] toggle|genie' "$sp" $(( sp + SILENCE_WINDOW )))
    T3_BACKFIRST=$(jfirst "$SHOW_RE" "$bc")
    probe_finish
    [ -z "$T3_BACKFIRST" ] && return 5
    T3_BACKDELTA=$(( T3_BACKFIRST - bc ))
    return 0
}
b3_run() {
    local attempt rc
    for attempt in 1 2 3; do
        b3_attempt
        rc=$?
        # rc 0 with a show, and no unrelated activity to blame: that is the bug
        # we are looking for, so it must not be papered over by retrying.
        if [ $rc -eq 0 ] && [ "${T3_SHOWS:-0}" != 0 ] && [ "${T3_OTHER:-0}" = 0 ]; then
            return 0
        fi
        if [ $rc -eq 0 ]; then
            [ $attempt -gt 1 ] && echo "  (sample $attempt used; earlier ones were voided by unrelated dock activity)"
            return 0
        fi
        [ $rc -ge 5 ] && return $rc
        echo "  (sample $attempt incomplete, retaking)"
    done
    return $rc
}
b3_run
B3_RC=$?
case $B3_RC in
    0) if [ "$T3_SHOWS" = 0 ] && [ "$T3_PEEKS" = 0 ]; then
           report $T fullscreen-suppresses-show PASS "no show and no peek for ${SILENCE_WINDOW}ms while a real fullscreen window existed"
       elif [ "$T3_SHOWS" != 0 ]; then
           report $T fullscreen-suppresses-show FAIL "$T3_SHOWS show(s) during fullscreen — the fullscreen branch no longer outranks the show path"
       else
           report $T fullscreen-suppresses-show FAIL "$T3_PEEKS peek(s) during fullscreen — peek suppression at dodge.js:900 broke"
       fi
       if [ "${T3_BACKDELTA:-99999}" -le "$SETUP_BOUND" ]; then
           report $T fullscreen-reversible PASS "dock returned ${T3_BACKDELTA}ms after the harness re-focused its own non-overlapping window (silence was not a wedge)"
       else
           report $T fullscreen-reversible FAIL "dock did not return within the bound once the fullscreen window was gone — suppression is not releasing"
       fi ;;
    2) report $T fullscreen-suppresses-show ENV "probe timeline incomplete — continuing so B4-B7 still run and the settings proof is not skipped" ;;
    3) report $T fullscreen-suppresses-show ENV "no overlap hide before fullscreen" ;;
    5) report $T fullscreen-reversible FAIL "dock never came back once the fullscreen window was gone and our own window held focus — suppression is not releasing" ;;
    6) report $T fullscreen-suppresses-show ENV "mutter would not (keep) focus the probe window — neither the silence nor its release can be attributed, no verdict. Run group B on an idle session." ;;
    *) report $T fullscreen-suppresses-show ENV "unknown sample outcome" ;;
esac

# B4: is that silence caused by the SETTING? Flip hide-in-fullscreen off and
# re-run: the show line must now appear. Without this, B3 could be measuring the
# moment rather than the branch.
#
# Gated on B3 having produced an attributable sample. When B3 could not make the
# probe window hold focus (rc 6) or its timeline broke (rc 2/3), B4 runs the same
# unstable session under a *different* setting, and "no show" there says nothing
# about the fullscreen branch — yet it used to be reported as a FAIL that reads
# like a product regression. Measured on 2026-10-10: one run had
# `fullscreen-suppresses-show ENV` (mutter would not keep focus) alongside
# `flag-control FAIL`, and the identical chain was fully green minutes later.
if [ "$B3_RC" != 0 ]; then
    report $T flag-control ENV "B3 gave no attributable sample (rc=$B3_RC) — the flag-off arm would measure the harness's focus problem, not the fullscreen branch"
else
set_key hide-in-fullscreen false || { report $T flag-control ENV "could not write hide-in-fullscreen"; }
b4_run() {
    PROBE_BG=1 run_sample fullscreen flag-off || return 2
    local mx sp
    wait_step big-maximize || { probe_finish; return 2; }
    mx=$(stamp big-maximize)
    setup_hidden "$mx" || { probe_finish; return 3; }
    wait_step big-fullscreen || { probe_finish; return 2; }
    wait_step small-present || { probe_finish; return 2; }
    sp=$(stamp small-present)
    focus_probe_window small || { probe_finish; return 6; }
    # Same anchored window as B3, so the two samples are directly comparable:
    # with the setting off, a show must land inside [small-present, +2500ms].
    sleep 3
    journal_load
    B4_SHOW=$(jcount "$SHOW_RE" "$sp" $(( sp + 2500 )))
    probe_finish
    [ "${B4_SHOW:-0}" -ge 1 ] || return 5
    return 0
}
b4_run
case $? in
    0) report $T flag-control PASS "with hide-in-fullscreen off, the show line returns during the same fullscreen timeline" ;;
    5) report $T flag-control FAIL "still suppressed with the setting off — B3's silence was not the fullscreen branch; the subtest is invalid" ;;
    6) report $T flag-control ENV "mutter would not focus the probe window" ;;
    *) report $T flag-control ENV "sample incomplete (rc=$?)" ;;
esac
set_key hide-in-fullscreen true
fi

# B5: re-run genie's private-API feature detection on the LIVE session, which is
# otherwise only reachable by logging out. dockManager listens for
# changed::genie-enabled and rebuilds the controller, so a toggle re-validates.
toggle_ms=$(now_ms)
set_key genie-enabled false
sleep 0.6
set_key genie-enabled true
# Poll rather than sleep-and-pray: journald can lag the shell by a second, and a
# flush delay must not read as "the settings listener is broken".
revalidated_at=$(wait_for '\[genie\] enabled' "$toggle_ms" 6000)
journal_load
degraded=$(jcount 'missing/changed private APIs' "$toggle_ms")
if [ -n "$revalidated_at" ] && [ "$degraded" = 0 ]; then
    report $T genie-revalidate PASS "_validate() passed again on the live shell $(( (revalidated_at - toggle_ms) / 1000 ))s after the toggle, no logout needed"
elif [ "$degraded" != 0 ]; then
    report $T genie-revalidate FAIL "genie degraded on the live shell — a private API moved in this GNOME build"
else
    report $T genie-revalidate FAIL "genie never re-logged enabled after the toggle — the settings listener or _startGenie is broken"
fi

# B5b: the two overview patches on a real settings round-trip. dockManager holds the
# revert closure and drops it on disable, so re-enabling must re-apply from scratch.
# This is the path D-062 hardened: an "already applied" branch that handed back a no-op
# revert would strand the shadowed get_preferred_height for the rest of the session, and
# only a live disable→enable can show the re-apply really happens. Counts and the `band`
# field only — never a raw line.
patch_toggle_ms=$(now_ms)
if ! set_key overview-patches-enabled false; then
    report $T overview-patches-roundtrip ENV "could not write overview-patches-enabled"
else
    sleep 0.6
    set_key overview-patches-enabled true
    reapplied_at=$(wait_for '\[overviewpatches\] enabled \(' "$patch_toggle_ms" 6000)
    journal_load
    band_skip=$(jcount 'band skipped' "$patch_toggle_ms")
    inset_off=$(jcount '\[overviewlayout\] disabled —' "$patch_toggle_ms")
    band_field=$(jfield '\[overviewpatches\] enabled \(' 's/.*band=([a-z]+).*/\1/p' | tail -1)
    if [ -z "$reapplied_at" ]; then
        report $T overview-patches-roundtrip FAIL "the patches never re-applied after the toggle — the settings listener or _startOverviewPatches is broken"
    elif [ "${band_skip:-0}" != 0 ] || [ "${inset_off:-0}" != 0 ]; then
        report $T overview-patches-roundtrip FAIL "re-applied but degraded (band skipped=$band_skip, inset disabled=$inset_off) — a shell private symbol moved"
    elif [ "$band_field" != "ok" ]; then
        report $T overview-patches-roundtrip FAIL "re-applied, but the band field read as '$band_field' instead of ok"
    else
        report $T overview-patches-roundtrip PASS "disable→enable re-applied inset+band on the live shell $(( (reapplied_at - patch_toggle_ms) / 1000 ))s after the toggle, no logout needed"
    fi
fi

# B6: separator oracle, only meaningful if something non-favorite is running.
# Leading `+`/`-` must be escaped: awk's ERE reads a bare `+separator` as an
# invalid repetition and aborts the whole check.
if [ "$(jcount '\+separator at=')" != 0 ]; then
    sep_ms=$(now_ms)
    set_key show-running-apps false
    sleep 1
    journal_load
    gone=$(jcount '\-separator' "$sep_ms")
    set_key show-running-apps true
    sleep 1
    journal_load
    back=$(jcount '\+separator' "$sep_ms")
    if [ "${gone:-0}" -ge 1 ] && [ "${back:-0}" -ge 1 ]; then
        report $T separator-toggle PASS "separator removed and re-added cleanly on a settings round-trip"
    else
        report $T separator-toggle ENV "did not observe both -separator and +separator (gone=${gone:-0} back=${back:-0}) — depends on what was running"
    fi
else
    report $T separator-toggle ENV "no separator existed this boot (nothing running outside favorites)"
fi

# B7: proof that the user's configuration is back exactly as it was.
restore_keys
sleep 0.5
if dconf_verify "$SNAP"; then
    report $T dconf-restored PASS "dconf subtree byte-identical to the pre-run snapshot"
else
    report $T dconf-restored FAIL "dconf NOT RESTORED — the harness left the user's settings changed"
    exit 1
fi
orphans=$(xdotool search --name "^$PREFIX" 2>/dev/null | wc -l | tr -d ' ')
[ "$orphans" = 0 ] \
    && report $T no-orphan-windows PASS "no probe windows left" \
    || report $T no-orphan-windows FAIL "$orphans probe window(s) still mapped — a SIGKILL left them behind"

report $T teardown PASS "sandbox removed$([ "${KEEP_T3:-0}" = 1 ] && echo " (KEEP_T3=1: $TD)")"
exit_code_from_results
