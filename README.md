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

Minimizing or restoring a window plays the macOS genie animation: the window is sliced into strips that pour into — and stream back out of — its **real dock icon** through a curved funnel. The funnel axis follows the dock's screen edge, so the animation is correct on a bottom, top, left or right dock. The animation targets the pure icon square (excluding the running-indicator strip), snapshots the icon's live magnified position when it starts, and follows a fallback chain when an app has no visible icon (live rect → last cached rect → dock-edge centre → primary monitor's dock edge). **Both directions** run from a single snapshot of the window, so the live window is parked (scale ≈ 0) for the duration and no longer repaints every frame. The funnel keeps its full-bodied belly even when a window sits right on top of its icon, the trailing strips dissolve individually rather than fading the whole container, the easing starts fast and finishes with a quick suck, and the target icon gives a small press-and-rebound as the window lands (its own switch). The strip count adapts to the window's extent along the funnel axis, capped by the mesh-resolution setting (default 64), so small windows stay cheap and large ones stay smooth.

When the dock is hidden by dodge, it briefly **peeks** for the duration of the animation so you can see where the window went; this can be turned off, in which case the window flies to the dock's screen edge while keeping the icon's position along that edge. While a genie animation runs, magnification is suspended and the dock slides along its own axis (bottom/top docks move vertically, left/right docks move horizontally); the dodge poll parks itself once the pointer settles far from the dock and wakes on the next pointer or window event, so an idle dock stops polling. Tool and background windows keep the system's native animation. The genie is only active while the dock is enabled, validates the private Shell APIs it needs at startup, and degrades to the native animation (with a loud log warning) if they are missing.

If you have the standalone `macos-genie@thuongvo.dev` extension installed, **disable it** — this fork now provides the same animation, and running both at once would fight over the same windows.

## Testing

The two modules that carry no GNOME/GI imports are covered by unit tests that run under plain Node — no `gjs`, no dependencies, no build step:

```
npm test
```

- `lib/genieGeometry.js` → `test/genieGeometry.test.js` (coordinate transforms, easing, the dock-position table, the strip-transform contract)
- `lib/signalManager.js` → `test/signalManager.test.js` (connection bookkeeping: per-source disconnect, error tolerance, idempotent teardown)

The GI-bound modules cannot be imported outside the shell, so they are verified live instead. When fixing a bug, add a regression test that fails against the pre-fix code before making it pass.

## Changes vs upstream (v9)

This fork adds maintenance commits on top of the upstream v9 baseline (`a2140d0`), and merges the macOS Genie minimize/restore animation:

- **Startup / flicker:** restored the `_started` guard to stop whole-row dock flicker after login; incremental sync for `installed-changed` and `favorite-apps` to eliminate full-rebuild flicker outside settle; merged the dodge/visibility modules; rolled back an over-broad performance/timing change to tighten scope.
- **Resource leaks & crash guards:** container-destroyed guards for magnification polling and the dock manager; destroyed-actor guard in the window-change fade `onComplete`; dodge `stop()`/`_refreshDodge()` respect the startup fade-in instead of forcing `opacity = 255`; dodge hide logging moved behind the `_hide()` guard.
- **Performance / idle power:** magnification idle stopwatch with restart on approach, removing a constant 60 Hz wake-up; adaptive dodge polling (120 ms near the edge, 500 ms heartbeat).
- **Previews:** the preview popup follows the hovered app switch, reusing the popup for the same app and reviving it during the exit animation.
- **Keyboard navigation:** a **crash self-healing sentinel** for the stock shortcuts — a backup plus dirty flag stored in the extension's own schema.
- **Separators:** fixed `_enforceOrder` false positives by excluding separators/buttons from the index comparison (zero moves at steady state); added separator add/remove instrumentation; aligned separator removal with icon fade-out; conditional early grace end (floor 400 ms + quiet 500 ms, cap 1200 ms).
- **Correctness:** the window-type check now uses `Meta.WindowType` symbols.
- **Genie merge:** merged the macOS Genie minimize/restore animation (`lib/genieGeometry.js`, `lib/genieEngine.js`, `lib/genieController.js`) — animates to the real dock icon, snapshots the live magnified position, follows a live-rect → cached-rect → dock-edge fallback chain, optionally peeks a dodge-hidden dock, validates the private Shell APIs at startup (degrading to the native animation), and guarantees an exactly-once completion callback.
- **Hotkey dock pop-up:** `Super` + number now briefly reveals a hidden dock for every action (launch, focus, switch, minimize), with its own on/off switch and duration; peek requests take the longest pending duration so a hotkey peek is never cut short by a shorter one.
- **Genie correctness & fidelity:** the funnel axis and both no-icon fallbacks now derive from the configured `dock-position`, so a top/left/right dock funnels to the correct edge; **both** minimize and restore run from a single window snapshot (the live window is parked for the duration); the trailing strips dissolve individually instead of fading the whole container; the easing was changed to a fast start with a quick final suck; the mesh-resolution setting is now an **upper bound** (default lowered to 64) and the strip count adapts to the window's extent along the funnel axis; the absorb-depth fallback was aligned with the schema default. The funnel taper still spans at least the window's own height (a window sitting on its icon is not squeezed flat) and the absorb target keeps its minimum sink depth.
- **Genie performance:** `layoutStrips` is allocation-free per frame (verified bit-identical to the previous matrices, ~2.5× faster); magnification is suspended while a genie animation runs, through a refcounted pause/resume that cannot leak a suspension across completion, failure or teardown.
- **Icon reaction:** the target icon gives a subtle press-and-rebound when a window is minimized into it or restored out of it, on its own switch.
- **Icon fade-in:** icons added by an incremental sync (window change, favorites sync) fade in over 180 ms; whole-table reloads and the startup build keep their single container-level fade instead.
- **Magnification smoothing:** replaced the per-tick LERP factor with time-based exponential smoothing, so the settle time is the same at 60/120/144/240 Hz.
- **Dodge idle power:** the dodge poll parks once the pointer settles far from the dock — never while the dock is hidden, since the poll is the peek healer — and wakes on the next pointer or window event.
- **Startup first paint:** the dock is revealed on its first paint instead of after the settle grace, so it reaches full opacity at ~T0+250 ms rather than ~T0+1440 ms; the grace period now ends with an incremental sync rather than a full rebuild, which is what used to flash the whole icon row.
- **Separator stability:** the separator is derived from the *settled* icon set — icons mid fade-out no longer count — so minimizing the last running non-favorite no longer snaps the dock 15 px wider and back. The count also comes from the real icon map instead of re-querying the running set, which could count an app whose id `AppSystem.lookup_app()` cannot resolve (the add path skips those) and raise an orphan separator.
- **Dodge correctness & cost:** per-window `position-changed` / `size-changed` / `unmanaged` watchers, so dragging an *already-focused* window over the dock hides it — a parked poll had no other way to learn about a plain move, since `restacked` does not fire for one and the pointer can sit far from the edge for the whole drag. The fullscreen test now reads mutter's own per-monitor state (`Monitor.inFullscreen`, the same one `ui/layout.js` uses) as an O(1) gate that can only *open* the authoritative scan, never replace its answer; chrome window types are no longer watched at all.
- **Magnification wake paths:** a second re-arm path on the container's `notify::visible`, so a dock revealed under a *stationary* pointer magnifies the icon already under the cursor instead of waiting for the next mouse move.
- **Genie / mutter accounting:** `_steal()` now runs *before* `finishFor()`, and the engine only restores actors it actually parked. Both stop Clutter's implicit-transition removal from emitting `stopped` into the shell's handler, which used to report one effect twice and make mutter log "Error in minimize/unminimize accounting." `MODAL_DIALOG` joined the animated window types to match the shell's own list, so modal dialogs no longer silently fall back to the native animation.
- **Genie axial bunching:** strips are spaced non-uniformly along the funnel axis (`v^gamma`, with gamma ramping in alongside the leading edge and scaled by the curvature knob), so content piles up at the neck instead of the whole window shrinking proportionally — the "pulled through a nozzle" reading. At rest the spacing is exactly uniform, so a stationary window is never distorted, and `curvature = 0` restores the previous behaviour bit for bit.
- **Accessibility:** minimize/restore durations honour the global slow-down factor through the shell's own `adjustAnimationTime()`, applied *after* the 100–3000 ms clamp so the factor can exceed the slider's ceiling.
- **Indicator refresh cost:** one window-actor walk per indicator pass instead of one per icon (17 → 1 on a 17-icon dock), shared through a per-pass scratch that iconFix's fixed two-argument wrapper cannot drop.
- **Disposed-actor guards:** the icon press-and-rebound's liveness check tolerates an already-destroyed wrapper, since pending backstops outlive a full reload by up to `step*3+120` ms.
- **Boot-time dock absence:** a show request arriving while a hide is still animating is now remembered and replayed when that animation ends, instead of being dropped at the guard with nothing left to re-arm it — the drop, compounded by the 500 ms hidden-state heartbeat, kept the dock off-screen for ~810 ms after login and printed 8 identical log lines. The ease `onComplete`, its `catch`, the `dur === 0` early return and the watchdog fallback all honour it; the log moved inside `_show()` and prints only for named callers, so the peek path's own line is unchanged.
- **Startup dodge grace is settle-based now:** the fixed 2 s grace that gated hide decisions was shorter than a real cold boot's autostart burst (journal-confirmed still spawning windows 800 ms after it expired), so the first post-grace evaluation hid the dock on a transient overlap that cleared again 166 ms later. It is now a 2000 ms floor plus a 500 ms window-quiet requirement under a 6000 ms hard cap, mirroring the shape iconManager's grace already used — a quiet session still releases at exactly 2000 ms. It is a gate rather than a one-shot: a later window event re-arms it, and the stamp is taken *before* the evaluation, so the very event that would trigger the hide closes it first. The poll-parking decision shares the same predicate and wakes the poll when the gate re-arms.

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
