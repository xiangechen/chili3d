// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type INodeFilter,
    type IStep,
    type IView,
    Line,
    PubSub,
    ShapeTypes,
    ShapeTypeUtils,
    type SnapResult,
    SubshapeSelectionHandler,
    type VisualShapeData,
    type XYZ,
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

/** Smallest value the drag can produce; zero-radius fillets/chamfers are invalid. */
const MIN_DRAG_VALUE = 0.1;

/** Where the arrow sits and which value it edits, provided by the command. */
export interface EdgeCornerArrowData {
    /** Edge midpoint in world coordinates. */
    anchor: XYZ;
    /** Outward drag direction in world coordinates. */
    direction: XYZ;
    value: number;
}

export interface EdgeCornerPickCallbacks {
    /** Undefined while no edge is selected — no arrow is shown then. */
    arrowData(): EdgeCornerArrowData | undefined;
    setValue(value: number): void;
}

/**
 * Multi-edge picking with a draggable value arrow: behaves like the standard subshape
 * multi-pick, but a press on the arrow starts a drag that projects the mouse ray onto
 * the arrow axis and reports the distance as the new value (clamped to MIN_DRAG_VALUE).
 * The arrow renders on top at a fixed pixel size, anchored at `anchor + direction * value`.
 */
export class EdgeCornerPickHandler extends SubshapeSelectionHandler {
    private _arrowIds: number[] = [];
    private _hovered = false;
    private _dragging = false;
    /** Projection of the grab point on the axis minus value at grab time; keeps dragging continuous. */
    private _grabOffset = 0;
    private _arrowLength: number | undefined;
    private _cameraView: IView | undefined;

    constructor(
        document: IDocument,
        controller: AsyncController,
        nodeFilter: INodeFilter,
        private readonly callbacks: EdgeCornerPickCallbacks,
    ) {
        super(document, ShapeTypes.edge, true, controller, undefined, nodeFilter);
        controller.onCancelled(() => this.dispose());
        controller.onCompleted(() => this.dispose());
        controller.onFailed(() => this.dispose());
    }

    override pointerDown(view: IView, event: PointerEvent): void {
        this.trackCamera(view);
        if (event.button === 0 && event.isPrimary && this.isOverArrow(view, event)) {
            // Skip super: no selection rect, no pick on release.
            this._dragging = true;
            this._grabOffset = this.projectValue(view, event) - (this.callbacks.arrowData()?.value ?? 0);
            this.pointerEventMap.set(event.pointerId, event);
            return;
        }
        super.pointerDown(view, event);
    }

    override pointerMove(view: IView, event: PointerEvent): void {
        this.trackCamera(view);
        if (this._dragging) {
            const value = Math.max(this.projectValue(view, event) - this._grabOffset, MIN_DRAG_VALUE);
            this.callbacks.setValue(value);
            this.refreshArrow(view);
            PubSub.default.pub("showFloatTip", { level: "info", msg: value.toFixed(2) });
            return;
        }
        super.pointerMove(view, event);
        const hovered = this.isOverArrow(view, event);
        if (hovered !== this._hovered) {
            this._hovered = hovered;
            this.refreshArrow(view);
        }
    }

    override pointerUp(view: IView, event: PointerEvent): void {
        if (this._dragging) {
            this._dragging = false;
            this.pointerEventMap.delete(event.pointerId);
            PubSub.default.pub("clearFloatTip");
            return;
        }
        super.pointerUp(view, event);
    }

    /** Rebuilds the arrow from the live arrow data; no data (no edges picked) removes it. */
    refreshArrow(view?: IView) {
        for (const id of this._arrowIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._arrowIds = [];

        const data = this.callbacks.arrowData();
        if (data !== undefined) {
            if (view !== undefined) this.updateArrowScale(view, data);
            const length = this._arrowLength ?? ARROW_LENGTH;
            const start = data.anchor.add(data.direction.multiply(data.value));
            const color = this._hovered ? ARROW_HOVER_COLOR : ARROW_COLOR;
            for (const mesh of arrowMeshes(start, data.direction, length, color)) {
                this._arrowIds.push(
                    this.document.visual.context.displayMesh([mesh], { meshOpacity: 1, onTop: true }),
                );
            }
        }
        this.document.visual.update();
    }

    /** Screen-space hit test against the arrow shaft segment. */
    private isOverArrow(view: IView, event: PointerEvent): boolean {
        const data = this.callbacks.arrowData();
        if (data === undefined) return false;
        const start = data.anchor.add(data.direction.multiply(data.value));
        const end = start.add(data.direction.multiply(this._arrowLength ?? ARROW_LENGTH));
        const a = view.worldToScreen(start);
        const b = view.worldToScreen(end);
        return distanceToSegment(event.offsetX, event.offsetY, a, b) <= ARROW_HOVER_TOLERANCE;
    }

    /** Projects the mouse ray onto the arrow axis and returns the signed distance from the anchor. */
    private projectValue(view: IView, event: PointerEvent): number {
        const data = this.callbacks.arrowData()!;
        const ray = view.rayAt(event.offsetX, event.offsetY);
        const axis = new Line({ point: data.anchor, direction: data.direction });
        return axis.nearestTo(ray.toLine()).sub(data.anchor).dot(data.direction);
    }

    /** Adapts the world-space arrow length so the arrow renders at a fixed pixel size. */
    private updateArrowScale(view: IView, data: EdgeCornerArrowData) {
        const length = pxSizedArrowLength(view, data.anchor, data.direction);
        if (length !== undefined) this._arrowLength = length;
    }

    /**
     * The viewport dispatches the wheel event to this handler before the camera zooms,
     * so rescaling there would use the stale camera. Track camera changes instead:
     * `cameraPosition` is emitted after every zoom/pan/rotate.
     */
    private trackCamera(view: IView) {
        if (this._cameraView === view) return;
        this._cameraView?.cameraController.removePropertyChanged(this.handleCameraChanged);
        this._cameraView = view;
        view.cameraController.onPropertyChanged(this.handleCameraChanged);
    }

    private readonly handleCameraChanged = () => {
        if (this._cameraView !== undefined) this.refreshArrow(this._cameraView);
    };

    protected override disposeInternal() {
        super.disposeInternal();
        this._cameraView?.cameraController.removePropertyChanged(this.handleCameraChanged);
        this._cameraView = undefined;
        for (const id of this._arrowIds) {
            this.document.visual.context.removeMesh(id);
        }
        this._arrowIds = [];
        PubSub.default.pub("clearFloatTip");
        this.document.visual.update();
    }
}

/**
 * Edge pick step for fillet/chamfer: reuses a valid preselection (same rule as
 * GetOrSelectShapeStep), otherwise runs an EdgeCornerPickHandler so the value arrow
 * is available while picking. The active handler is reported through `onHandler` so
 * the command can refresh the arrow when the value changes outside the handler.
 */
export class EdgeCornerSelectStep implements IStep {
    constructor(
        private readonly nodeFilter: INodeFilter,
        private readonly callbacks: EdgeCornerPickCallbacks,
        private readonly onHandler: (handler: EdgeCornerPickHandler | undefined) => void,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const preselected = this.preselectedEdges(document);
        if (preselected.length > 0) {
            controller.success();
            return toSnapResult(document, preselected);
        }

        document.selection.clearSelection();
        const handler = new EdgeCornerPickHandler(document, controller, this.nodeFilter, this.callbacks);
        this.onHandler(handler);
        try {
            await document.picker.pickAsync(
                handler,
                "prompt.select.edges",
                controller,
                true,
                "select.default",
            );
        } finally {
            this.onHandler(undefined);
            handler.dispose();
        }

        if (controller.result?.status !== "success") return undefined;
        const shapes = document.selection.getSelectedShapes();
        return shapes.length === 0 ? undefined : toSnapResult(document, shapes);
    }

    private preselectedEdges(document: IDocument): VisualShapeData[] {
        return document.selection
            .getSelectedShapes()
            .filter(
                (x) =>
                    ShapeTypeUtils.contains(ShapeTypes.edge, x.shape.shapeType) &&
                    (this.nodeFilter.allow?.(x.owner.node) ?? true),
            );
    }
}

function toSnapResult(document: IDocument, shapes: VisualShapeData[]): SnapResult {
    return {
        view: document.application.activeView!,
        shapes,
        nodes: shapes.map((x) => x.owner.node),
        type: "shape",
    };
}
