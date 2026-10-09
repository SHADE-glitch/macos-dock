#!/usr/bin/env node
/**
 * invariants.mjs — the rules that make INVARIANTS.md a pointer list rather than
 * a second copy of the record. No dependencies; imported by BOTH consumers:
 * `test/check-log.mjs --invariants` (the manual gate) and `test/repo.test.js`
 * (so tier 1 runs it on every `npm run test:static` — a docs-only check that
 * nobody executes is decoration, not a guard).
 *
 * The table's columns are fixed: | Id | Rule | Evidence tier | Reverting it costs |
 * Each rule below is a way this file silently stops meaning anything:
 *   6.0 an empty table is a fake green (same principle as check-log's rule 0)
 *   6.1 a row has four cells and all four say something
 *   6.2 the Id resolves to a real CHANGELOG entry
 *   6.3 ids are unique and strictly increase down the file
 *   6.4 a `taste` entry is not an invariant (the file says so; this proves it)
 *   6.5 the evidence column starts with a tier this repo defines (L0/L1/L2/L?)
 *   6.6 every kebab-case token in backticks in the evidence column is a check
 *       that still exists in the harness — the drift this catches is an
 *       invariant citing a guard that was renamed or deleted
 *   6.7 no row copies a long verbatim run out of CHANGELOG.md (it points, it
 *       does not restate; see AGENTS.md "Docs & Commits")
 */

export const INVARIANTS_FILE = "INVARIANTS.md";
export const TIERS = ["L0", "L1", "L2", "L?"];
const PLACEHOLDERS = ["TODO", "TBD", "FIXME", "待补", "待填", "xxx"];
const RESTATE_LIMIT = 40;

// One definition of what an entry heading looks like, shared with check-log.mjs:
// if the two parsers disagreed after a format change, every row would report
// "no such CHANGELOG entry", which is loud — but a shared regex keeps it honest.
export const CHANGELOG_ENTRY_RE = /^### (D-\d+) · (\d{4}-\d{2}-\d{2}) · ([a-z]+)(?: · .*)?$/gm;
// A backticked token in the evidence column is read as a harness check name. The
// pattern demands two or more dash-separated alphanumeric segments, which is what a
// check name looks like and what `visible`, `ControlsState`, `disable+enable`,
// `test:live-trigger` and `lib/dodge.js` are not. Deliberately permissive about
// case and underscores: a renamed check that slips through quietly is the failure
// this rule exists to catch, and a false red here costs one pair of backticks.
const CHECK_NAME_IN_BACKTICKS = /`([A-Za-z0-9][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+)`/g;

/** @returns {Map<number,{id:string,kind:string,body:string}>} */
export function changelogEntries(text) {
    const out = new Map();
    for (const m of text.matchAll(CHANGELOG_ENTRY_RE)) {
        const body = text.slice(text.indexOf(m[0]) + m[0].length).split(/^### /m)[0];
        out.set(Number(m[1].slice(2)), { id: m[1], kind: m[3], body });
    }
    return out;
}

/** Check names as the harness declares them: `report $T <name> PASS|FAIL|ENV "…"`. */
export function harnessCheckNames(shellSource) {
    const names = new Set();
    for (const m of shellSource.matchAll(/^\s*report\s+\S+\s+([a-z0-9][a-z0-9-]*)\s+(?:PASS|FAIL|ENV)\b/gm))
        names.add(m[1]);
    return names;
}

function parseRows(text) {
    const rows = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|")) continue;
        const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
        if (cells.length === 0 || !/^D-\d{3,}$/.test(cells[0])) continue; // header, separator, prose
        rows.push({ id: cells[0], cells });
    }
    return rows;
}

/** Longest common substring length, on whitespace-collapsed text. */
function lcsLength(a, b) {
    const n = a.length, m = b.length;
    if (!n || !m) return 0;
    let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1), best = 0;
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : 0;
            if (cur[j] > best) best = cur[j];
        }
        [prev, cur] = [cur, prev];
        cur.fill(0);
    }
    return best;
}

const norm = (s) => s.replace(/\s+/g, " ").trim();

/**
 * @param {{text:string, entries:Map, checkNames?:Set|null, changelog?:string}} opts
 * @returns {string[]} problems, empty when the table holds up
 */
export function validateInvariants({ text, entries, checkNames = null, changelog = "" }) {
    const problems = [];
    const rows = parseRows(text);

    if (rows.length === 0)
        return ["6.0 INVARIANTS.md has no rows — an empty pointer list proves nothing. Either list the fixes that must not be reverted or delete the file."];

    let prevNumber = -1;
    for (const { id, cells } of rows) {
        const number = Number(id.slice(2));

        if (cells.length !== 4)
            problems.push(`6.1 ${id}: table row has ${cells.length} cells, expected 4 (Id | Rule | Evidence tier | Reverting it costs)`);
        cells.forEach((cell, i) => {
            if (!cell)
                problems.push(`6.1 ${id}: column ${i + 1} is empty — a blank cell means the row was added and never filled in`);
            else if (PLACEHOLDERS.some(p => cell.toUpperCase().includes(p)))
                problems.push(`6.1 ${id}: column ${i + 1} still carries a placeholder ("${cell}")`);
        });

        if (!entries.has(number))
            problems.push(`6.2 ${id}: no such CHANGELOG entry — an invariant must point at a recorded change, and ids are never reused`);

        if (number === prevNumber)
            problems.push(`6.3 ${id} appears twice in the table`);
        else if (number <= prevNumber)
            problems.push(`6.3 ${id} does not increase: it follows D-${String(prevNumber).padStart(3, "0")}`);
        prevNumber = number;

        const entry = entries.get(number);
        if (entry && entry.kind === "taste")
            problems.push(`6.4 ${id} is kind \`taste\` in CHANGELOG — a preference is not an invariant; an upgrade may discard it wholesale`);

        const tier = cells[2] || "";
        if (cells.length === 4 && !TIERS.some(t => tier.startsWith(t)))
            problems.push(`6.5 ${id}: evidence column must start with one of ${TIERS.join("/")}, found "${tier}"`);

        if (checkNames) {
            for (const m of tier.matchAll(CHECK_NAME_IN_BACKTICKS)) {
                if (!checkNames.has(m[1]))
                    problems.push(`6.6 ${id}: cites \`${m[1]}\` as evidence, but no harness check reports that name any more — the invariant now points at a guard that does not exist`);
            }
        }

        if (entry && changelog) {
            const overlap = lcsLength(norm(cells[1]), norm(changelog));
            if (overlap >= RESTATE_LIMIT)
                problems.push(`6.7 ${id}: rule column copies ${overlap} characters verbatim out of CHANGELOG — this file points, it does not restate`);
        }
    }
    return problems;
}

/** Convenience for both consumers: read the harness scripts and build the check-name set. */
export function harnessCheckNamesFromSources(sources) {
    const merged = new Set();
    for (const text of Object.values(sources))
        for (const name of harnessCheckNames(text)) merged.add(name);
    return merged;
}
