#!/usr/bin/bash
# test/static-checks.sh — Tier 1: everything that can be checked without a
# desktop. Safe on any machine, safe in a git checkout with no session, and safe
# to run while the user is working. Typical runtime 3-6 s.
#
#   bash test/static-checks.sh          (standalone)
#   npm run test:static
#
# The value of this tier is concentrated in S3 and S6: a syntax error in a
# GI-bound module is invisible to `npm test` (Node cannot import it) and only
# shows up as "extension ERROR after you log out" — the most expensive failure
# mode available in this repo. A stale gschemas.compiled is the same class: the
# shell reads *it*, not the XML.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/common.sh"

T=1
init_results
BASELINE_FINGERPRINT=$(tree_fingerprint)

# S1 -----------------------------------------------------------------------
missing=""
for c in node npm gjs glib-compile-schemas gsettings dconf journalctl git jq; do
    need_cmd "$c" || missing="$missing $c"
done
if [ -n "$missing" ]; then
    report $T toolchain ENV "absent:$missing — this tier cannot answer anything here"
    exit 77
fi
report $T toolchain PASS "node $(node --version | sed 's/^v//'), gjs $(gjs --version | awk '{print $NF}')"

# S2 -----------------------------------------------------------------------
# Floors, not exact counts: additions are welcome, a *drop* in suite or test
# count means coverage quietly disappeared.
units=$(cd "$REPO" && npm test 2>&1)
# node --test prints `# pass 70` — the value is field 3, not 2.
u_fail=$(printf '%s\n' "$units" | awk '/^# fail/{print $3}')
u_pass=$(printf '%s\n' "$units" | awk '/^# pass/{print $3}')
u_suites=$(printf '%s\n' "$units" | awk '/^# suites/{print $3}')
if ! [[ ${u_fail:-x} =~ ^[0-9]+$ ]]; then
    report $T unit-suites ENV "could not parse node --test output (node $(node --version))"
elif [ "$u_fail" != 0 ]; then
    report $T unit-suites FAIL "$u_fail failing assertion(s) — $(printf '%s\n' "$units" | grep -ac '^not ok') not-ok lines"
elif [ "$u_pass" -lt 104 ] || [ "$u_suites" -lt 26 ]; then
    report $T unit-suites FAIL "coverage dropped to $u_pass/$u_suites (floor 104/26) — a suite stopped being collected"
else
    report $T unit-suites PASS "$u_pass assertions in $u_suites suites, 0 fail"
fi

# S3 -----------------------------------------------------------------------
# `node --check` parses the GI-bound files too: package.json sets type=module, so
# import syntax is valid and no temp copy or rename is needed.
bad_js=""
for f in $(cd "$REPO" && git ls-files '*.js'); do
    (cd "$REPO" && node --check "$f" >/dev/null 2>&1) || bad_js="$bad_js $f"
done
if [ -n "$bad_js" ]; then
    report $T syntax-all-js FAIL "unparsable:$bad_js — this surfaces as extension ERROR after a logout"
else
    report $T syntax-all-js PASS "$(cd "$REPO" && git ls-files '*.js' | wc -l | tr -d ' ') files parse"
fi

# S4 -----------------------------------------------------------------------
bad_sh=""
for f in "$HERE"/*.sh; do
    err=$(bash -n "$f" 2>&1) || bad_sh="$bad_sh $(basename "$f"): $(printf '%s\n' "$err" | head -1)"
done
if [ -n "${bad_sh# }" ]; then
    report $T syntax-harness FAIL "harness does not parse:$bad_sh"
else
    report $T syntax-harness PASS "$(ls "$HERE"/*.sh | wc -l | tr -d ' ') shell files parse"
fi

# S5 -----------------------------------------------------------------------
if (cd "$REPO" && glib-compile-schemas --strict --dry-run schemas/ >/dev/null 2>&1); then
    report $T schema-valid PASS "glib-compile-schemas --strict accepted schemas/"
else
    report $T schema-valid FAIL "schema XML is invalid — the extension cannot load its own settings"
fi

# S6 -----------------------------------------------------------------------
# gschemas.compiled is a tracked binary. If it is byte-reproducible, compare it;
# otherwise fall back to the key set the shell actually reads out of it. Either
# way a mismatch means the running defaults differ from the XML on disk.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/macosdock-s6-XXXXXX")
(cd "$REPO" && glib-compile-schemas --strict --targetdir="$tmp" schemas/ >/dev/null 2>&1)
xml_keys=$(grep -oE '<key[[:space:]]+name="[^"]+"' "$REPO/schemas/org.gnome.shell.extensions.macosdock.gschema.xml" \
    | sed -E 's/.*name="([^"]+)"/\1/' | sort)
live_keys=$(GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings list-keys "$SCHEMA" 2>/dev/null | sort)
fresh_keys=$(GSETTINGS_SCHEMA_DIR="$tmp" gsettings list-keys "$SCHEMA" 2>/dev/null | sort)
rm -rf "$tmp"
if [ "$live_keys" = "$fresh_keys" ] && [ "$live_keys" = "$xml_keys" ]; then
    report $T compiled-fresh PASS "$(printf '%s\n' "$live_keys" | wc -l | tr -d ' ') keys: compiled == XML == what the shell reads"
elif [ "$live_keys" = "$fresh_keys" ]; then
    report $T compiled-fresh PASS "tracked binary already matches a fresh compile (key set)"
else
    report $T compiled-fresh FAIL "schemas/gschemas.compiled is stale — run glib-compile-schemas schemas/ (drift: $(comm -3 <(printf '%s\n' "$live_keys") <(printf '%s\n' "$fresh_keys") | wc -l | tr -d ' ') keys)"
fi

# S7 -----------------------------------------------------------------------
if gjs -c 'true' >/dev/null 2>&1; then
    report $T gjs-smoke PASS "gjs can boot and resolve typelibs — tiers 2 and 3 are meaningful here"
else
    report $T gjs-smoke ENV "gjs -c failed — tiers 2 and 3 cannot run on this box"
fi

# S8 -----------------------------------------------------------------------
# docs/reports/ holds local-only phase evidence that may quote raw journal lines and
# window titles — the exact content this public repository must never carry. The
# enforceable half is not "the directory exists" (it legitimately does not in a
# CI checkout) but: nothing under it is tracked, AND the ignore rule is present.
# The tracked count is tested FIRST because `git check-ignore` answers "not
# ignored" for any path already in the index — once evidence is added, that probe
# stops reporting the rule and the two failures would collapse into one message.
tracked_reports=$( (cd "$REPO" && git ls-files -- docs/reports/) | wc -l | tr -d ' ')
if [ "$tracked_reports" != 0 ]; then
    report $T reports-untracked FAIL "$tracked_reports file(s) under docs/reports/ are tracked — raw evidence in a public repo"
elif ! (cd "$REPO" && git check-ignore -q docs/reports/STATE.md); then
    report $T reports-untracked FAIL "docs/reports/ is not ignored — an unattended git add would publish local evidence"
else
    report $T reports-untracked PASS "ignore rule present, 0 tracked files under docs/reports/"
fi

# S9 -----------------------------------------------------------------------
[ "$(tree_fingerprint)" = "$BASELINE_FINGERPRINT" ] \
    && report $T no-tree-writes PASS "this tier wrote nothing into the repo" \
    || report $T no-tree-writes FAIL "the harness modified or created files in the working tree"

exit_code_from_results
