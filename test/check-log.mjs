#!/usr/bin/env node
/**
 * check-log.mjs — the recording-coverage check. No dependencies; bare
 * `node test/check-log.mjs` is the real gate (npm is only a name for it).
 * It is deliberately not named *.test.js: `npm test` globs test/*.test.js via node --test.
 * macos-dock@local: 57 code-touching commits since the frozen-upstream baseline a2140d0.
 * The window deliberately starts at the baseline, not at the `freeze-2026-09-23` tag: that tag
 * points at 85eb488, an ordinary fix commit, so anchoring on it would silently drop the whole
 * P1/P2 batch from the record.
 *
 * Checks, all bounded by the window declared in CHANGELOG.md:
 *   0. the record is not empty (a check over an empty set is a fake green)
 *   1. the coverage anchor is declared and resolves
 *   2. D-### ids are unique, strictly increasing, gapless, never reused
 *   3. every commit that touched a code path inside the window is cited, and every cited hash resolves
 *   4. every D-### mentioned in any tracked .md resolves to a real entry
 *   5. every entry carries all five fields and a kind from the allowed set
 *   6. INVARIANTS.md is a pointer list that still points (see test/invariants.mjs)
 *
 * `--invariants` runs only check 6, for a docs-only change where re-walking the
 * whole commit window is noise. The same rules also run inside `npm test`, so this
 * flag is a convenience, not the only way the check ever executes.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { INVARIANTS_FILE, CHANGELOG_ENTRY_RE, changelogEntries, harnessCheckNamesFromSources, validateInvariants } from './invariants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHANGELOG = 'CHANGELOG.md';
const ONLY_INVARIANTS = process.argv.includes('--invariants');
const HARNESS_SCRIPTS = ['test/static-checks.sh', 'test/headless-checks.sh', 'test/live-checks.sh'];

/** Production code paths. stylesheet.css is authored here (not generated), so it is listed. */
const CODE_PATHS = ['extension.js', 'lib/', 'stylesheet.css'];

/** Six kinds. `perf` was added for copyous (resource/throughput work is neither a correctness bug
 *  nor a preference). `chore` is added here because dead-code removal and comment corrections have
 *  no revert obligation *and* no obligation to keep — putting them in perf or taste would
 *  overstate what an upgrade owes them. */
const KINDS = ['fix', 'perf', 'taste', 'guard', 'revert', 'chore'];
const FIELDS = ['Symptom', 'Change', 'Evidence', 'Cost', 'Commit'];

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const problems = [];
const fail = (msg) => problems.push(msg);

function resolveSha(ref) {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  } catch {
    return null;
  }
}

let changelog;
try {
  changelog = readFileSync(path.join(ROOT, CHANGELOG), 'utf8');
} catch {
  console.error(`[check:log] FAIL: ${CHANGELOG} not found in ${ROOT}`);
  process.exit(1);
}

const coverage = changelog.match(/^Coverage:\s*([0-9a-zA-Z^~_/-]+)\.\.\*?HEAD\s*$/m);
if (!coverage) {
  console.error(`[check:log] FAIL: no "Coverage: <anchor>..HEAD" line in ${CHANGELOG}`);
  process.exit(1);
}
const anchor = coverage[1];
const anchorSha = resolveSha(anchor);
if (!anchorSha) fail(`1. coverage anchor does not resolve: ${anchor}`);

const entryRe = CHANGELOG_ENTRY_RE;
const entries = [...changelog.matchAll(entryRe)];
const ids = entries.map((m) => m[1]);

/** Check 6 — the pointer list must still point. Reads only tracked docs and the harness. */
function invariantProblems() {
  const sources = {};
  for (const rel of HARNESS_SCRIPTS) {
    try { sources[rel] = readFileSync(path.join(ROOT, rel), 'utf8'); } catch { /* absent in a trimmed checkout */ }
  }
  let text;
  try {
    text = readFileSync(path.join(ROOT, INVARIANTS_FILE), 'utf8');
  } catch {
    return [`6.0 ${INVARIANTS_FILE} is missing — the pointer list is part of the record`];
  }
  return validateInvariants({
    text,
    entries: changelogEntries(changelog),
    checkNames: harnessCheckNamesFromSources(sources),
    changelog,
  });
}

const invProblems = invariantProblems();
if (ONLY_INVARIANTS) {
  console.log(`[check:log --invariants] ${ids.length} entries, ${invProblems.length ? 'problems' : 'table holds'}`);
  if (invProblems.length) {
    for (const p of invProblems) console.error(`  - ${p}`);
    process.exit(1);
  }
  process.exit(0);
}

if (entries.length === 0) {
  fail('0. the record has no entries — a coverage check over an empty set proves nothing. Widen the window to where real deviations exist, or state in the header that there are none to record.');
}

for (const m of entries) {
  if (!KINDS.includes(m[3])) fail(`5. ${m[1]}: kind "${m[3]}" is not one of ${KINDS.join('/')}`);
  const body = changelog.slice(changelog.indexOf(m[0]) + m[0].length).split(/^### /m)[0];
  for (const field of FIELDS) {
    if (!new RegExp(`^${field}\\s`, 'm').test(body)) fail(`5. ${m[1]}: missing field "${field}"`);
  }
}

const numbers = ids.map((id) => Number(id.slice(2)));
const seen = new Map();
numbers.forEach((n, i) => {
  const id = ids[i];
  if (seen.has(n)) fail(`2. id ${id} reuses number ${n} (already used by ${seen.get(n)})`);
  else seen.set(n, id);
});
for (let i = 1; i < numbers.length; i++) {
  if (numbers[i] <= numbers[i - 1]) fail(`2. ids must increase: ${ids[i]} follows ${ids[i - 1]}`);
}
const top = Math.max(0, ...numbers);
for (let n = 1; n <= top; n++) {
  if (!seen.has(n)) fail(`2. id gap: D-${String(n).padStart(3, '0')} is missing (numbers are never reused, so a gap means an entry was deleted)`);
}

const recorded = new Set();
for (const m of changelog.matchAll(/^Commit\s+(.*)$/gm)) {
  for (const ref of m[1].split(/[\s,]+/).filter(Boolean)) {
    const sha = resolveSha(ref);
    if (!sha) fail(`3. ${CHANGELOG} cites a commit that does not exist: ${ref}`);
    else recorded.add(sha);
  }
}
const uncovered = [];
if (anchorSha) {
  const out = git(['log', '--format=%H%x00%s', `${anchorSha}..HEAD`, '--name-only', '--', ...CODE_PATHS]);
  let sha = null, subject = '', touches = false;
  const flush = () => {
    if (sha && touches && !recorded.has(sha)) uncovered.push(`${sha.slice(0, 7)} ${subject}`);
    touches = false;
  };
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const nul = line.indexOf('\u0000');
    if (nul > 0 && /^[0-9a-f]{40}$/.test(line.slice(0, nul))) {
      flush();
      sha = line.slice(0, nul);
      subject = line.slice(nul + 1);
    } else if (CODE_PATHS.some((p) => line.trim() === p || line.trim().startsWith(p))) {
      touches = true;
    }
  }
  flush();
}
if (uncovered.length) {
  fail(`3. ${uncovered.length} commit(s) touched production code but no entry cites them:`);
  for (const u of uncovered) console.error(`      ${u}`);
}

const tracked = git(['ls-files', '-z', '*.md']).split('\0').filter(Boolean);
for (const file of tracked) {
  if (file === CHANGELOG) continue;
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of text.matchAll(/\bD-(\d{3,})\b/g)) {
    if (!seen.has(Number(m[1]))) fail(`4. ${file} references D-${m[1]}, which has no entry`);
  }
}

const codeCommits = git(['rev-list', '--count', `${anchorSha}..HEAD`, '--', ...CODE_PATHS]);
problems.push(...invProblems);
console.log(`[check:log] window ${anchor}..HEAD over code paths ${CODE_PATHS.join(' ')}: ${codeCommits} commit(s) touched them`);
console.log(`[check:log] ${entries.length} entries, ${recorded.size} distinct commit(s) cited`);
if (problems.length) {
  console.error(`[check:log] FAIL (${problems.length} problem(s)):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('[check:log] PASS');
