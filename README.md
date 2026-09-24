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
- **Magnification** — LERP-smoothed scaling with a pointer dead-zone and a configurable falloff.
- **Window previews** on hover, with configurable scale.
- **Dodge / auto-hide** — hide-only-when-focused, a peek edge, a peek hold delay and hide-in-fullscreen.
- **Keyboard navigation** — `Super` + `1` … `0` to launch, focus, switch or minimize the first ten apps, briefly popping the dock up so you can see it.
- **Running indicators**, launch bounce, animation duration and a show threshold.
- **Media controls** via MPRIS, with an optional indicator.
- **Separators** that divide favorites from running non-favorites.
- **Applications button**, running-apps display and a workspace mode setting.
- **Genie minimize/restore** — windows pour into, and stream back out of, their **real dock icon**, merging the macOS Genie animation.

## Prerequisites

| Requirement | Details |
|---|---|
| GNOME Shell | 48 – 50 |

## Installation

```bash
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

Minimizing or restoring a window plays the macOS genie animation: the window is sliced into strips that pour into — and stream back out of — its **real dock icon** through a curved funnel. The animation targets the pure icon square (excluding the running-indicator strip), snapshots the icon's live magnified position when it starts, and follows a fallback chain when an app has no visible icon (live rect → last cached rect → dock centre → primary screen bottom-centre). The funnel keeps its full-bodied belly even when a window sits right on top of its icon, and the window sinks deep into the icon before dissolving smoothly.

When the dock is hidden by dodge, it briefly **peeks** for the duration of the animation so you can see where the window went; this can be turned off, in which case the window flies to the primary screen's bottom edge while keeping the icon's horizontal position. Tool and background windows keep the system's native animation. The genie is only active while the dock is enabled, validates the private Shell APIs it needs at startup, and degrades to the native animation (with a loud log warning) if they are missing.

If you have the standalone `macos-genie@thuongvo.dev` extension installed, **disable it** — this fork now provides the same animation, and running both at once would fight over the same windows.

## Changes vs upstream (v9)

This fork adds maintenance commits on top of the upstream v9 baseline (`a2140d0`), and merges the macOS Genie minimize/restore animation:

- **Startup / flicker:** restored the `_started` guard to stop whole-row dock flicker after login; incremental sync for `installed-changed` and `favorite-apps` to eliminate full-rebuild flicker outside settle; merged the dodge/visibility modules; rolled back an over-broad performance/timing change to tighten scope.
- **Resource leaks & crash guards:** container-destroyed guards for magnification polling and the dock manager; destroyed-actor guard in the window-change fade `onComplete`; dodge `stop()`/`_refreshDodge()` respect the startup fade-in instead of forcing `opacity = 255`; dodge hide logging moved behind the `_hide()` guard.
- **Performance / idle power:** magnification idle stopwatch with restart on approach, removing a constant 60 Hz wake-up; adaptive dodge polling (120 ms near the edge, 500 ms heartbeat).
- **Previews:** the preview popup follows the hovered app switch, reusing the popup for the same app and reviving it during the exit animation.
- **Keyboard navigation:** a **crash self-healing sentinel** for the stock shortcuts — a backup plus dirty flag stored in the extension's own schema.
- **Separators:** fixed `_enforceOrder` false positives by excluding separators/buttons from the index comparison (zero moves at steady state); added separator add/remove instrumentation; aligned separator removal with icon fade-out; conditional early grace end (floor 400 ms + quiet 500 ms, cap 1200 ms).
- **Correctness:** the window-type check now uses `Meta.WindowType` symbols.
- **Genie merge:** merged the macOS Genie minimize/restore animation (`lib/genieGeometry.js`, `lib/genieEngine.js`, `lib/genieController.js`) — animates to the real dock icon, snapshots the live magnified position, follows a cached-rect fallback chain, optionally peeks a dodge-hidden dock, validates the private Shell APIs at startup (degrading to the native animation), and guarantees an exactly-once completion callback.
- **Hotkey dock pop-up:** `Super` + number now briefly reveals a hidden dock for every action (launch, focus, switch, minimize), with its own on/off switch and duration; peek requests take the longest pending duration so a hotkey peek is never cut short by a shorter one.
- **Genie polish near the icon:** the funnel taper now spans at least the window's own height, so a window sitting close to (or over) its icon is no longer squeezed flat; the absorb target has a minimum sink depth and a deeper default, and the tail fade uses smoothstep for a gentler dissolve.

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
