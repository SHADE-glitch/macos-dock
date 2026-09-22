import Gio from "gi://Gio";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

/**
 * Super+<digit> hotkeys for the companion dock fix.
 *
 * The original MacOS Dock already exposes this exact behaviour in
 * dockManager._onAppClicked (dockManager.js:281): for a given app it
 *   - minimizes the window if it is focused & visible,
 *   - unminimizes+activates if it is minimized,
 *   - activates if it is open but unfocused,
 *   - opens a new window if it is not running.
 * So "Super+N cycles app N th in the dock" is just resolving the Nth APP icon
 * (skipping the separator and the Show Apps button) and calling _onAppClicked.
 * We reuse that battle-tested method instead of reimplementing focus logic.
 *
 * While this module is enabled we also clear the matching stock
 * switch-to-application shortcuts (org.gnome.shell.keybindings) so the system
 * and our dock-ordered hotkeys cannot both fire on one press. On disable we
 * restore whatever values were present when we grabbed them.
 *
 * No original extension files are modified; binding and system-key changes are
 * runtime-only and fully reverted on disable().
 */

const TAG = "[macos-dock-local][keynav]";

// Nth dock app -> stock keybinding name this module takes over while active.
const STOCK_KEY = (i) => `switch-to-application-${i}`; // 1..9

export class HotkeyNavController {
    _settings = null;
    _dm = null;
    _bound = [];
    _settingsConns = [];
    _stockVal = []; // cached stock switch-to-application values (9 entries)
    _overviewAppId = null; // appId the overview was opened for (multi-window pick)
    _overviewConnId = null; // Main.overview 'hiding' signal id

    enable(settings, dm) {
        this._settings = settings;
        this._dm = dm;
        this._bound = [];
        this._stockVal = [];

        this._grabStock();
        for (let i = 1; i <= 10; i++)
            this._bindSlot(i);
        this._watch();
        // Clear the "which app opened the overview" state whenever the overview
        // is dismissed by any means (Esc, clicking a window, clicking away...).
        try {
            if (Main.overview)
                this._overviewConnId = Main.overview.connect("hiding", () => {
                    this._overviewAppId = null;
                });
        } catch (e) {}
        console.log(`${TAG} enabled (10 bindings)`);
        return this;
    }

    disable() {
        if (Main.overview && this._overviewConnId !== null) {
            try { Main.overview.disconnect(this._overviewConnId); } catch (e) {}
            this._overviewConnId = null;
        }
        this._overviewAppId = null;
        for (const id of this._bound) {
            try { Main.wm.removeKeybinding(`keynav-app-${id}`); } catch (e) {}
        }
        this._bound = [];
        for (const c of this._settingsConns) {
            try { this._settings.disconnect(c); } catch (e) {}
        }
        this._settingsConns = [];
        this._restoreStock();
        this._sysKeySettings = null;
        console.log(`${TAG} disabled`);
    }

    _bindSlot(i) {
        try {
            const cb = () => { try { this._cycleAt(i - 1, i); } catch (e) { console.warn(`${TAG} slot ${i} failed:`, e); } };
            Main.wm.addKeybinding(
                `keynav-app-${i}`,
                this._settings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                cb
            );
            this._bound.push(i);
        } catch (e) {
            console.warn(`${TAG} bind slot ${i} failed:`, e);
        }
    }

    // Watch accelerator changes and rebind live.
    _watch() {
        try {
            for (let i = 1; i <= 10; i++) {
                const id = this._settings.connect(`changed::keynav-app-${i}`, () => {
                    try {
                        Main.wm.removeKeybinding(`keynav-app-${i}`);
                        this._bound = this._bound.filter((k) => k !== i);
                        this._bindSlot(i);
                    } catch (e) {}
                });
                this._settingsConns.push(id);
            }
        } catch (e) {}
    }

    // --- stock switch-to-application takeover ---------------------------------
    _grabStock() {
        try {
            const s = new Gio.Settings({ schema_id: "org.gnome.shell.keybindings" });
            this._sysKeySettings = s;
        } catch (e) {
            this._sysKeySettings = null;
            return;
        }
        for (let i = 1; i <= 9; i++) {
            try {
                const v = this._sysKeySettings.get_strv(STOCK_KEY(i));
                this._stockVal.push(v);
                // Prevent double-trigger: our dock-ordered Super+N owns the key.
                if (v.length > 0)
                    this._sysKeySettings.set_strv(STOCK_KEY(i), []);
            } catch (e) {
                this._stockVal.push([]);
            }
        }
    }

    _restoreStock() {
        if (!this._sysKeySettings)
            return;
        for (let i = 1; i <= 9; i++) {
            const cached = this._stockVal[i - 1];
            if (!cached)
                continue;
            try {
                this._sysKeySettings.set_strv(STOCK_KEY(i), cached);
            } catch (e) {}
        }
        this._stockVal = [];
    }

    // --- cycle ---------------------------------------------------------------
    _orderedApps() {
        const im = this._dm?._iconManager;
        if (!im)
            return [];
        const out = [];
        try {
            const appButton = im._appButton;
            for (const actor of im.getIconActors()) {
                if (!actor || actor === appButton)
                    continue;
                const d = actor._appData;
                if (d && d.appId)
                    out.push(d.appId);
            }
        } catch (e) { /* best effort */ }
        return out;
    }

    _cycleAt(idx, slot) {
        const apps = this._orderedApps();
        if (idx >= apps.length) {
            console.log(`${TAG} slot=${slot} out-of-range idx=${idx} len=${apps.length}`);
            return;
        }
        const appId = apps[idx];
        if (!appId)
            return;
        const app = Shell.AppSystem.get_default().lookup_app(appId);
        if (!app) {
            console.warn(`${TAG} slot=${slot} lookup failed appId=${appId}`);
            return;
        }

        // Overview is visible. Activate the app so it is ready when the overview
        // closes, then exit the overview.  This handles every case: the overview
        // we opened ourselves (multi-window pick), the hot-corner overview, or
        // any other entry.
        const overVisible = this._overviewVisible();
        if (overVisible) {
            this._overviewAppId = null;
            const nWin = this._countWindows(app);
            if (nWin === 0)
                app.open_new_window(-1);
            else {
                const firstWin = this._findFirstWindow(app);
                if (firstWin)
                    firstWin.activate(global.get_current_time());
            }
            Main.overview.hide();
            console.log(`${TAG} cycle slot=${slot} action=overview-exit appId=${appId}`);
            return;
        }

        // Not running -> open a new window.
        const nWin = this._countWindows(app);
        if (nWin === 0) {
            app.open_new_window(-1);
            console.log(`${TAG} cycle slot=${slot} action=launch appId=${appId}`);
            return;
        }

        const firstWin = this._findFirstWindow(app);
        if (firstWin && firstWin.has_focus() && !firstWin.minimized) {
            if (nWin > 1) {
                // Multi-window + focused -> activate the next window of the same
                // app (rather than opening the overview for window-picking).
                const nextWin = this._findNextWindow(app, firstWin);
                if (nextWin)
                    nextWin.activate(global.get_current_time());
                console.log(`${TAG} cycle slot=${slot} action=switch-next appId=${appId}`);
                return;
            }
            // Single focused visible window -> minimize.
            firstWin.minimize();
            console.log(`${TAG} cycle slot=${slot} action=minimize appId=${appId}`);
            return;
        }

        // Reuse the dock's own raise flow for everything else (minimized or
        // simply unfocused) for consistency with a real icon click.
        if (typeof this._dm._onAppClicked === "function")
            this._dm._onAppClicked(app);
        let action = this._findFirstWindow(app)?.minimized ? "raise" : "focus";
        console.log(`${TAG} cycle slot=${slot} idx=${idx} action=${action} appId=${appId}`);
    }

    _overviewVisible() {
        try {
            return Main.overview?.visible === true;
        } catch (e) { /* ignore */ }
        return false;
    }

    _countWindows(app) {
        let n = 0;
        try {
            const tracker = Shell.WindowTracker.get_default();
            for (const wa of global.get_window_actors()) {
                const metaWin = wa ? wa.get_meta_window() : null;
                if (metaWin && tracker.get_window_app(metaWin) === app)
                    n++;
            }
        } catch (e) { /* ignore */ }
        return n;
    }

    _findFirstWindow(app) {
        try {
            const tracker = Shell.WindowTracker.get_default();
            for (const wa of global.get_window_actors()) {
                const metaWin = wa.get_meta_window();
                if (!metaWin)
                    continue;
                if (tracker.get_window_app(metaWin) === app)
                    return metaWin;
            }
        } catch (e) {}
        return null;
    }

    // Find the next window of the same app after `skip` in the window stack.
    // Returns null if there is none.
    _findNextWindow(app, skip) {
        try {
            const tracker = Shell.WindowTracker.get_default();
            let seenSkip = false;
            for (const wa of global.get_window_actors()) {
                const metaWin = wa.get_meta_window();
                if (!metaWin || tracker.get_window_app(metaWin) !== app)
                    continue;
                if (metaWin === skip) {
                    seenSkip = true;
                    continue;
                }
                if (seenSkip)
                    return metaWin;
            }
            // Wrapped around: if we only saw `skip` and it was last, fall back to
            // the first window (which would not be `skip` given nWin > 1).
            if (seenSkip) {
                for (const wa of global.get_window_actors()) {
                    const metaWin = wa.get_meta_window();
                    if (!metaWin || metaWin === skip)
                        continue;
                    if (tracker.get_window_app(metaWin) === app)
                        return metaWin;
                }
            }
        } catch (e) {}
        return null;
    }
}