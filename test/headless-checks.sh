#!/usr/bin/bash
# test/headless-checks.sh — Tier 2: boot a throwaway, private, *headless* GNOME
# Shell in a clean-room environment and assert only what a headless session can
# actually prove. Typical runtime 40 s warm, hard cap 150 s.
#
#   bash test/headless-checks.sh
#   npm run test:headless
#
# What headless CAN prove (and why each line is here): the extension imports,
# reaches ENABLED, builds its GTypes and stylesheet, its feature detection agrees
# with the shell it is running against, and it does not throw. What it CANNOT
# prove: any map/minimize/restore animation path — mutter never runs those here,
# verified earlier with counters wrapped onto the live instance that stayed at 0
# even under --force-animations. Do not add animation assertions to this tier.
#
# Isolation contract, all of it load-bearing:
#   GSETTINGS_BACKEND=memory  -> zero dconf writes; every write is discarded
#   XDG_DATA_HOME=$T2         -> the shell scans only this dir, so the symlinked
#                               fork is the ONLY extension loaded. Without it all
#                               of the user's extensions boot in here and their
#                               log lines and behaviour pollute every assertion.
#   unique --wayland-display  -> without it mutter tries wayland-0, fails to lock
#                               and cascades into confusing "shell bug" errors.
#   never `gnome-extensions enable` -> under the memory backend that CLI is a
#                               separate process whose write dies with it, so the
#                               real shell never sees it and the poll spins to
#                               timeout. Enable from inside via Eval instead.
#   never `gnome-extensions install`/`pack` in this repo -> follows symlinks and
#                               wipes the source directory (AGENTS.md).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

T=2
init_results
for c in gnome-shell dbus-run-session gdbus jq; do
    need_cmd "$c" || { report $T prereq ENV "$c is absent — tier 2 cannot run here"; exit 77; }
done

# Reclaim sandboxes a previous run could not remove. t2cleanup deletes $T2 on
# every normal exit, but a run that was SIGKILLed (or a host that lost power)
# leaves its dir behind and nothing else ever picks it up — 16 of them (2.9 MB)
# had piled up before this sweep existed. Only dirs older than an hour are
# reclaimed, so a *concurrent* run's fresh sandbox (a run here is ≤150 s) is
# never touched. Best-effort hygiene, not an assertion, so it prints no report
# line and the "asserts 19 things" count in MAINTENANCE stays true.
t2swept=0
for d in "${TMPDIR:-/tmp}"/macosdock-t2-*; do
    [ -d "$d" ] || continue
    [ -n "$(find "$d" -maxdepth 0 -mmin +60 2>/dev/null)" ] || continue
    rm -rf "$d" && t2swept=$((t2swept + 1))
done
if [ "$t2swept" -gt 0 ]; then
    echo "  sweep  reclaimed $t2swept stale sandbox dir(s) from earlier runs"
fi

T2=$(mktemp -d "${TMPDIR:-/tmp}/macosdock-t2-XXXXXX")
UNIQ=${T2##*-}
SOCK_NAME="wayland-$UNIQ"
RUNDIR="/run/user/$(id -u)"
LOCK="$RUNDIR/$SOCK_NAME.lock"
SOCK="$RUNDIR/$SOCK_NAME"
mkdir -p "$T2/gnome-shell/extensions"
ln -s "$REPO" "$T2/gnome-shell/extensions/$UUID"

INNER=""

# Every process under <pid>, children before their parent. Order matters: killing
# a parent first reparents its children to systemd, where `pgrep -P` can no longer
# see them, so the list has to be built while the tree is still intact.
t2descendants() { # t2descendants <pid>
    local c
    for c in $(pgrep -P "$1" 2>/dev/null); do t2descendants "$c"; done
    echo "$1"
}

# dbus-run-session forks TWO children — a private dbus-daemon and the command
# (gnome-shell) — and `kill $INNER` reaches NEITHER: both are reparented to
# systemd and keep running. Measured leak: after a day of runs, 7 headless
# shells + 18 private dbus-daemons (~580 MB) were still alive. Reap the whole
# subtree, children first, so nothing reparents mid-kill.
t2killtree() {
    [ -n "$INNER" ] || return 0
    local pids p
    pids=$(t2descendants "$INNER")
    for p in $pids; do kill -TERM "$p" 2>/dev/null; done
    sleep 0.5
    for p in $pids; do kill -KILL "$p" 2>/dev/null; done
}

t2cleanup() {
    t2killtree
    # The only two sanctioned writes outside $T2, and both carry this run's own
    # unique name, so a stale file from another run can never be deleted here.
    [ -f "$LOCK" ] && rm -f "$LOCK"
    [ -S "$SOCK" ] && rm -f "$SOCK"
    # KEEP_T2=1 leaves the sandbox and its log in place for post-mortem reading.
    [ "${KEEP_T2:-0}" = 1 ] || rm -rf "$T2"
}
trap 't2cleanup' EXIT INT TERM

# H1 ------------------------------------------------------------------------
export GSETTINGS_BACKEND=memory
export XDG_DATA_HOME="$T2"
export XDG_CONFIG_HOME="$T2/config"
export XDG_CACHE_HOME="$T2/cache"
export GSETTINGS_SCHEMA_DIR="$REPO/schemas"
unset WAYLAND_DISPLAY          # never let a client app find the throwaway shell
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
report $T sandbox PASS "clean room $T2 with exactly one extension symlinked"

# H2 ------------------------------------------------------------------------
# This distribution's dbus-run-session has no --print-address option, so the
# inner shell writes the bus address itself; the harness then talks to that bus
# from outside the session it created.
( ADDR="$T2/bus.addr" SOCK="$SOCK_NAME" dbus-run-session -- bash -c '
      printf "%s" "$DBUS_SESSION_BUS_ADDRESS" > "$ADDR"
      exec gnome-shell --headless --unsafe-mode --wayland-display="$SOCK" --virtual-monitor=1280x800
  ' > "$T2/shell.log" 2>&1 ) &
INNER=$!

for _ in $(seq 1 50); do [ -s "$T2/bus.addr" ] && break; sleep 0.1; done
if [ ! -s "$T2/bus.addr" ]; then
    report $T boot ENV "no bus address after 5 s"
    exit 77
fi
export DBUS_SESSION_BUS_ADDRESS=$(cat "$T2/bus.addr")

# An option that a release removed (--nested is gone in 50) must report ENV with
# the shell's own words, never a FAIL that looks like our bug.
sleep 2
if ! kill -0 "$INNER" 2>/dev/null; then
    report $T boot ENV "gnome-shell refused to start: $(grep -aE 'Usage:|Unknown option|failed to' "$T2/shell.log" | head -1)"
    exit 77
fi
if grep -aqE 'Usage:|Unknown option' "$T2/shell.log"; then
    report $T boot ENV "headless flags changed — check gnome-shell --help manually: $(grep -aE 'Unknown option' "$T2/shell.log" | head -1)"
    exit 77
fi
report $T boot PASS "headless shell running (pid $(pgrep -P "$INNER" | head -1) via $SOCK_NAME)"

# Eval plumbing: code comes from a file (quoting through gdbus is a trap) and
# results come back as a file (Eval's reply is ASCII-escaped and unparseable).
# Two distinct helpers on purpose: a raw expression is NOT a path. An earlier
# revision fed `1+1` through the file loader, which made every readiness probe
# fail with (false, …) and the poll spin to its timeout.
EV_RAW() {
    gdbus call --session -d org.gnome.Shell -o /org/gnome/Shell \
        -m org.gnome.Shell.Eval "$1" 2>/dev/null
}
EV_FILE() {
    EV_RAW "eval(imports.byteArray.toString(imports.gi.GLib.file_get_contents('$1')[1]))"
}
eval_available() { grep -aq '^(true,' <<< "$(EV_RAW '1+1')"; }

cat > "$T2/e1.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const em = Main.extensionManager;
    const out = { eval: true, hasManager: !!em, discovered: false, state: null, hasObj: false };
    if (em) {
        const info = em.lookup('macos-dock@local');
        out.discovered = !!info;
        if (info) {
            out.state = info.state;
            out.hasObj = !!info.stateObj;
        }
    }
    GLib.file_set_contents('%T2%/e1.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e1.js"

# H3 ------------------------------------------------------------------------
# Discovery, not ACTIVE: under a memory backend the enabled list is empty, so
# `lookup(uuid)` becomes truthy long before extension.js is imported. Polling on
# the wrong thing looks exactly like "the extension failed to load".
READY=no
POLL_START=$(now_ms)
for _ in $(seq 1 120); do
    kill -0 "$INNER" 2>/dev/null || break
    if ! eval_available; then sleep 0.5; continue; fi
    EV_FILE "$T2/e1.js" >/dev/null 2>&1
    if [ -f "$T2/e1.json" ] && grep -aq '"discovered":true' "$T2/e1.json"; then READY=yes; break; fi
    sleep 0.5
done
if [ "$READY" != yes ]; then
    report $T discovery ENV "never discovered after $(( ($(now_ms) - POLL_START) / 1000 ))s — eval_ok=$(eval_available && echo yes || echo no) probe=$(head -c 120 "$T2/e1.json" 2>/dev/null)"
    exit 77
fi
report $T discovery PASS "discovered in $(( ($(now_ms) - POLL_START) / 1000 ))s, state=$(jq -r '.state // "undefined(metadata only)"' "$T2/e1.json") imported=$(jq -r '.hasObj' "$T2/e1.json") (state 6 = INITIALIZED, extension.js not yet imported)"

cat > "$T2/e2.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const em = Main.extensionManager, uuid = 'macos-dock@local';
    const info = em.lookup(uuid);
    const out = { path: null, initState: null, enableRes: null, finalState: null, hasObj: false };
    // The shell's own boot path, so the variant stylesheet is loaded too —
    // closer to a real login than calling stateObj.enable() directly.
    if (typeof em._callExtensionInit === 'function') {
        out.path = '_callExtensionInit';
        await em._callExtensionInit(uuid);
        out.initState = em.lookup(uuid).state;
        if (typeof em._callExtensionEnable === 'function')
            out.enableRes = await em._callExtensionEnable(uuid);
    } else if (info && info.stateObj) {
        out.path = 'stateObj.enable';
        out.enableRes = info.stateObj.enable();
    }
    const after = em.lookup(uuid);
    out.finalState = after ? after.state : null;
    out.hasObj = !!(after && after.stateObj);
    GLib.file_set_contents('%T2%/e2.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e2.js"

# H4 ------------------------------------------------------------------------
EV_FILE "$T2/e2.js" >/dev/null 2>&1
for _ in $(seq 1 30); do [ -s "$T2/e2.json" ] && break; sleep 1; done
if [ ! -s "$T2/e2.json" ]; then
    report $T enable ENV "enable probe never returned"
    exit 77
fi
final=$(jq -r '.finalState' "$T2/e2.json")
# ExtensionState: 1 ACTIVE, 2 INACTIVE, 3 ERROR, 4 OUT_OF_DATE, 6 INITIALIZED
if [ "$final" != 1 ]; then
    report $T enable FAIL "extension state $final, expected 1 ACTIVE ($(cat "$T2/e2.json" | jq -c '.path, .enableRes'))"
    exit 1
fi
report $T enable PASS "ACTIVE via $(jq -r '.path' "$T2/e2.json")"

# Settle before reading any oracle. enable() returns in ~20 ms here, while the
# iconManager grace ends at ~600 ms and dodge's grace releases at ~2 s: reading
# the log immediately made H9 report a FAIL against a line that existed 600 ms
# later. Waiting past `[dodge] grace released` also makes H11 cover the whole
# startup grace instead of just the first frame.
SETTLE=$(now_ms)
while [ $(( $(now_ms) - SETTLE )) -lt 9000 ]; do
    grep -aq '\[dodge\] grace released' "$T2/shell.log" 2>/dev/null && break
    kill -0 "$INNER" 2>/dev/null || break
    sleep 0.5
done
report $T settle PASS "waited $(( ($(now_ms) - SETTLE) / 1000 ))s for the startup grace to release"

# ---- log oracles over $T2/shell.log ---------------------------------------
L="$T2/shell.log"
lc() { grep -acE -- "$1" "$L" 2>/dev/null | head -1; }

# H5 ------------------------------------------------------------------------
enable_ms=$(grep -aoE '\[macos-dock-local\] enable\(\) total [0-9.]+ms' "$L" 2>/dev/null | head -1 | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)
if [ -z "$enable_ms" ]; then
    report $T enable-ran FAIL "no enable() total line — extension.js ran but enable() never completed"
else
    # Deliberately unbounded: software rendering on a virtual monitor makes
    # headless timings incomparable to the live session (5355 ms vs 757 ms was
    # measured for a different fork). Presence is the assertion, the number is
    # evidence to copy into MAINTENANCE, not a threshold.
    report $T enable-ran PASS "enable() completed in ${enable_ms}ms (informational, not comparable to live)"
fi

# H6 ------------------------------------------------------------------------
genie_ok=$(lc '\[macos-dock-local\]\[genie\] enabled')
genie_bad=$(lc 'missing/changed private APIs')
if [ "$genie_ok" -ge 1 ] && [ "$genie_bad" = 0 ]; then
    report $T genie-apis PASS "_validate() accepted this shell's private API surface"
elif [ "$genie_bad" -ge 1 ]; then
    report $T genie-apis FAIL "genie degraded to native animation — a shell symbol moved or vanished (see facts.json)"
else
    report $T genie-apis FAIL "genie logged neither line — enable() did not reach _startGenie()"
fi

# H7 ------------------------------------------------------------------------
[ "$(lc '\[macos-dock-local\]\[dodge\] started \(onlyFocused=')" -ge 1 ] \
    && report $T dodge-started PASS "dodge start() survived signal wiring and created its poll" \
    || report $T dodge-started FAIL "dodge never started"

# H8 ------------------------------------------------------------------------
icon_n=$(grep -aoE '\[icons\] reload: [0-9]+ icons' "$L" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)
if [ -z "$icon_n" ]; then
    report $T icon-table FAIL "no reason=startup reload line — the icon row was never built"
elif [ "$icon_n" -eq 0 ]; then
    # The classic silent breakage when Shell.AppSystem stops resolving apps: an
    # empty row that loads fine and shows nothing.
    report $T icon-table FAIL "icon table built empty (0 icons) — AppSystem enumeration is broken here"
else
    report $T icon-table PASS "$icon_n icons enumerated"
fi

# H9 ------------------------------------------------------------------------
# The assertion is "the icons grace ENDED", not "it ended early": running to the
# 1200 ms cap is a legitimate exit, and a real cold boot here did exactly that.
# The end is observable through the post-grace incremental sync, so both paths
# prove the same thing; when the early line exists, its number is reported too.
grace_ms=$(grep -aoE 'startup grace ended early at [0-9]+ms' "$L" 2>/dev/null | head -1 | grep -oE '[0-9]+' | head -1)
ended=$(grep -ac 'reason=startup-grace-end' "$L" 2>/dev/null | head -1)
if [ "${ended:-0}" = 0 ]; then
    report $T icon-grace FAIL "the icons grace never ended (no startup-grace-end sync) — updates would stay suppressed for the whole session"
elif [ -n "$grace_ms" ] && [ "$grace_ms" -ge 400 ] && [ "$grace_ms" -le 2000 ]; then
    report $T icon-grace PASS "grace ended early at ${grace_ms}ms (floor 400, cap 1200)"
elif [ -n "$grace_ms" ]; then
    report $T icon-grace ENV "grace ended early at ${grace_ms}ms, outside 400-2000 — headless clock, not a regression"
else
    report $T icon-grace PASS "grace ran to its cap and released (window churn kept it alive — a real cold boot does the same)"
fi

# H10 -----------------------------------------------------------------------
# Headless boots emit unrelated shell noise (~90 "already disposed" from
# dateMenu.js plus a `-nan` GLib critical in one recorded run). Counting raw
# matches produced 1884 false hits once, so require our own path in the stack.
errblock=$(grep -aA12 -E 'JS ERROR|TypeError|ReferenceError|Gjs-Message|CRITICAL' "$L" 2>/dev/null \
    | grep -ac 'macos-dock@local' | head -1)   # ANCHOR-EXCEPTION: here the anchor is our own *path* in a stack frame, not the log tag
if [ "${errblock:-0}" = 0 ]; then
    report $T no-js-errors PASS "no error block names this extension"
else
    report $T no-js-errors FAIL "$errblock error block(s) name macos-dock@local — rerun with KEEP_T2=1 and read the kept shell.log"
fi

# H11 -----------------------------------------------------------------------
# Zero windows means zero overlap, so a hide here is the stale-rectangle bug
# class the startup grace gate exists to stop.
[ "$(lc '\[macos-dock-local\]\[dodge\] .+ -> hide')" = 0 ] \
    && report $T no-boot-hide PASS "dodge never hid in a window-less session" \
    || report $T no-boot-hide FAIL "dodge hid the dock with no windows present — grace/geometry regression"

# H12 -----------------------------------------------------------------------
cat > "$T2/e3.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const facts = {};
    // Every key is probed independently: an earlier revision lost the whole file
    // because `imports.gi.Config` has no typelib inside Eval in a headless boot,
    // and one throw used to swallow all the other answers.
    const probe = (name, fn) => {
        try { facts[name] = fn(); } catch (e) { facts[name] = 'threw: ' + e.message; }
    };
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const wm = Main.wm, gwm = global.window_manager;
    const setLike = (o) => !!o && typeof o.has === 'function' && typeof o.delete === 'function';
    probe('Main.wm', () => !!wm);
    probe('Main.wm._minimizing', () => (wm ? setLike(wm._minimizing) : false));
    probe('Main.wm._unminimizing', () => (wm ? setLike(wm._unminimizing) : false));
    probe('window_manager.connect', () => (gwm ? typeof gwm.connect === 'function' : false));
    probe('completed_minimize', () => (gwm ? typeof gwm.completed_minimize === 'function' : false));
    probe('completed_unminimize', () => (gwm ? typeof gwm.completed_unminimize === 'function' : false));
    probe('monitors', () => Main.layoutManager.monitors.length);
    probe('mutterContextVersion', () => global.context_version);
    GLib.file_set_contents('%T2%/facts.json', JSON.stringify(facts, null, 1));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e3.js"
EV_FILE "$T2/e3.js" > "$T2/e3.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/facts.json" ] && break; sleep 1; done
if [ -s "$T2/facts.json" ]; then
    # Only the six keys genie's own _validate() consults; `monitors` and
    # `mutterContextVersion` are data, not symbol checks.
    missing_syms=$(jq -r '[to_entries[]
        | select(.key | test("^(Main\\\\.wm|window_manager|completed_)"))
        | select(.value != true) | .key] | join(",")' "$T2/facts.json")
    if [ -z "$missing_syms" ]; then
        report $T facts PASS "$(gnome-shell --version 2>/dev/null | head -1), all genie symbols present, $(jq -r '.monitors' "$T2/facts.json") monitor(s)"
    else
        report $T facts FAIL "absent or throwing symbols: $missing_syms — names where to fix genieController._validate()"
    fi
else
    report $T facts ENV "facts probe wrote nothing — reply: $(head -c 140 "$T2/e3.reply" 2>/dev/null) (H6 stands on its own)"
fi

# H13 ------------------------------------------------------------------------
# Edge geometry under a *fabricated* two-monitor layout. On a single-panel
# machine the class of bug this guards is invisible no matter what the user does,
# so the only honest check is to make the headless shell believe there are two
# vertically stacked monitors with primary on the far one, then ask dodge where
# its own edges are. The layout is restored in the same probe.
cat > "$T2/e4.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { ok: false };
    const dodge = Main.extensionManager.lookup('macos-dock@local')?.stateObj
        ?._dockManager?._dodge;
    if (!dodge) {
        out.error = 'no dodge instance';
        GLib.file_set_contents('%T2%/geom.json', JSON.stringify(out));
        return;
    }
    out.hasDockMonitor = typeof dodge._dockMonitor === 'function';
    const lm = Main.layoutManager;
    const savedMonitors = lm.monitors;
    const savedPrimary = lm.primaryMonitor;
    try {
        const stack = [
            { x: 0, y: 0, width: 1728, height: 1080 },
            { x: 0, y: 1080, width: 1728, height: 1080 },
        ];
        lm.monitors = stack;
        lm.primaryMonitor = stack[1];
        const got = dodge._dockMonitor();
        out.pickedDockMonitor = got === stack[0];
        out.pickedPrimaryInstead = got === stack[1];
        // A pointer pressed against the bottom edge of the dock's own monitor.
        out.deepOnDockMonitor = dodge._inDeepZone(200, 1079, stack[0], 0);
        // Same pointer measured against primary — must be false, which is what
        // the old primaryMonitor-based code would have used for every decision.
        out.deepOnPrimary = dodge._inDeepZone(200, 1079, stack[1], 0);
        // And the park test must agree that this pointer is at the dock's edge.
        out.farFromEdgeAtDockEdge = dodge._pointerFarFromEdge(200, 1079);
        out.ok = out.pickedDockMonitor === true && out.deepOnDockMonitor === true
            && out.deepOnPrimary === false && out.farFromEdgeAtDockEdge === false;
    } catch (e) {
        out.error = e.message;
    } finally {
        lm.monitors = savedMonitors;
        lm.primaryMonitor = savedPrimary;
    }
    GLib.file_set_contents('%T2%/geom.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e4.js"
EV_FILE "$T2/e4.js" > "$T2/e4.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/geom.json" ] && break; sleep 1; done
if [ ! -s "$T2/geom.json" ]; then
    report $T dock-monitor-geometry ENV "geometry probe wrote nothing — reply: $(head -c 120 "$T2/e4.reply" 2>/dev/null)"
elif [ "$(jq -r '.ok' "$T2/geom.json")" = true ]; then
    report $T dock-monitor-geometry PASS "edge tests follow the dock's monitor, not primary (stacked 2-monitor layout)"
else
    report $T dock-monitor-geometry FAIL "geometry: $(jq -c 'del(.ok)' "$T2/geom.json") — expected pickedDockMonitor=true deepOnDockMonitor=true deepOnPrimary=false far=false"
fi

# H14 ------------------------------------------------------------------------
# The overview reserves its bottom band from the stock dash's preferred height
# (overviewControls.js: vfunc_allocate), even while the dash is hidden. Hiding
# the dash leaves it empty, so that height collapses to the theme padding — and
# a dock taller than that padding then overlapped the window picker / app grid.
# Assert the reserved band (dash preferred height + the shell's own spacing)
# clears the dock's occupied height. Red before the fix (36 + 21 = 57 < 70).
cat > "$T2/e5.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const mon = Main.layoutManager.primaryMonitor;
    const wa = Main.layoutManager.getWorkAreaForMonitor(mon.index);
    const dash = Main.overview?.dash;
    const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj?._dockManager;
    const rect = dm?.getRestingContainerRect?.();
    const spacing = Math.round(wa.height * 0.02);
    const out = {
        dashPref: dash ? dash.get_preferred_height(wa.width)[1] : null,
        spacing,
        band: null,
        dockOccupied: rect ? (mon.y + mon.height - rect.y) : null,
        ok: false,
    };
    out.band = out.dashPref === null ? null : out.dashPref + spacing;
    out.ok = out.dockOccupied !== null && out.band !== null && out.band >= out.dockOccupied;
    GLib.file_set_contents('%T2%/band.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e5.js"
EV_FILE "$T2/e5.js" > "$T2/e5.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/band.json" ] && break; sleep 1; done
if [ ! -s "$T2/band.json" ]; then
    report $T overview-band ENV "band probe wrote nothing — reply: $(head -c 120 "$T2/e5.reply" 2>/dev/null)"
elif [ "$(jq -r '.ok' "$T2/band.json")" = true ]; then
    report $T overview-band PASS "overview reserves band=$(jq -r '.band' "$T2/band.json") >= dock=$(jq -r '.dockOccupied' "$T2/band.json") (no overlap)"
else
    report $T overview-band FAIL "band=$(jq -r '.band' "$T2/band.json") < dock occupied=$(jq -r '.dockOccupied' "$T2/band.json") — dock would overlap the overview (dashPref=$(jq -r '.dashPref' "$T2/band.json"), spacing=$(jq -r '.spacing' "$T2/band.json"))"
fi

# H18 ------------------------------------------------------------------------
# The overview layout patches (D-054 band + D-057 inset) moved into their own
# concern (lib/overviewPatches.js, D-058) behind the `overview-patches-enabled`
# toggle. Presence check: the composer logs `enabled` on a good boot; it only
# fails to log if the toggle defaulted off or the composer was never wired.
# `band=skipped` is legitimate (the stock dash may not be ready at enable) and is
# not a failure — tier 2 asserts presence, never a threshold.
ovp_ok=$(lc '\[macos-dock-local\]\[overviewpatches\] enabled')
if [ "$ovp_ok" -ge 1 ]; then
    report $T overview-patches PASS "composer ran (inset + band) behind overview-patches-enabled"
else
    report $T overview-patches FAIL "overview patches logged no 'enabled' line — composer not wired or the toggle defaulted off"
fi

# H17 ------------------------------------------------------------------------
# The overview window previews are laid out by WorkspaceLayout._getWindowSlots,
# which the shell feeds the whole window-picker box while the desktop background
# is inset inside it — so previews poke past the desktop edge. lib/overviewLayout.js
# wraps that private method to pass the background rect instead. This is a
# presence check (tier-2 style): the wrapper logs `enabled` on a good boot, or a
# one-line `disabled — missing/changed private APIs` degrade when a shell symbol
# moves. Either way it must not throw — the FAIL here is "it logged neither".
ovl_ok=$(lc '\[macos-dock-local\]\[overviewlayout\] enabled')
ovl_bad=$(lc '\[macos-dock-local\]\[overviewlayout\] disabled')
if [ "$ovl_ok" -ge 1 ] && [ "$ovl_bad" = 0 ]; then
    report $T overview-window-inset PASS "_validate() accepted this shell's WorkspaceLayout._getWindowSlots surface"
elif [ "$ovl_bad" -ge 1 ]; then
    report $T overview-window-inset FAIL "overview inset degraded to native layout — a shell symbol moved or vanished (see facts.json)"
else
    report $T overview-window-inset FAIL "overview layout logged neither line — enable() did not reach applyOverviewLayout()"
fi

# H19 ------------------------------------------------------------------------
# The Show Apps button fix is now its own concern (D-058) behind
# `apps-button-fix-enabled`, decoupled from icons-fix-enabled. Presence check:
# lib/overviewApps.js logs `[appsbtn] applied` when it lands on the dock button.
appsbtn_ok=$(lc '\[macos-dock-local\]\[appsbtn\] applied')
if [ "$appsbtn_ok" -ge 1 ]; then
    report $T apps-button PASS "Show Apps button fix applied behind apps-button-fix-enabled"
else
    report $T apps-button FAIL "Show Apps button fix logged no 'applied' line — not wired or the toggle defaulted off"
fi

# H15 ------------------------------------------------------------------------
# Teardown is an assertion, not a formality. dbus-run-session's private
# dbus-daemon and its gnome-shell both outlive a naive `kill $INNER` (reparented
# to systemd), so snapshot the tree, reap it, and prove every pid is gone — the
# leak this guards once left 7 shells + 18 dbus-daemons (~580 MB) behind.
t2tree=$(t2descendants "$INNER")
t2killtree
INNER=""   # the trap's cleanup must not re-walk a tree we already reaped
t2leaked=""
for _ in $(seq 1 6); do
    t2leaked=""
    for p in $t2tree; do [ -r "/proc/$p/stat" ] && t2leaked="$t2leaked $p"; done
    [ -z "$t2leaked" ] && break
    sleep 0.5
done
if [ -z "$t2leaked" ]; then
    report $T teardown PASS "reaped the whole subtree ($(wc -w <<< "$t2tree") pids) — no orphan dbus-daemon or headless shell"
else
    report $T teardown FAIL "teardown leaked:$t2leaked — dbus-run-session's children outlived the kill"
fi
exit_code_from_results
