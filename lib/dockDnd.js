import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";
import * as DND from "resource:///org/gnome/shell/ui/dnd.js";
import { getAppFavorites } from "resource:///org/gnome/shell/ui/appFavorites.js";
import {
    boundaryAt,
    containerIndexForFavoriteSlot,
    favoriteIndexAtGap,
    gapSlide,
    isSelfPosition,
    moveInFavoriteList,
    offerGapForBoundary,
    restingSlots,
} from "./dockDndSlots.js";

const TAG = "[macos-dock-local][dnd]";
// The shell's own dash and app grid both use 200ms. Longer sticks, shorter turns
// an ordinary click into a drag.
const DRAG_TIMEOUT_MS = 200;
// dash.js DASH_ANIMATION_TIME: the placeholder grows in and clears out over this
// long, and a move that arrives while one is still clearing is DROPPED (see
// _animatingPlaceholders) -- that gate is a large part of why the shell's dash
// feels calm instead of jittery.
const PLACEHOLDER_ANIMATION_MS = 200;
// The drag's own transition out of the hover magnification: long enough to read
// as "the dock settles", short enough that the gap is already growing while it
// happens.
const DRAG_MAGNIFY_EASE_MS = 150;
// How long a crossed icon takes to slide into its new place when the gap moves.
// Below the placeholder's own 200ms so the row has settled before the gap has.
const GAP_SLIDE_MS = 180;
// Ubuntu dims the dragged icon to this and puts it back at 255 on drag-end
// (dash.js:519-526 of the extension itself) rather than hiding it, so the icon
// stays where it came from and the dock widens by the gap's slot instead.
const DRAGGED_OPACITY = 50;
const FAVORITES_KEY = "favorite-apps";

/**
 * Drag-and-drop for the dock's pinned row. This module IS dock-coupled: it
 * reads the live icon order straight out of the dock container and writes
 * through the shell's AppFavorites, so the pinned order ends up in the same
 * `favorite-apps` key the dock already reloads on.
 *
 * Sources are the icon actors: each gets a `_delegate` plus a DND gesture.
 * Targets are the container (reorder / pin) and the applications button
 * (unpin), which is how the shell's own dash resolves the same gestures --
 * `dnd.js` walks up from the actor under the pointer until some
 * `_delegate.handleDragOver` stops returning CONTINUE.
 *
 * Only favorites are reorderable, matching the shell: a drop position is
 * always clamped into the favorites range, so dragging a running icon into
 * that range pins it rather than reordering a list that is not persisted.
 *
 * The mechanic is the shell dash's, because that is what Ubuntu Dock inherits
 * (`dash.js:860-988` -- DockDash only forwards to `Dash.prototype` and adapts
 * the axis): the slot clamped to the favorites count, a placeholder that grows
 * in and clears out over DASH_ANIMATION_TIME with moves refused while one is
 * still clearing, no positioning before or after self, one deferred write. The
 * one deliberate difference is how the pointer is read: the nearest line between
 * two icons rather than the shell's proportional cell (see `boundaryAt`), because
 * a cell-sized dead zone in the middle of every icon is exactly what the owner
 * reported as "the gap does not follow". Nothing here is copied from
 * dash-to-dock (GPL-3): the numbers, the order of the steps and the guards were
 * read off the installed shell sources (`ui/dnd.js`, `ui/dash.js`,
 * `ui/appDisplay.js`, `ui/appFavorites.js`) and re-implemented against this
 * dock's container.
 */
export class DockDnd {
    _iconManager;
    _enabled = false;
    _started = false;
    _dragging = null;
    // Every actor currently dimmed as a drag source. A Set, because the shell
    // can end a gesture without ever reaching `_finishDrag` for the previous
    // one, and a dim that outlives its drag is permanent on screen.
    _dimmed = new Set();
    _placeholder = null;
    _placeholderPos = -1;
    _animatingPlaceholders = 0;
    _unpinCueOn = false;
    _warned = false;
    _lastVerdict = null;
    // The hold threshold is a setting now; the shell's 200ms stays the default.
    _dragHoldMs = DRAG_TIMEOUT_MS;
    // Installed only while a gap or the Unpin cue is on screen. An app dragged
    // in from the grid has no dock-side `drag-end`, so this is the only thing
    // that can notice the pointer leaving and clear the gap.
    _dragMonitor = null;
    _stageKeyId = 0;
    // Set by the dock manager once magnification exists. A drag suspends it for
    // its whole duration: the hover scale and the row's own re-flow are two
    // animations writing the same icons, and the grid-into-dock drag -- which
    // reads as smooth -- never magnifies the item being carried.
    _magnification = null;
    _magnifySuspended = false;

    constructor(iconManager) {
        this._iconManager = iconManager;
    }

    setMagnification(magnification) {
        this._magnification = magnification;
    }

    start() {
        if (this._started)
            return;
        const im = this._iconManager;
        if (!im?._container) {
            this._warnOnce("no dock container to attach to");
            return;
        }
        this._started = true;
        this._installContainerTarget();
        this._installAppButtonTarget();
        // Icons that already exist need the gesture too; new ones get it from
        // IconManager's add path.
        for (const [appId, actor] of im._icons) {
            this.bindIcon(actor, appId);
        }
        console.log(`${TAG} started (${this._enabled ? "enabled" : "idle, gated by dock-dnd-enabled"})`);
    }

    stop() {
        if (!this._started)
            return;
        this._finishDrag();
        const im = this._iconManager;
        if (im?._container)
            im._container._delegate = null;
        if (im?._appButton)
            im._appButton._delegate = null;
        for (const actor of im ? im._icons.values() : []) {
            this.teardownIcon(actor);
        }
        this._started = false;
        console.log(`${TAG} stopped`);
    }

    setEnabled(enabled) {
        if (this._enabled === enabled)
            return;
        this._enabled = enabled;
        // The gesture lives on the actor, so turning drag off mid-session has
        // to take it back off every icon. Only the public action list is
        // touched -- no private field of the shell's _Draggable.
        const im = this._iconManager;
        if (!im || !this._started)
            return;
        for (const [appId, actor] of im._icons) {
            if (enabled)
                this.bindIcon(actor, appId);
            else
                this.teardownIcon(actor);
        }
        if (!enabled)
            this._clearUnpinCue();
    }

    /**
     * `DND.makeDraggable()` fixes the timeout when the gesture is created, so a
     * change has to rebuild the gestures. There is no public way to read the
     * value back either; the field is the source of truth.
     */
    setDragHoldMs(ms) {
        const next = Math.min(1000, Math.max(100, Number(ms) || DRAG_TIMEOUT_MS));
        if (next === this._dragHoldMs)
            return;
        this._dragHoldMs = next;
        if (!this._started || !this._enabled)
            return;
        const im = this._iconManager;
        if (!im)
            return;
        for (const [appId, actor] of im._icons) {
            if (!actor?._dockDraggable)
                continue;
            this.teardownIcon(actor);
            this.bindIcon(actor, appId);
        }
    }

    /**
     * Called by IconManager for every icon it adds, favourite or not: a running
     * unpinned icon is draggable precisely so it can be dropped into the
     * favourites range and become pinned.
     */
    bindIcon(actor, appId) {
        if (!this._enabled || !this._started || !actor || actor._dockDraggable)
            return;
        const im = this._iconManager;
        actor._delegate = {
            appId,
            get app() {
                return Shell.AppSystem.get_default().lookup_app(this.appId);
            },
            getDragActor: () => this._makeDragActor(appId),
            getDragActorSource: () => actor,
            // Foreign drop targets walk the source's parent chain to decide
            // whether the drag came from their own view: the shell's grid icons
            // set `_delegate = this` (appDisplay.js:1857), so `_canAccept`
            // calls `source.get_parent()` unguarded and threw four times in
            // one boot as a dock icon passed over the app grid
            // (`appDisplay.js:108`). Answering with the real actor's parent
            // makes that probe walk to the stage, find no BaseAppView, and
            // refuse the drop the way it is supposed to.
            get_parent: () => actor.get_parent(),
            _dockDnd: this,
        };
        // The gesture _Draggable hangs on the actor is captured by diffing the
        // action list rather than by testing a type name: that keeps the
        // teardown independent of what the gesture class is called this cycle.
        const before = [...actor.get_actions()];
        const draggable = DND.makeDraggable(actor, { timeoutThreshold: this._dragHoldMs });
        actor._dockDraggable = draggable;
        actor._dockDndGesture = [...actor.get_actions()].find(a => !before.includes(a)) ?? null;
        if (!actor._dockDndGesture) {
            this._warnOnce("could not capture the drag gesture; drag cannot be switched off per icon");
        }
        else {
            // Diagnostic that separates the two silent failure modes, because
            // neither one logs anything on its own: the gesture never seeing the
            // press (recognize absent) versus recognizing it and then losing the
            // pointer grab, since _gestureRecognized() returns before emitting
            // drag-begin when Main.pushModal gives back nothing (dnd.js:144-147).
            actor._dockDndGesture.connect("recognize", () => {
                console.log(`${TAG} gesture recognize`);
            });
        }
        // Connected through the icon manager's SignalManager so a disable path
        // that never reaches teardownIcon still drops them.
        im._signals.connect(draggable, "drag-begin", () => this._onDragBegin(actor));
        // `drag-end` only, never `drag-cancelled`: the shell's own
        // `_cancelDrag()` emits BOTH (dnd.js:592 then 597/535), so wiring both
        // signals finishes one gesture twice -- visible in the journal as two
        // `drag end` lines for one `drag begin`, which makes a real double
        // teardown indistinguishable from this one.
        im._signals.connect(draggable, "drag-end", () => this._onDragEnd());
    }

    teardownIcon(actor) {
        if (!actor)
            return;
        if (actor._dockDndGesture) {
            try {
                actor.remove_action(actor._dockDndGesture);
            }
            catch (_e) { /* actor already gone */ }
            actor._dockDndGesture = null;
        }
        actor._dockDraggable = null;
        if (actor._delegate?._dockDnd === this)
            actor._delegate = null;
    }

    _makeDragActor(appId) {
        const im = this._iconManager;
        const app = Shell.AppSystem.get_default().lookup_app(appId);
        return new St.Icon({
            gicon: app ? app.get_icon() : null,
            icon_size: im?._iconSize ?? 48,
            style_class: "macos-dock-icon-gicon",
        });
    }

    _onDragBegin(actor) {
        const im = this._iconManager;
        if (!im)
            return;
        // Ubuntu's behaviour and Ubuntu's number: the icon stays in its slot at
        // low opacity and the dock widens by the gap's slot. Hiding it instead
        // would hold the width steady but leave a hole where the item came from,
        // and the row would be one slot short of what the pointer is looking at.
        //
        // The dim is recorded per actor rather than as "the one being dragged",
        // because a gesture can be interrupted -- the dock sliding out from under
        // the pointer, the actor destroyed -- and a single `_dragging` slot then
        // hands the restore to the NEXT drag and leaves this icon dimmed for the
        // rest of the session (measured in the sandbox: five icons stuck at 50).
        this._dimmed.add(actor);
        actor.opacity = DRAGGED_OPACITY;
        this._dragging = actor;
        this._lastVerdict = null;
        im.setDragInProgress(true);
        // The hover animations belong to an icon that is only being pointed at.
        // Once one is picked up the row is supposed to be still -- the gap is the
        // only thing that moves for the rest of the gesture, which is also what
        // makes a drag in from the grid read as smooth.
        im._hideTooltip();
        this._suspendMagnification();
        console.log(`${TAG} drag begin`);
    }

    _suspendMagnification() {
        if (this._magnifySuspended || !this._magnification)
            return;
        this._magnifySuspended = true;
        this._magnification.suspend(DRAG_MAGNIFY_EASE_MS);
    }

    _resumeMagnification() {
        if (!this._magnifySuspended)
            return;
        this._magnifySuspended = false;
        if (this._magnification)
            this._magnification.resume();
    }

    _onDragEnd() {
        this._finishDrag();
        console.log(`${TAG} drag end`);
    }

    _finishDrag() {
        const im = this._iconManager;
        for (const actor of this._dimmed) {
            try {
                actor.opacity = 255;
            }
            catch (_e) { /* destroyed mid-gesture */ }
        }
        this._dimmed.clear();
        this._dragging = null;
        this._clearPlaceholder(true);
        this._clearUnpinCue();
        this._removeDragMonitor();
        if (im)
            im.setDragInProgress(false);
        this._resumeMagnification();
    }

    // ---- drag monitor -------------------------------------------------------
    //
    // A target only hears `handleDragOver` while the pointer is over it, and an
    // app dragged in from the grid never emits a `drag-end` this class can
    // connect to. Without an observer, moving out of the dock leaves the gap
    // exactly where it was — the empty rounded slot the owner photographed.
    // The shell's own dash installs the same monitor for the same reason
    // (dash.js:403-406, 420-443).

    _ensureDragMonitor() {
        if (this._dragMonitor)
            return;
        this._dragMonitor = {
            dragMotion: (event) => this._onDragMotion(event),
        };
        DND.addDragMonitor(this._dragMonitor);
        // dnd.js only calls the monitor on motion; Escape cancels the gesture
        // without one. A captured stage handler still sees the key before the
        // source consumes it, so the gap is not stranded either.
        if (!this._stageKeyId) {
            this._stageKeyId = global.stage.connect("captured-event", (_actor, event) => {
                if (event.type() !== Clutter.EventType.KEY_PRESS ||
                    event.get_key_symbol() !== Clutter.KEY_Escape)
                    return Clutter.EVENT_PROPAGATE;
                this._clearPlaceholder(true);
                this._clearUnpinCue();
                return Clutter.EVENT_PROPAGATE;
            });
        }
    }

    _removeDragMonitor() {
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        if (this._stageKeyId) {
            try {
                global.stage.disconnect(this._stageKeyId);
            }
            catch (_e) { /* stage already gone at teardown */ }
            this._stageKeyId = 0;
        }
    }

    _syncDragMonitor() {
        if (this._placeholder || this._unpinCueOn)
            this._ensureDragMonitor();
        else
            this._removeDragMonitor();
    }

    _onDragMotion(event) {
        const container = this._iconManager?._container;
        if (!container) {
            this._clearPlaceholder(true);
            this._clearUnpinCue();
            return DND.DragMotionResult.CONTINUE;
        }
        let inside = true;
        try {
            const [x, y] = container.get_transformed_position();
            const [w, h] = container.get_transformed_size();
            inside = event.x >= x && event.x < x + w &&
                event.y >= y && event.y < y + h;
        }
        catch (_e) {
            inside = false;
        }
        if (!inside) {
            // Same rule as the shell dash: leaving the box withdraws the gap.
            // The target actor is the drag clone while the pointer is over a
            // slot, so the pointer's stage coordinates are the honest input.
            this._clearPlaceholder(true);
            this._clearUnpinCue();
        }
        return DND.DragMotionResult.CONTINUE;
    }

    // ---- targets ------------------------------------------------------------

    _installContainerTarget() {
        const im = this._iconManager;
        const container = im._container;
        container._delegate = {
            handleDragOver: (source, actor, x, y, time) => this._handleDragOver(source, x, y),
            // The drop never reads the pointer: the gap already records where the
            // item will land, and reading it off the row is what makes the write
            // and the indicator agree (dash.js:942-988 does the same).
            acceptDrop: (source) => this._acceptDrop(source),
        };
    }

    _installAppButtonTarget() {
        const im = this._iconManager;
        const button = im._appButton;
        if (!button) {
            this._warnOnce("no applications button to attach the unpin target to");
            return;
        }
        button._delegate = {
            handleDragOver: (source) => {
                if (!this._canUnpin(source))
                    return DND.DragMotionResult.NO_DROP;
                this._setUnpinCue(true);
                return DND.DragMotionResult.MOVE_DROP;
            },
            acceptDrop: (source) => {
                const app = this._appFromSource(source);
                const fromDock = source?._dockDnd === this;
                if (fromDock) {
                    // Leave the drag itself open for the source's own drag-end;
                    // only the cues this target owns are finished here.
                    this._clearUnpinCue();
                    this._clearPlaceholder(true);
                }
                else {
                    // An app-grid drag has no dock-side drag-end to do this.
                    this._finishDrag();
                }
                if (!this._enabled || !app)
                    return false;
                const id = app.get_id();
                const favorites = getAppFavorites();
                this._defer(() => {
                    if (favorites.isFavorite(id))
                        favorites.removeFavorite(id);
                });
                return true;
            },
        };
    }

    /**
     * dash.js:860-868 -- transient (window-backed) apps are never pinnable, and a
     * read-only key means the whole gesture is pointless.
     */
    _canDrop(app) {
        return !app.is_window_backed() && global.settings.is_writable(FAVORITES_KEY);
    }

    _handleDragOver(source, x, y) {
        const app = this._appFromSource(source);
        // Not an app source, or drag switched off: CONTINUE, so the walk up the
        // parent chain is not blocked by a dock that wants nothing.
        if (!this._enabled || !app)
            return DND.DragMotionResult.CONTINUE;
        // Moving back from the applications button onto the row must take the
        // Unpin cue away again; only the button's own target sets it.
        this._clearUnpinCue();
        if (!this._canDrop(app)) {
            this._verdict(`over refused by canDrop (window-backed=${app.is_window_backed()})`);
            return DND.DragMotionResult.NO_DROP;
        }
        const im = this._iconManager;
        const favorites = im._favorites;
        const id = app.get_id();
        const favPos = favorites.indexOf(id);
        const { boundary, cell } = boundaryAt(this._isVertical() ? y : x,
            this._slotChildren(), this._isRtl());
        const pos = offerGapForBoundary(boundary, cell, favPos, favorites.length);
        if (pos !== this._placeholderPos && this._animatingPlaceholders === 0) {
            this._placeholderPos = pos;
            // Both lines that touch the held icon's own slot are the order it
            // already has, so they are withdrawn the way dash.js:910 withdraws
            // them, and the two neighbours are pushed onto their outer line --
            // see `offerGapForBoundary` and D-132 for the spent slot.
            if (isSelfPosition(pos, favPos)) {
                this._verdict(`over self-slot pos=${pos} favPos=${favPos} cell=${cell}`);
                this._clearPlaceholder(true);
                return DND.DragMotionResult.CONTINUE;
            }
            this._relocatePlaceholder(pos, this._placeholder === null);
            this._verdict(`over gap@pos=${pos} boundary=${boundary} cell=${cell} favPos=${favPos} favs=${favorites.length}`);
        }
        if (!this._placeholder)
            return DND.DragMotionResult.NO_DROP;
        return DND.DragMotionResult.MOVE_DROP;
    }

    /**
     * One line per slot change, not per motion event: a live boot logged nine
     * drags and no drop at all, and the difference between "the pointer was
     * never over another slot", "the slot math says the same slot" and "the
     * shrink gate is stuck" is invisible from the outside and cheap to read off
     * here. Same reason `gesture recognize` exists.
     */
    _verdict(message) {
        if (this._lastVerdict === message)
            return;
        this._lastVerdict = message;
        console.log(`${TAG} ${message}`);
    }

    _acceptDrop(source) {
        const app = this._appFromSource(source);
        if (!this._enabled || !app || !this._canDrop(app)) {
            // A refused drop still ends whatever cue this drag put on screen.
            this._clearPlaceholder(true);
            this._clearUnpinCue();
            console.log(`${TAG} drop refused (enabled=${this._enabled} app=${!!app})`);
            return false;
        }
        // No placeholder means the pointer never left the icon's own neighbourhood:
        // "dragged it to its original position", and the shell persists nothing and
        // reports success (dash.js:974-976).
        if (!this._placeholder) {
            console.log(`${TAG} drop in place, nothing written (animating=${this._animatingPlaceholders})`);
            return true;
        }
        const id = app.get_id();
        const children = this._iconManager._container.get_children();
        const pos = favoriteIndexAtGap(this._rowAppIds(), this._iconManager._favorites,
            children.indexOf(this._placeholder), id);
        const srcIsFavorite = getAppFavorites().isFavorite(id);
        // dnd.js emits the source's `drag-end` AFTER acceptDrop returns
        // (_dragActorDropped). Finishing here would replay IconManager's deferred
        // favorites reload before that event, rebuilding the row while the drop
        // animation is still resolving — the journal's `+0 -1` right after a
        // move. A dock source is finished by its own drag-end; an app-grid
        // source has no such event, so it has to be finished here.
        if (source?._dockDnd === this) {
            this._clearUnpinCue();
        }
        else {
            this._finishDrag();
        }
        // Written on the next redraw, the way the shell's own dash does it: the
        // drop animation is still resolving, and a favorites change landing
        // right now would rebuild the row underneath it.
        this._defer(() => {
            if (srcIsFavorite)
                this._moveInFavoriteList(id, pos);
            else
                getAppFavorites().addFavoriteAtPos(id, pos);
        });
        console.log(`${TAG} drop ${srcIsFavorite ? "move" : "pin"} to fav#${pos}`);
        return true;
    }

    /**
     * A reorder writes the list itself, once, instead of calling
     * AppFavorites.moveFavoriteToPos -- because that method is
     * `_removeFavorite` + `_addFavorite` (appFavorites.js:115-118), so it
     * publishes an intermediate `favorite-apps` that has NO entry for the app at
     * all. Two live signals are not something a dock that fades a removed
     * favorite over 200ms can render calmly, and here it was worse than a
     * flicker: the fading actor still held its slot in the icon table, so the
     * second pass concluded the icon was already there, added nothing, and the
     * fade's tail then destroyed the actor -- the dropped icon gone for the rest
     * of the session (journal: `+0 -1` immediately followed by `+0 -0`).
     *
     * Rebuilding from the key's CURRENT value rather than from AppFavorites also
     * stops a second loss: every AppFavorites write regenerates the list from
     * `_getIds()`, which only contains ids AppSystem happens to resolve at that
     * instant (appFavorites.js:46-62, 124), so an unrelated drop can silently
     * delete a pinned entry whose .desktop is mid-rename.
     */
    _moveInFavoriteList(id, pos) {
        const ids = moveInFavoriteList(global.settings.get_strv(FAVORITES_KEY), id, pos);
        if (ids)
            global.settings.set_strv(FAVORITES_KEY, ids);
    }

    _defer(work) {
        global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            try {
                work();
            }
            catch (e) {
                this._warnOnce(`favorites write failed: ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _appFromSource(source) {
        if (!source)
            return null;
        if (source.app instanceof Shell.App)
            return source.app;
        if (source.appId)
            return Shell.AppSystem.get_default().lookup_app(source.appId);
        return null;
    }

    _canUnpin(source) {
        if (!this._enabled)
            return false;
        const app = this._appFromSource(source);
        return !!app && getAppFavorites().isFavorite(app.get_id());
    }

    _isVertical() {
        const im = this._iconManager;
        return !!im?._container?.vertical;
    }

    _isRtl() {
        return this._iconManager._container.text_direction === Clutter.TextDirection.RTL;
    }

    /**
     * The children that can be a slot, projected onto the dock's main axis. The
     * gap and the separator are subtracted the way dash.js subtracts them, and so
     * are the two tail buttons: in the shell's dash neither is even inside `_box`
     * (dash.js:212), so neither is ever a slot here either. Leaving the Trash in
     * counts a slot that no favourite can ever land in, which drags the
     * `favPos + 1` boundary off the last icon's edge and into the tail buttons'
     * pixels — so aiming at the end of the row alternated between "gap here" and
     * "that is your own slot, gap withdrawn" for as long as the pointer hovered.
     */
    _slotChildren() {
        const im = this._iconManager;
        const vertical = this._isVertical();
        const raw = [];
        for (const child of im._container.get_children()) {
            const isGap = child === this._placeholder;
            if (!isGap && (child === im._separator || child === im._appButton ||
                child === im._trashButton))
                continue;
            raw.push({
                start: vertical ? child.y : child.x,
                size: vertical ? child.height : child.width,
                isGap,
            });
        }
        return restingSlots(raw, im._container.get_layout_manager().spacing);
    }

    /**
     * The row as app ids, null for whatever is not an icon. Read by the two index
     * rules in dockDndSlots.js, which is what lets them be unit-tested with a
     * plain array instead of a compositor.
     */
    _rowAppIds() {
        return this._iconManager._container.get_children()
            .map((child) => child._appData?.appId ?? null);
    }

    /**
     * dash.js:915-933 -- if a gap exists it is destroyed and the new one placed
     * at full size; only the FIRST gap of a drag grows in. Re-animating on every
     * slot change is the jitter this deliberately avoids.
     *
     * The gap animates its WIDTH, not its scale. Scale is a transform: it moves
     * pixels, not the layout, so an eased scale leaves the row one whole slot
     * wider than it looks for the duration and -- since the magnification tick
     * writes scale_x on the row's children every frame -- the two fight over the
     * same property. The shell gets the same result by having its placeholder
     * report a preferred width already multiplied by its own animation.
     */
    _relocatePlaceholder(slot, fadeIn) {
        const im = this._iconManager;
        const container = im._container;
        // Captured before the old gap leaves: the slide has to answer "where was
        // each child a frame ago", and after the destroy that row no longer
        // exists. The gap's width is read as-is because the first one may still
        // be growing when the pointer moves on.
        const before = container.get_children();
        const oldGap = this._placeholder ? before.indexOf(this._placeholder) : null;
        const oldWidth = this._placeholder ? this._placeholder.width : 0;
        if (this._placeholder)
            this._placeholder.destroy();
        const padded = (im._iconSize ?? 48) + 12;
        const width = fadeIn ? 0 : padded;
        const placeholder = new St.Widget({
            style_class: "macos-dock-drag-placeholder",
            width,
            height: padded,
            reactive: false,
            opacity: fadeIn ? 0 : 255,
        });
        this._placeholder = placeholder;
        this._ensureDragMonitor();
        const newGap = containerIndexForFavoriteSlot(this._rowAppIds(), im._favorites, slot);
        container.insert_child_at_index(placeholder, newGap);
        this._slideRow(before, oldGap, newGap, oldWidth, width);
        // Every frame of the growth is a change to the row's extent, and the
        // dock's background is sized from that extent, so it has to be asked to
        // look again -- that is what makes the dock breathe with the gap instead
        // of jumping by a slot.
        placeholder.connect("notify::width", () => im.notifyRowChanged());
        if (fadeIn) {
            placeholder.ease({
                width: padded,
                opacity: 255,
                duration: PLACEHOLDER_ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        else {
            // Born at full size, so no `notify::width` is coming: ask once here
            // or the background stays a slot short until the next relayout.
            im.notifyRowChanged();
        }
    }

    /**
     * The box re-flowed in a single allocation, so every child the gap crossed is
     * a whole slot away from where it was a frame ago -- the jump the pointer sees
     * as "the icons teleport". Paint that distance back on each of them and ease it
     * out; `translation` is a transform, so the layout keeps owning `x` and the
     * magnification keeps owning `scale`, and the move reads as a slide.
     */
    _slideRow(before, oldGap, newGap, oldWidth, newWidth) {
        const container = this._iconManager._container;
        const spacing = container.get_layout_manager().spacing;
        const vertical = this._isVertical();
        const axis = vertical ? "translation_y" : "translation_x";
        // gapSlide answers "toward the row's end", which is the left edge in an
        // RTL row; a vertical row is always top-to-bottom and ignores RTL.
        const sign = !vertical && this._isRtl() ? -1 : 1;
        try {
            for (let index = 0; index < before.length; index++) {
                const child = before[index];
                const shift = gapSlide(index, oldGap, newGap, oldWidth, newWidth, spacing);
                if (shift === 0)
                    continue;
                child[axis] = (child[axis] || 0) + shift * sign;
                child.ease({
                    [axis]: 0,
                    duration: GAP_SLIDE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
        catch (_e) {
            // A child can be rebuilt mid-gesture (installed-changed); the slide is
            // cosmetic and must never break the drag.
        }
    }

    /**
     * dash.js:841-851 -- the gap shrinks out, and while it is still shrinking
     * every further move is refused (`_animatingPlaceholdersCount`). That gate is
     * most of why the shell's gap reads as calm instead of buzzing across the row.
     */
    _clearPlaceholder(animate) {
        this._placeholderPos = -1;
        const placeholder = this._placeholder;
        this._placeholder = null;
        if (!placeholder) {
            this._syncDragMonitor();
            return;
        }
        if (!animate) {
            placeholder.destroy();
            this._syncDragMonitor();
            return;
        }
        this._animatingPlaceholders++;
        // The destroy hook is the single release point: it fires whether the
        // shrink completes, the actor is thrown away by a rebuild, or the ease
        // never starts on an already-dead widget. It also hands the slot's width
        // back, because the shrinking gap is still a child until then.
        placeholder.connect("destroy", () => {
            this._animatingPlaceholders--;
            this._iconManager?.notifyRowChanged();
        });
        placeholder.ease({
            width: 0,
            opacity: 0,
            duration: PLACEHOLDER_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => placeholder.destroy(),
        });
        this._syncDragMonitor();
    }

    _setUnpinCue(on) {
        const im = this._iconManager;
        const button = im?._appButton;
        if (!button || this._unpinCueOn === on)
            return;
        this._unpinCueOn = on;
        // A style class rather than a pseudo-class: St matches the pseudo-class
        // list only for the names it knows, and this needs to be plain CSS.
        if (on)
            button.add_style_class_name("macos-dock-drop-target");
        else
            button.remove_style_class_name("macos-dock-drop-target");
        im.setUnpinLabel(on);
        this._syncDragMonitor();
    }

    _clearUnpinCue() {
        this._setUnpinCue(false);
    }

    _warnOnce(message) {
        if (this._warned)
            return;
        this._warned = true;
        console.warn(`${TAG} ${message}`);
    }
}
