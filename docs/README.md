# docs/

This is the repository's documentation root.

- `reports/` holds this fork's **per-phase maintenance evidence** — `PROFILE.md`, `AUDIT.md`,
  `PLAN.md`, `VERIFY.md`, `STATE.md`, `REVIEW-PACK.md`, probe output and draft notes. Those files
  quote raw journal lines, window titles and resolved temp paths, so they are **local-only**:
  `reports/` is ignored, and nothing under it may ever be tracked.
- This `README.md` is tracked so the directory itself is present in a clean clone. The dimension-A
  layout guard (`test/conventions.test.js`) requires `docs/` at the repository root, and git cannot
  carry an empty directory.

The rules live in the machine-wide standard; `AGENTS.md` carries the pointer to it.
