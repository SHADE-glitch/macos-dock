<p align="right"><a href="README.md"><b>English</b></a> | <a href="README.zh-CN.md">简体中文</a></p>

# MacOS Dock — Local Maintenance Fork

A macOS-style dock for GNOME Shell with magnification, animations, dodge, keyboard navigation and a genie minimize/restore animation.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: MIT + GPL-2.0-or-later](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0--or--later-green)
![Based on: MacOSDock + macos-genie](https://img.shields.io/badge/based%20on-MacOSDock%20%2B%20macos--genie-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/macos-dock)

## 📖 About

This repository is a **personal maintenance fork** of [**MacOSDock**](https://github.com/vinnytherobot/MacOSDock) by **vinnytherobot** (also on [extensions.gnome.org](https://extensions.gnome.org/extension/10719/macos-dock/) as #10719), frozen at upstream **v9** and maintained locally under the UUID `macos-dock@local`. It also merges the **macOS Genie** minimize/restore animation by **Thuong Vo (SekiroKenjii)**.

It is **not** affiliated with or endorsed by the upstream authors. The fork keeps the upstream feature set and targets **startup flicker, resource leaks, idle power draw and the separator/visibility logic**, with a conservative, rollback-friendly maintenance style.

## ✨ Features

- **macOS-style dock** with configurable icon size, position, opacity, border radius, blur, background color and icon quality.
- **Magnification** — time-based exponential smoothing (frame-rate independent) with a pointer dead-zone and a configurable falloff.
- **Window previews** on hover, with configurable scale.
- **Dodge / auto-hide** — hide-only-when-focused, a peek edge, a peek hold delay and hide-in-fullscreen.
- **Keyboard navigation** — `Super` + `1` … `0` to launch, focus, switch or minimize the first ten apps, briefly popping the dock up so you can see it.
- **Running indicators**, launch bounce, animation duration and a show threshold.
- **Media controls** via MPRIS, with an optional indicator.
- **Separators** that divide favorites from running non-favorites.
- **Applications button**, running-apps display and a workspace mode setting.
- **Genie minimize/restore** — windows pour into, and stream back out of, their **real dock icon** from any dock edge, merging the macOS Genie animation.

## 🧰 Prerequisites

| Requirement | Details |
|---|---|
| OS | Ubuntu (verified on Ubuntu 26.04) |
| GNOME Shell | 48 – 50 |
| Build tools | `glib-compile-schemas` |

## 📥 Installation

```bash
sudo apt install libglib2.0-bin   # glib-compile-schemas

git clone https://github.com/SHADE-glitch/macos-dock.git ~/.local/share/gnome-shell/extensions/macos-dock@local
cd ~/.local/share/gnome-shell/extensions/macos-dock@local
glib-compile-schemas schemas/
gnome-extensions enable macos-dock@local
```

On Wayland you must log out and back in for GNOME Shell to load the extension.

### Uninstall

```bash
gnome-extensions disable macos-dock@local
rm -rf ~/.local/share/gnome-shell/extensions/macos-dock@local
```

## 🖱️ Usage

Once enabled, the dock appears at the configured screen edge. Hover to magnify and reveal previews; click an icon to launch or focus its app; right-click for the app menu. Use `Super` + digit to launch by position — the dock pops up briefly each time.

## ⚙️ Preferences

Open **GNOME Settings → Extensions → MacOS Dock → Settings** to configure appearance and position, magnification, previews, dodge/auto-hide, keyboard navigation (including the dock pop-up), media controls, running indicators, separators, animation timing and the genie minimize/restore animation.

## 📚 Settings reference

Every key the extension reads, with the default it ships with. The rows are taken from
`schemas/org.gnome.shell.extensions.macosdock.gschema.xml`, and `test/repo.test.js` fails when a key
is added to the schema without a row here. The settings window binds 45 of the 57 keys; the ten
`keynav-app-N` slots are set by the keyboard code (Super+digit steals the shell's own binding), and
`keynav-stock-backup` / `keynav-stock-dirty` are its crash-recovery bookkeeping — no row in the
window for those twelve, by design.

### Dock size, look and position

| Key | Default | What it does |
|---|---|---|
| `icon-size` | `48` | Size of dock icons in pixels (16-96) |
| `dock-opacity` | `60` | Dock background opacity percentage (0-100) |
| `dock-background-color` | `'#1e1e1e'` | Hex color for dock background (e.g. #1e1e1e) |
| `dock-border-radius` | `16` | Corner radius of the dock in pixels |
| `dock-blur-enabled` | `false` | Apply blur effect behind the dock for a frosted glass look |
| `dock-position` | `0` | Position of the dock on screen (0=bottom, 1=left, 2=right, 3=top) |
| `icon-quality` | `2` | Render icons at N times native resolution to prevent blur when magnified (1, 2, or 4) |
| `animation-duration` | `200` | Duration of the show/hide animation in milliseconds (0 = instant, max 1000) |
| `bounce-on-launch` | `true` | Play a bounce animation on the dock icon when a new app is launched |

### Magnification

| Key | Default | What it does |
|---|---|---|
| `magnification-enabled` | `true` | Whether icons grow when the pointer hovers near the dock |
| `magnification-scale` | `1.4` | Maximum scale applied to the icon directly under the cursor (1.0 = no magnification) |
| `magnification-falloff` | `100` | How far (in pixels) the magnification wave reaches from the cursor |
| `magnification-framerate` | `60` | Target framerate for magnification animation in Hz (30, 60, or 120) |

### Indicators and media

| Key | Default | What it does |
|---|---|---|
| `running-indicators` | `true` | Show a small dot under icons of running apps |
| `running-indicator-style` | `0` | 0 = dots per window (macOS style), 1 = horizontal bar |
| `media-indicator` | `true` | Show a music note indicator on the icon of the currently playing media app |
| `media-controls` | `false` | Show play/pause controls in the dock context menu when media is playing |

### Apps, windows and previews

| Key | Default | What it does |
|---|---|---|
| `show-applications-button` | `true` | Show a button to access all installed applications |
| `apps-button-fix-enabled` | `true` | Make the dock's Show Apps button open the app grid from the overview and use the brand icon instead of hiding the overview. Independent of the running-icons fix |
| `show-running-apps` | `true` | Show non-favorite running applications in the dock |
| `dock-workspace-mode` | `0` | Which workspaces show running apps (0=all, 1=current only) |
| `window-previews` | `true` | Show live thumbnail previews of app windows on hover |
| `preview-scale` | `200` | Width of each preview thumbnail in pixels (100-400) |
| `icons-fix-enabled` | `true` | Keep non-favorite running apps in the dock across minimize and workspace switches |
| `overview-patches-enabled` | `true` | Inset the overview window previews to the desktop background and reserve the dock's height in the overview's bottom band. Shell-layout fixes independent of the dock; degrade to the native layout if a shell symbol moves |

### Dodge (auto-hide) and peek

| Key | Default | What it does |
|---|---|---|
| `dodge-enabled` | `true` | Keep the dock visible unless the focused window overlaps it |
| `dodge-only-focused` | `true` | Hide only when the currently focused window overlaps the dock; otherwise any overlapping window hides it |
| `show-threshold` | `25` | Distance in pixels from screen edge to trigger dock show |
| `peek-edge-px` | `5` | Pointer must be within this many pixels of the screen edge to peek the hidden dock |
| `peek-hold-ms` | `80` | Pointer must stay inside the deep zone this long before the hidden dock peeks out |
| `hide-in-fullscreen` | `true` | Force-hide the dock and disable peeking while a true fullscreen window is on the active workspace |

### Super+number keyboard launch

| Key | Default | What it does |
|---|---|---|
| `keynav-enabled` | `true` | Super+1..9 / Super+0 cycles the nth app in the dock: launch if not running, raise if running but unfocused, minimize if focused |
| `keynav-app-1` | `['<Super>1']` | Activate the first app in the dock |
| `keynav-app-2` | `['<Super>2']` | Activate the second app in the dock |
| `keynav-app-3` | `['<Super>3']` | Activate the third app in the dock |
| `keynav-app-4` | `['<Super>4']` | Activate the fourth app in the dock |
| `keynav-app-5` | `['<Super>5']` | Activate the fifth app in the dock |
| `keynav-app-6` | `['<Super>6']` | Activate the sixth app in the dock |
| `keynav-app-7` | `['<Super>7']` | Activate the seventh app in the dock |
| `keynav-app-8` | `['<Super>8']` | Activate the eighth app in the dock |
| `keynav-app-9` | `['<Super>9']` | Activate the ninth app in the dock |
| `keynav-app-10` | `['<Super>0']` | Activate the tenth app in the dock |
| `keynav-peek-dock` | `true` | Briefly reveal a dodge-hidden dock whenever a Super+number shortcut fires, whether it launches, focuses, switches or minimizes |
| `keynav-peek-duration` | `800` | How long the dock stays revealed after a Super+number shortcut |
| `keynav-stock-backup` | `[]` | Internal crash-recovery backup of org.gnome.shell.keybindings switch-to-application-1..9, one newline-joined entry per slot, taken when the dock grabs them. Not user-facing; never shown in preferences. |
| `keynav-stock-dirty` | `false` | True while the dock holds cleared stock keybindings. Lets the next enable() self-heal after a crash between grab and restore. Not user-facing; never shown in preferences. |

### Genie animation

| Key | Default | What it does |
|---|---|---|
| `genie-enabled` | `true` | Play the macOS genie animation when a window minimizes into, or restores out of, its dock icon |
| `genie-mode` | `funnel` | Which animation plays: `funnel` pours the window into the icon, `shrink` scales the real window uniformly toward it under gravity. Anything else falls back to `funnel` |
| `genie-peek-hidden-dock` | `true` | When the dock is hidden by dodge, briefly show it during a minimize/restore so the window can be seen flying to its icon. When off, the animation flies to the dock's screen edge instead |
| `genie-icon-reaction` | `true` | Give the target dock icon a small press-and-rebound as the window lands in it (minimize) or leaves it (restore) |
| `genie-minimize-duration` | `560` | How long the window takes to pour into its dock icon |
| `genie-restore-duration` | `480` | How long the window takes to stream back out of its dock icon |
| `genie-curvature` | `0.85` | 0 = gentle macOS S-curve, 1 = tighter KDE magic-lamp gather |
| `genie-lead-fraction` | `0.58` | Fraction of the animation after which the near edge has reached the icon |
| `genie-trail-fraction` | `0.38` | Fraction of the animation at which the far edge starts to move |
| `genie-absorb-depth` | `0.85` | How deep into the icon the window sinks at the end (fraction of icon depth) |
| `genie-tail-fade` | `0.08` | Final fraction of the animation over which the last sliver fades out |
| `genie-mesh-resolution` | `64` | Upper bound on the number of strips along the funnel; the actual count adapts to the window size (higher = smoother curves) |
| `shrink-minimize-duration` | `320` | Shrink mode: how long the window takes to fall into its icon (ms) |
| `shrink-restore-duration` | `300` | Shrink mode: how long the window takes to grow back out (ms) |
| `shrink-gravity` | `0.6` | Shrink mode: 0 = even speed, higher holds the window back at the start and accelerates it into the icon |
| `shrink-peek-hidden-dock` | `false` | Shrink mode: whether a dodge-hidden dock briefly peeks so the window lands on its real icon. Off means it stays hidden and the window flies to the dock's screen edge |

## 🛠️ Troubleshooting

Every command below was run on this machine before being written down. The one exception is marked:
a command that *changes* something is left for the user, because this extension's own settings and
the running session are not things an agent should mutate unattended (see `AGENTS.md`).

| Symptom | First check | Command |
|---|---|---|
| The dock is not there at all | Is the extension even loaded, and on which state? | `gnome-extensions info macos-dock@local` (state `ERROR` / `OUT_OF_DATE` is printed here) |
| Extension sits in `OUT_OF_DATE`, nothing loads | `metadata.json` lists the shell majors the fork supports; the shell compares only the **major** (`50.1` matches `"50"`). A brand-new major that is not listed means the extension never loads — this is the first row of the upgrade playbook | `grep -A4 shell-version metadata.json` and `gnome-shell --version` |
| Edited a `lib/*.js` file and nothing changed | Expected: `disable`+`enable` re-runs `enable()` on the **cached** module. Only a logout reloads the code | run `npm run test:live` — it refuses to certify a shell older than the tree (`stale_code`) |
| Dock appears very slowly after login, or icons flicker | Both are startup-chain questions with their own log lines: `enable() total Xms`, `reload: N icons in Xms`, `startup grace ended early at Xms`, `[dodge] grace released at Xms` | `journalctl --user -b -o cat _PID=$(bash -c 'source test/common.sh; shell_pid') \| grep -a '[macos-dock-local]'` |
| The dock hides when it should not, or never hides | `dodge-enabled`, `dodge-only-focused`, `hide-in-fullscreen`, and whether the overview is the thing fighting it (the known signature is an `overview -> show` that a hide contradicts within 600 ms with no overview entry in between) | `npm run test:live` reports `overview-flicker` as a count; a healthy boot is 0 |
| The dock does not dodge correctly on a **second monitor** | Edge and poll thresholds are measured against the monitor the dock is on (D-052), and this box has one panel, so it can only be proven in the fabricated layout | `npm run test:headless` — `dock-monitor-geometry` |
| Genie does not animate | Either `genie-enabled` is off, or `_validate()` rejected this shell and it is running with the native animation — that decision is logged, never silent | grep the journal for `[genie] enabled` vs `[genie] disabled — missing/changed private APIs:` |
| Overview previews poke past the desktop, or the bottom band collapses | Both are the shell-layout concern behind `overview-patches-enabled`; a renamed shell symbol degrades to native with one warn line | `npm run test:headless` — `overview-band`, `overview-window-inset`, `overview-patches` |
| Super+number does nothing, or the stock launcher icons broke | `keynav-enabled`, then the crash-recovery flags `keynav-stock-dirty` / `keynav-stock-backup` — a crash between grabbing and restoring those bindings is exactly what they exist to heal | read them: `GSETTINGS_SCHEMA_DIR=$PWD/schemas gsettings get org.gnome.shell.extensions.macosdock keynav-stock-dirty` |
| Icons look soft when magnified | `icon-quality` (1/2/4 supersampling) trades memory for sharpness; `magnification-framerate` trades CPU for smoothness | see the settings reference above |
| Something is configured wrong and you want the defaults back | **User action, not agent action.** This is a recursive reset of the extension's own keys | `dconf reset -f /org/gnome/shell/extensions/macosdock/` |

Nothing on this list needs a reboot. A logout is needed only to load edited JavaScript, and it is
always the user's to perform.

## 🧞 Genie animation

Minimizing or restoring a window plays the macOS genie animation: the window is sliced into strips that pour into — and stream back out of — its **real dock icon** through a curved funnel. The funnel axis follows the dock's screen edge, so a bottom, top, left or right dock all funnel correctly. Both directions run from a single window snapshot, so the live window is parked (scale ≈ 0) for the duration and does not repaint every frame.

The strip count adapts to the window's extent along the funnel axis, capped by the mesh-resolution setting (default 64), so small windows stay cheap and large ones stay smooth. When an app has no visible icon, the engine falls back through live rect → last cached rect → dock-edge centre → primary monitor's dock edge.

When the dock is hidden by dodge it briefly **peeks** for the duration of the animation, so you can see where the window went (can be turned off). While a genie animation runs, magnification is suspended and the dodge poll parks itself once the pointer settles away from the dock. Tool and background windows keep the system's native animation. The genie validates the private Shell APIs it needs at startup and degrades to the native animation, with a log warning, if they are missing.

If you have the standalone `macos-genie@thuongvo.dev` extension installed, **disable it** — this fork provides the same animation, and running both at once would fight over the same windows.

## 🧪 Testing

The two modules that carry no GNOME/GI imports are covered by unit tests that run under plain Node — no `gjs`, no dependencies, no build step:

```
npm test
```

- `lib/genieGeometry.js` → `test/genieGeometry.test.js` (coordinate transforms, easing, the dock-position table, the strip-transform contract)
- `lib/signalManager.js` → `test/signalManager.test.js` (connection bookkeeping: per-source disconnect, error tolerance, idempotent teardown)
- `test/invariants.mjs` → `test/invariants.test.js` (the rules that keep [`INVARIANTS.md`](INVARIANTS.md) a pointer list: every row must name a real `D-###`, a check the harness still reports, and no copied prose)

Checks run in three tiers, because most of this extension cannot be imported outside the shell:

| Tier | Command | Needs a desktop | Changes anything |
|---|---|---|---|
| 1 · static | `npm run test:static` | no | no |
| 2 · headless | `npm run test:headless` | no (private compositor) | no |
| 3 · live | `npm run test:live` | yes | no — reads this boot's journal |
| 3 · live A/B | `npm run test:live-trigger` | yes | settings, restored and proven |

Tier 1 also guards repository invariants that nothing else can see — the genie licence headers, the pure modules staying `gi://`-free, the privacy scan for a public repo, the schema/prefs key coverage, that every schema key is documented in both READMEs, and that `INVARIANTS.md` still points at real entries and live checks. The tiers, the measured numbers behind them and the per-GNOME-release playbook are documented in [`MAINTENANCE.md`](MAINTENANCE.md).

When fixing a bug, add a regression test that fails against the pre-fix code before making it pass.

## 🆚 Changes vs upstream (v9)

This fork adds maintenance commits on top of the upstream v9 baseline (`a2140d0`) and merges the macOS Genie minimize/restore animation. The commit-by-commit history is in the git log; this is the summary.

- **Startup:** fixed post-login whole-row dock flicker (restored the `_started` guard), replaced full rebuilds with incremental syncs, and made the dock reach full opacity at ~T0+250 ms instead of ~T0+1440 ms.
- **Idle power:** removed a constant 60 Hz magnification wake-up and replaced fixed dodge polling with an adaptive interval (120 ms near the edge, 500 ms heartbeat).
- **Leaks & crash guards:** destroyed-actor/container guards across magnification, the dock manager, window-change fades and the icon press-and-rebound; the dodge path no longer forces `opacity = 255`.
- **Separators:** fixed `_enforceOrder` false positives (zero moves at steady state), derived the separator from the *settled* icon set, and aligned removal with the icon fade-out.
- **Keyboard navigation:** added a crash self-healing sentinel for the stock `Super`+digit shortcuts, plus a dock pop-up so a hidden dock is visible during the action.
- **Magnification:** time-based exponential smoothing (same settle time at 60/120/144/240 Hz) and a second re-arm path so a dock revealed under a stationary pointer magnifies immediately.
- **Genie merge:** merged the macOS Genie animation (`lib/genieGeometry.js`, `lib/genieEngine.js`, `lib/genieController.js`) — animates to the real dock icon, honours the configured dock edge, degrades to the native animation when the private Shell APIs are missing, and guarantees an exactly-once completion callback.
- **Genie correctness:** both directions run from a single window snapshot; the funnel axis and the no-icon fallbacks follow `dock-position`; trailing strips dissolve individually; the mesh-resolution setting is an upper bound (default 64) and the strip count adapts to the window's extent.
- **Genie performance:** `layoutStrips` is allocation-free per frame (verified bit-identical, ~2.5× faster); magnification is suspended through a refcounted pause/resume that cannot leak across completion, failure or teardown.
- **Genie / mutter accounting:** `_steal()` now runs before `finishFor()`, removing spurious "Error in minimize/unminimize accounting" logs; `MODAL_DIALOG` joined the animated window types.
- **Accessibility:** minimize/restore durations honour the global slow-down factor through `adjustAnimationTime()`, applied *after* the 100–3000 ms clamp.
- **Correctness:** the window-type check uses `Meta.WindowType` symbols; dodge watches per-window position/size/unmanaged changes and gates fullscreen on mutter's own `Monitor.inFullscreen`.
- **Icon fade-in:** icons added by an incremental sync fade in over 180 ms; whole-table reloads keep a single container-level fade.
- **Indicator refresh:** one window-actor walk per pass instead of one per icon (17 → 1 on a 17-icon dock).

## 🤝 Contributing

Issues and pull requests are welcome. Please keep changes scoped and test them against the GNOME Shell versions listed above.

## 🙏 Credits & Attribution

This extension is a **maintenance fork** of **MacOSDock** by **vinnytherobot**, and **merges** the macOS Genie animation by **Thuong Vo (SekiroKenjii)**. All original design and features are their work.

- **Dock upstream:** [vinnytherobot/MacOSDock](https://github.com/vinnytherobot/MacOSDock) — license **MIT**
- **Dock upstream author:** vinnytherobot
- **GNOME Extensions listing:** [#10719](https://extensions.gnome.org/extension/10719/macos-dock/)
- **Fork baseline:** upstream **v9** (commit `a2140d0`)
- **Genie upstream:** [SekiroKenjii/macos-genie](https://github.com/SekiroKenjii/macos-genie) — license **GPL-2.0-or-later**
- **Genie author:** Thuong Vo (SekiroKenjii)
- **Merge & maintenance:** SHADE-glitch

## ⚖️ License

The dock code is licensed under the **MIT License**; the genie-derived code is licensed under **GPL-2.0-or-later**, and the combined work is distributed under **GPL-2.0-or-later**. See [LICENSE](LICENSE), [LICENSE.GPL-2.0](LICENSE.GPL-2.0) and [LICENSES.md](LICENSES.md).

© vinnytherobot and contributors; genie engine © Thuong Vo (SekiroKenjii); fork modifications and merge © SHADE-glitch.
