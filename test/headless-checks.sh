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

# H10 ------------------------------------------------------------------------
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

# H11 ------------------------------------------------------------------------
# Zero windows means zero overlap, so a hide here is the stale-rectangle bug
# class the startup grace gate exists to stop.
[ "$(lc '\[macos-dock-local\]\[dodge\] .+ -> hide')" = 0 ] \
    && report $T no-boot-hide PASS "dodge never hid in a window-less session" \
    || report $T no-boot-hide FAIL "dodge hid the dock with no windows present — grace/geometry regression"

# H12 ------------------------------------------------------------------------
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

# H15 ------------------------------------------------------------------------
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

# H16 ------------------------------------------------------------------------
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

# H17 ------------------------------------------------------------------------
# The Show Apps button fix is now its own concern (D-058) behind
# `apps-button-fix-enabled`, decoupled from icons-fix-enabled. Presence check:
# lib/overviewApps.js logs `[appsbtn] applied` when it lands on the dock button.
appsbtn_ok=$(lc '\[macos-dock-local\]\[appsbtn\] applied')
if [ "$appsbtn_ok" -ge 1 ]; then
    report $T apps-button PASS "Show Apps button fix applied behind apps-button-fix-enabled"
else
    report $T apps-button FAIL "Show Apps button fix logged no 'applied' line — not wired or the toggle defaulted off"
fi

# H18 ------------------------------------------------------------------------
# The Show Apps fix decides "am I in the grid?" from the overview's pagination
# state. It used to compare that value against the literal `2`, so a shell that
# *renumbers* ControlsState (rather than renaming it) would make the answer
# confidently wrong and log nothing. Now the module resolves
# ControlsState.APP_GRID once and prints it in its `applied` line; this check
# compares that printed number against the number the shell itself is using,
# read in the same boot. Pre-fix the line carries no `grid=` at all, so the
# check is red against the code it replaced.
# Tier 2 reads $T2/shell.log (the private shell's own output); `jfield` is the
# tier-3 primitive over the live journal and returns nothing here.
applied_line=$(grep -a '\[appsbtn\] applied' "$L" 2>/dev/null | head -1)
grid_reported=$(grep -oE 'grid=([0-9]+|null)' <<< "$applied_line" | head -1 | cut -d= -f2)
cat > "$T2/e8.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const oc = await import('resource:///org/gnome/shell/ui/overviewControls.js');
    GLib.file_set_contents('%T2%/grid.json',
        JSON.stringify({ appGrid: oc.ControlsState?.APP_GRID ?? null }));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e8.js"
EV_FILE "$T2/e8.js" > "$T2/e8.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/grid.json" ] && break; sleep 1; done
shell_grid=$(jq -r '.appGrid // "none"' "$T2/grid.json" 2>/dev/null)
if [ ! -s "$T2/grid.json" ]; then
    report $T grid-state-source ENV "ControlsState probe wrote nothing — reply: $(head -c 120 "$T2/e8.reply" 2>/dev/null)"
elif [ -z "$applied_line" ]; then
    report $T grid-state-source ENV "no appsbtn applied line to read the grid source from"
elif [ -z "$grid_reported" ]; then
    report $T grid-state-source FAIL "the applied line carries no grid= field — the module still compares a hardcoded number"
elif [ "$shell_grid" = none ]; then
    report $T grid-state-source FAIL "shell reports no ControlsState.APP_GRID but the module printed grid=$grid_reported — the number cannot be trusted"
elif [ "$grid_reported" = "$shell_grid" ]; then
    report $T grid-state-source PASS "grid state read from the shell enum (both $grid_reported this boot)"
else
    report $T grid-state-source FAIL "module used grid=$grid_reported but this shell's ControlsState.APP_GRID is $shell_grid — grid detection is wrong"
fi

# H19 ------------------------------------------------------------------------
# The hover tick must read each icon's geometry once per frame. It used to read
# position and size twice per icon — once to find minDist, once to scale — and
# each read returns a fresh GI array. Pointer injection into the live session is
# impossible here and `global.set_pointer` does not exist in this shell either
# (measured), so the probe shadows `global.get_pointer()` for exactly one frame —
# coordinates taken from the container's own geometry — and counts the reads.
# Precondition is the shadow actually being what the tick reads; if it is not,
# the probe says ENV instead of quietly measuring zero.
cat > "$T2/e10.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { precondition: false, ok: false };
    try {
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj
            ?._dockManager;
        const mag = dm?._magnification;
        if (!mag || !mag._container || typeof mag._update !== 'function') {
            out.error = 'no magnifier instance';
            GLib.file_set_contents('%T2%/tick.json', JSON.stringify(out));
            return;
        }
        const cont = mag._container;
        const [dx, dy] = cont.get_position();
        const [cw, ch] = cont.get_size();
        const tx = dx + Math.round(cw / 2), ty = dy + Math.round(ch / 2);
        // `global.set_pointer` does not exist in this shell (measured), and a
        // Clutter device warp would not reach the code under test either. The
        // tick reads the pointer through `global.get_pointer()`, so the honest
        // instrument is to shadow that for exactly one frame and restore it —
        // the coordinates come from the container's own real geometry.
        const origGetPointer = global.get_pointer;
        global.get_pointer = () => [tx, ty];
        const [gx, gy] = global.get_pointer();
        out.wanted = [tx, ty];
        out.got = [gx, gy];
        out.precondition = gx === tx && gy === ty;
        if (!out.precondition) {
            global.get_pointer = origGetPointer;
            GLib.file_set_contents('%T2%/tick.json', JSON.stringify(out));
            return;
        }
        const children = cont.get_children();
        out.n = children.length;
        // The tick magnifies app tiles only: the separator, the Trash, the
        // applications button and the drag gap are children but not tiles, and
        // scaling them is an artefact (and a fight with the gap's own
        // animation). So the contract is one read per ICON, and none for the
        // rest -- counting all children here would call the correct behaviour a
        // regression.
        const icons = children.filter((k) => k._appData);
        out.nIcons = icons.length;
        let posCalls = 0;
        const saved = [];
        for (const c of children) {
            const orig = c.get_position;
            saved.push(orig);
            c.get_position = function () { posCalls++; return orig.call(this); };
        }
        try {
            mag._update();
        } finally {
            // Restore both shadows even if the tick threw: a left-behind fake
            // `global.get_pointer` would corrupt every later probe in this run.
            global.get_pointer = origGetPointer;
            children.forEach((c, i) => { c.get_position = saved[i]; });
        }
        out.posCalls = posCalls;
        // One read per icon is the target; zero means the tick never reached the
        // geometry pass, which is an instrument gap, not a pass.
        out.ok = out.nIcons > 0 && posCalls === out.nIcons;
        out.tooFew = posCalls < out.nIcons;
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/tick.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e10.js"
EV_FILE "$T2/e10.js" > "$T2/e10.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/tick.json" ] && break; sleep 1; done
tick_json=$(jq -c 'del(.ok)' "$T2/tick.json" 2>/dev/null)
if [ ! -s "$T2/tick.json" ]; then
    report $T tick-geometry-reads ENV "tick probe wrote nothing — reply: $(head -c 120 "$T2/e10.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/tick.json")" != true ]; then
    report $T tick-geometry-reads ENV "headless pointer warp did not land, so the tick cannot be driven: $tick_json"
elif [ "$(jq -r '.tooFew' "$T2/tick.json")" = true ]; then
    report $T tick-geometry-reads ENV "tick ran but never reached the geometry pass: $tick_json"
elif [ "$(jq -r '.ok' "$T2/tick.json")" = true ]; then
    report $T tick-geometry-reads PASS "one geometry read per icon per frame ($(jq -r '.posCalls' "$T2/tick.json") for $(jq -r '.nIcons' "$T2/tick.json") icons of $(jq -r '.n' "$T2/tick.json") children)"
else
    report $T tick-geometry-reads FAIL "$(jq -r '.posCalls' "$T2/tick.json") position reads for $(jq -r '.n' "$T2/tick.json") icons in one tick — the tick passes over the icons more than once: $tick_json"
fi

# H20 ------------------------------------------------------------------------
# One pointer event must resolve the dock's monitor once, not twice.
# `_onPointer` takes a monitor, then calls `_pointerFarFromEdge`, which resolved
# its own — a second `Main.layoutManager.monitors` conversion and a second scan
# on the hottest path in the extension (motion events arrive unthrottled, and
# this is the path that decides whether the dock feels immediate).
#
# Pointer injection is unavailable on this machine, so the probe calls the
# handler directly and counts resolutions. That is the honest form of the
# assertion: it tests the call graph, not a timing guess.
cat > "$T2/e7.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { ok: false, precondition: false };
    const dodge = Main.extensionManager.lookup('macos-dock@local')?.stateObj
        ?._dockManager?._dodge;
    if (!dodge || !dodge._container || !dodge._containerValid) {
        out.error = dodge ? 'no live dock container' : 'no dodge instance';
        GLib.file_set_contents('%T2%/motion.json', JSON.stringify(out));
        return;
    }
    out.precondition = true;
    const orig = dodge._dockMonitor.bind(dodge);
    let calls = 0;
    dodge._dockMonitor = () => { calls++; return orig(); };
    try {
        // A pointer well inside the monitor, away from the dock edge: the far
        // from-edge branch must run, which is the one that used to re-resolve.
        dodge._onPointer(40, 40);
    } catch (e) {
        out.error = e.message;
    }
    delete dodge._dockMonitor;
    out.calls = calls;
    out.ok = out.error === undefined && calls <= 1;
    GLib.file_set_contents('%T2%/motion.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e7.js"
EV_FILE "$T2/e7.js" > "$T2/e7.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/motion.json" ] && break; sleep 1; done
motion_json=$(jq -c 'del(.ok)' "$T2/motion.json" 2>/dev/null)
if [ ! -s "$T2/motion.json" ]; then
    report $T motion-monitor-resolve ENV "motion probe wrote nothing — reply: $(head -c 120 "$T2/e7.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/motion.json")" != true ]; then
    report $T motion-monitor-resolve ENV "dock container unavailable for the motion probe: $motion_json"
elif [ "$(jq -r '.ok' "$T2/motion.json")" = true ]; then
    report $T motion-monitor-resolve PASS "one pointer event resolves the dock monitor $(jq -r '.calls' "$T2/motion.json") time(s)"
else
    report $T motion-monitor-resolve FAIL "one pointer event resolved the dock monitor $(jq -r '.calls' "$T2/motion.json") times — expected <=1: $motion_json"
fi

# H21 ------------------------------------------------------------------------
# A monkey-patch apply must be idempotent *and* revertible. Both overview
# patches used to answer "already applied" with a noop revert, which is only
# reachable if a previous revert threw and the caller swallowed it — and then the
# patch is stranded for the rest of the session with nothing left that can undo
# it. The probe recreates exactly that state (drop the held revert, re-apply so
# the already-applied branch is taken, then stop) and asserts both shadows are
# really gone afterwards. Red against the noop form of the code.
cat > "$T2/e9.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const ws = await import('resource:///org/gnome/shell/ui/workspace.js');
    const out = { precondition: false, ok: false };
    try {
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj
            ?._dockManager;
        const dash = Main.overview?.dash;
        const proto = ws.WorkspaceLayout?.prototype;
        if (!dm || !dash || !proto ||
            typeof dm._startOverviewPatches !== 'function' ||
            typeof dm._stopOverviewPatches !== 'function') {
            out.error = 'patch surface unavailable';
            GLib.file_set_contents('%T2%/revert.json', JSON.stringify(out));
            return;
        }
        const shadowed = () =>
            Object.prototype.hasOwnProperty.call(dash, 'get_preferred_height');
        out.precondition = true;
        out.installedBefore = shadowed() && proto._dockOverviewLayoutApplied === true;
        // Simulate the lost revert, then take the already-applied branch.
        dm._overviewPatchesRevert = null;
        dm._startOverviewPatches();
        dm._stopOverviewPatches();
        out.shadowStillInstalled = shadowed();
        out.insetStillApplied = proto._dockOverviewLayoutApplied === true;
        out.ok = out.installedBefore === true &&
            out.shadowStillInstalled === false && out.insetStillApplied === false;
        // Leave the session as found: re-apply for whatever runs after this.
        dm._startOverviewPatches();
        out.reapplied = shadowed() && proto._dockOverviewLayoutApplied === true;
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/revert.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e9.js"
EV_FILE "$T2/e9.js" > "$T2/e9.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/revert.json" ] && break; sleep 1; done
revert_json=$(jq -c 'del(.ok)' "$T2/revert.json" 2>/dev/null)
if [ ! -s "$T2/revert.json" ]; then
    report $T patch-revert-idempotent ENV "revert probe wrote nothing — reply: $(head -c 120 "$T2/e9.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/revert.json")" != true ]; then
    report $T patch-revert-idempotent ENV "patch surface unavailable: $revert_json"
elif [ "$(jq -r '.installedBefore' "$T2/revert.json")" != true ]; then
    report $T patch-revert-idempotent ENV "patches were not installed to begin with, so the branch cannot be exercised: $revert_json"
elif [ "$(jq -r '.ok' "$T2/revert.json")" = true ]; then
    report $T patch-revert-idempotent PASS "already-applied branch still returns a working revert (and re-applied cleanly=$(jq -r '.reapplied' "$T2/revert.json"))"
else
    report $T patch-revert-idempotent FAIL "patch stranded after stop(): $revert_json — expected shadowStillInstalled=false insetStillApplied=false"
fi

# H22 ------------------------------------------------------------------------
# The background must be as long as the row drawn inside it. The length used to
# be ESTIMATED (icons + separator + tail + a flag for the drag gap, all from
# counts) and on the live session that estimate lost touch with the row after a
# drag -- the trailing icons sat outside the background, which is what the owner
# photographed. The row is now measured instead, so the assertion is the
# agreement, sampled at the two moments the estimate was provably wrong: while a
# gap is open, and while one is still shrinking (the shrinking gap is a child,
# and the old flag had already been cleared for it).
cat > "$T2/e7.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { ok: false, precondition: false, samples: [] };
    const wait = (ms) => new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; });
    });
    try {
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj?._dockManager;
        const im = dm?._iconManager;
        const dnd = dm?._dockDnd;
        const c = im?._container;
        if (!c || !dnd) {
            GLib.file_set_contents('%T2%/extent.json', JSON.stringify(out));
            return;
        }
        // The row's own extent: the children's real allocation, mirrored
        // padding included. Independent of the code under test.
        const sample = (tag) => {
            let left = Infinity, right = 0, n = 0;
            for (const k of c.get_children()) {
                if (!k.visible)
                    continue;
                n++;
                left = Math.min(left, k.x);
                right = Math.max(right, k.x + k.width);
            }
            out.samples.push({
                tag,
                row: n > 0 ? Math.round(right + left) : 0,
                rect: (dm._computeContainerRect() || {}).w,
                n,
            });
        };
        const icons = c.get_children().filter(k => k._appData);
        out.precondition = icons.length >= 2;
        if (!out.precondition) {
            GLib.file_set_contents('%T2%/extent.json', JSON.stringify(out));
            return;
        }
        // The partition the drag math is fed. The tail buttons cannot hold a
        // favourite, so counting one of them as a slot moved the "that is your
        // own position, gap withdrawn" boundary off the last icon's edge and into
        // the tail's pixels -- measured on the live session as ~5 alternations a
        // second for seven seconds while the owner held the pointer at the end of
        // the row. Judged against the row itself, not against the code.
        const slotFacts = (tag) => {
            const slots = dnd._slotChildren();
            const lastIcon = icons[icons.length - 1];
            out.slotSamples.push({
                tag,
                slots: slots.length,
                icons: icons.length,
                tail: c.get_children()
                    .filter(k => !k._appData && k !== dnd._placeholder &&
                                  k !== im._separator)
                    .map(k => Math.round(k.x + k.width)),
                boundary: slots.length > 0
                    ? Math.round(slots[slots.length - 1].start + slots[slots.length - 1].size)
                    : null,
                lastIconEdge: Math.round(lastIcon.x + lastIcon.width),
            });
        };
        out.slotSamples = [];
        slotFacts('rest');
        await wait(120);
        sample('rest');
        dnd._onDragBegin(icons[0]);
        slotFacts('dragging');
        dnd._relocatePlaceholder(2, false);
        await wait(150);
        sample('gap-open');
        dnd._clearPlaceholder(true);
        await wait(90);
        sample('gap-shrinking');
        await wait(600);
        sample('gap-gone');
        // A child the dock never planned for: the estimate had nothing to count.
        const extra = new imports.gi.St.Widget({ width: 40, height: 40 });
        c.add_child(extra);
        await wait(150);
        sample('unexpected-child');
        extra.destroy();
        c._delegate = null;
        // Two begins with one finish is what an interrupted gesture leaves
        // behind -- the dock sliding out from under the pointer, the actor
        // destroyed mid-drag. A single "currently dragged" slot restores only
        // the last one and every other icon stays at drag opacity for the rest
        // of the session (measured: five stuck at 50).
        dnd._onDragBegin(icons[0]);
        dnd._onDragBegin(icons[1]);
        dnd._finishDrag();
        out.dimLeft = c.get_children().filter(k => k._appData && k.opacity !== 255).length;
        out.dimOk = out.dimLeft === 0;
        await wait(150);
        sample('final');
        out.ok = out.samples.every(s => s.rect !== null && Math.abs(s.rect - s.row) <= 2);
        out.slotOk = out.slotSamples.every(s => s.icons === s.slots && s.boundary === s.lastIconEdge);
        // The instrument about itself. At login it once warned "background 1066
        // does not cover the row's 55 (18 children)": eighteen children had been
        // added, none had been allocated yet. So an unallocated child must keep it
        // quiet -- and it must STILL speak when a laid-out row disagrees, or the
        // bail-out would be a mute button rather than a guard. The warn is the
        // only output the method has, and `console.warn` cannot be reassigned in
        // GJS (measured: it throws `"warn" is read-only`), so the evidence is
        // counted in the private shell's own log -- the same $T2/shell.log the
        // oracles above grep.
        const LOG = '%T2%/shell.log';
        const layoutLines = () => (imports.byteArray.toString(
            GLib.file_get_contents(LOG)[1]).match(/\[layout\]/g) || []).length;
        const base = layoutLines();
        // A child that has never been allocated sits at x=0 with width 0, which
        // pulls the row's painted left edge out of the padding: the disagreement
        // it manufactures is exactly the login-time one.
        const ghost = new imports.gi.St.Widget({ visible: true });
        c.add_child(ghost);
        dm._checkExtentAgreement();
        await wait(30);
        out.ghostDelta = layoutLines() - base;
        ghost.destroy();
        const realRect = dm._computeContainerRect;
        dm._computeContainerRect = () => {
            const r = realRect.call(dm);
            return { ...r, w: r.w + 300 };
        };
        dm._checkExtentAgreement();
        dm._computeContainerRect = realRect;
        await wait(30);
        out.speakDelta = layoutLines() - base - out.ghostDelta;
        // The other way this instrument can lie: a hidden dock paints nothing,
        // and its children keep whatever allocation they had when it went away
        // while the length is recomputed from their requests. The live session
        // said it twice with identical numbers -- "background 1127 does not
        // cover the row's 930 (19 children)", once at login and once right after
        // a drop, i.e. both times the pointer had left and the dock was hidden.
        const base2 = layoutLines();
        const wideChild = new imports.gi.St.Widget({ visible: true, width: 200, height: 40 });
        c.hide();
        c.add_child(wideChild);
        dm._updatePosition();
        dm._checkExtentAgreement();
        await wait(30);
        out.hiddenDelta = layoutLines() - base2;
        wideChild.destroy();
        c.show();
        dm._updatePosition();
        await wait(60);
        out.hiddenSilent = out.hiddenDelta === 0;
        out.instrumentLog = true;
        out.ghostSilent = out.ghostDelta === 0;
        out.stillSpeaks = out.speakDelta === 1;
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/extent.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e7.js"
EV_FILE "$T2/e7.js" > "$T2/e7.reply" 2>&1
for _ in $(seq 1 15); do [ -s "$T2/extent.json" ] && break; sleep 1; done
extent_json=$(jq -c '.samples, .error' "$T2/extent.json" 2>/dev/null)
if [ ! -s "$T2/extent.json" ]; then
    report $T dock-extent-tracks-row ENV "extent probe wrote nothing — reply: $(head -c 120 "$T2/e7.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/extent.json")" != true ]; then
    report $T dock-extent-tracks-row ENV "row too short to sample: $extent_json"
elif [ "$(jq -r '.ok' "$T2/extent.json")" = true ]; then
    report $T dock-extent-tracks-row PASS "computed length equals the row's own extent in every sampled state, gap open and shrinking included: $extent_json"
else
    report $T dock-extent-tracks-row FAIL "computed length disagrees with the row: $extent_json"
fi

# H23b -----------------------------------------------------------------------
# Same probe, second assertion: no icon may be left at drag opacity. Reported
# separately because it is a different promise -- the row's length is geometry,
# this is state a gesture can strand.
if [ ! -s "$T2/extent.json" ] || [ "$(jq -r '.precondition' "$T2/extent.json")" != true ]; then
    report $T drag-dim-released ENV "no sample to judge (see dock-extent-tracks-row)"
elif [ "$(jq -r '.dimOk' "$T2/extent.json")" = true ]; then
    report $T drag-dim-released PASS "overlapping drags leave every icon at full opacity"
else
    report $T drag-dim-released FAIL "$(jq -r '.dimLeft' "$T2/extent.json") icon(s) stuck at drag opacity after two begins and one finish"
fi

# H23c -----------------------------------------------------------------------
# Third assertion from the same probe: the children the drag math is allowed to
# count as slots. Pre-fix this failed on both halves -- the Trash was a slot, so
# there was one more slot than there were favourites and the last slot's edge was
# the Trash's, not the last icon's.
slot_json=$(jq -c '.slotSamples, .error' "$T2/extent.json" 2>/dev/null)
if [ ! -s "$T2/extent.json" ] || [ "$(jq -r '.precondition' "$T2/extent.json")" != true ]; then
    report $T drag-slots-are-icons-only ENV "no sample to judge (see dock-extent-tracks-row)"
elif [ "$(jq -r '.slotOk' "$T2/extent.json")" = true ]; then
    report $T drag-slots-are-icons-only PASS "slot count equals the icon count and the partition ends at the last icon's edge: $slot_json"
else
    report $T drag-slots-are-icons-only FAIL "a non-icon child is counted as a slot: $slot_json"
fi

# H23d -----------------------------------------------------------------------
# Fourth assertion from the same probe, about the instrument itself: it must not
# warn about a row that has not been allocated, and must still warn once the row
# is laid out and the background really disagrees.
if [ ! -s "$T2/extent.json" ] || [ "$(jq -r '.precondition' "$T2/extent.json")" != true ]; then
    report $T extent-check-silent-unallocated ENV "no sample to judge (see dock-extent-tracks-row)"
elif [ "$(jq -r '.instrumentLog' "$T2/extent.json")" != true ]; then
    report $T extent-check-silent-unallocated ENV "the probe never reached the log count: $(jq -c '{error, ghostDelta, speakDelta}' "$T2/extent.json")"
elif [ "$(jq -r '.ghostSilent' "$T2/extent.json")" != true ]; then
    report $T extent-check-silent-unallocated FAIL "the instrument warned about a child that has never been allocated: $(jq -c '{ghostDelta, speakDelta, error}' "$T2/extent.json")"
elif [ "$(jq -r '.stillSpeaks' "$T2/extent.json")" != true ]; then
    report $T extent-check-silent-unallocated FAIL "the guard mutes the check: it stayed quiet against a background 300px short. $(jq -c '{ghostDelta, speakDelta, error}' "$T2/extent.json")"
elif [ "$(jq -r '.hiddenSilent' "$T2/extent.json")" != true ]; then
    report $T extent-check-silent-unallocated FAIL "the instrument testified about a hidden dock, whose children are not allocated at all (+$(jq -r '.hiddenDelta' "$T2/extent.json") line(s)): $(jq -c '{ghostDelta, speakDelta, hiddenDelta, error}' "$T2/extent.json")"
else
    report $T extent-check-silent-unallocated PASS "silent for an unallocated row and for a hidden one, still speaks for a laid-out row that disagrees: $(jq -c '{ghostDelta, speakDelta, hiddenDelta}' "$T2/extent.json")"
fi

# H24 ------------------------------------------------------------------------
# Three drag/label regressions from the owner's live session. All three are
# state a headless session can set up by hand even though it cannot move a
# pointer: the placeholder is an actor, the label is positioned by a pure
# method, and acceptDrop is a call.
#
#   1. An app dragged out of the grid and then away from the dock left its
#      placeholder behind forever. Only a source that lives in this dock emits
#      a dock-side drag-end, so an external source needs a drag monitor that
#      clears the gap when the pointer leaves the container.
#   2. The label was placed from the configured maximum magnification, not the
#      hovered icon's settled scale, so at the row's edge it floated a whole
#      (max-1)*height too high. The probe pins the actual-scale math.
#   3. acceptDrop finished the drag before dnd.js emitted drag-end, so the
#      deferred favorites reload rebuilt the row mid-drop and could destroy
#      the icon just dropped. A dock source must keep the drag open until its
#      own drag-end; an external source has none and must be finished here.
cat > "$T2/e12.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const DND = await import('resource:///org/gnome/shell/ui/dnd.js');
    const out = { precondition: false, externalOk: false, tooltipOk: false, dragGuardOk: false };
    const wait = (ms) => new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; });
    });
    try {
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj?._dockManager;
        const im = dm?._iconManager;
        const dnd = dm?._dockDnd;
        const c = im?._container;
        if (!c || !im || !dnd || !im._tooltipText) {
            out.error = 'dock surface unavailable';
            GLib.file_set_contents('%T2%/fixes.json', JSON.stringify(out));
            return;
        }
        const icons = c.get_children().filter(k => k._appData?.appId);
        out.precondition = icons.length >= 2;
        if (!out.precondition) {
            GLib.file_set_contents('%T2%/fixes.json', JSON.stringify(out));
            return;
        }
        // A stale shrink from the previous probe must not gate the first gap.
        dnd._finishDrag();
        await wait(300);

        // 1. External drag leaves the dock.
        const first = icons[0];
        const external = { appId: first._appData.appId };
        dnd._enabled = true;
        dnd._handleDragOver(external, c.vertical ? c.width / 2 : c.width - 1,
            c.vertical ? c.height - 1 : c.height / 2);
        out.externalHadGap = !!dnd._placeholder;
        out.monitorsWithGap = DND.dragMonitors.length;
        const [cx, cy] = c.get_transformed_position();
        let leaveError = null;
        try {
            dnd._onDragMotion?.({ x: cx - 50, y: cy - 50 });
        } catch (e) {
            leaveError = e.message;
        }
        out.leaveError = leaveError;
        out.externalGapAfterLeave = !!dnd._placeholder;
        out.externalCueAfterLeave = dnd._unpinCueOn === true;
        out.monitorsAfterLeave = DND.dragMonitors.length;
        out.externalCleanupOk = out.externalHadGap &&
            !out.externalGapAfterLeave && !out.externalCueAfterLeave;
        // The monitor was installed by the gap and must be gone once it is.
        out.externalMonitorOk = out.monitorsAfterLeave === out.monitorsWithGap - 1;
        out.externalOk = out.externalCleanupOk && out.externalMonitorOk && leaveError === null;
        dnd._finishDrag();
        await wait(300);

        // 2. Label against the icon's settled scale, not the configured max.
        const actor = icons[0];
        const appId = actor._appData.appId;
        const saved = {
            actor: im._tooltipActor,
            appId: im._tooltipAppId,
            text: im._tooltipText.get_text(),
            gap: im._tooltipGap,
            mag: im._magScale,
            scale: actor._dockMagnifyScale,
        };
        im._tooltipActor = actor;
        im._tooltipAppId = appId;
        im._tooltipText.set_text('probe');
        im._tooltipText.opacity = 0;
        im._tooltipText.show();
        actor._dockMagnifyScale = 1;
        im._magScale = 1.4;
        im._tooltipGap = 6;
        let tooltipError = null;
        try {
            im._positionTooltip();
        } catch (e) {
            tooltipError = e.message;
        }
        const [, tooltipHeight] = im._tooltipText.get_preferred_height(-1);
        const rest = im._restingRect?.() ?? { x: c.x, y: c.y };
        const expectedY = rest.y + actor.y - tooltipHeight - 6;
        out.tooltipY = Math.round(im._tooltipText.y);
        out.tooltipExpectedY = Math.round(expectedY);
        out.tooltipDelta = Math.round(im._tooltipText.y - expectedY);
        out.tooltipError = tooltipError;
        out.tooltipOk = tooltipError === null && Math.abs(out.tooltipDelta) <= 2;
        im._hideTooltip();
        im._tooltipText.set_text(saved.text);
        if (saved.gap === undefined)
            delete im._tooltipGap;
        else
            im._tooltipGap = saved.gap;
        im._magScale = saved.mag;
        if (saved.scale === undefined)
            delete actor._dockMagnifyScale;
        else
            actor._dockMagnifyScale = saved.scale;
        im._tooltipActor = saved.actor;
        im._tooltipAppId = saved.appId;

        // 3. A dock source keeps the drag open through acceptDrop.
        dnd._onDragBegin(actor);
        dnd._relocatePlaceholder(0, false);
        const dockSource = { appId, _dockDnd: dnd };
        const realDefer = dnd._defer;
        let deferred = 0;
        dnd._defer = () => { deferred++; };
        let accepted = false;
        let dropError = null;
        try {
            accepted = dnd._acceptDrop(dockSource);
        } catch (e) {
            dropError = e.message;
        }
        out.accepted = accepted;
        out.deferred = deferred;
        out.dragInProgressAfterDrop = im._dragInProgress === true;
        out.gapAfterDrop = !!dnd._placeholder;
        dnd._onDragEnd();
        out.dragInProgressAfterEnd = im._dragInProgress === true;
        out.gapAfterEnd = !!dnd._placeholder;
        dnd._defer = realDefer;
        out.dropError = dropError;
        out.dragGuardOk = dropError === null && accepted === true && deferred === 1 &&
            out.dragInProgressAfterDrop && out.gapAfterDrop &&
            !out.dragInProgressAfterEnd && !out.gapAfterEnd;
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/fixes.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e12.js"
EV_FILE "$T2/e12.js" > "$T2/e12.reply" 2>&1
for _ in $(seq 1 15); do [ -s "$T2/fixes.json" ] && break; sleep 1; done
fixes_json=$(jq -c 'del(.ok)' "$T2/fixes.json" 2>/dev/null)
if [ ! -s "$T2/fixes.json" ]; then
    report $T external-drag-placeholder-clears ENV "fix probe wrote nothing — reply: $(head -c 120 "$T2/e12.reply" 2>/dev/null)"
    report $T tooltip-settled-scale ENV "fix probe wrote nothing"
    report $T drag-guard-through-drop ENV "fix probe wrote nothing"
elif [ "$(jq -r '.precondition' "$T2/fixes.json")" != true ]; then
    report $T external-drag-placeholder-clears ENV "dock surface unavailable: $fixes_json"
    report $T tooltip-settled-scale ENV "dock surface unavailable"
    report $T drag-guard-through-drop ENV "dock surface unavailable"
else
    if [ "$(jq -r '.externalOk' "$T2/fixes.json")" = true ]; then
        report $T external-drag-placeholder-clears PASS "an app-grid drag that leaves the dock destroys its gap and removes its drag monitor"
    else
        report $T external-drag-placeholder-clears FAIL "external drag left the dock but the gap survived: $fixes_json"
    fi
    if [ "$(jq -r '.tooltipOk' "$T2/fixes.json")" = true ]; then
        report $T tooltip-settled-scale PASS "label placed from the icon's settled scale (delta $(jq -r '.tooltipDelta' "$T2/fixes.json")px)"
    else
        report $T tooltip-settled-scale FAIL "label is not placed from the icon's settled scale: $fixes_json"
    fi
    if [ "$(jq -r '.dragGuardOk' "$T2/fixes.json")" = true ]; then
        report $T drag-guard-through-drop PASS "acceptDrop leaves a dock source's drag open until its own drag-end"
    else
        report $T drag-guard-through-drop FAIL "acceptDrop finished the drag too early: $fixes_json"
    fi
fi

# H25 ------------------------------------------------------------------------
# The slot partition must not be measured through the gap it just opened. The
# live journal shows the pair of verdicts flipping for a still pointer
# (`over gap@pos=10` / `over self-slot pos=9`, 202 gap lines against 89 self-slot
# lines in six drags): opening the gap widens the extent the next division reads,
# the same coordinate then falls one slot left, and withdrawing the gap puts the
# boundary back. The shell's own dash cannot do this because it subtracts the
# placeholder's width before dividing (dash.js:879-885).
cat > "$T2/e13.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { precondition: false };
    const wait = (ms) => new Promise((resolve) => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { resolve(); return GLib.SOURCE_REMOVE; });
    });
    try {
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj?._dockManager;
        const im = dm?._iconManager;
        const dnd = dm?._dockDnd;
        const c = im?._container;
        const icons = c ? c.get_children().filter(k => k._appData?.appId) : [];
        out.precondition = !!c && !!dnd && icons.length >= 4;
        if (!out.precondition) {
            GLib.file_set_contents('%T2%/gapslot.json', JSON.stringify(out));
            return;
        }
        dnd._enabled = true;
        dnd._finishDrag();
        await wait(320);
        const vertical = dnd._isVertical();
        const closed = dnd._slotChildren();
        const span = (list) => Math.round(list[list.length - 1].start +
            list[list.length - 1].size - list[0].start);
        const k = 3;
        const mid = Math.round(closed[k].start + closed[k].size / 2);
        out.n = closed.length;
        out.extentClosed = span(closed);
        out.mid = mid;
        out.spacing = c.get_layout_manager().spacing;
        const src = { appId: icons[0]._appData.appId };
        const ask = (x) => {
            dnd._placeholderPos = -1;
            dnd._lastVerdict = null;
            dnd._handleDragOver(src, vertical ? 0 : x, vertical ? x : 0);
            return dnd._placeholderPos;
        };
        // A live drag never leaves the container at its old length: the gap's own
        // `notify::width` calls `im.notifyRowChanged()`, which re-runs
        // `_updatePosition()` and re-allocates every child. Without that, the row
        // this probe measures is the resting one and the feedback is invisible.
        const relayout = async () => {
            im.notifyRowChanged();
            dm._updatePosition();
            await wait(320);
        };
        // The invariant, stated as the pointer experiences it: a pointer that does
        // not move must not make the gap walk. dnd.js calls `handleDragOver` again
        // on the next motion event with the same coordinates and no reset, so that
        // is exactly what is replayed -- first from a closed row, then from the row
        // the first answer just opened. One flip is enough: near the right end of a
        // long row the flip band is tens of pixels, which is where a hand rests.
        out.flips = [];
        out.gateHeld = 0;
        for (let k = 0; k < closed.length; k++) {
            for (const frac of [0.2, 0.5, 0.8]) {
                const x = Math.round(closed[k].start + frac * closed[k].size);
                dnd._finishDrag();
                await relayout();
                dnd._handleDragOver(src, vertical ? 0 : x, vertical ? x : 0);
                await relayout();
                const first = dnd._placeholderPos;
                if (dnd._animatingPlaceholders !== 0) {
                    out.gateHeld++;
                    continue;
                }
                dnd._handleDragOver(src, vertical ? 0 : x, vertical ? x : 0);
                const second = dnd._placeholderPos;
                if (first !== second)
                    out.flips.push({ x, first, second });
            }
        }
        dnd._finishDrag();
        await relayout();
        out.midAsk = ask(mid);
        await relayout();
        out.posFirst = dnd._placeholderPos;
        out.gapFirst = !!dnd._placeholder;
        const open = dnd._slotChildren();
        out.extentOpen = span(open);
        out.gapWidth = dnd._placeholder
            ? Math.round(vertical ? dnd._placeholder.height : dnd._placeholder.width) : 0;
        out.containerLength = Math.round(vertical ? c.height : c.width);
        out.openCount = open.length;
        out.tableClosed = closed.map(a => `${Math.round(a.start)}+${Math.round(a.size)}`);
        out.tableOpen = open.map(a => `${Math.round(a.start)}+${Math.round(a.size)}`);
        out.stable = out.flips.length === 0 && out.gapFirst === true &&
            out.gateHeld === 0 && out.midAsk === out.posFirst;
        // The live journal then climbed a ladder no counter explains: 19 children
        // at login, and 20/21/22/23 after the drags, with the row's painted length
        // frozen at 930 while the computed background grew 61px per extra child --
        // which is one gap's width. So: does a gap cleared while the dock is hidden
        // ever leave the row? The shrink is a 200ms `ease()` whose `onComplete`
        // destroys the actor, and `animating=0` in every drop line says the counter
        // was released -- so either the actor leaves and the ladder came from
        // overlapping clears, or it stays and the counter lies.
        dnd._finishDrag();
        await relayout();
        const nBefore = c.get_children().length;
        dnd._handleDragOver(src, vertical ? 0 : mid, vertical ? mid : 0);
        await relayout();
        out.ladderGapOpen = !!dnd._placeholder;
        out.ladderChildren = c.get_children().length;
        out.nBefore = nBefore;
        c.hide();
        dnd._clearPlaceholder(true);
        await wait(500);
        out.hiddenClearChildren = c.get_children().length;
        out.hiddenClearAnimating = dnd._animatingPlaceholders;
        out.hiddenClearLeak = out.hiddenClearChildren > nBefore;
        c.show();
        dm._updatePosition();
        await wait(120);
        out.afterShowChildren = c.get_children().length;
        out.restingLength = Math.round(vertical ? c.height : c.width);
        out.ladderOk = !out.hiddenClearLeak && out.hiddenClearAnimating === 0 &&
            out.afterShowChildren === nBefore;
        // The owner's reports, in order: dragging onto the icon immediately to the
        // right of the held one showed no gap (the cell answered the line BEFORE
        // it, which is the position the item already has); then the reverse
        // direction showed the same on the left; then the whole "+1 to the right"
        // fix was rejected as worse than the disease. What the owner described and
        // approved is the pointer's own rule -- the nearer line wins -- with one
        // consequence: the held icon still occupies its own slot until the drop
        // lands, so both lines touching it are spent, its two neighbours can only
        // be answered on their outer line, and its own cell draws nothing at all.
        const rowIds = icons.map(k => k._appData.appId);
        // The gesture needs the cell right of the dragged icon to BE the favourite
        // slot right of it. This sandbox ships eight favourites for six icons, so the
        // two spaces do not line up the way the live row's do -- and the tier-2
        // settings backend is in memory, so the probe may pin exactly the six icons it
        // can see, run the gesture, then put the list back.
        const origFavs = global.settings.get_strv('favorite-apps');
        global.settings.set_strv('favorite-apps', rowIds);
        await wait(500);
        const cells2 = dnd._slotChildren();
        const favIds2 = im._favorites;
        out.biasWhy = { slots: cells2.length, favs: favIds2.length,
            aligned: cells2.length === favIds2.length &&
                rowIds.every((id, j) => favIds2.indexOf(id) === j) };
        out.biasPrecondition = out.biasWhy.aligned && cells2.length >= 4;
        // Every (held position, icon, half) the row offers, as a table. The
        // neighbour is not a special case to patch: it is one line of a rule that
        // has to hold everywhere, so the expected answer is written here from the
        // geometry -- the nearest line, spent lines pushed to the neighbour's outer
        // side, nothing on the held icon's own cell. null means draw nothing.
        const nCells = cells2.length;
        const line = (i) => i === 0 ? cells2[0].start
            : i === nCells ? cells2[nCells - 1].start + cells2[nCells - 1].size
            : (cells2[i - 1].start + cells2[i - 1].size + cells2[i].start) / 2;
        const wantGap = (p, k, frac) => {
            const x = cells2[k].start + frac * cells2[k].size;
            let b = 0, best = Infinity;
            for (let i = 0; i <= nCells; i++) {
                const d = Math.abs(x - line(i));
                if (d < best) { best = d; b = i; }
            }
            if (b !== p && b !== p + 1)
                return b;
            if (k === p)
                return null;
            return k < p ? k : Math.min(k + 1, nCells);
        };
        const CASES = [];
        for (let p = 0; p < nCells; p++)
            for (let k = 0; k < nCells; k++)
                for (const frac of [0.2, 0.8])
                    CASES.push([p, k, frac, wantGap(p, k, frac)]);
        const wrong = [];
        for (const [p, k, frac, want] of CASES) {
            dnd._clearPlaceholder(false);
            dm._updatePosition();
            await wait(25);
            const src = { appId: rowIds[p], _dockDnd: dnd };
            const cell = cells2[k];
            const cx = Math.round(cell.start + frac * cell.size);
            dnd._placeholderPos = -1;
            dnd._lastVerdict = null;
            dnd._handleDragOver(src, vertical ? 0 : cx, vertical ? cx : 0);
            const got = dnd._placeholder ? dnd._placeholderPos : null;
            const gotIndex = dnd._placeholder ? c.get_children().indexOf(dnd._placeholder) : null;
            if (got !== want || gotIndex !== want)
                wrong.push(`p${p}k${k}@${frac}want=${want}got=${got}/${gotIndex}`);
        }
        out.uniformCases = CASES.length;
        out.uniformWrong = wrong;
        out.uniformOk = wrong.length === 0 && CASES.length >= 32;
        // The gesture's own two gates (D-134). First: a held icon stops the hover
        // magnification. The scale is forced up before the hold so the ease has
        // something to undo, and the counter proves the poll is back afterwards.
        const mag = dm._magnification;
        const held = icons[Math.min(2, icons.length - 1)];
        held.scale_x = 1.6;
        held.scale_y = 1.6;
        held._dockMagnifyScale = 1.6;
        dnd._onDragBegin(held);
        await wait(260);
        out.magnifyPaused = mag._pauseCount > 0;
        out.magnifyScales = icons.map(k => Math.round(k.scale_x * 100) / 100);
        dnd._finishDrag();
        await wait(80);
        out.magnifyResumed = mag._pauseCount === 0;
        out.magnifyOk = out.magnifyPaused && out.magnifyResumed &&
            out.magnifyScales.every(s => s === 1);
        // Second: when the gap moves, the row must slide instead of teleport.
        // Open at line 3, then aim one icon further -- the crossed icon carries
        // the whole gap-plus-spacing on its translation and eases it away, the
        // icon on the other side of the gap never moves.
        const at = (cell, frac) => Math.round(cells2[cell].start + frac * cells2[cell].size);
        const srcB = { appId: rowIds[0], _dockDnd: dnd };
        const hoverB = (cell, frac) => dnd._handleDragOver(srcB,
            vertical ? 0 : at(cell, frac), vertical ? at(cell, frac) : 0);
        const tAxis = vertical ? "translation_y" : "translation_x";
        dnd._clearPlaceholder(false);
        dm._updatePosition();
        await wait(25);
        hoverB(2, 0.8);
        await wait(320);
        out.slideGapOpen = !!dnd._placeholder;
        const crossed = icons[3];
        const other = icons[1];
        out.slideBefore = Math.round((crossed[tAxis] || 0) * 100) / 100;
        hoverB(3, 0.8);
        out.slideShift = Math.round((crossed[tAxis] || 0) * 100) / 100;
        out.slideOther = Math.round((other[tAxis] || 0) * 100) / 100;
        // The painted offset is the gap plus spacing, in the row's own direction:
        // the crossed icon must be held at its OLD place and slide out of the way,
        // never start a second slot further and slide home. Sign and size.
        const slideSign = vertical || !dnd._isRtl() ? 1 : -1;
        const gapWidth = dnd._placeholder ? dnd._placeholder.width : 0;
        out.slideExpect = Math.round((gapWidth + out.spacing) * slideSign * 100) / 100;
        await wait(320);
        out.slideSettled = Math.round((crossed[tAxis] || 0) * 100) / 100;
        out.slideOk = out.slideGapOpen &&
            Math.abs(out.slideBefore) < 0.01 &&
            Math.abs(out.slideShift - out.slideExpect) < 0.5 &&
            Math.abs(out.slideOther) < 0.01 &&
            Math.abs(out.slideSettled) < 0.5;
        dnd._clearPlaceholder(false);
        dm._updatePosition();
        await wait(25);
        global.settings.set_strv('favorite-apps', origFavs);
        dnd._finishDrag();
        await wait(320);
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/gapslot.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e13.js"
EV_FILE "$T2/e13.js" > "$T2/e13.reply" 2>&1
for _ in $(seq 1 15); do [ -s "$T2/gapslot.json" ] && break; sleep 1; done
gapslot_json=$(jq -c 'del(.stable)' "$T2/gapslot.json" 2>/dev/null)
if [ ! -s "$T2/gapslot.json" ]; then
    report $T drag-slot-partition-gap-invariant ENV "gap-slot probe wrote nothing — reply: $(head -c 120 "$T2/e13.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant ENV "dock surface unavailable: $gapslot_json"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.ladderOk' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant FAIL "partition stable, but a gap cleared while the dock was hidden did not leave the row: $(jq -c '{ladderChildren,hiddenClearChildren,hiddenClearAnimating,afterShowChildren}' "$T2/gapslot.json")"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.ladderOk' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.biasPrecondition' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant ENV "the row is not aligned favourites, so cell space and favourite space disagree: $(jq -c '{biasWhy}' "$T2/gapslot.json")"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.ladderOk' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.uniformOk' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant FAIL "the held icon's own slot is not accounted for uniformly ($(jq -r '(.uniformWrong|length)' "$T2/gapslot.json") of $(jq -r '.uniformCases' "$T2/gapslot.json") cases wrong: $(jq -r '.uniformWrong[:6]|join(" ")' "$T2/gapslot.json"))"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.magnifyOk' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant FAIL "the hover magnification is not suspended for the gesture: $(jq -c '{magnifyPaused,magnifyResumed,magnifyScales}' "$T2/gapslot.json")"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ] && [ "$(jq -r '.slideOk' "$T2/gapslot.json")" != true ]; then
    report $T drag-slot-partition-gap-invariant FAIL "the row does not slide when the gap moves: $(jq -c '{slideGapOpen,slideBefore,slideShift,slideExpect,slideOther,slideSettled}' "$T2/gapslot.json")"
elif [ "$(jq -r '.stable' "$T2/gapslot.json")" = true ]; then
    report $T drag-slot-partition-gap-invariant PASS "every held position x every icon x both halves answers the table, the gap's own geometry included, a gap cleared while hidden leaves the row, the hover scale is suspended for the gesture and the row slides rather than jumping: $(jq -c '{extentClosed,extentOpen,hiddenClearChildren,afterShowChildren,uniformCases,slideShift,magnifyPaused}' "$T2/gapslot.json")"
else
    report $T drag-slot-partition-gap-invariant FAIL "opening the gap moved the partition under the pointer ($(jq -r '.flips|length' "$T2/gapslot.json") flips, first $(jq -c '.flips[0]' "$T2/gapslot.json")): $gapslot_json"
fi

# H26 ------------------------------------------------------------------------
# A reorder-only incremental sync must invalidate the genie icon-rect cache.
# Adds/removes have their own notifications; reordering existing favourite actors
# is the one path that otherwise only logs `reorder:yes`. Exercise the real
# callback chain, then prove a steady-state second sync emits nothing.
cat > "$T2/e14.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { ok: false, precondition: false };
    const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj?._dockManager;
    const im = dm?._iconManager;
    const genie = dm?._genie;
    const c = im?._container;
    const favActors = im?._favorites?.map(id => im._icons.get(id)).filter(Boolean) ?? [];
    out.precondition = !!c && favActors.length >= 2 &&
        typeof im?._onIconsChanged === 'function' &&
        typeof genie?.onLayoutChanged === 'function';
    if (!out.precondition) {
        GLib.file_set_contents('%T2%/reorder.json', JSON.stringify(out));
        return;
    }
    const saved = {
        defer: im._deferForDrag,
        syncFavorites: im._syncFavorites,
        windowChange: im._doWindowChange,
        iconsChanged: im._onIconsChanged,
        layoutChanged: genie.onLayoutChanged,
    };
    const first = favActors[0], second = favActors[1];
    let notifications = 0, invalidations = 0;
    try {
        // Establish the canonical order before deliberately reversing the first
        // two favourites. No app, favourite or running-set membership changes.
        im._enforceOrder();
        saved.iconsChanged();
        c.set_child_at_index(first, c.get_children().indexOf(second));
        out.mismatchCreated = c.get_children().indexOf(first) >
            c.get_children().indexOf(second);
        im._deferForDrag = () => false;
        im._syncFavorites = () => ({ added: 0, removed: 0 });
        im._doWindowChange = () => ({ added: 0, removed: 0 });
        im._onIconsChanged = () => {
            notifications++;
            saved.iconsChanged();
        };
        genie.onLayoutChanged = function () {
            invalidations++;
            return saved.layoutChanged.call(this);
        };
        im._doSync('reorder-only-probe');
        out.reorderNotifications = notifications;
        out.reorderInvalidations = invalidations;
        out.orderRestored = c.get_children().indexOf(first) <
            c.get_children().indexOf(second);
        notifications = 0;
        invalidations = 0;
        im._doSync('reorder-steady-probe');
        out.steadyNotifications = notifications;
        out.steadyInvalidations = invalidations;
        out.ok = out.mismatchCreated && out.orderRestored &&
            out.reorderNotifications === 1 && out.reorderInvalidations === 1 &&
            out.steadyNotifications === 0 && out.steadyInvalidations === 0;
    } catch (e) {
        out.error = e.message;
    } finally {
        im._enforceOrder();
        im._deferForDrag = saved.defer;
        im._syncFavorites = saved.syncFavorites;
        im._doWindowChange = saved.windowChange;
        im._onIconsChanged = saved.iconsChanged;
        genie.onLayoutChanged = saved.layoutChanged;
        saved.iconsChanged();
    }
    GLib.file_set_contents('%T2%/reorder.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e14.js"
EV_FILE "$T2/e14.js" > "$T2/e14.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/reorder.json" ] && break; sleep 1; done
reorder_json=$(jq -c 'del(.ok)' "$T2/reorder.json" 2>/dev/null)
if [ ! -s "$T2/reorder.json" ]; then
    report $T genie-reorder-invalidation ENV "reorder probe wrote nothing — reply: $(head -c 120 "$T2/e14.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/reorder.json")" != true ]; then
    report $T genie-reorder-invalidation ENV "reorder surface unavailable: $reorder_json"
elif [ "$(jq -r '.ok' "$T2/reorder.json")" = true ]; then
    report $T genie-reorder-invalidation PASS "reorder-only sync invalidated genie rects exactly once; steady sync stayed silent"
else
    report $T genie-reorder-invalidation FAIL "reorder-only notification chain is not exactly-once: $reorder_json"
fi

# H23 ------------------------------------------------------------------------
# Teardown of the chrome registration is an assertion, not a formality. The
# container's own `destroy` handler nulls `_container`, and `stop()` decides
# whether to call `removeChrome` by testing that very field — so if the shell
# destroys the actor first (the case the handler was written for, see the journal
# evidence quoted at dockManager.js:71-73), the untrack never happens and
# `Main.layoutManager._trackedActors` keeps an entry pointing at a disposed
# actor. `_findActor()` linear-scans that array on every layout query, so the
# entry is paid for repeatedly for the rest of the session, and a disable→enable
# cycle in one session adds another.
#
# The probe destroys the container deliberately, runs disable(), then asks the
# registry whether our actor is still in it. It also records what calling
# `removeChrome` on an already-destroyed actor does, because that is exactly what
# the fix has to do — the answer decides whether the fix is safe, not just tidy.
cat > "$T2/e6.js" <<'JS'
(async () => {
    const GLib = imports.gi.GLib;
    const Main = await import('resource:///org/gnome/shell/ui/main.js');
    const out = { ok: false, precondition: false };
    try {
        const lm = Main.layoutManager;
        const dm = Main.extensionManager.lookup('macos-dock@local')?.stateObj
            ?._dockManager;
        const mine = dm?._container;
        const registry = lm._trackedActors;
        out.hasRegistry = Array.isArray(registry);
        out.hasContainer = !!mine;
        if (!out.hasRegistry || !out.hasContainer) {
            GLib.file_set_contents('%T2%/chrome.json', JSON.stringify(out));
            return;
        }
        const isMine = () => registry.some(d => d.actor === mine);
        out.precondition = true;
        out.wasTracked = isMine();
        out.nBefore = registry.length;
        // Simulate the shell destroying our actor out from under the extension.
        mine.destroy();
        out.destroyNulledContainer = dm._container === null;
        // The path under test.
        Main.extensionManager.lookup('macos-dock@local').stateObj.disable();
        out.stillTrackedAfterDisable = isMine();
        out.nAfter = registry.length;
        // What the fix will have to do: untrack a disposed actor.
        if (out.stillTrackedAfterDisable) {
            try {
                lm.removeChrome(mine);
                out.manualRemoveThrew = null;
            } catch (e) {
                out.manualRemoveThrew = e.message;
            }
            out.stillTrackedAfterManual = isMine();
        }
        out.ok = out.wasTracked === true && out.stillTrackedAfterDisable === false;
    } catch (e) {
        out.error = e.message;
    }
    GLib.file_set_contents('%T2%/chrome.json', JSON.stringify(out));
})();
JS
sed -i "s|%T2%|$T2|g" "$T2/e6.js"
EV_FILE "$T2/e6.js" > "$T2/e6.reply" 2>&1
for _ in $(seq 1 10); do [ -s "$T2/chrome.json" ] && break; sleep 1; done
chrome_json=$(jq -c 'del(.ok)' "$T2/chrome.json" 2>/dev/null)
if [ ! -s "$T2/chrome.json" ]; then
    report $T chrome-untracked ENV "chrome probe wrote nothing — reply: $(head -c 120 "$T2/e6.reply" 2>/dev/null)"
elif [ "$(jq -r '.precondition' "$T2/chrome.json")" != true ]; then
    report $T chrome-untracked ENV "registry or container unavailable: $chrome_json"
elif [ "$(jq -r '.ok' "$T2/chrome.json")" = true ]; then
    report $T chrome-untracked PASS "destroyed container is untracked by disable() (registry $chrome_json)"
else
    report $T chrome-untracked FAIL "disposed actor still in _trackedActors after disable(): $chrome_json"
fi

# H24 ------------------------------------------------------------------------
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
