import Meta from "gi://Meta";
import Shell from "gi://Shell";
import GLib from "gi://GLib";

/**
 * Non-invasive fix for: non-favorite running apps disappear after
 * minimize / workspace switch ("偶尔出现，切换就消失").
 *
 * Root cause in original lib/iconManager.js:
 *   _getRunningApps() drops windows with !showing_on_its_workspace(),
 *   which is false for minimized windows, so a minimized app is treated
 *   as "no longer running" and its icon is removed in _doWindowChange().
 *   But restore/minimize/workspace-switch emits no window-created, so the
 *   icon is never re-added (only focus-app -> _refreshAllIndicators runs).
 *   Extra signals (app-state-changed / restacked / workspace-switched /
 *   focus-window) are missing.
 *
 * This module patches a live IconManager *instance* (no file modification):
 *   - replaces _getRunningApps with a version that keeps minimized windows
 *     and falls back to wm_class/gtk-id when tracker returns null
 *   - adds the missing signal connections so _onWindowChange runs on
 *     minimize/restore/workspace-switch/focus changes
 */

const TAG = "[macos-dock-local][icons]";

function _isSkippableWindow(metaWin) {
    try {
        if (typeof metaWin.is_skip_taskbar === "function" && metaWin.is_skip_taskbar())
            return true;
    } catch (e) { /* ignore */ }
    try {
        // Skip desktop/dock and other non-app chrome. Keep NORMAL/DIALOG.
        const t = metaWin.get_window_type();
        // Meta.WindowType (mutter enum): DESKTOP=1, DOCK=2, NOTIFICATION=11,
        // COMBO=12. Exactly these four are skipped — pre-existing behavior
        // preserved verbatim (SPLASHSCREEN=6, menus, tooltips etc. are kept
        // so running-app icons persist). Symbolic names instead of the old
        // raw integers whose comment had drifted from the code.
        if (t === Meta.WindowType.DESKTOP || t === Meta.WindowType.DOCK ||
            t === Meta.WindowType.NOTIFICATION || t === Meta.WindowType.COMBO)
            return true;
    } catch (e) { /* ignore */ }
    return false;
}

function _resolveAppFallback(metaWin) {
    const appSystem = Shell.AppSystem.get_default();
    try {
        let gtkId = null;
        try {
            if (typeof metaWin.get_gtk_application_id === "function")
                gtkId = metaWin.get_gtk_application_id();
        } catch (e) { /* ignore */ }
        if (gtkId) {
            let app = null;
            try { app = appSystem.lookup_app(`${gtkId}.desktop`); } catch (e) {}
            if (!app) {
                try { app = appSystem.lookup_app(gtkId); } catch (e) {}
            }
            if (app)
                return app;
        }
    } catch (e) { /* ignore */ }
    try {
        let wmClass = null;
        try {
            if (typeof metaWin.get_wm_class_instance === "function")
                wmClass = metaWin.get_wm_class_instance();
            if (!wmClass && typeof metaWin.get_wm_class === "function")
                wmClass = metaWin.get_wm_class();
        } catch (e) { /* ignore */ }
        if (wmClass) {
            const candidates = [
                `${wmClass}.desktop`,
                `${wmClass.toLowerCase()}.desktop`,
            ];
            for (const c of candidates) {
                try {
                    const app = appSystem.lookup_app(c);
                    if (app)
                        return app;
                } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* ignore */ }
    return null;
}

function fixedGetRunningApps() {
    // `this` is the IconManager instance.
    const tracker = Shell.WindowTracker.get_default();
    const seen = new Set();
    const result = [];
    let windowActors = [];
    try {
        windowActors = global.get_window_actors();
    } catch (e) {
        return result;
    }
    let activeWorkspace = null;
    try {
        activeWorkspace = global.workspace_manager.get_active_workspace();
    } catch (e) { /* ignore */ }
    const workspaceMode = this._workspaceMode ?? 0;

    for (const wa of windowActors) {
        let metaWin = null;
        try {
            metaWin = wa.get_meta_window();
        } catch (e) {
            continue;
        }
        if (!metaWin)
            continue;
        if (_isSkippableWindow(metaWin))
            continue;
        // Workspace filter: mode 1 = current workspace only. Mode 0 = all.
        // NOTE: intentionally NOT filtering on showing_on_its_workspace() so
        // minimized windows keep their icons (the original bug).
        if (workspaceMode === 1 && activeWorkspace) {
            try {
                if (metaWin.get_workspace() !== activeWorkspace)
                    continue;
            } catch (e) {
                continue;
            }
        }
        let app = null;
        try {
            app = tracker.get_window_app(metaWin);
        } catch (e) {
            app = null;
        }
        if (!app)
            app = _resolveAppFallback(metaWin);
        if (!app)
            continue;
        let aid = null;
        try {
            aid = app.get_id();
        } catch (e) {
            continue;
        }
        if (!aid || seen.has(aid))
            continue;
        seen.add(aid);
        result.push(app);
    }
    return result;
}

/**
 * Non-invasive pin: keep the Show Apps button as the last child of the dock
 * container ("fixed to the far right").
 *
 * Root cause in original lib/iconManager.js: _addIcon() always appends new
 * running icons via container.add_child(), landing AFTER the Show Apps
 * button (which is only appended once at creation). So every newly launched
 * app pushes the button leftwards.
 *
 * Fix: listen to container 'actor-added' and raise the button back to the
 * end. raise_child() does not add/remove, so no signal recursion; a
 * reentrancy guard covers the remove+add fallback path.
 */
export function applyShowAppsPin(iconManager) {
    const noop = () => {};
    const empty = { revert: noop, ensurePinned: noop };
    if (!iconManager)
        return empty;
    let container = null;
    try {
        container = iconManager._container ?? null;
    } catch (e) {
        return empty;
    }
    if (!container)
        return empty;

    let pinning = false;
    let addedId = null;
    const ensurePinned = () => {
        if (pinning)
            return;
        pinning = true;
        try {
            let liveContainer = null;
            try { liveContainer = iconManager._container ?? null; } catch (e) { liveContainer = null; }
            if (liveContainer && liveContainer !== container) {
                try { if (addedId !== null) container.disconnect(addedId); } catch (e) {}
                container = liveContainer;
                try { addedId = container.connect("actor-added", () => ensurePinned()); } catch (e) { addedId = null; }
            }
            const c = liveContainer ?? container;
            if (!c)
                return;
            const btn = iconManager._appButton ?? null;
            if (!btn)
                return;
            try { if (btn.get_parent && btn.get_parent() !== c) return; } catch (e) {}
            const n = c.get_n_children();
            if (n > 0 && c.get_child_at_index(n - 1) !== btn) {
                try {
                    c.raise_child(btn, null);
                } catch (e) {
                    try { c.remove_child(btn); } catch (_e) {}
                    try { c.add_child(btn); } catch (_e) {}
                }
            }
        } catch (e) {
            /* container gone; stop() will disconnect */
        }
        pinning = false;
    };

    try {
        addedId = container.connect("actor-added", () => ensurePinned());
    } catch (e) {
        addedId = null;
    }
    ensurePinned();
    console.log(`${TAG} show-apps pinned right`);

    const revert = () => {
        try {
            if (addedId !== null)
                container.disconnect(addedId);
        } catch (e) { /* already gone */ }
        console.log(`${TAG} show-apps pin reverted`);
    };
    return { revert, ensurePinned };
}

/**
 * No-shuffle insert: original _addIcon() appends every new running icon via
 * container.add_child(), landing AFTER the Show Apps button for one frame
 * (visible jump when the pin moves the button back). Wrap the live instance
 * method so the new icon is placed directly BEFORE the button in the same
 * tick: the compositor only ever renders the final order, so the icon fades
 * in place instead of sliding. set_child_at_index() only reorders (no
 * add/remove signals), so no recursion with the pin listener.
 */
function applyAddIconOrder(iconManager) {
    const noop = () => {};
    if (!iconManager || typeof iconManager._addIcon !== "function")
        return noop;
    if (iconManager._dockFixAddIconWrapped)
        return noop;
    const origAddIcon = iconManager._addIcon;
    iconManager._dockFixAddIconWrapped = true;
    iconManager._addIcon = function (app) {
        const r = origAddIcon.call(this, app);
        try {
            const c = this._container ?? null;
            const btn = this._appButton ?? null;
            const icons = (this._icons && typeof this._icons.get === "function") ? this._icons : null;
            let appId = null;
            try { appId = app?.get_id?.() ?? null; } catch (e) {}
            const actor = (c && btn && icons && appId) ? (icons.get(appId) ?? null) : null;
            if (c && actor && btn && typeof c.get_children === "function" && typeof c.set_child_at_index === "function") {
                const kids = c.get_children();
                const ai = kids.indexOf(actor);
                const bi = kids.indexOf(btn);
                if (ai >= 0 && bi >= 0 && ai > bi)
                    c.set_child_at_index(actor, bi);
            }
        } catch (e) { /* keep orig behavior on any surprise */ }
        return r;
    };
    console.log(`${TAG} add-icon order wrapped`);
    return () => {
        try {
            if (iconManager._dockFixAddIconWrapped)
                delete iconManager._addIcon;
        } catch (e) {}
        try {
            iconManager._dockFixAddIconWrapped = false;
        } catch (e) {}
        console.log(`${TAG} add-icon order reverted`);
    };
}

export function applyIconFix(iconManager) {    if (!iconManager || iconManager._dockFixIconsApplied)
        return Object.assign(() => {}, { revert: () => {}, ensurePinned: () => {} });

    const origGetRunningApps = iconManager._getRunningApps;
    iconManager._getRunningApps = fixedGetRunningApps;

    // Autologin-safe liveness tracking (no-touch guards).
    // NOTE: probing `actor.visible` on a disposed object itself emits a
    // disposed log, so we never probe. Destroy signals flip flags instead.
    const deadActors = new Set();
    const deadBoxes = new Set();
    let containerAlive = true;
    let trackedContainer = null;
    try {
        trackedContainer = iconManager._container ?? null;
        if (trackedContainer && !trackedContainer._dockFixDestroyId) {
            try {
                trackedContainer._dockFixDestroyId = trackedContainer.connect("destroy", () => {
                    containerAlive = false;
                });
            } catch (_e) {}
        }
    } catch (_e) { trackedContainer = null; }
    const trackActor = (actor) => {
        if (!actor || deadActors.has(actor))
            return;
        try {
            if (!actor._dockFixDestroyId) {
                const id = actor.connect("destroy", () => {
                    try { deadActors.add(actor); } catch (_e) {}
                });
                actor._dockFixDestroyId = id;
            }
        } catch (_e) {
            try { deadActors.add(actor); } catch (_e2) {}
            return;
        }
        try {
            const data = actor._appData ?? null;
            const box = data?.indicatorBox ?? null;
            if (box && !deadBoxes.has(box) && !box._dockFixDestroyId) {
                try {
                    box._dockFixDestroyId = box.connect("destroy", () => {
                        try { deadBoxes.add(box); } catch (_e) {}
                    });
                } catch (_e) {}
            }
        } catch (_e) {}
    };
    try {
        const entries = iconManager._icons?.entries?.() ?? [];
        for (const [, actor] of entries)
            trackActor(actor);
    } catch (_e) {}

    const origRefreshRunningIndicator = iconManager._refreshRunningIndicator;
    const origOnWindowChange = iconManager._onWindowChange;
    const origDoWindowChange = iconManager._doWindowChange;
    const origRefreshAllIndicators = iconManager._refreshAllIndicators;
    const _autologinGuardApplyTime = GLib.get_monotonic_time();

    let pendingWindowChangeId = null;
    const isAutologinGrace = () => {
        try {
            const elapsedMs = (GLib.get_monotonic_time() - _autologinGuardApplyTime) / 1000;
            if (elapsedMs >= 3000)
                return false;
            if (!containerAlive)
                return true;
            try {
                const c = iconManager._container;
                if (!c || c !== trackedContainer)
                    return true;
                if (!c.mapped)
                    return true;
            } catch (_e) { return true; }
            return false;
        } catch (_e) { return false; }
    };
    const queueWindowChange = () => {
        if (pendingWindowChangeId !== null)
            return;
        try {
            pendingWindowChangeId = GLib.timeout_add(GLib.PRIORITY_LOW, 800, () => {
                pendingWindowChangeId = null;
                if (!containerAlive)
                    return GLib.SOURCE_REMOVE;
                if (isAutologinGrace()) {
                    queueWindowChange();
                    return GLib.SOURCE_REMOVE;
                }
                try {
                    if (typeof origOnWindowChange === "function")
                        origOnWindowChange.call(iconManager);
                } catch (_e) {}
                return GLib.SOURCE_REMOVE;
            });
        } catch (_e) { pendingWindowChangeId = null; }
    };

    if (typeof origRefreshRunningIndicator === "function" && !iconManager._dockFixRefreshGuardApplied) {
        iconManager._dockFixRefreshGuardApplied = true;
        iconManager._refreshRunningIndicator = function (actor, appId) {
            try {
                if (!actor || deadActors.has(actor))
                    return;
                try { trackActor(actor); } catch (_e) {}
                if (deadActors.has(actor))
                    return;
                let data = null;
                try {
                    data = this._getStored ? this._getStored(actor) : actor._appData;
                } catch (_e) {
                    try { deadActors.add(actor); } catch (_e2) {}
                    return;
                }
                if (!data)
                    return;
                const box = data.indicatorBox;
                if (!box || deadBoxes.has(box))
                    return;
                if (!containerAlive)
                    return;
            } catch (_e) { return; }
            try {
                return origRefreshRunningIndicator.call(this, actor, appId);
            } catch (e) {
                console.warn(`${TAG} guarded _refreshRunningIndicator suppressed:`, e);
            }
        };
    }
    if (typeof origDoWindowChange === "function" && !iconManager._dockFixDoChangeWrapped) {
        iconManager._dockFixDoChangeWrapped = true;
        iconManager._doWindowChange = function () {
            if (!containerAlive)
                return;
            try {
                // Pre-clean dead icons so orig `actor.ease` never touches them.
                try {
                    for (const [id, actor] of this._icons.entries()) {
                        if (deadActors.has(actor)) {
                            try { this._icons.delete(id); } catch (_e) {}
                            try { this._apps.delete(id); } catch (_e) {}
                        }
                    }
                } catch (_e) {}
                return origDoWindowChange.call(this);
            } catch (e) {
                console.warn(`${TAG} guarded _doWindowChange suppressed:`, e);
            }
        };
    }
    if (typeof origRefreshAllIndicators === "function" && !iconManager._dockFixRefreshAllWrapped) {
        iconManager._dockFixRefreshAllWrapped = true;
        iconManager._refreshAllIndicators = function () {
            if (!containerAlive)
                return;
            try {
                return origRefreshAllIndicators.call(this);
            } catch (e) {
                console.warn(`${TAG} guarded _refreshAllIndicators suppressed:`, e);
            }
        };
    }
    if (typeof origOnWindowChange === "function" && !iconManager._dockFixOnChangeWrapped) {
        iconManager._dockFixOnChangeWrapped = true;
        iconManager._onWindowChange = function () {
            if (!containerAlive)
                return;
            if (isAutologinGrace()) {
                queueWindowChange();
                return;
            }
            try {
                return origOnWindowChange.call(this);
            } catch (e) {
                console.warn(`${TAG} guarded _onWindowChange suppressed:`, e);
            }
        };
    }

    // Extra signal connections missing in the original start().
    // Stored locally so companion disable() can disconnect without
    // touching the original SignalManager.
    const extraConns = [];
    const connectSafe = (obj, signal, cb) => {
        try {
            const id = obj.connect(signal, cb);
            extraConns.push({ obj, id });
        } catch (e) {
            console.warn(`${TAG} connect failed ${signal}:`, e);
        }
    };

    // Extra-signal entries go through the wrapped instance methods above,
    // so original signals and our signals share the same guards (no behavior change).
    const onWindowChange = () => {
        try {
            if (typeof iconManager._onWindowChange === "function")
                iconManager._onWindowChange();
        } catch (_e) {}
    };
    const refreshIndicators = () => {
        if (!containerAlive || isAutologinGrace())
            return;
        try {
            if (typeof iconManager._refreshAllIndicators === "function")
                iconManager._refreshAllIndicators();
        } catch (_e) { /* guarded inside */ }
    };

    try {
        const appSystem = Shell.AppSystem.get_default();
        // Fired on launch/activate/stop even before a window exists.
        connectSafe(appSystem, "app-state-changed", () => onWindowChange());
    } catch (e) {}
    try {
        // Minimized windows still emit restacked; catches drag-to-cover too.
        connectSafe(global.display, "restacked", () => onWindowChange());
    } catch (e) {}
    try {
        connectSafe(global.display, "notify::focus-window", () => {
            onWindowChange();
            refreshIndicators();
        });
    } catch (e) {}
    try {
        connectSafe(global.display, "in-fullscreen-changed", () => onWindowChange());
    } catch (e) {}
    try {
        // Workspace switch: original only reloads when mode==1; for mode==0
        // we still need to re-evaluate running set + indicators.
        connectSafe(global.workspace_manager, "workspace-switched", () => {
            onWindowChange();
            refreshIndicators();
        });
    } catch (e) {}
    try {
        const tracker = Shell.WindowTracker.get_default();
        // focus-app already used for indicators; also re-evaluate icons so a
        // restored window's app comes back even if window-created was missed.
        connectSafe(tracker, "notify::focus-app", () => onWindowChange());
    } catch (e) {}

    iconManager._dockFixIconsApplied = true;
    console.log(`${TAG} applied (orig preserved: ${!!origGetRunningApps})`);

    // Pin Show Apps button to the far right (reverted together below).
    let pinHandle = null;
    try {
        pinHandle = applyShowAppsPin(iconManager);
    } catch (e) {
        console.warn(`${TAG} show-apps pin failed:`, e);
    }
    const ensurePinned = (() => {
        // Heal the running-icon / Show Apps pin.
        const base = pinHandle?.ensurePinned ?? (() => {});
        return () => {
            try { base(); } catch (e) {}
        };
    })();
    const revertPin = pinHandle?.revert ?? (() => {});

    // Insert new running icons directly before Show Apps (no visible shuffle).
    let revertAddOrder = () => {};
    try {
        revertAddOrder = applyAddIconOrder(iconManager);
    } catch (e) {
        console.warn(`${TAG} add-icon order wrap failed:`, e);
    }

    // Show Apps button fix (brand + overview toggle) is NOT applied here any
    // more: it is its own concern (D-058) owned by dockManager via
    // _startAppButtonFix / apps-button-fix-enabled, so it no longer tracks
    // icons-fix-enabled.

    // Force one re-evaluation so currently-minimized apps reappear.
    try {
        onWindowChange();
    } catch (e) {}

    const revert = () => {
        try {
            revertAddOrder();
        } catch (e) {}
        try {
            revertPin();
        } catch (e) {}
        try {
            if (pendingWindowChangeId !== null) {
                try { GLib.source_remove(pendingWindowChangeId); } catch (_e) {}
                pendingWindowChangeId = null;
            }
        } catch (_e) {}
        try {
            if (iconManager._dockFixOnChangeWrapped) {
                iconManager._onWindowChange = origOnWindowChange;
                iconManager._dockFixOnChangeWrapped = false;
            }
        } catch (_e) {}
        try {
            if (iconManager._dockFixDoChangeWrapped) {
                iconManager._doWindowChange = origDoWindowChange;
                iconManager._dockFixDoChangeWrapped = false;
            }
        } catch (_e) {}
        try {
            if (iconManager._dockFixRefreshAllWrapped) {
                iconManager._refreshAllIndicators = origRefreshAllIndicators;
                iconManager._dockFixRefreshAllWrapped = false;
            }
        } catch (_e) {}
        try {
            if (iconManager._dockFixRefreshGuardApplied) {
                iconManager._refreshRunningIndicator = origRefreshRunningIndicator;
                iconManager._dockFixRefreshGuardApplied = false;
            }
        } catch (e) {}
        try {
            if (trackedContainer && containerAlive && trackedContainer._dockFixDestroyId) {
                try { trackedContainer.disconnect(trackedContainer._dockFixDestroyId); } catch (_e) {}
                try { delete trackedContainer._dockFixDestroyId; } catch (_e) {}
            }
        } catch (_e) {}
        try {
            const entries = iconManager._icons?.entries?.() ?? [];
            for (const [, actor] of entries) {
                try {
                    if (actor && !deadActors.has(actor) && actor._dockFixDestroyId) {
                        try { actor.disconnect(actor._dockFixDestroyId); } catch (_e) {}
                        try { delete actor._dockFixDestroyId; } catch (_e) {}
                    }
                } catch (_e) {}
            }
        } catch (_e) {}
        try { deadActors.clear(); } catch (_e) {}
        try { deadBoxes.clear(); } catch (_e) {}
        try { containerAlive = false; } catch (_e) {}
        try {
            if (origGetRunningApps)
                iconManager._getRunningApps = origGetRunningApps;
        } catch (e) {}
        for (const c of extraConns) {
            try {
                c.obj.disconnect(c.id);
            } catch (e) { /* already gone */ }
        }
        try {
            iconManager._dockFixIconsApplied = false;
        } catch (e) {}
        console.log(`${TAG} reverted`);
    };
    revert.ensurePinned = ensurePinned;
    return revert;
}
