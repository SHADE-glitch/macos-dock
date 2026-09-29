<p align="right"><a href="README.md"><b>English</b></a> | <a href="README.zh-CN.md">简体中文</a></p>

# MacOS Dock — Local Maintenance Fork

A macOS-style dock for GNOME Shell with magnification, animations, dodge, keyboard navigation and a genie minimize/restore animation.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: MIT + GPL-2.0-or-later](https://img.shields.io/badge/license-MIT%20%2B%20GPL--2.0--or--later-green)
![Based on: MacOSDock + macos-genie](https://img.shields.io/badge/based%20on-MacOSDock%20%2B%20macos--genie-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/macos-dock)

## About

This repository is a **personal maintenance fork** of [**MacOSDock**](https://github.com/vinnytherobot/MacOSDock) by **vinnytherobot** (also on [extensions.gnome.org](https://extensions.gnome.org/extension/10719/macos-dock/) as #10719), frozen at upstream **v9** and maintained locally under the UUID `macos-dock@local`. It also merges the **macOS Genie** minimize/restore animation by **Thuong Vo (SekiroKenjii)**.

It is **not** affiliated with or endorsed by the upstream authors. The fork keeps the upstream feature set and targets **startup flicker, resource leaks, idle power draw and the separator/visibility logic**, with a conservative, rollback-friendly maintenance style.

## Features

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

## Prerequisites

| Requirement | Details |
|---|---|
| OS | Ubuntu (verified on Ubuntu 26.04) |
| GNOME Shell | 48 – 50 |
| Build tools | `glib-compile-schemas` |

## Installation

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

## Usage

Once enabled, the dock appears at the configured screen edge. Hover to magnify and reveal previews; click an icon to launch or focus its app; right-click for the app menu. Use `Super` + digit to launch by position — the dock pops up briefly each time.

## Preferences

Open **GNOME Settings → Extensions → MacOS Dock → Settings** to configure appearance and position, magnification, previews, dodge/auto-hide, keyboard navigation (including the dock pop-up), media controls, running indicators, separators, animation timing and the genie minimize/restore animation.

## Genie animation

Minimizing or restoring a window plays the macOS genie animation: the window is sliced into strips that pour into — and stream back out of — its **real dock icon** through a curved funnel. The funnel axis follows the dock's screen edge, so a bottom, top, left or right dock all funnel correctly. Both directions run from a single window snapshot, so the live window is parked (scale ≈ 0) for the duration and does not repaint every frame.

The strip count adapts to the window's extent along the funnel axis, capped by the mesh-resolution setting (default 64), so small windows stay cheap and large ones stay smooth. When an app has no visible icon, the engine falls back through live rect → last cached rect → dock-edge centre → primary monitor's dock edge.

When the dock is hidden by dodge it briefly **peeks** for the duration of the animation, so you can see where the window went (can be turned off). While a genie animation runs, magnification is suspended and the dodge poll parks itself once the pointer settles away from the dock. Tool and background windows keep the system's native animation. The genie validates the private Shell APIs it needs at startup and degrades to the native animation, with a log warning, if they are missing.

If you have the standalone `macos-genie@thuongvo.dev` extension installed, **disable it** — this fork provides the same animation, and running both at once would fight over the same windows.

## Testing

The two modules that carry no GNOME/GI imports are covered by unit tests that run under plain Node — no `gjs`, no dependencies, no build step:

```
npm test
```

- `lib/genieGeometry.js` → `test/genieGeometry.test.js` (coordinate transforms, easing, the dock-position table, the strip-transform contract)
- `lib/signalManager.js` → `test/signalManager.test.js` (connection bookkeeping: per-source disconnect, error tolerance, idempotent teardown)

The GI-bound modules cannot be imported outside the shell, so they are verified live instead. When fixing a bug, add a regression test that fails against the pre-fix code before making it pass.

## Changes vs upstream (v9)

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

## Contributing

Issues and pull requests are welcome. Please keep changes scoped and test them against the GNOME Shell versions listed above.

## Credits & Attribution

This extension is a **maintenance fork** of **MacOSDock** by **vinnytherobot**, and **merges** the macOS Genie animation by **Thuong Vo (SekiroKenjii)**. All original design and features are their work.

- **Dock upstream:** [vinnytherobot/MacOSDock](https://github.com/vinnytherobot/MacOSDock) — license **MIT**
- **Dock upstream author:** vinnytherobot
- **GNOME Extensions listing:** [#10719](https://extensions.gnome.org/extension/10719/macos-dock/)
- **Fork baseline:** upstream **v9** (commit `a2140d0`)
- **Genie upstream:** [SekiroKenjii/macos-genie](https://github.com/SekiroKenjii/macos-genie) — license **GPL-2.0-or-later**
- **Genie author:** Thuong Vo (SekiroKenjii)
- **Merge & maintenance:** SHADE-glitch

## License

The dock code is licensed under the **MIT License**; the genie-derived code is licensed under **GPL-2.0-or-later**, and the combined work is distributed under **GPL-2.0-or-later**. See [LICENSE](LICENSE), [LICENSE.GPL-2.0](LICENSE.GPL-2.0) and [LICENSES.md](LICENSES.md).

© vinnytherobot and contributors; genie engine © Thuong Vo (SekiroKenjii); fork modifications and merge © SHADE-glitch.
