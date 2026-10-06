// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type I18nKeys,
    type IDocument,
    type IEventHandler,
    type INode,
    type IView,
    Line,
    Precision,
    PubSub,
    Result,
    type ShapeMeshData,
    XYZ,
} from "@chili3d/core";
import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    ARROW_HOVER_TOLERANCE,
    ARROW_LENGTH,
    arrowMeshes,
    distanceToSegment,
    pxSizedArrowLength,
} from "./arrowHandle";

const DRAG_THRESHOLD_SQ = 9; // px², below this a press-release is a click, not a drag

/** What a drag preview contributes: meshes to draw, and the nodes it stands in for. */
export interface DragPreview {
    meshes: ShapeMeshData[];
    /**
     * Nodes whose display the preview replaces — hidden for as long as it is shown.
     * A boolean preview *is* the target body with the operation applied, so the body
     * has to come down: drawn together, the two overlap and the result reads as a
     * ghost over the geometry it replaces instead of as the geometry itself.
     */
    hide?: INode[];
}

/**
 * Shared skeleton of a "drag an arrow along an axis" handler: the press/drag and
 * click-move-click state machine, numeric keypad entry, the confirm control, the
 * pixel-sized arrow, and the temp-mesh lifecycle.
 *
 * A subclass says what the arrow *means* — where the axis is (`axis`), what the preview
 * looks like (`buildPreview`), what counts as a committable value (`canConfirm`) — and
 * this class owns everything about the gesture itself.
 */
export abstract class AxisDragHandler implements IEventHandler {
    isEnabled: boolean = true;

    /** The view that committed the drag, handed back to the step. */
    commitView: IView | undefined;

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
    private _previewIds: number[] = [];
    /** Nodes the displayed preview hid (see `DragPreview.hide`). */
    private _hidden: INode[] = [];
    /** The view whose camera changes are tracked for arrow rescaling. */
    private _cameraView: IView | undefined;
    private _cleaned = false;
    /** Canonical arrow geometry, keyed by direction and colour, re-placed on every rebuild. */
    private readonly _arrowCache = new Map<string, ShapeMeshData[]>();

    constructor(
        readonly document: IDocument,
        readonly controller: AsyncController,
    ) {
        controller.onCancelled(() => this.cleanup());
        controller.onCompleted(() => this.cleanup());
        controller.onFailed(() => this.cleanup());
    }

    /**
     * Puts the gesture on screen. The subclass calls this at the END of its own
     * constructor, once its state is in place — the hooks this triggers (`arrowSegment`,
     * `buildPreview`, ...) all read it, and during `super(...)` the subclass's fields do
     * not exist yet.
     */
    protected start(): void {
        const view = this.document.application.activeView;
        if (view !== undefined) this.trackCamera(view);
        this.refreshTempShapes(view);
        this.publishConfirmControl();
        this.onReady();
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

    /** Preview geometry for the current value. */
    protected buildPreview(): DragPreview {
        return { meshes: [] };
    }
    /** Whether the current value may be committed. */
    protected canConfirm(): boolean {
        return true;
    }
    /** The point the arrow is measured at when sizing it in pixels; must not move with the value. */
    protected scaleAnchor(): XYZ {
        return this.axis().origin;
    }
    /** How opaque the preview meshes are drawn. */
    protected previewOpacity(): number {
        return 1;
    }
    /**
     * Whether the preview's faces keep their own colour instead of being shaded. Overlays
     * whose colour *is* the information (a handle's state, a marker) want this; previews that
     * stand in for geometry stay lit so they read as solids.
     */
    protected previewUnlit(): boolean {
        return false;
    }
    /**
     * Whether the preview ignores depth. A preview that stands in for a solid (a boolean
     * result) stays behind whatever is in front of it; a plane being placed does not.
     */
    protected previewOnTop(): boolean {
        return false;
    }
    /** Called once the handler is live and its first preview is up. */
    protected onReady(): void {}
    /** Called on hover while not dragging, when the pointer is off the arrow. */
    protected onHover(_view: IView, _event: PointerEvent): void {}
    /** Called on a click that neither dragged nor hit the arrow. */
    protected onClick(_view: IView, _event: PointerEvent): void {}
    /** Drops subclass-owned hover highlight. */
    protected clearHover(): void {}
    /** Runs after the preview meshes are up — ghosts, sibling display, ... */
    protected afterPreview(): void {}
    /**
     * Called after a camera change has rescaled the arrow. Previews sized in pixels (rather
     * than in the world, the way a boolean's ghost is) rebuild here, or they keep the size
     * they were drawn at until the next gesture rebuilds them.
     */
    protected onCameraChanged(_view: IView): void {}
    /** Extra teardown beyond the temp meshes this class owns. */
    protected onCleanup(): void {}

    // ------------------------------------------------------------------ Pointer events

    pointerMove(view: IView, event: PointerEvent): void {
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

    pointerDown(view: IView, event: PointerEvent): void {
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

    pointerUp(view: IView, event: PointerEvent): void {
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

    keyDown(view: IView, event: KeyboardEvent): void {
        if (event.key === "Escape") {
            if (this._awaitingClick) {
                // The first Escape only leaves the click-move mode; the next cancels.
                event.preventDefault();
                event.stopImmediatePropagation();
                this.exitMoveMode(view);
                return;
            }
            this.controller.cancel();
        } else if (event.key === "Enter" || event.key === " ") {
            // Enter/Space confirms the pending value (and must not trigger HotKeyService).
            event.preventDefault();
            event.stopImmediatePropagation();
            this.confirm();
        } else {
            this.handleNumericInput(view, event);
        }
    }

    dispose(): void {
        this.cleanup();
    }

    // ------------------------------------------------------------------ Command push-back

    /** The command pushes a new value (from the options-tab input) into the drag. */
    setValue(value: number): void {
        if (Math.abs(this.currentValue() - value) < Precision.Float) return;
        this.setCurrentValue(value);
        this.refreshTempShapes();
    }

    /** The command asks for a preview rebuild after an option changed. */
    refresh(): void {
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
        this.refreshTempShapes(view);
        this.showDragBox(view);
        view.document.visual.update();
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

        this.setCurrentValue(value);
        this.refreshTempShapes(view);
        return Result.ok(text);
    }

    protected confirm(): void {
        if (!this.canConfirm()) return;
        // The button/Enter has no pointer event to provide the view, so fall back to the
        // active view; without it the step returns undefined and the command closes as if
        // cancelled (e.g. confirming a cached value without dragging).
        if (this.commitView === undefined) {
            this.commitView = this.document.application.activeView;
        }
        this.controller.success();
    }

    /**
     * Shows the confirm/cancel buttons for the whole step (not just after a release), so
     * a user who only edits the options tab can still commit. The bare bar, not the
     * selection one: a drag has no picked shapes to count.
     */
    private publishConfirmControl(): void {
        PubSub.default.pub("showConfirmControl", {
            success: () => this.confirm(),
            cancel: () => this.controller.cancel(),
        } as unknown as AsyncController);
    }

    private handleNumericInput(view: IView, event: KeyboardEvent): void {
        if (!["#", "-", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(event.key)) return;

        PubSub.default.pub("showInput", event.key, (text: string) => {
            if (Number.isNaN(Number(text))) return Result.err("error.input.invalidNumber" as I18nKeys);

            const value = Number(text);
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
        const a = view.worldToScreen(start);
        const b = view.worldToScreen(end);
        return distanceToSegment(event.offsetX, event.offsetY, a, b) <= ARROW_HOVER_TOLERANCE;
    }

    // ------------------------------------------------------------------ Temp meshes

    protected refreshTempShapes(view?: IView): void {
        this.refreshArrow(view);
        for (const id of this._previewIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._previewIds = [];
        this.restoreHiddenNodes();
        const preview = this.buildPreview();
        for (const mesh of preview.meshes) {
            this._previewIds.push(
                this.document.visual.context.displayMesh([mesh], {
                    meshOpacity: this.previewOpacity(),
                    onTop: this.previewOnTop(),
                    unlit: this.previewUnlit(),
                }),
            );
        }
        for (const node of preview.hide ?? []) {
            this.document.visual.context.setVisible(node, false);
            this._hidden.push(node);
        }
        this.afterPreview();
        this.document.visual.update();
    }

    protected refreshArrow(view?: IView): void {
        if (view !== undefined) this.updateArrowScale(view);
        for (const id of this._arrowIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._arrowIds = [];
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
        const color = this.arrowHovered ? ARROW_HOVER_COLOR : ARROW_COLOR;
        const key = `${direction.x},${direction.y},${direction.z},${color}`;
        let meshes = this._arrowCache.get(key);
        if (meshes === undefined) {
            meshes = arrowMeshes(XYZ.zero, direction, ARROW_LENGTH, color);
            this._arrowCache.set(key, meshes);
        }
        const scale = (this.arrowLength ?? ARROW_LENGTH) / ARROW_LENGTH;
        return meshes.map((mesh) => ({
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
     * Brings back the nodes the displayed preview hid. Each goes back to what its own
     * flags say rather than to visible: a hidden body can still be the preview's target.
     */
    private restoreHiddenNodes(): void {
        for (const node of this._hidden) {
            this.document.visual.context.setVisible(node, node.visible && node.parentVisible);
        }
        this._hidden = [];
    }

    private removeTempShapes(): void {
        for (const id of [...this._arrowIds, ...this._previewIds]) {
            this.document.visual.context.removeMesh(id);
        }
        this._arrowIds = [];
        this._previewIds = [];
        this.restoreHiddenNodes();
    }

    protected cleanup(): void {
        if (this._cleaned) return;
        this._cleaned = true;
        this._cameraView?.cameraController.removePropertyChanged(this.handleCameraChanged);
        this._cameraView = undefined;
        this.removeTempShapes();
        this.clearHover();
        this.onCleanup();
        PubSub.default.pub("clearInput");
        PubSub.default.pub("clearConfirmControl");
        this.document.visual.update();
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
        if (this._cameraView !== undefined && !this._cleaned) {
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
