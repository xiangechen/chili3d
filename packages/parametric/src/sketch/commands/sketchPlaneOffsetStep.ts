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
import { DATUM_PREVIEW_SIZE, datumQuad, datumQuadCenter } from "./planePreview";

const GUIDE_COLOR = 0x4a9eff;
const AXIS_X_COLOR = 0xd9534f;
const AXIS_Y_COLOR = 0x5cb85c;

export interface OffsetDragData {
    /** The plane the offset is measured from — the picked face or global datum plane. */
    basePlane: Plane;
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

    // ------------------------------------------------------------------ AxisDragHandler hooks

    protected override axis(): { origin: XYZ; normal: XYZ } {
        return { origin: this.data.basePlane.origin, normal: this.data.basePlane.normal };
    }

    /**
     * The arrow sits on the offset plane and points along the drag direction, so its
     * position *is* the offset readout. It starts at the quad's centre rather than the
     * plane's origin, which is a corner of the drawn quad — a handle has to sit on the
     * plane it moves, and the drag's own projection is unaffected either way.
     */
    protected override arrowSegment() {
        const plane = this.plane;
        const start = this.quadCenter(plane);
        const dir = this._offset < -Precision.Float ? plane.normal.multiply(-1) : plane.normal;
        return { start, end: start.add(dir.multiply(this.arrowLength ?? ARROW_LENGTH)) };
    }

    /** Measured at the base plane's centre so the arrow does not pulse as the offset moves it. */
    protected override scaleAnchor(): XYZ {
        return this.quadCenter(this.data.basePlane);
    }

    /** Centre of the preview quad on `plane` — where the handle and the guide line sit. */
    private quadCenter(plane: Plane): XYZ {
        return datumQuadCenter(plane, DATUM_PREVIEW_SIZE);
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
            meshes: [datumQuad(this.plane, DATUM_PREVIEW_SIZE), ...this.guideLine(), ...this.axisMarks()],
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

    /** Ties the offset plane back to the base plane it came from, so the shift reads as one. */
    private guideLine(): ShapeMeshData[] {
        const from = this.quadCenter(this.data.basePlane);
        const to = this.quadCenter(this.plane);
        if (from.distanceTo(to) < Precision.Float) return [];
        return [MeshDataUtils.createEdgeMesh(from, to, GUIDE_COLOR, "solid")];
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
