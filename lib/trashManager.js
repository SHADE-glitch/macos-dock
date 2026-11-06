import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { SignalManager } from "./signalManager.js";
import { applyClickAction } from "./clickAction.js";

const TAG = "[macos-dock-local][trash]";
const TRASH_URI = "trash:///";
const ICON_EMPTY = "user-trash";
const ICON_FULL = "user-trash-full";
const UPDATE_TRASH_DELAY = 1000;
const FILE_MANAGER1_BUS = "org.freedesktop.FileManager1";
const FILE_MANAGER1_PATH = "/org/freedesktop/FileManager1";
const NAUTILUS_BUS = "org.gnome.Nautilus";
const NAUTILUS_FILE_OPERATIONS_PATH = "/org/gnome/Nautilus/FileOperations2";
const NAUTILUS_FILE_OPERATIONS_IFACE = "org.gnome.Nautilus.FileOperations2";

const FileManager1Interface = `
<node>
  <interface name="org.freedesktop.FileManager1">
    <property name="OpenWindowsWithLocations" type="a{sas}" access="read"/>
  </interface>
</node>`;
const FileManager1Proxy = Gio.DBusProxy.makeProxyWrapper(FileManager1Interface);

/**
 * Tracks the Trash location independently from the Files application.
 *
 * The trash window is still a Nautilus window at the Shell level. This class
 * only maps it through FileManager1's OpenWindowsWithLocations property, so
 * the dock can keep it out of the Files icon's window count and previews.
 * The proxy is deliberately constructed with DO_NOT_AUTO_START: the D-Bus
 * service file for FileManager1 exists, and enabling the extension must not
 * launch a file manager as a side effect.
 */
export class TrashManager {
    _signals;
    _windowSignals;
    _proxy = null;
    _proxyWarned = false;
    _cancellable = null;
    _monitor = null;
    _updateSourceId = null;
    _windowsUpdateSourceId = null;
    _windowsReadPending = false;
    _windowsRereadRequested = false;
    _windowsReadWarned = false;
    _windowsByPath = new Map();
    _windowsByLocation = new Map();
    _trashWindows = new Set();
    _empty = true;
    _trashStateWarned = false;
    _emptyTrashWarned = false;
    _openWarned = false;
    _onChanged = null;
    _started = false;

    start() {
        if (this._started)
            return;
        this._started = true;
        this._signals = new SignalManager();
        this._windowSignals = new SignalManager();
        this._cancellable = new Gio.Cancellable();

        try {
            const trash = Gio.File.new_for_uri(TRASH_URI);
            this._monitor = trash.monitor_directory(Gio.FileMonitorFlags.NONE, this._cancellable);
            this._signals.connect(this._monitor, "changed", () => this._scheduleTrashUpdate());
        }
        catch (e) {
            console.warn(`${TAG} trash directory monitor unavailable:`, e);
        }

        this._signals.connect(global.workspace_manager, "workspace-added", () => this._scheduleWindowsUpdate());
        this._signals.connect(global.workspace_manager, "workspace-removed", () => this._scheduleWindowsUpdate());
        this._signals.connect(global.display, "window-created", () => this._scheduleWindowsUpdate());
        this._signals.connect(global.display, "window-entered-monitor", () => this._scheduleWindowsUpdate());
        this._signals.connect(global.display, "window-left-monitor", () => this._scheduleWindowsUpdate());

        try {
            const proxy = new FileManager1Proxy(
                Gio.DBus.session,
                FILE_MANAGER1_BUS,
                FILE_MANAGER1_PATH,
                (_proxy, error) => {
                    if (!this._started)
                        return;
                    if (error) {
                        this._warnProxy(error);
                        return;
                    }
                    // A file manager that is not running is the normal state at
                    // login, and the init callback still reports no error for it,
                    // so ownership -- not this callback -- decides whether the
                    // property can be read.
                    this._scheduleWindowsUpdate();
                },
                this._cancellable,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START
            );
            this._proxy = proxy;
            this._signals.connect(proxy, "g-properties-changed", () => this._scheduleWindowsUpdate());
            this._signals.connect(proxy, "notify::g-name-owner", () => this._scheduleWindowsUpdate());
        }
        catch (e) {
            this._warnProxy(e);
        }

        this._updateTrashState();
    }

    stop() {
        this._started = false;
        if (this._updateSourceId !== null) {
            try { GLib.source_remove(this._updateSourceId); } catch (_e) {}
            this._updateSourceId = null;
        }
        if (this._windowsUpdateSourceId !== null) {
            try { GLib.source_remove(this._windowsUpdateSourceId); } catch (_e) {}
            this._windowsUpdateSourceId = null;
        }
        this._signals?.disconnectAll();
        this._windowSignals?.disconnectAll();
        this._signals = null;
        this._windowSignals = null;
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._monitor) {
            try { this._monitor.cancel(); } catch (_e) {}
            this._monitor = null;
        }
        this._proxy = null;
        this._windowsReadPending = false;
        this._windowsRereadRequested = false;
        this._windowsByPath.clear();
        this._windowsByLocation.clear();
        this._trashWindows.clear();
        this._onChanged = null;
    }

    setOnChanged(callback) {
        this._onChanged = callback;
    }

    isEmpty() {
        return this._empty;
    }

    getIcon() {
        return Gio.ThemedIcon.new(this._empty ? ICON_EMPTY : ICON_FULL);
    }

    getWindows() {
        const prefix = this._normalizeLocation(TRASH_URI);
        const result = new Set();
        for (const [location, windows] of this._windowsByLocation) {
            if (!location.startsWith(prefix))
                continue;
            for (const window of windows)
                result.add(window);
        }
        return [...result];
    }

    hasWindow() {
        return this.getWindows().length > 0;
    }

    isTrashWindow(metaWindow) {
        return !!metaWindow && this._trashWindows.has(metaWindow);
    }

    /**
     * A click on the trash icon, answered by the same rule an app icon uses
     * (see applyClickAction) rather than by always raising the first window:
     * focusing a window that is already focused is invisible, which made a
     * second and third click look like the icon was dead.
     *
     * The try/catch is not decoration — these windows are learned from an async
     * D-Bus read, so one can be gone by the time the click lands.
     */
    activate() {
        const window = this._pickWindow();
        const open = this.getWindows().length;
        try {
            const action = applyClickAction(window, global.get_current_time(), () => this.openNewWindow());
            // Which branch a click took is the one thing the journal cannot infer
            // from the screen: "nothing happened" and "minimized the window you
            // could not see" look identical to the owner.
            console.log(`${TAG} click -> ${action} (open=${open})`);
        }
        catch (e) {
            console.warn(`${TAG} failed to activate the trash window:`, e);
        }
    }

    /**
     * Opens another trash window even when one is already open. The default file
     * manager's Exec carries `--new-window`, so launching the URI is what the
     * shell's own "New Window" menu row resolves to as well.
     */
    openNewWindow() {
        try {
            Gio.AppInfo.launch_default_for_uri(TRASH_URI, global.create_app_launch_context(global.get_current_time(), -1));
        }
        catch (e) {
            if (!this._openWarned) {
                this._openWarned = true;
                console.warn(`${TAG} failed to open the trash:`, e);
            }
        }
    }

    /**
     * The window a click acts on, in the order an app icon would pick it: the
     * focused one, then a visible one on the current workspace, then any other.
     */
    _pickWindow() {
        const windows = this.getWindows();
        if (windows.length === 0)
            return null;
        const focused = global.display.focus_window;
        if (focused && windows.includes(focused))
            return focused;
        const active = global.workspace_manager.get_active_workspace();
        const onCurrent = windows.filter((window) => {
            try {
                return window.get_workspace() === active;
            }
            catch (_e) {
                return false;
            }
        });
        const visible = onCurrent.filter((window) => !window.minimized);
        if (visible.length > 0)
            return visible[0];
        if (onCurrent.length > 0)
            return onCurrent[0];
        return windows[0];
    }

    emptyTrash() {
        const platformData = {
            "parent-handle": GLib.Variant.new_string(""),
            "timestamp": GLib.Variant.new_uint32(global.get_current_time()),
            "window-position": GLib.Variant.new_string("center"),
        };
        try {
            Gio.DBus.session.call(
                NAUTILUS_BUS,
                NAUTILUS_FILE_OPERATIONS_PATH,
                NAUTILUS_FILE_OPERATIONS_IFACE,
                "EmptyTrash",
                new GLib.Variant("(ba{sv})", [true, platformData]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (connection, result) => {
                    try {
                        connection.call_finish(result);
                    }
                    catch (e) {
                        if (!this._emptyTrashWarned) {
                            this._emptyTrashWarned = true;
                            console.warn(`${TAG} empty trash failed:`, e);
                        }
                    }
                }
            );
        }
        catch (e) {
            if (!this._emptyTrashWarned) {
                this._emptyTrashWarned = true;
                console.warn(`${TAG} empty trash request failed:`, e);
            }
        }
    }

    _warnProxy(error) {
        if (this._proxyWarned)
            return;
        this._proxyWarned = true;
        console.warn(`${TAG} FileManager1 unavailable; trash windows will not be filtered from Files:`, error);
    }

    _scheduleTrashUpdate() {
        if (!this._started)
            return;
        if (this._updateSourceId !== null) {
            try { GLib.source_remove(this._updateSourceId); } catch (_e) {}
        }
        this._updateSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, UPDATE_TRASH_DELAY, () => {
            this._updateSourceId = null;
            this._updateTrashState();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateTrashState() {
        if (!this._started)
            return;
        const trash = Gio.File.new_for_uri(TRASH_URI);
        trash.query_info_async(
            Gio.FILE_ATTRIBUTE_TRASH_ITEM_COUNT,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW,
            this._cancellable,
            (source, result) => {
                if (!this._started)
                    return;
                try {
                    const info = source.query_info_finish(result);
                    const count = info.get_attribute_uint32(Gio.FILE_ATTRIBUTE_TRASH_ITEM_COUNT);
                    this._setEmpty(count === 0);
                }
                catch (e) {
                    if (!this._trashStateWarned) {
                        this._trashStateWarned = true;
                        console.warn(`${TAG} trash item count unavailable:`, e);
                    }
                }
            }
        );
    }

    _setEmpty(empty) {
        if (this._empty === empty)
            return;
        this._empty = empty;
        this._onChanged?.();
    }

    _scheduleWindowsUpdate() {
        if (!this._started)
            return;
        if (this._windowsUpdateSourceId !== null)
            return;
        this._windowsUpdateSourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._windowsUpdateSourceId = null;
            this._rebuildWindows();
            return GLib.SOURCE_REMOVE;
        });
    }

    _rebuildWindows() {
        if (!this._started)
            return;

        const windowsByPath = new Map();
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.get_n_workspaces(); i++) {
            const workspace = manager.get_workspace_by_index(i);
            if (!workspace)
                continue;
            for (const window of workspace.list_windows()) {
                const path = window.get_gtk_window_object_path();
                if (path)
                    windowsByPath.set(path, window);
            }
        }
        this._windowsByPath = windowsByPath;

        if (!this._managerOwned()) {
            this._applyLocationWindows(new Map(), new Set());
            return;
        }
        if (this._windowsReadPending) {
            this._windowsRereadRequested = true;
            return;
        }
        this._windowsReadPending = true;
        this._readOpenWindows((openWindows) => {
            this._windowsReadPending = false;
            const reread = this._windowsRereadRequested;
            this._windowsRereadRequested = false;
            if (!this._started)
                return;
            const windowsByLocation = new Map();
            const trashWindows = new Set();
            this._collectLocationWindows(openWindows, windowsByLocation, trashWindows);
            this._applyLocationWindows(windowsByLocation, trashWindows);
            if (reread)
                this._scheduleWindowsUpdate();
        });
    }

    /**
     * Whether a file manager owns the name right now. No owner means no window
     * mapping at all: the trash window is not open.
     */
    _managerOwned() {
        return !!this._proxy && this._proxy.get_name_owner() !== null;
    }

    /**
     * OpenWindowsWithLocations is read with an explicit Properties.Get rather
     * than from the proxy cache. Two measured reasons: a DO_NOT_AUTO_START
     * proxy caches nothing while the name is absent, and GJS unpacks `a{sas}`
     * into entries whose array member is an empty object (`{"/w/1": {}}`), so
     * the cached form cannot be walked. The reply is read by child index.
     */
    _readOpenWindows(callback) {
        Gio.DBus.session.call(
            FILE_MANAGER1_BUS,
            FILE_MANAGER1_PATH,
            "org.freedesktop.DBus.Properties",
            "Get",
            new GLib.Variant("(ss)", [FILE_MANAGER1_BUS, "OpenWindowsWithLocations"]),
            new GLib.VariantType("(v)"),
            Gio.DBusCallFlags.NONE,
            -1,
            this._cancellable,
            (connection, result) => {
                let openWindows = null;
                try {
                    const reply = connection.call_finish(result);
                    openWindows = reply.get_child_value(0).get_child_value(0);
                }
                catch (e) {
                    if (!this._windowsReadWarned) {
                        this._windowsReadWarned = true;
                        console.warn(`${TAG} OpenWindowsWithLocations unreadable; the trash window stays with Files:`, e);
                    }
                }
                callback(openWindows);
            }
        );
    }

    _applyLocationWindows(windowsByLocation, trashWindows) {
        const changed = !this._locationMapsEqual(this._windowsByLocation, windowsByLocation) ||
            !this._windowSetsEqual(this._trashWindows, trashWindows);
        this._windowsByLocation = windowsByLocation;
        this._trashWindows = trashWindows;

        this._windowSignals.disconnectAll();
        for (const window of trashWindows) {
            this._windowSignals.connect(window, "unmanaged", () => this._scheduleWindowsUpdate());
        }

        if (changed)
            this._onChanged?.();
    }

    /**
     * Walks the `a{sas}` reply into location -> windows, flagging the windows
     * that show the trash. Every member is read by child index because the
     * unpacked form loses the array entries (see _readOpenWindows).
     */
    _collectLocationWindows(openWindows, windowsByLocation, trashWindows) {
        if (!openWindows)
            return;
        const trashPrefix = this._normalizeLocation(TRASH_URI);

        for (let i = 0; i < openWindows.n_children(); i++) {
            const entry = openWindows.get_child_value(i);
            const windowPath = entry.get_child_value(0).get_string()[0];
            const window = this._windowsByPath.get(windowPath);
            if (!window)
                continue;

            const windowGroup = new Set([window]);
            try {
                window.foreach_transient((transient) => {
                    if (transient)
                        windowGroup.add(transient);
                    return true;
                });
            }
            catch (_e) {}

            const locations = entry.get_child_value(1);
            for (let k = 0; k < locations.n_children(); k++) {
                const normalized = this._normalizeLocation(locations.get_child_value(k).get_string()[0]);
                for (const groupedWindow of windowGroup) {
                    let windows = windowsByLocation.get(normalized);
                    if (!windows) {
                        windows = new Set();
                        windowsByLocation.set(normalized, windows);
                    }
                    windows.add(groupedWindow);
                    if (normalized.startsWith(trashPrefix))
                        trashWindows.add(groupedWindow);
                }
            }
        }
    }

    _normalizeLocation(location) {
        return location.endsWith("/") ? location : `${location}/`;
    }

    _locationMapsEqual(a, b) {
        if (a.size !== b.size)
            return false;
        for (const [location, windows] of a) {
            const other = b.get(location);
            if (!other || !this._windowSetsEqual(windows, other))
                return false;
        }
        return true;
    }

    _windowSetsEqual(a, b) {
        if (a.size !== b.size)
            return false;
        for (const window of a) {
            if (!b.has(window))
                return false;
        }
        return true;
    }
}
