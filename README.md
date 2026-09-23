<p align="right"><a href="README.md"><b>English</b></a> | <a href="README.zh-CN.md">简体中文</a></p>

# MacOS Dock — Local Maintenance Fork

A macOS-style dock for GNOME Shell with magnification, animations, dodge and keyboard navigation.

![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-48--50-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Based on: MacOSDock](https://img.shields.io/badge/based%20on-MacOSDock-orange)
[![Repository](https://img.shields.io/badge/repository-GitHub-black?logo=github)](https://github.com/SHADE-glitch/macos-dock)

## About

This repository is a **personal maintenance fork** of [**MacOSDock**](https://github.com/vinnytherobot/MacOSDock) by **vinnytherobot** (also on [extensions.gnome.org](https://extensions.gnome.org/extension/10719/macos-dock/) as #10719), frozen at upstream **v9** and maintained locally under the UUID `macos-dock@local`.

It is **not** affiliated with or endorsed by the upstream author. The fork keeps the upstream feature set and targets **startup flicker, resource leaks, idle power draw and the separator/visibility logic**, with a conservative, rollback-friendly maintenance style.

## Features

- **macOS-style dock** with configurable icon size, position, opacity, border radius, blur, background color and icon quality.
- **Magnification** — LERP-smoothed scaling with a pointer dead-zone and a configurable falloff.
- **Window previews** on hover, with configurable scale.
- **Dodge / auto-hide** — hide-only-when-focused, a peek edge, a peek hold delay and hide-in-fullscreen.
- **Keyboard navigation** — `Super` + `1` … `0` to launch or focus the first ten apps.
- **Running indicators**, launch bounce, animation duration and a show threshold.
- **Media controls** via MPRIS, with an optional indicator.
- **Separators** that divide favorites from running non-favorites.
- **Applications button**, running-apps display and a workspace mode setting.

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

Once enabled, the dock appears at the configured screen edge. Hover to magnify and reveal previews; click an icon to launch or focus its app; right-click for the app menu. Use `Super` + digit to launch by position.

## Preferences

Open **GNOME Settings → Extensions → MacOS Dock → Settings** to configure appearance and position, magnification, previews, dodge/auto-hide, keyboard navigation, media controls, running indicators, separators and animation timing.

## Changes vs upstream (v9)

This fork adds 17 commits on top of the upstream v9 baseline (`a2140d0`):

- **Startup / flicker:** restored the `_started` guard to stop whole-row dock flicker after login; incremental sync for `installed-changed` and `favorite-apps` to eliminate full-rebuild flicker outside settle; merged the dodge/visibility modules; rolled back an over-broad performance/timing change to tighten scope.
- **Resource leaks & crash guards:** container-destroyed guards for magnification polling and the dock manager; destroyed-actor guard in the window-change fade `onComplete`; dodge `stop()`/`_refreshDodge()` respect the startup fade-in instead of forcing `opacity = 255`; dodge hide logging moved behind the `_hide()` guard.
- **Performance / idle power:** magnification idle stopwatch with restart on approach, removing a constant 60 Hz wake-up; adaptive dodge polling (120 ms near the edge, 500 ms heartbeat).
- **Previews:** the preview popup follows the hovered app switch, reusing the popup for the same app and reviving it during the exit animation.
- **Keyboard navigation:** a **crash self-healing sentinel** for the stock shortcuts — a backup plus dirty flag stored in the extension's own schema.
- **Separators:** fixed `_enforceOrder` false positives by excluding separators/buttons from the index comparison (zero moves at steady state); added separator add/remove instrumentation; aligned separator removal with icon fade-out; conditional early grace end (floor 400 ms + quiet 500 ms, cap 1200 ms).
- **Correctness:** the window-type check now uses `Meta.WindowType` symbols.

## Contributing

Issues and pull requests are welcome. Please keep changes scoped and test them against the GNOME Shell versions listed above.

## Credits & Attribution

This extension is a **maintenance fork** of **MacOSDock** by **vinnytherobot**. All original design and features are their work.

- **Upstream:** [vinnytherobot/MacOSDock](https://github.com/vinnytherobot/MacOSDock) — license **MIT**
- **Upstream author:** vinnytherobot
- **GNOME Extensions listing:** [#10719](https://extensions.gnome.org/extension/10719/macos-dock/)
- **Fork baseline:** upstream **v9** (commit `a2140d0`)

## License

Licensed under the **MIT License** — see [LICENSE](LICENSE).

© vinnytherobot and contributors; fork modifications © SHADE-glitch.
