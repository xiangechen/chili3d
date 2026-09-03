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
    type ShapeMeshData,
    ShapeTypes,
    ShapeTypeUtils,
    type SnapResult,
    SubshapeSelectionHandler,
    type XY,
    type XYZ,
} from "@chili3d/core";

/** Blue handle color, distinct from the green highlight/selection tints. */
const ARROW_COLOR = 0x3b82f6;

/** Lighter blue shown while the pointer hovers the arrow. */
const ARROW_HOVER_COLOR = 0x93c5fd;

const ARROW_HOVER_TOLERANCE = 10; // px, screen-space distance to the arrow shaft

/** Target on-screen arrow length (px); the world length adapts so zooming never resizes the arrow. */
const ARROW_LENGTH_PX = 80;

/** Fallback world length before the first scale measurement. */
const ARROW_LENGTH_FALLBACK = 40;

/** Baseline (world units) for the px/mm measurement; long enough to beat worldToScreen rounding. */
const SCALE_MEASURE_BASELINE = 100;

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

/** Solid cylinder shaft + cone head, starting at `start` and pointing along `direction`. */
function arrowMeshes(start: XYZ, direction: XYZ, length: number, color: number): ShapeMeshData[] {
    const headLength = Math.max(length * 0.45, 8);
    const shaftLength = length - headLength;
    return [
        shapeFactory.cylinder(direction, start, headLength * 0.1, shaftLength),
        shapeFactory.cone(
            direction,
            start.add(direction.multiply(shaftLength)),
            headLength * 0.3,
            0,
            headLength,
        ),
    ].map((shape) => {
        if (!shape.isOk) throw shape.error;
        const mesh = shape.value.mesh.faces!;
        mesh.color = color;
        shape.value.dispose();
        return mesh;
    });
}

function distanceToSegment(x: number, y: number, a: XY, b: XY): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lengthSq = abx * abx + aby * aby;
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * abx + (y - a.y) * aby) / lengthSq));
    return Math.hypot(x - a.x - t * abx, y - a.y - t * aby);
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
            const length = this._arrowLength ?? ARROW_LENGTH_FALLBACK;
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
        const end = start.add(data.direction.multiply(this._arrowLength ?? ARROW_LENGTH_FALLBACK));
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
        // A screen-parallel unit vector: perpendicular to both the view and the arrow
        // direction, falling back to the view's up when the arrow points at the camera.
        const side = view.direction().cross(data.direction).normalize() ?? view.up();
        const a = view.worldToScreen(data.anchor);
        const b = view.worldToScreen(data.anchor.add(side.multiply(SCALE_MEASURE_BASELINE)));
        const pxPerUnit = a.distanceTo(b) / SCALE_MEASURE_BASELINE;
        if (pxPerUnit > 1e-6) {
            this._arrowLength = ARROW_LENGTH_PX / pxPerUnit;
        }
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
        const preselected = document.selection
            .getSelectedShapes()
            .filter(
                (x) =>
                    ShapeTypeUtils.contains(ShapeTypes.edge, x.shape.shapeType) &&
                    (this.nodeFilter.allow?.(x.owner.node) ?? true),
            );
        if (preselected.length > 0) {
            controller.success();
            return {
                view: document.application.activeView!,
                shapes: preselected,
                nodes: preselected.map((x) => x.owner.node),
                type: "shape",
            };
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
        if (shapes.length === 0) return undefined;
        return {
            view: document.application.activeView!,
            shapes,
            nodes: shapes.map((x) => x.owner.node),
            type: "shape",
        };
    }
}
