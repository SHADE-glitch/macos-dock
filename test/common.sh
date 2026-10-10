#!/usr/bin/bash
# test/common.sh — shared primitives for the three check tiers.
# Sourced, never executed. Bash 5, jq, python3-free.
#
# Why each piece exists is recorded inline; the short version is that this repo
# has no CI and no way to import the GI-bound modules from Node, so the checks
# run against the *live shell* and read its own log lines as the oracle. That
# makes three hazards load-bearing, and this file is where each one is closed:
#
#   1. Log lines carry private data (dodge's `_dbg`/`hide-trigger` print real
#      window titles). Everything this file exposes is redacted, and only ever
#      timestamps + captured numbers reach a report line.
#   2. `journalctl -b` spans the whole BOOT, not this session, so an unfiltered
#      query can certify code that is not running. `_PID=` is mandatory and the
#      stale-code gate is a first-class function.
#   3. Writing settings is the one way a test can damage the user's session.
#      `set_key` is the only writer, it whitelists this extension's own keys and
#      refuses `keynav-*`, and `restore_keys` + `dconf_verify` prove the tree
#      came back byte-identical.
set -u
# Nothing the harness writes is group- or world-readable: the journal cache holds
# live shell log lines and the dconf snapshots hold this extension's settings, and
# both used to land in /tmp at 0664 (measured — 2 orphaned journal caches from
# runs whose cleanup could not see them, one 9 days old). One `umask` covers the
# whole class instead of a `chmod` at each of the three mktemp sites.
umask 077
export LC_ALL=C

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID='macos-dock@local'
SCHEMA='org.gnome.shell.extensions.macosdock'
DCONF_BASE="/org/gnome/shell/extensions/macosdock/"
# Anchored: a bare `macos-dock` grep matched 847 lines in one run here, because
# a clipboard extension had the fork's name in its history. Never loosen this.
TAG='[macos-dock-local]'
ANCHOR='\[macos-dock-local\]'

RESULTS_FILE="${TEST_RESULTS_FILE:-}"

# A tier run standalone needs its own results file, truncated: reusing a fixed
# path across runs would let yesterday's FAIL decide today's exit code. Under
# run-all.sh the variable is already exported and shared.
init_results() {
    # Only a tier running standalone owns (and therefore may truncate) the file.
    # Truncating a shared one wiped the earlier tiers' rows, which silently made
    # run-all's summary and exit code blind to their failures.
    if [ -z "$RESULTS_FILE" ]; then
        RESULTS_FILE=$(mktemp "${TMPDIR:-/tmp}/macosdock-tier-results-XXXXXX")
        export TEST_RESULTS_FILE="$RESULTS_FILE"
        : > "$RESULTS_FILE"
    fi
    export RESULTS_FILE
}

# Exit code contract shared by every tier and the aggregator.
exit_code_from_results() {
    local nf ne nt
    nf=$(grep -a -c '|FAIL|' "$RESULTS_FILE" 2>/dev/null | head -1)
    ne=$(grep -a -c '|ENV|' "$RESULTS_FILE" 2>/dev/null | head -1)
    nt=$(grep -a -c '.' "$RESULTS_FILE" 2>/dev/null | head -1)
    [ "${nf:-0}" -gt 0 ] && exit 1
    [ "${nt:-0}" -gt 0 ] && [ "${ne:-0}" = "${nt:-0}" ] && exit 77
    exit 0
}
# Respect a path handed down by the runner (`run-all.sh` pins it inside the
# evidence dir it removes on exit). A bare `=""` here clobbered that, so every
# tier process mktemp'd its own cache and the cleanup handler could not see the
# ones made inside a command substitution.
JOURNAL_CACHE="${JOURNAL_CACHE:-}"

# ---- reporting -------------------------------------------------------------

report() { # report <tier> <name> <status:PASS|FAIL|ENV> <reason>
    local line
    printf '%s|%s|%s|%s\n' "$1" "$2" "$3" "$4" >> "$RESULTS_FILE"
    case $3 in
        PASS) line="  ok    $1/$2";;
        FAIL) line="  FAIL  $1/$2";;
        *)    line="  env   $1/$2";;
    esac
    printf '%s — %s\n' "$line" "$4"
    return 0
}

need_cmd() { # need_cmd <binary> — returns 1 when absent; caller reports ENV
    command -v "$1" >/dev/null 2>&1
}

now_ms() { date +%s%3N; }

# Probe STEP stamps are `hh:mm:ss.mmm` in local time; the journal gives epoch ms.
# Same-day only, which is fine because a sample spans ~10 s; unparseable input
# returns non-zero rather than a bogus number.
stamp_to_ms() { date -d "$(date +%Y-%m-%d) $1" +%s%3N 2>/dev/null; }

# Poll an oracle until it appears after a given instant. Refreshes the journal
# cache each turn, because the cache is a snapshot by design.
wait_for() { # wait_for <ERE> <after_ms> <timeout_ms> -> ms of first match
    local re=$1 after=$2 deadline=$(( $(now_ms) + $3 ))
    while [ "$(now_ms)" -lt "$deadline" ]; do
        journal_load
        local hit; hit=$(jfirst "$re" "$after")
        [ -n "$hit" ] && { echo "$hit"; return 0; }
        sleep 0.3
    done
    return 1
}

# The dock's current state, inferred the only way it can be inferred from
# outside: dodge logs every transition, so whichever came last is the truth.
# Needed because a sample that starts with the dock ALREADY hidden never emits a
# fresh `-> hide` line, and treating that as a failed setup is a false ENV.
dock_state() { # dock_state [from_ms] -> hidden | shown | unknown
    local from=${1:-0} h s
    h=$(jlast "$HIDE_RE" 2>/dev/null); s=$(jlast "$SHOW_RE" 2>/dev/null)
    [ -z "$h" ] && [ -z "$s" ] && { echo unknown; return; }
    [ -z "$s" ] && { echo hidden; return; }
    [ -z "$h" ] && { echo shown; return; }
    if [ "$h" -gt "$s" ]; then echo hidden; else echo shown; fi
}

# A tier must not leave anything in the source tree. Comparing a fingerprint
# taken before the run with one taken after is the only version of this check
# that works while new files are legitimately uncommitted.
tree_fingerprint() {
    (cd "$REPO" && git status --porcelain 2>/dev/null | sort | sha256sum | cut -c1-16)
}

# ---- live shell identity ---------------------------------------------------

# There can be more than one gnome-shell process on this box: other agents'
# harnesses run `gnome-shell --headless`, and `pgrep -x gnome-shell` would happily
# return one of those, sending every later assertion to read the journal of a
# compositor that has nothing to do with the live session. Pick the session shell
# by rejecting anything whose command line mentions --headless.
shell_pid() {
    local p
    for p in $(pgrep -x gnome-shell 2>/dev/null); do
        if ! tr '\0' '\n' < "/proc/$p/cmdline" 2>/dev/null | grep -qa -- '--headless'; then
            echo "$p"; return 0
        fi
    done
    return 1
}

newest_js_mtime() {
    # Exactly what the shell imports — no wider. `git ls-files '*.js'` also matched
    # `test/*.test.js` and `test/probe-window.js`, which the shell never loads, so
    # committing a test file would have made this gate certify that the running
    # shell predates an edit it cannot see (a permanent ENV). `prefs.js` is out for
    # the same reason: it runs in the prefs process, and tier 3 asserts about the shell.
    (cd "$REPO" && git ls-files 'extension.js' 'lib/*.js' | xargs -r stat -c %Y | sort -n | tail -1)
}

# `disable`+`enable` does NOT reimport ES modules, so the running shell may well
# predate the file on disk. Any live assertion made in that state certifies code
# that is not running — this gate turns it into ENV with an instruction instead.
stale_code() { # -> 0 when the running shell predates the newest JS edit
    local p newest started
    p=$(shell_pid) || return 1
    newest=$(newest_js_mtime); started=$(stat -c %Y "/proc/$p")
    [ -n "$newest" ] && [ "$newest" -gt "$started" ]
}

shell_start_ms() {
    local p; p=$(shell_pid) || return 1
    # /proc/<pid> ctime-ish mtime is second-granular; btime from the journal is
    # what we actually compare, so take the first tagged line instead.
    journal_load >/dev/null 2>&1
    [ -n "$JOURNAL_CACHE" ] && head -1 "$JOURNAL_CACHE" 2>/dev/null | cut -f1
}

# ---- journal oracle --------------------------------------------------------

# Cache once per refresh: every assertion is then arithmetic on timestamps
# instead of another journalctl invocation, which keeps a B-group run fast and,
# more importantly, makes all assertions in one sample see the same snapshot.
journal_load() {
    local p=${SHELL_PID:-$(shell_pid)}
    [ -n "$p" ] || return 1
    JOURNAL_CACHE="${JOURNAL_CACHE:-$(mktemp "${TMPDIR:-/tmp}/macosdock-journal-XXXXXX")}"
    local tmp="$JOURNAL_CACHE.part"
    journalctl --user -b --no-pager --output=json "_PID=$p" 2>/dev/null |
        jq -r --arg tag "$TAG" '
            ((.MESSAGE // "") | (if type == "array" then join(" ") else . end)) as $m
            | select($m | contains($tag))
            | [ ((.__REALTIME_TIMESTAMP | tonumber | ./1000 | floor)),
                 ($m | gsub("win=\"[^\"]*\""; "win=<redacted>")) ]
            | @tsv' > "$tmp" 2>/dev/null
    mv -f "$tmp" "$JOURNAL_CACHE"
    SHELL_PID=$p
    return 0
}

# The cached file is a *redacted* copy, but titles can ride in other fields, so
# nothing here ever prints a message body: only counts and captured groups.
jcount() { # jcount <ERE> [from_ms] [to_ms]
    local re=$1 from=${2:-0} to=${3:-99999999999999}
    [ -s "$JOURNAL_CACHE" ] || { echo 0; return; }
    awk -F '\t' -v re="$re" -v lo="$from" -v hi="$to" \
        '$1>=lo && $1<=hi && $2 ~ re' "$JOURNAL_CACHE" | wc -l | tr -d ' '
}

jfirst() { # jfirst <ERE> [from_ms] — epoch-ms of the first match, empty if none
    local re=$1 from=${2:-0}
    [ -s "$JOURNAL_CACHE" ] || return 0
    awk -F '\t' -v re="$re" -v lo="$from" '$1>=lo && $2 ~ re {print $1; exit}' "$JOURNAL_CACHE"
}

jlast() {
    local re=$1
    [ -s "$JOURNAL_CACHE" ] || return 0
    awk -F '\t' -v re="$re" '$2 ~ re {t=$1} END {if (t) print t}' "$JOURNAL_CACHE"
}

jfield() { # jfield <ERE to select> <sed -nE script that prints ONLY the capture>
    # Value-only by design. An earlier revision substituted inside the line and
    # printed the remainder, so the report carried whole journal lines — harmless
    # for these particular messages, but the day a line gains a window title that
    # becomes a leak. The script must therefore be `s/…/\1/ p`, never a partial.
    local re=$1 sedx=$2
    [ -s "$JOURNAL_CACHE" ] || return 0
    awk -F '\t' -v re="$re" '$2 ~ re {print $2; exit}' "$JOURNAL_CACHE" | sed -nE "$sedx"
}

# Two shapes are counted, and only one of them can prove anything.
#
# The *race* (what D-051 removed) is dodge re-showing a dock the shell had just
# put away: the tick read a stale transition flag, so the shell immediately
# contradicts it and the dock has to hide again. That is a visible pop-out, and
# its signature is a show followed within one animation-and-tick window by an
# unwitnessed hide — jflicker_count.
#
# The bare `hide -> overview -> show` pair (jpair_count) is NOT that signature.
# A dock hiding for overlap and the overview then genuinely opening produces
# the identical two lines, and nothing in dodge's own logging separates them:
# `_show("overview")` records the decision, not the state that justified it.
# Measured on a healthy 2026-10-10 boot: 2 pairs under 300 ms, both genuine
# entries — one corroborated because the very next `overview -> show` in the
# same session sat behind an `overlay-key`, and all four rapid pairs sat under
# 400 ms with a witness 2-15 ms after the show. So the pair count is reported as
# context only; it must never turn the verdict.
#
# Patterns are hardcoded rather than taken from the caller's regexes so the
# signature cannot drift when someone edits a report. Only ever counted, never
# printed: the lines it scans are our own, but the helper must stay
# shape-compatible with the redacted cache.
jpair_count() { # jpair_count [window_ms=300] -> hide followed by an overview show inside the window
    [ -s "$JOURNAL_CACHE" ] || { echo 0; return; }
    awk -F '\t' -v win="${1:-300}" '
        $2 ~ /\[dodge\] [a-z]+ -> hide/ { h = $1 + 0; next }
        $2 ~ /\[dodge\] overview -> show/ {
            if (h && ($1 + 0) - h >= 0 && ($1 + 0) - h <= win) { c++; h = 0 }
        }
        END { print c + 0 }' "$JOURNAL_CACHE"
}

# An `overview -> show` counts as contradicted when a hide lands within
# window_ms of it and no entry witness fires in between — the witness being the
# overlay-key canary or the dock's own Show Apps press, both of which prove the
# overview really was being opened. Blind spot, stated rather than hidden: an
# entry through the hot corner or a touchpad gesture emits no witness, so a
# gesture entry closed again inside the window would be counted here. Measured
# gesture entries on this boot were followed by hides 6.5-56 s later, far outside
# the window, which is why the window is one animation-and-tick long and not a
# second.
jflicker_count() { # jflicker_count [window_ms=600] -> overview shows contradicted by an unwitnessed hide
    [ -s "$JOURNAL_CACHE" ] || { echo 0; return; }
    awk -F '\t' -v win="${1:-600}" '
        $2 ~ /\[dodge\] overview -> show/ { s = $1 + 0; w = 0; next }
        $2 ~ /\[dodge\] canary overlay-key/ || $2 ~ /\[appsbtn\] toggle action=open-grid/ {
            if (s) w = 1
            next
        }
        $2 ~ /\[dodge\] [a-z]+ -> hide/ {
            if (s && ($1 + 0) - s >= 0 && ($1 + 0) - s <= win && !w) c++
            s = 0
        }
        END { print c + 0 }' "$JOURNAL_CACHE"
}

# A6 of the live tier: untagged mentions of the fork's name. Two numbers, never content: an untagged
# journal line can carry a window title, and reading it here would be exactly the
# leak this harness is supposed to prevent.
#   junanchored        — how many lines say `macos-dock` without the tag. Most are
#                        benign (the shell names the extension in ordinary
#                        messages), so this is only a number for the report.
#   junanchored_errors — of those, how many carry an error verb. Non-zero means the
#                        shell is complaining about our extension in a line our
#                        anchored greps cannot see — a real gap worth failing on.
# TAG is matched as a FIXED STRING on purpose: as a regex the brackets become a
# character class and grep aborts with "Invalid range end".
junanchored() {
    local p=${SHELL_PID:-$(shell_pid)}; [ -n "$p" ] || { echo 0; return; }
    # ANCHOR-EXCEPTION: deliberately loose on the first pass (it must catch every
    # mention), then narrowed to a COUNT by the -aFv tag filter. Prints nothing.
    journalctl --user -b --no-pager --output=json "_PID=$p" 2>/dev/null |
        jq -r '((.MESSAGE // "") | (if type == "array" then join(" ") else . end))' |
        grep -ai 'macos-dock' | grep -aFvc -- "$TAG" || true   # ANCHOR-EXCEPTION: loose first pass, narrowed by the tag filter below; emits a count only
}

junanchored_errors() {
    local p=${SHELL_PID:-$(shell_pid)}; [ -n "$p" ] || { echo 0; return; }
    # ANCHOR-EXCEPTION: same deliberate loose-then-count shape; only a number
    # leaves this function, never a message body.
    journalctl --user -b --no-pager --output=json "_PID=$p" 2>/dev/null |
        jq -r '((.MESSAGE // "") | (if type == "array" then join(" ") else . end))' |
        grep -ai 'macos-dock' | grep -aFv -- "$TAG" |   # ANCHOR-EXCEPTION: loose first pass by design; only a count leaves this pipeline
        grep -aciE 'JS ERROR|TypeError|ReferenceError|Gjs-Message|CRITICAL|failed|error' || true
}

# ---- settings: snapshot, guarded write, restore, proof ---------------------

# Writes land in the REAL dconf database even when XDG_CONFIG_HOME is redirected
# (gsettings/dconf talk to the running dconf-service over D-Bus). That trap once
# silently changed the user's colour scheme, so isolation by environment is not
# an option here — snapshot and verify instead.
dconf_snapshot() { # dconf_snapshot <file>
    dconf dump "$DCONF_BASE" > "$1" 2>/dev/null || : > "$1"
}

declare -a RESTORE_KEYS=()   # entries: "<key>|<original-value-or-EMPTY>"

set_key() { # set_key <key> <true|false> — the only settings writer in the harness
    local key=$1 val=$2
    [[ $key =~ ^[a-z0-9-]+$ ]] || { echo "set_key: bad key name '$key'" >&2; return 2; }
    case $key in
        keynav-*) echo "set_key: REFUSED — keynav-* drives real system keybindings" >&2; return 2;;
        dodge-enabled) echo "set_key: REFUSED — its failure mode leaves the user with a dock that never dodges" >&2; return 2;;
    esac
    [[ $val == true || $val == false ]] || { echo "set_key: only booleans here, got '$val'" >&2; return 2; }
    local cur; cur=$(dconf read "$DCONF_BASE$key" 2>/dev/null)
    # Remember the pre-state exactly once, so a restore inside a retry loop does
    # not mistake this test's own write for the user's original value.
    local i seen=no
    for i in "${!RESTORE_KEYS[@]}"; do
        [[ ${RESTORE_KEYS[$i]} == "$key|"* ]] && seen=yes && break
    done
    [ "$seen" = no ] && RESTORE_KEYS+=("$key|${cur:-EMPTY}")
    GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set "$SCHEMA" "$key" "$val" || return 1
}

restore_keys() {
    local entry key val
    for entry in "${RESTORE_KEYS[@]}"; do
        key=${entry%%|*}; val=${entry#*|}
        if [ "$val" = EMPTY ]; then
            # Originally unset: writing it back as a value would leave the key
            # explicitly set forever, which is config pollution.
            dconf reset "$DCONF_BASE$key" 2>/dev/null
        else
            GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set "$SCHEMA" "$key" "$val" 2>/dev/null
        fi
    done
    RESTORE_KEYS=()
}

dconf_verify() { # dconf_verify <snapshot-file> -> 0 unchanged, 1 drifted
    local snap=$1 cur
    cur=$(mktemp "${TMPDIR:-/tmp}/macosdock-dconf-after-XXXXXX")
    dconf_snapshot "$cur"
    if cmp -s "$snap" "$cur"; then
        rm -f "$cur"; return 0
    fi
    echo "  dconf drift:"; diff "$snap" "$cur" | sed 's/^/    /' >&2
    rm -f "$cur"; return 1
}

cleanup_harness() { # trap handler: restore settings, drop caches
    restore_keys
    [ -n "$JOURNAL_CACHE" ] && rm -f "$JOURNAL_CACHE"
}
