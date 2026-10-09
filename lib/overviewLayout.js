import * as workspaceModule from "resource:///org/gnome/shell/ui/workspace.js";

/**
 * Overview window-preview inset (D-057).
 *
 * In the overview's window picker, GNOME lays the window previews out in a
 * container (`Workspace._container`) that fills the whole `Workspace` box, while
 * the desktop background (`WorkspaceBackground`, its sibling) is inset inside
 * that same box — measured 20 px sides / 12 px top+bottom on GNOME Shell 50.1.
 * So a preview near the edge pokes past the desktop's bottom edge (and the
 * sides). This patch makes the preview layout area equal the desktop
 * background's rect, so previews stay inside the desktop.
 *
 * Mechanism: the container's layout manager is the shell's private
 * `WorkspaceLayout`; its `_getWindowSlots(containerBox)` decides the area the
 * slots are placed in. We wrap that method on the PROTOTYPE — which covers every
 * current and future `Workspace` instance, so workspaces added/removed later
 * need no re-hooking — and hand it the desktop background's rect instead of the
 * full box. The inset is read from the live allocations each layout, not
 * hardcoded, so it tracks theme / monitor changes.
 *
 * Patched private symbol: `WorkspaceLayout.prototype._getWindowSlots`
 * Verified against: GNOME Shell 50.1 (Ubuntu 26.04). On any miss this warns once
 * and leaves the native layout untouched — it never throws into the shell.
 */

const TAG = "[macos-dock-local][overviewlayout]";

// The desktop background actor: the container's sibling inside the Workspace.
function _findBackground(container) {
    if (!container || typeof container.get_parent !== "function")
        return null;
    const workspace = container.get_parent();
    if (!workspace || typeof workspace.get_children !== "function")
        return null;
    for (const child of workspace.get_children()) {
        if (child === container)
            continue;
        try {
            const style = child.get_style_class_name ? (child.get_style_class_name() || "") : "";
            if (style.includes("workspace-background"))
                return child;
        } catch (_e) {}
    }
    return null;
}

// The area the previews should use: the background's rect, in the container's
// own coordinate space. Returns null when it cannot be determined (caller then
// keeps the native full-box area).
function _previewArea(container) {
    const background = _findBackground(container);
    if (!background)
        return null;
    const bg = background.allocation;
    const cont = container.allocation;
    if (!bg || !cont)
        return null;
    const area = bg.copy();
    area.x1 -= cont.x1;
    area.y1 -= cont.y1;
    area.x2 -= cont.x1;
    area.y2 -= cont.y1;
    return area;
}

// Probe each private symbol individually so one miss does not hide the rest.
function _validate() {
    const problems = [];
    const WorkspaceLayout = workspaceModule.WorkspaceLayout;
    if (!WorkspaceLayout || !WorkspaceLayout.prototype)
        problems.push("WorkspaceLayout");
    else if (typeof WorkspaceLayout.prototype._getWindowSlots !== "function")
        problems.push("WorkspaceLayout._getWindowSlots");
    return problems;
}

// The inset depends on the container field; a rename makes `_previewArea()`
// return null and the wrapper silently keeps the native layout. This module's
// header promises "warns once on any miss", so honour it for that case too —
// otherwise the inset disappearing is invisible until someone notices the
// previews poking past the desktop again.
let _containerWarned = false;

// Idempotent and re-derived from the prototype each call, so it also undoes a
// patch installed by an earlier apply — see applyOverviewLayout()'s already-applied
// branch, which used to hand back a noop and strand the wrapper permanently.
function _revertOverviewLayout() {
    try {
        const proto = workspaceModule.WorkspaceLayout?.prototype;
        if (!proto || proto._dockOverviewLayoutApplied !== true)
            return;
        proto._getWindowSlots = proto._dockOverviewLayoutOrig;
        delete proto._dockOverviewLayoutOrig;
        proto._dockOverviewLayoutApplied = false;
    } catch (_e) {}
}

export function applyOverviewLayout() {
    const noop = () => {};
    const problems = _validate();
    if (problems.length) {
        console.warn(`${TAG} disabled — missing/changed private APIs: ` +
            `${problems.join(", ")}. Falling back to the native layout.`);
        return noop;
    }

    const proto = workspaceModule.WorkspaceLayout.prototype;
    if (proto._dockOverviewLayoutApplied)
        return _revertOverviewLayout;

    const origGetWindowSlots = proto._getWindowSlots;
    proto._dockOverviewLayoutOrig = origGetWindowSlots;
    proto._getWindowSlots = function (containerBox) {
        try {
            const area = _previewArea(this._container);
            if (area)
                return origGetWindowSlots.call(this, area);
            if (this._container === undefined && !_containerWarned) {
                _containerWarned = true;
                console.warn(`${TAG} WorkspaceLayout has no _container — previews stay native (symbol renamed?)`);
            }
        } catch (e) {
            console.warn(`${TAG} preview area failed, using native:`, e);
        }
        return origGetWindowSlots.call(this, containerBox);
    };
    proto._dockOverviewLayoutApplied = true;
    console.log(`${TAG} enabled`);

    return _revertOverviewLayout;
}
