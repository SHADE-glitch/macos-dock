import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { DockManager } from "./lib/dockManager.js";
export default class MacosDockExtension extends Extension {
    _dockManager = null;
    enable() {
        try {
            this._dockManager = new DockManager();
            this._dockManager.enable(this.getSettings());
        } catch (e) {
            console.error("[macos-dock-local] enable() failed:", e);
            // enable() may have failed after mounting the container, connecting the
            // settings signals or starting a timer. Dropping the reference alone leaves
            // all of that unreachable, so disable() could never undo it and the dock
            // would stay on screen until the next logout. disable() tolerates a
            // partially enabled manager, so hand it back before forgetting it.
            try {
                this._dockManager?.disable();
            } catch (e2) {
                console.error("[macos-dock-local] cleanup after a failed enable() failed:", e2);
            }
            this._dockManager = null;
        }
    }
    disable() {
        if (this._dockManager) {
            try { this._dockManager.disable(); } catch (e) {
                console.error("[macos-dock-local] disable() failed:", e);
            }
            this._dockManager = null;
        }
    }
}
