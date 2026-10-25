// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { SubshapeSelectionHandler } from "../eventHandlers/shapeSelectionEventHandler";
import type { AsyncController } from "../foundation";
import { PubSub } from "../foundation";
import type { I18nKeys } from "../i18n";
import { Line, type XYZ } from "../math";
import { type INodeFilter, type IShapeFilter, isReferenceGeometryNode } from "../selectionFilter";
import type { ShapeType } from "../shape";
import { ShapeTypeUtils } from "../shape";
import type { SnapResult } from "../snap";
import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    ARROW_HOVER_TOLERANCE,
    ARROW_LENGTH,
    arrowMeshes,
    distanceToSegment,
    pxSizedArrowLength,
} from "../visual/arrowHandle";
import type { VisualShapeData } from "../visual/detectedData";
import type { IView } from "../visual/view";
import { type VisualState, VisualStates } from "../visual/visualShape";
import type { IStep } from "./step";

/** Smallest value the drag can produce; zero-radius fillets/chamfers are invalid. */
const MIN_DRAG_VALUE = 0.1;

/** Where the arrow sits and which value it edits, provided by the command. */
export interface ValueArrowData {
    /** Anchor point in world coordinates — the origin the drag measures from. */
    anchor: XYZ;
    /** Outward drag direction in world coordinates. */
    direction: XYZ;
    value: number;
}

export interface ValueArrowPickCallbacks {
    /** Undefined while nothing is selected — no arrow is shown then. */
    arrowData(): ValueArrowData | undefined;
    setValue(value: number): void;
}

/**
 * What the gesture picks and how a click lands.
 *
 * `shapeType` is the sub-shape kind the arrow edits a value on: edges for a fillet/chamfer's
 * radius, the corner's own surface for the command that EDITS one of those features.
 */
export interface ValueArrowPickOptions {
    readonly shapeType: ShapeType;
    /**
     * Let reference geometry (a datum plane) answer the pick. Off by default, exactly as
     * `SelectShapeStep` treats it: a reference node is not modeling geometry, and a command
     * that replaced one would dangle every sketch/feature referencing it.
     */
    readonly allowReferenceGeometry?: boolean;
    /**
     * Each click REPLACES the selection instead of toggling into it, so exactly one sub-shape
     * is ever selected and the arrow always describes that one. Toggling (the default) is what
     * a fillet's multi-edge pick wants: several edges, one radius.
     */
    readonly replaceSelection?: boolean;
    /**
     * Narrows what the pointer may detect at all — the entries dropped here cannot be
     * highlighted and cannot be clicked. Node-aware on purpose: it is the only detection hook
     * that sees the picked sub-shape's `owner` and `indexes` together (an `IShapeFilter` gets
     * the shape alone, so it cannot look an id up on the body the shape came from).
     */
    readonly admitDetected?: (detected: VisualShapeData[]) => VisualShapeData[];
    /** Narrows what the pointer may detect by the shape itself (sub-shape kind, curve type, …). */
    readonly shapeFilter?: IShapeFilter;
    /** In multiple mode, finish the pick automatically once this returns true. */
    readonly canFinish?: (selected: VisualShapeData[]) => boolean;
    /** How a detected sub-shape is tinted. Defaults to the edge states the base class carries. */
    readonly highlightState?: VisualState;
    readonly selectedState?: VisualState;
    /**
     * Whether a selection that is already there ANSWERS the step. True (the default) for a pick
     * whose value the command already holds — a fillet to append has its radius ready, and the
     * preselected edges are the whole answer. False for a pick that still has to be dragged and
     * confirmed: the selection is only what the gesture starts from, so the pick stays open.
     * A predicate answers per selection, for a pick that is only complete once it holds enough
     * (a 2D corner needs exactly the two edges of one face).
     */
    readonly preselectionAnswers?: boolean | ((selected: VisualShapeData[]) => boolean);
}

/**
 * Sub-shape picking with a draggable value arrow: behaves like the standard subshape
 * multi-pick, but a press on the arrow starts a drag that projects the mouse ray onto the
 * arrow axis and reports the distance as the new value (clamped to MIN_DRAG_VALUE).
 * The arrow renders on top at a fixed pixel size, anchored at `anchor + direction * value`.
 *
 * The pick itself stays multi wherever `replaceSelection` is unset: a single-shape pick
 * would finish the step on the first click (`SelectionHandler.pointerUp`), leaving no
 * chance to touch the arrow.
 */
export class ValueArrowPickHandler extends SubshapeSelectionHandler {
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
        private readonly options: ValueArrowPickOptions,
        nodeFilter: INodeFilter,
        private readonly callbacks: ValueArrowPickCallbacks,
    ) {
        super(document, options.shapeType, true, controller, options.shapeFilter, nodeFilter);
        if (options.admitDetected !== undefined) this.sortDetected = options.admitDetected;
        if (options.canFinish !== undefined) this.canFinish = options.canFinish;
        if (options.highlightState !== undefined) this.highlightState = options.highlightState;
        if (options.selectedState !== undefined) this.selectedState = options.selectedState;
        // No box-select on a pick that can only ever hold one sub-shape.
        if (options.replaceSelection === true) this.showRect = false;
        controller.onCancelled(() => this.dispose());
        controller.onCompleted(() => this.dispose());
        controller.onFailed(() => this.dispose());
    }

    /** A click lands on `_highlights` alone when the pick is one target at a time. */
    protected override select(_view: IView, _event: PointerEvent): number {
        if (!this._highlights?.length) return 0;
        return this.document.selection.setSelectedShapes(
            this._highlights,
            this.selectedState,
            this.multiMode && this.options.replaceSelection !== true,
        );
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

    /** Rebuilds the arrow from the live arrow data; no data (nothing picked) removes it. */
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
    private updateArrowScale(view: IView, data: ValueArrowData) {
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
 * Sub-shape pick step for a value arrow: what the selection already holds answers the step when
 * the options say a preselection is an answer (same rule as GetOrSelectShapeStep), and otherwise
 * seeds the gesture; either way a valid preselection is kept rather than cleared, because it is
 * what the user pointed at before running the command. Without one the step runs a
 * `ValueArrowPickHandler` so the value arrow is available while picking. The active handler is
 * reported through `onHandler` so the command can refresh the arrow when the value changes
 * outside the handler.
 */
export class ValueArrowSelectStep implements IStep {
    constructor(
        private readonly options: ValueArrowPickOptions,
        private readonly nodeFilter: INodeFilter,
        private readonly callbacks: ValueArrowPickCallbacks,
        private readonly onHandler: (handler: ValueArrowPickHandler | undefined) => void,
        private readonly prompt: I18nKeys = "prompt.select.edges",
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const preselected = this.preselected(document);
        if (preselected.length > 0 && this.answersFromPreselection(preselected)) {
            controller.success();
            return toSnapResult(document, preselected);
        }
        if (preselected.length === 0) {
            document.selection.clearSelection();
        } else {
            document.selection.setSelectedShapes(
                preselected,
                this.options.selectedState ?? VisualStates.edgeSelected,
                false,
            );
        }

        const handler = new ValueArrowPickHandler(
            document,
            controller,
            this.options,
            valueArrowNodeFilter(this.options, this.nodeFilter),
            this.callbacks,
        );
        this.onHandler(handler);
        // Up before the first pointer move: a seeded pick would otherwise show its preview and its
        // value row with nothing to drag.
        handler.refreshArrow(document.application.activeView);
        try {
            await document.picker.pickAsync(handler, this.prompt, controller, "selection", "select.default");
        } finally {
            this.onHandler(undefined);
            handler.dispose();
        }

        if (controller.result?.status !== "success") return undefined;
        const shapes = document.selection.getSelectedShapes();
        return shapes.length === 0 ? undefined : toSnapResult(document, shapes);
    }

    /** Whether what is already selected is the whole answer, per the options. */
    private answersFromPreselection(selected: VisualShapeData[]): boolean {
        const answers = this.options.preselectionAnswers;
        if (typeof answers === "function") return answers(selected);
        return answers !== false;
    }

    /**
     * What the selection already holds and this gesture would accept, put through the same
     * admission rule the pointer runs against — a preselection the pick would not have allowed
     * must not answer the step for the user.
     */
    private preselected(document: IDocument): VisualShapeData[] {
        const nodeFilter = valueArrowNodeFilter(this.options, this.nodeFilter);
        const candidates = document.selection
            .getSelectedShapes()
            .filter(
                (x) =>
                    ShapeTypeUtils.contains(this.options.shapeType, x.shape.shapeType) &&
                    (nodeFilter.allow?.(x.owner.node) ?? true) &&
                    (this.options.shapeFilter?.allow(x.shape, x.transform) ?? true),
            );
        return this.options.admitDetected?.(candidates) ?? candidates;
    }
}

/**
 * The caller's node gate composed with the reference-geometry exclusion, exactly as
 * `SelectShapeStep` composes it: a reference node is not modeling geometry, and a command
 * that replaced one would dangle every sketch/feature referencing it. `allowReferenceGeometry`
 * is the opt-out, for a tool that genuinely targets one.
 */
export function valueArrowNodeFilter(options: ValueArrowPickOptions, nodeFilter: INodeFilter): INodeFilter {
    if (options.allowReferenceGeometry === true) return nodeFilter;
    return {
        allow: (node) => !isReferenceGeometryNode(node) && (nodeFilter.allow?.(node) ?? true),
    };
}

function toSnapResult(document: IDocument, shapes: VisualShapeData[]): SnapResult {
    return {
        view: document.application.activeView!,
        shapes,
        nodes: shapes.map((x) => x.owner.node),
        type: "shape",
    };
}
