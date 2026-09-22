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
