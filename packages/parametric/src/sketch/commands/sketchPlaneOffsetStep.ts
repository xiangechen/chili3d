// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type I18nKeys,
    type IDocument,
    type IStep,
    type IView,
    MeshDataUtils,
    type Plane,
    Precision,
    type ShapeMeshData,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { ARROW_LENGTH } from "../../commands/arrowHandle";
import { AxisDragHandler, type DragPreview } from "../../commands/axisDragHandler";
import { DATUM_PREVIEW_SIZE, datumQuadAt, datumQuadCenter } from "./planePreview";

const GUIDE_COLOR = 0x4a9eff;
const AXIS_X_COLOR = 0xd9534f;
const AXIS_Y_COLOR = 0x5cb85c;

export interface OffsetDragData {
    /** The plane the offset is measured from — the picked face or global datum plane. */
    basePlane: Plane;
    /**
     * The frame the preview quad is drawn in, when it differs from `basePlane`'s: a datum pick
     * passes its display frame (see `datumDisplayPlane`), so the quad lands where the picker
     * showed it instead of jumping to the other side of the axis the sketch planes are handed
     * around. Same plane, same normal — only the in-plane axes differ.
     */
    quadPlane?: Plane;
    /**
     * The point the user picked on the base plane, when the pick was on real geometry. The
     * preview centres on it, so the quad closes around the pointer and the drag arrow — the
     * handle the user has to reach next — starts under it. A datum pick passes none: its quad
     * is a stand-in the picker drew at a fixed place, and the preview has to read as that same
     * quad moving rather than as one that jumped to the cursor.
     */
    pickPoint?: XYZ;
    /** The command's current offset, so the arrow starts in sync with its input. */
    offset?: number;
    onReady?(handler: SketchPlaneOffsetHandler): void;
    onDone?(): void;
    /** The handler reports the signed offset so the command syncs its input. */
    onOffset?(offset: number): void;
}

/**
 * Places the pending sketch plane: a translucent quad sits on it, a normals arrow drags
 * it, and a guide line ties it back to the plane it was picked on. The offset is what
 * the command persists — the quad only shows where that offset lands.
 *
 * Unlike the extrude's drag, a zero offset is a perfectly good result, so confirm is
 * always allowed and the step commits without any drag at all.
 */
export class SketchPlaneOffsetStep implements IStep {
    constructor(
        readonly tip: I18nKeys,
        private readonly handleStepData: () => OffsetDragData,
    ) {}

    async execute(document: IDocument, controller: AsyncController): Promise<SnapResult | undefined> {
        const data = this.handleStepData();
        const handler = new SketchPlaneOffsetHandler(document, controller, data);
        try {
            await document.picker.pickAsync(handler, this.tip, controller, "none", "draw");
        } finally {
            handler.dispose();
        }

        const view = handler.commitView;
        if (controller.result?.status !== "success" || view === undefined) return undefined;

        return {
            view,
            point: handler.plane.origin,
            distance: Math.abs(handler.offset),
            shapes: [],
            type: "input",
            plane: handler.plane,
        };
    }
}

export class SketchPlaneOffsetHandler extends AxisDragHandler {
    private _offset: number;
    private _arrowHovered = false;

    constructor(
        document: IDocument,
        controller: AsyncController,
        readonly data: OffsetDragData,
    ) {
        super(document, controller);
        this._offset = data.offset ?? 0;
        this.start();
    }

    get offset(): number {
        return this._offset;
    }

    /** The plane at the current offset — where the sketch will be created. */
    get plane(): Plane {
        return this.data.basePlane.offsetAlongNormal(this._offset);
    }

    /** The quad's plane at the current offset — `plane`'s frame for a face pick. */
    private get quadPlane(): Plane {
        return (this.data.quadPlane ?? this.data.basePlane).offsetAlongNormal(this._offset);
    }

    // ------------------------------------------------------------------ AxisDragHandler hooks

    protected override axis(): { origin: XYZ; normal: XYZ } {
        return { origin: this.data.basePlane.origin, normal: this.data.basePlane.normal };
    }

    /**
     * The arrow sits on the offset plane and points along the drag direction, so its
     * position *is* the offset readout. It starts at the preview's centre rather than at
     * the plane's origin — which is a corner of the drawn quad, and for a face pick may be
     * nowhere near either the quad or the part. A handle has to sit on the plane it moves,
     * and the drag's own projection is unaffected either way.
     */
    protected override arrowSegment() {
        const start = this.previewCenter();
        const normal = this.data.basePlane.normal;
        const dir = this._offset < -Precision.Float ? normal.multiply(-1) : normal;
        return { start, end: start.add(dir.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    /** Measured at the base centre so the arrow does not pulse as the offset moves it. */
    protected override scaleAnchor(): XYZ {
        return this.baseCenter();
    }

    /**
     * The preview's centre on the base plane: the point the user picked, or — for a datum,
     * which has none — the centre of the quad its display frame draws.
     */
    private baseCenter(): XYZ {
        return (
            this.data.pickPoint ??
            datumQuadCenter(this.data.quadPlane ?? this.data.basePlane, DATUM_PREVIEW_SIZE)
        );
    }

    /** That centre moved along the normal — where the quad, the handle and the guide line sit. */
    private previewCenter(): XYZ {
        return this.baseCenter().add(this.data.basePlane.normal.multiply(this._offset));
    }

    /** Ties the offset plane back to the base plane it came from, so the shift reads as one. */
    private guideLine(): ShapeMeshData[] {
        const from = this.baseCenter();
        const to = this.previewCenter();
        if (from.distanceTo(to) < Precision.Float) return [];
        return [MeshDataUtils.createEdgeMesh(from, to, GUIDE_COLOR, "solid")];
    }

    protected override currentValue(): number {
        return this._offset;
    }

    protected override setCurrentValue(value: number): void {
        this._offset = value;
        this.data.onOffset?.(value);
    }

    protected override get arrowHovered(): boolean {
        return this._arrowHovered;
    }
    protected override set arrowHovered(value: boolean) {
        this._arrowHovered = value;
    }

    /** The plane itself, plus the marks that show the sketch frame it will carry. */
    protected override buildPreview(): DragPreview {
        return {
            meshes: [
                datumQuadAt(this.quadPlane, this.previewCenter(), DATUM_PREVIEW_SIZE),
                ...this.guideLine(),
                ...this.axisMarks(),
            ],
        };
    }

    protected override previewOpacity(): number {
        return 0.25;
    }

    /** A plane being placed must not disappear behind a body — it is what is being aimed. */
    protected override previewOnTop(): boolean {
        return true;
    }

    protected override onReady(): void {
        this.data.onReady?.(this);
    }

    protected override onHover(view: IView, event: PointerEvent): void {
        // Covers the case where no active view was available at construction time.
        if (this.arrowLength === undefined) this.refreshArrow(view);
        this.setArrowHover(view, this.isOverArrow(view, event));
    }

    protected override onCleanup(): void {
        this.data.onDone?.();
    }

    /** The sketch origin and its x/y axes, so the frame the user is about to draw in is visible. */
    private axisMarks(): ShapeMeshData[] {
        const { origin, xvec, yvec } = this.plane;
        const length = DATUM_PREVIEW_SIZE / 6;
        return [
            MeshDataUtils.createEdgeMesh(origin, origin.add(xvec.multiply(length)), AXIS_X_COLOR, "solid"),
            MeshDataUtils.createEdgeMesh(origin, origin.add(yvec.multiply(length)), AXIS_Y_COLOR, "solid"),
        ];
    }
}
