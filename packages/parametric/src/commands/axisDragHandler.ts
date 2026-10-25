// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    ARROW_HOVER_TOLERANCE,
    ARROW_LENGTH,
    type AsyncController,
    arrowMeshes,
    distanceToSegment,
    type I18nKeys,
    type IDocument,
    type IView,
    Line,
    Precision,
    PubSub,
    pxSizedArrowLength,
    Result,
    type ShapeMeshData,
    XYZ,
} from "@chili3d/core";
import { PreviewConfirmHandler } from "./previewConfirmHandler";

export type { DragPreview } from "./previewConfirmHandler";

const DRAG_THRESHOLD_SQ = 9; // px², below this a press-release is a click, not a drag

/**
 * A `PreviewConfirmHandler` with a draggable arrow on an axis: the press/drag and
 * click-move-click state machine, numeric keypad entry, the pixel-sized arrow, and the
 * camera tracking that keeps it pixel-sized.
 *
 * A subclass says what the arrow *means* — where the axis is (`axis`), what the preview
 * looks like (`buildPreview`), what counts as a committable value (`canConfirm`) — and
 * this class owns everything about the gesture itself.
 */
export abstract class AxisDragHandler extends PreviewConfirmHandler {
    /** World-space arrow length, adapted so the arrow renders at a fixed pixel size. */
    protected arrowLength: number | undefined;

    private _downX: number | undefined;
    private _downY: number | undefined;
    private _dragging = false;
    /** Click-move-click mode: the arrow was clicked, the next click commits the value. */
    private _awaitingClick = false;
    /** Projection of the grab point on the axis minus the value at grab time; keeps dragging continuous. */
    private _grabOffset = 0;
    /** Whether the readout box is up — kept in step with the box itself, via its `onClose`. */
    private _boxShown = false;

    private _arrowIds: number[] = [];
    /** The view whose camera changes are tracked for arrow rescaling. */
    private _cameraView: IView | undefined;
    /** Canonical arrow geometry, keyed by direction and colour, re-placed on every rebuild. */
    private readonly _arrowCache = new Map<string, ShapeMeshData[]>();
    /**
     * A preview rebuild coalesced onto the next animation frame (with the view it refreshes):
     * a pointermove storm would otherwise pay the full preview build — the sketch's profiles,
     * the sweep, the boolean, the meshing — once per event.
     */
    private _previewFrame: number | undefined;
    private _previewView: IView | undefined;

    constructor(document: IDocument, controller: AsyncController) {
        super(document, controller);
    }

    /**
     * The drag's start adds camera tracking to the preview's own start-up — the arrow is
     * pixel-sized, so a zoom must reach it (see `handleCameraChanged`).
     */
    protected override start(): void {
        const view = this.document.application.activeView;
        if (view !== undefined) this.trackCamera(view);
        super.start();
    }

    // ------------------------------------------------------------------ Subclass contract

    /** The drag axis: the pointer ray projects onto this line to give the value. */
    protected abstract axis(): { origin: XYZ; normal: XYZ };
    /** The arrow's world segment; also the drag handle's screen-space hit target. */
    protected abstract arrowSegment(): { start: XYZ; end: XYZ };
    /** The value the drag edits (a depth, an offset, ...). */
    protected abstract currentValue(): number;
    /**
     * What the drag is editing, printed the way the floating box should show it, or undefined
     * for a drag that keeps no box. Read afresh on every step, so the box follows the hand.
     */
    protected dragText(): string | undefined {
        return undefined;
    }
    /** Writes a new value. Implementations report it back to the command here. */
    protected abstract setCurrentValue(value: number): void;
    /** Whether the pointer hovers the arrow. Drives the arrow's highlight colour. */
    protected abstract get arrowHovered(): boolean;
    protected abstract set arrowHovered(value: boolean);

    /**
     * Whether a drag or a click-move gesture is in flight. DOM overlays anchored near the
     * arrow (a session's value badges) read this to go inert while it lasts: the badge is
     * what the browser sees, the mesh handle underneath it is not, so a live badge over the
     * handle would swallow the press that grabs it.
     */
    protected get gestureActive(): boolean {
        return this._dragging || this._awaitingClick;
    }

    /** Whether the click-move gesture is waiting for the click that settles it. */
    protected get awaitingClick(): boolean {
        return this._awaitingClick;
    }

    /**
     * Drops every bit of gesture state the base owns. A subclass can lose the handle a
     * gesture was editing (the value's direction was removed, the arrow went away) — its own
     * bookkeeping is not enough: the base would keep waiting for a settling click or a
     * release that will never come, and swallow the next press.
     */
    protected abandonGesture(): void {
        this._awaitingClick = false;
        this._downX = undefined;
        this._downY = undefined;
        this._dragging = false;
    }
    /** The point the arrow is measured at when sizing it in pixels; must not move with the value. */
    protected scaleAnchor(): XYZ {
        return this.axis().origin;
    }

    /**
     * The world length the arrow is drawn at: exactly the pixel-sized length the view
     * measured. A floor of `ARROW_LENGTH` here would be a floor in WORLD units — at 10 px/mm
     * an 80 px arrow is 8 mm, and a 40 mm minimum would draw it 400 px wide (with the hit
     * test aimed at the same wrong length).
     */
    protected get handleLength(): number {
        return this.arrowLength ?? ARROW_LENGTH;
    }
    /** Called on hover while not dragging, when the pointer is off the arrow. */
    protected onHover(_view: IView, _event: PointerEvent): void {}
    /** Called on a click that neither dragged nor hit the arrow. */
    protected onClick(_view: IView, _event: PointerEvent): void {}
    /** Drops subclass-owned hover highlight. */
    protected clearHover(): void {}
    /**
     * Called after a camera change has rescaled the arrow. Previews sized in pixels (rather
     * than in the world, the way a boolean's ghost is) rebuild here, or they keep the size
     * they were drawn at until the next gesture rebuilds them.
     */
    protected onCameraChanged(_view: IView): void {}

    // ------------------------------------------------------------------ Pointer events

    override pointerMove(view: IView, event: PointerEvent): void {
        this.trackCamera(view);
        if (this._awaitingClick) {
            this.updateDrag(view, event);
        } else if (this._downX !== undefined) {
            if (!this._dragging) {
                const dx = event.offsetX - this._downX;
                const dy = event.offsetY - this._downY!;
                if (dx * dx + dy * dy <= DRAG_THRESHOLD_SQ) return;
                this._dragging = true;
                this._grabOffset = this.projectValue(view, event) - this.currentValue();
                this.clearHover();
            }
            this.updateDrag(view, event);
        } else {
            this.onHover(view, event);
        }
    }

    override pointerDown(view: IView, event: PointerEvent): void {
        if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
        this.trackCamera(view);
        if (this._awaitingClick) return; // the release commits; nothing to track
        // a gesture that keeps no readout of its own takes the last gesture's down first:
        // the box stays up after a drag so the number can still be typed over, but it must
        // not ride on under a drag that has nothing to put in it
        if (this.dragText() === undefined) this.dismissDragBox();
        this._downX = event.offsetX;
        this._downY = event.offsetY;
        this._dragging = false;
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (this._awaitingClick) {
            this.finishMoveMode(view);
            return;
        }
        if (this._downX === undefined) return;
        const wasDragging = this._dragging;
        this._downX = undefined;
        this._downY = undefined;
        this._dragging = false;

        if (wasDragging) {
            // A drag is not a click, and does not open the click-move-click gesture however it
            // settles. Letting go always lands back on the mark — a handle is drawn where the
            // pointer dragging it is — so falling through would leave the very next twitch of
            // the mouse dragging it again, which is not what letting go means. It bites hardest
            // on a drag that cannot settle on a value at all, since that one never takes the
            // branch above: the transform's origin moves the frame rather than the geometry.
            if (this.canConfirm()) this.commitView = view;
            return;
        }
        // A plain click on the arrow starts the click-move-click gesture; Shift keeps its
        // other meaning even on the arrow.
        if (!event.shiftKey && this.isOverArrow(view, event)) {
            this.enterMoveMode(view, event);
            return;
        }
        this.onClick(view, event);
    }

    pointerOut(view: IView, _event: PointerEvent): void {
        this.clearHover();
        if (!this._awaitingClick) this.setArrowHover(view, false);
        view.update();
    }

    mouseWheel(view: IView, _event: WheelEvent): void {
        this.trackCamera(view);
        view.update();
    }

    override keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape" && this._awaitingClick) {
            // The first Escape only leaves the click-move mode; the next cancels.
            event.preventDefault();
            event.stopImmediatePropagation();
            this.exitMoveMode(view);
            return;
        }
        if (event.key !== "Escape" && event.key !== "Enter" && event.key !== " ") {
            this.handleNumericInput(view, event);
            return;
        }
        super.keyDown(view, event);
    }

    // ------------------------------------------------------------------ Command push-back

    /** The command pushes a new value (from the options-tab input) into the drag. */
    setValue(value: number): void {
        if (Math.abs(this.currentValue() - value) < Precision.Float) return;
        this.cancelPendingPreview();
        this.setCurrentValue(value);
        this.refreshTempShapes();
    }

    protected setArrowHover(view: IView, hovered: boolean): void {
        if (this.arrowHovered === hovered) return;
        this.arrowHovered = hovered;
        this.refreshArrow(view);
        view.update();
    }

    // ------------------------------------------------------------------ Gesture internals

    /** Projects the mouse ray onto the drag axis and returns the signed distance from its origin. */
    protected projectValue(view: IView, event: PointerEvent): number {
        const { origin, normal } = this.axis();
        const ray = view.rayAt(event.offsetX, event.offsetY);
        const axisLine = new Line({ point: origin, direction: normal });
        return axisLine.nearestTo(ray.toLine()).sub(origin).dot(normal);
    }

    /** Enters click-move-click mode: grabs the current projection so the value does not jump. */
    protected enterMoveMode(view: IView, event: PointerEvent): void {
        this._awaitingClick = true;
        this._grabOffset = this.projectValue(view, event) - this.currentValue();
        this.clearHover();
        this.setArrowHover(view, true);
    }

    /**
     * The second click of click-move-click: settles a committable value, else leaves the
     * mode. The readout stays up either way — the value is not committed until Enter or
     * the confirm button, and the box is the place to still change it.
     */
    protected finishMoveMode(view: IView): void {
        this._awaitingClick = false;
        if (this.canConfirm()) {
            this.commitView = view;
        } else {
            this.setArrowHover(view, false);
            PubSub.default.pub("clearFloatTip");
        }
    }

    /** Leaves click-move-click mode without committing, resetting the value. */
    protected exitMoveMode(view: IView): void {
        this._awaitingClick = false;
        this.cancelPendingPreview();
        this.resetValue();
        this.setArrowHover(view, false);
        this.refreshTempShapes(view);
        // an abandoned gesture has no value left to show: the box would hold the one the
        // reset just threw away
        this.dismissDragBox();
        PubSub.default.pub("clearFloatTip");
        view.document.visual.update();
    }

    /**
     * What abandoning the click-move gesture resets the drag to: nought for a plain axis.
     * A drag whose nought is somewhere else — a scale's is 1 — answers for itself here.
     */
    protected resetValue(): void {
        this.setCurrentValue(0);
    }

    protected updateDrag(view: IView, event: PointerEvent): void {
        this.setCurrentValue(this.projectValue(view, event) - this._grabOffset);
        this.schedulePreviewRefresh(view);
        this.showDragBox(view);
    }

    /**
     * One preview rebuild per animation frame, the latest value winning. The value and the
     * readout box stay synchronous with the pointer; only the geometry trails. Every path
     * that settles or supersedes the value — confirm, cancel, a typed commit, a push-back
     * — flushes or drops the pending frame synchronously, so nothing ever observes a
     * preview a frame behind the value.
     */
    private schedulePreviewRefresh(view: IView): void {
        this._previewView = view;
        this._previewFrame ??= requestAnimationFrame(() => {
            this._previewFrame = undefined;
            const pendingView = this._previewView;
            this._previewView = undefined;
            if (this.cleaned || pendingView === undefined) return;
            this.refreshTempShapes(pendingView);
        });
    }

    /**
     * Runs the pending frame now, synchronously. `confirm()` is the only caller: the commit
     * proceeds synchronously from the final value, so its preview goes up first. Every path
     * that tears down or rebuilds for itself cancels instead.
     */
    private flushPendingPreview(): void {
        if (this._previewFrame === undefined) return;
        cancelAnimationFrame(this._previewFrame);
        this._previewFrame = undefined;
        const view = this._previewView;
        this._previewView = undefined;
        this.refreshTempShapes(view);
    }

    /** Drops the pending frame — for a path about to rebuild the preview itself. */
    private cancelPendingPreview(): void {
        if (this._previewFrame === undefined) return;
        cancelAnimationFrame(this._previewFrame);
        this._previewFrame = undefined;
        this._previewView = undefined;
    }

    /** The push-back rebuild cannot wait a frame, and must not be doubled by one. */
    override refresh(): void {
        this.cancelPendingPreview();
        super.refresh();
    }

    protected override confirm(): void {
        // A drag may hold a not-yet-drawn frame; the commit proceeds synchronously from
        // here, so the final value's preview goes up now.
        this.flushPendingPreview();
        super.confirm();
    }

    /**
     * The box that rides the drag, showing the value the hand is at. Put up on the first step
     * of a gesture and refreshed from then on; a subclass that wants no box leaves `dragText`
     * undefined and pays nothing.
     *
     * It is put up by the base rather than typed into: the typed-in box is `handleNumericInput`,
     * which needs a digit to get going and would fight this one for the same slot. The handler
     * below is that path's, minus the sign flip — a readout is showing the value the drag has
     * settled on, and re-reading it as an intention to negate would turn every negative move
     * into a positive one the moment anyone pressed Enter.
     */
    private showDragBox(view: IView): void {
        const text = this.dragText();
        if (text === undefined) return;
        if (this._boxShown) {
            PubSub.default.pub("updateInput", text);
            return;
        }
        // Whatever box is up is not this one: it may be the numeric-entry box holding a digit
        // somebody never finished typing, whose handler is a different rule about signs. A
        // readout with that under it would be worse than no readout, so it goes first — and
        // when nothing is up this is the no-op it looks like.
        PubSub.default.pub("clearInput");
        this._boxShown = true;
        PubSub.default.pub("showInput", text, (typed: string) => this.applyTyped(view, typed), {
            // taken as a whole, so a number typed straight away replaces the one the drag is at
            selectAll: true,
            // ...but the box only reports it: the keyboard stays with the drag, or the first
            // Enter would close the box instead of confirming the gesture it rides
            takeFocus: false,
            // the flag rides the box's own lifetime: once it is down, however it came down,
            // the next step of the drag puts a fresh one up rather than updating one long gone
            onClose: () => {
                this._boxShown = false;
            },
        });
    }

    /**
     * Takes the readout box down, for a value that did not come from the drag. Leaving it up
     * would leave it holding a number the drag no longer has — and it is an input, so the next
     * Enter in it would put that stale number back.
     */
    protected dismissDragBox(): void {
        if (!this._boxShown) return;
        this._boxShown = false;
        PubSub.default.pub("clearInput");
    }

    private applyTyped(view: IView, text: string): Result<string, I18nKeys> {
        const value = Number(text);
        if (Number.isNaN(value)) return Result.err("error.input.invalidNumber" as I18nKeys);

        this.cancelPendingPreview();
        this.setCurrentValue(value);
        this.refreshTempShapes(view);
        return Result.ok(text);
    }

    private handleNumericInput(view: IView, event: KeyboardEvent): void {
        if (!["#", "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) return;

        PubSub.default.pub("showInput", event.key, (text: string) => {
            if (Number.isNaN(Number(text))) return Result.err("error.input.invalidNumber" as I18nKeys);

            const value = Number(text);
            this.cancelPendingPreview();
            this.setCurrentValue(this.currentValue() < -Precision.Float ? -value : value);
            // The command's push-back is guarded against feeding the drag its own value
            // (see the `onOffset`/`onDist` setters), so neither path redraws for us — a
            // typed length has to repaint the preview here or it moves on screen never.
            this.refreshTempShapes(view);
            this.commitView = view;
            return Result.ok(text);
        });
    }

    /** Screen-space hit test against the arrow shaft segment. */
    protected isOverArrow(view: IView, event: PointerEvent): boolean {
        const { start, end } = this.arrowSegment();
        // A collapsed arrow (nothing picked yet) has no handle: a degenerate screen segment
        // would otherwise make the world origin hoverable.
        if (start.distanceTo(end) < Precision.Float) return false;
        const a = view.worldToScreen(start);
        const b = view.worldToScreen(end);
        return distanceToSegment(event.offsetX, event.offsetY, a, b) <= ARROW_HOVER_TOLERANCE;
    }

    // ------------------------------------------------------------------ The arrow (the base's handle)

    protected override refreshHandle(view?: IView): void {
        this.refreshArrow(view);
    }

    protected override removeHandle(): void {
        for (const id of this._arrowIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._arrowIds = [];
    }

    protected refreshArrow(view?: IView): void {
        if (view !== undefined) this.updateArrowScale(view);
        this.removeHandle();
        const context = this.document.visual.context;
        for (const mesh of this.buildArrowMeshes()) {
            this._arrowIds.push(context.displayMesh([mesh], { meshOpacity: 1, onTop: true }));
        }
        this.document.visual.update();
    }

    /** The arrow at its world position, reusing the canonical geometry for its direction. */
    private buildArrowMeshes(): ShapeMeshData[] {
        const { start, end } = this.arrowSegment();
        const direction = end.sub(start).normalize();
        if (direction === undefined) return [];
        return this.arrowMeshesAt(start, direction, this.arrowHovered ? ARROW_HOVER_COLOR : ARROW_COLOR);
    }

    /**
     * An arrow of `length` starting at `start`, pointing along `direction`. The canonical
     * geometry is cached by direction and colour, so a hover, a drag frame or a panel edit
     * re-places the same buffers rather than asking the kernel to build a cylinder and a
     * cone again — a subclass that draws more than one arrow (the pattern preview's per
     * direction) shares the cache through this method.
     */
    protected arrowMeshesAt(start: XYZ, direction: XYZ, color: number): ShapeMeshData[] {
        const key = `${direction.x},${direction.y},${direction.z},${color}`;
        let arrow = this._arrowCache.get(key);
        if (arrow === undefined) {
            arrow = arrowMeshes(XYZ.zero, direction, ARROW_LENGTH, color);
            this._arrowCache.set(key, arrow);
        }
        const scale = this.handleLength / ARROW_LENGTH;
        return arrow.map((mesh) => ({
            ...mesh,
            position: scaleAndTranslate(mesh.position, start, scale),
        }));
    }

    /** Adapts the world-space arrow length so the arrow renders at a fixed pixel size. */
    private updateArrowScale(view: IView): void {
        const anchor = this.scaleAnchor();
        const length = pxSizedArrowLength(view, anchor, this.axis().normal);
        if (length !== undefined) this.arrowLength = length;
    }

    /**
     * The drag's own teardown, ahead of the preview meshes (see the base class's cleanup
     * protocol): unhook the camera first — its next change would rescale an arrow that is
     * about to come down.
     */
    protected override onCleanupStart(): void {
        this._cameraView?.cameraController.removePropertyChanged(this.handleCameraChanged);
        this._cameraView = undefined;
        // A frame still pending here belongs to a gesture being torn down: the meshes it
        // would build are removed a statement later, before anything renders them. Only
        // confirm() flushes — the commit proceeds synchronously from the final value.
        this.cancelPendingPreview();
        this.clearHover();
        PubSub.default.pub("clearInput");
    }

    /**
     * The viewport dispatches the wheel event to this handler before the camera zooms,
     * so rescaling there would use the stale camera. Track camera changes instead:
     * `cameraPosition` is emitted after every zoom/pan/rotate.
     */
    private trackCamera(view: IView): void {
        if (this._cameraView === view) return;
        this._cameraView?.cameraController.removePropertyChanged(this.handleCameraChanged);
        this._cameraView = view;
        view.cameraController.onPropertyChanged(this.handleCameraChanged);
    }

    private readonly handleCameraChanged = () => {
        if (this._cameraView !== undefined && !this.cleaned) {
            this.refreshArrow(this._cameraView);
            this.onCameraChanged(this._cameraView);
        }
    };
}

/** Uniformly scales canonical arrow geometry and moves it to `offset`. */
function scaleAndTranslate(data: Float32Array, offset: XYZ, scale: number): Float32Array {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 3) {
        out[i] = data[i] * scale + offset.x;
        out[i + 1] = data[i + 1] * scale + offset.y;
        out[i + 2] = data[i + 2] * scale + offset.z;
    }
    return out;
}
