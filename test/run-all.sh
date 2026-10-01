#!/usr/bin/bash
# test/run-all.sh — one readable report across the three tiers, with per-tier
# skip semantics and a hard rule that nothing which disturbs the desktop runs
# unless it was asked for by name.
#
#   npm test                                  pure Node suites only (always safe)
#   npm run test:static                       tier 1        (no desktop needed)
#   npm run test:headless                     tier 2        (private throwaway shell)
#   npm run test:live                         tier 3 group A (passive journal reads)
#   bash test/run-all.sh --tier 3 --trigger   tier 3 group B (opens probe windows)
#   npm run test:all                          tiers 1-3, group B NOT included
#
# Exit codes: 0 no FAIL, 1 any FAIL, 77 every check was ENV, 2 usage/prereq.
# ENV means "this machine or session could not answer the question today" and is
# never a pass — see the report-reading section of MAINTENANCE.md.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

TIERS=1
TRIGGER=0
KEEP=0
while [ $# -gt 0 ]; do
    case $1 in
        --tier) TIERS=${2:-1}; shift 2;;
        --trigger) TRIGGER=1; shift;;
        --keep) KEEP=1; shift;;
        -h|--help) sed -n '2,17p' "$0"; exit 0;;
        *) echo "unknown option: $1" >&2; exit 2;;
    esac
done

EVIDENCE=$(mktemp -d "${TMPDIR:-/tmp}/macosdock-checks-XXXXXX")
chmod 700 "$EVIDENCE"
export TEST_RESULTS_FILE="$EVIDENCE/results.txt"
: > "$TEST_RESULTS_FILE"
BASELINE=$(tree_fingerprint)

finish() {
    # Ctrl-C during group B must still put the user's settings back.
    restore_keys
    if [ "$KEEP" = 1 ]; then
        echo "evidence kept in $EVIDENCE"
    else
        rm -f "$JOURNAL_CACHE" 2>/dev/null
        rm -rf "$EVIDENCE"
    fi
}
trap finish EXIT INT TERM

has() { [[ ",$TIERS," == *",$1,"* ]]; }

echo "macos-dock@local checks — repo $REPO"
echo "tiers: $TIERS   trigger: $TRIGGER   evidence: $EVIDENCE"
echo

if has 1; then
    echo "── Tier 1 static ────────────────────────────────────────────"
    bash "$HERE/static-checks.sh" || echo "  (tier 1 exited $?)"
fi
if has 2; then
    echo "── Tier 2 headless ─────────────────────────────────────────"
    bash "$HERE/headless-checks.sh" || echo "  (tier 2 exited $?)"
fi
if has 3; then
    echo "── Tier 3 live ─────────────────────────────────────────────"
    if [ "$TRIGGER" = 1 ]; then
        LIVE_TRIGGER=1 bash "$HERE/live-checks.sh" || echo "  (tier 3 exited $?)"
    else
        echo "  group B skipped — it opens probe windows on the live desktop; add --trigger"
        bash "$HERE/live-checks.sh" || echo "  (tier 3 exited $?)"
    fi
fi

echo
echo "── summary ─────────────────────────────────────────────────"
# `grep -c` already prints 0 when nothing matched, so it must not be paired with
# `|| echo 0` — that produced two lines and broke the arithmetic below.
count() { grep -a -c -- "$1" "$TEST_RESULTS_FILE" 2>/dev/null | head -1; }
for t in 1 2 3; do
    n=$(count "^$t|")
    [ "${n:-0}" = 0 ] && continue
    p=$(count "^$t|.*|PASS|"); f=$(count "^$t|.*|FAIL|"); e=$(count "^$t|.*|ENV|")
    printf 'tier %s: %s checks — %s pass, %s fail, %s env\n' "$t" "$n" "$p" "$f" "$e"
done
if [ "$(count '|FAIL|')" = 0 ]; then
    echo "no regressions detected; any ENV lines above are environment gaps, not passes"
fi

[ "$(tree_fingerprint)" = "$BASELINE" ] \
    || { echo "FAIL: the run left the working tree dirty"; exit 1; }

nf=$(grep -ac '|FAIL|' "$TEST_RESULTS_FILE")
ne=$(grep -ac '|ENV|' "$TEST_RESULTS_FILE")
nt=$(grep -ac '.' "$TEST_RESULTS_FILE")
if [ "$nf" -gt 0 ]; then exit 1; fi
if [ "$nt" -gt 0 ] && [ "$ne" = "$nt" ]; then exit 77; fi
exit 0
