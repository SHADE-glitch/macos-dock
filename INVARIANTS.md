# INVARIANTS

Fixes that have been verified on a real shell and must **not** be reverted. This file is a pointer
list, not a second copy: the mechanism, the measurement and the reasoning live in
[`CHANGELOG.md`](CHANGELOG.md) (`D-###`) and [`MAINTENANCE.md`](MAINTENANCE.md) §11 — Chinese twin in
[`MAINTENANCE.zh-CN.md`](MAINTENANCE.zh-CN.md). If this list and those files disagree, those files
win and this one is stale.

| Id | Rule | Evidence tier | Reverting it costs |
|---|---|---|---|
| D-002 | keep the `_started` guard in the icon reveal chain | L? — predates the tier convention and no check covers it | the whole-dock icon flicker after login comes back |
| D-051 | dodge reconciles overview state from `Main.overview.visibleTarget`, not `visible` | L2, measured 40 → 0 flicker signatures under 300 ms | the dock pops back out during the overview exit animation |
| D-052 | edge and poll thresholds are measured against **the monitor the dock is on** | L1, fabricated stacked two-monitor layout (H13) | dodge silently stops working with the dock on a secondary monitor |
| D-053 | disabling restores the overview dash to the shell's default, never to a value captured at enable | L2 | a snapshot taken mid-layout leaves the overview without its dash after the extension is off |
| D-054 | the overview bottom band is reserved from the dock's occupied height | L1 (`overview-band`) | a dock taller than the theme padding overlaps the window picker / app grid |
| D-059 | one pointer event resolves the dock monitor **once** | L1 (`motion-monitor-resolve`, red at 2 calls) | re-splits the hottest path in the extension back into two GI array conversions |
| D-061 | the grid state comes from the shell's `ControlsState`, never the literal `2` | L1 (`grid-state-source`) | a renumbered enum makes grid detection confidently wrong and silent |
| D-062 | an already-applied patch returns a **real, idempotent** revert | L1 (`patch-revert-idempotent`) | a swallowed revert error strands the patch for the rest of the session |
| D-063 | the magnification tick is single-pass | L1 (`tick-geometry-reads`, 12 → 6 reads/frame) | double allocation traffic on the hover path |
| D-064 | `dash._dashSpacer` stays although it is inert on 50.1 | L0 + untested on 48/49 | deleting it is an unverified behaviour change on a declared-supported major |

Two rules about the list itself:

- **`kind: taste` entries are not invariants.** Genie's funnel feel (`AXIAL_BUNCH`) and the preview
  inset (D-057) are preferences: an upgrade may discard them wholesale. They are recorded in
  `CHANGELOG.md`, not here.
- **Withdrawn items belong to MAINTENANCE §11, not here.** "Do not re-propose" entries (dodge's
  hidden-state heartbeat as a CPU saving, the genie trailing ease-in) are decisions not to change
  something, which is the opposite kind of claim from "never revert this fix".
