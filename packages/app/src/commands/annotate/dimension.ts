// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    DimensionAnnotation,
    Dimensions,
    formatMeasurement,
    type IStep,
    type IView,
    nearestDimensionNormal,
    Plane,
    PointOnPlaneStep,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    XYZ,
} from "@chili3d/core";
import { AnnotationCommandBase } from "./annotationCommandBase";

/** Viewport axis-inference colors, matching the usual CAD red/green/blue axis convention. */
function axisColor(axis: XYZ): number {
    if (axis.x !== 0) return 0xff0000;
    return axis.y !== 0 ? 0x00a000 : 0x0000ff;
}

/** Pull-direction snap tolerance for axis inference, as a direction cosine (≈15°). */
const AXIS_SNAP_COS = Math.cos((15 * Math.PI) / 180);
/** A screen segment or drag shorter than this (px) carries no reliable direction. */
const MIN_SCREEN_DIRECTION_PX = 2;

@command({
    key: "annotate.dimension",
    icon: "icon-dDimension",
})
export class AnnotateDimension extends AnnotationCommandBase<DimensionAnnotation> {
    /** The axis the current position pick snapped to, set by `annotationPlane`. */
    private snappedAxis?: XYZ;

    protected override getSteps(): IStep[] {
        const firstStep = new PointStep("prompt.pickFistPoint");
        const secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        const thirdStep = new PointOnPlaneStep("prompt.pickDimensionPosition", this.getThirdPointData);
        return [firstStep, secondStep, thirdStep];
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.linePreview,
        };
    };

    private readonly linePreview = (point: XYZ | undefined) => {
        if (!point) {
            return [this.meshPoint(this.stepDatas[0].point!)];
        }
        return [this.meshPoint(this.stepDatas[0].point!), this.meshLine(this.stepDatas[0].point!, point)];
    };

    private readonly getThirdPointData = (): PointSnapData => {
        return {
            dimension: Dimensions.D1D2D3,
            prompt: () => this.dimensionPrompt(),
            preview: this.dimensionPreview,
            plane: this.annotationPlane,
            beforeExecute: this.startPreview,
            onPreviewReady: this.onPreviewReady,
        };
    };

    /**
     * The plane the position pick is constrained to, through the first point. Which
     * plane the measured direction shares with which principal axis is inferred from
     * the on-screen drag (SketchUp-style axis inference) — a world-space offset of
     * the picked point cannot say this, since the pick sits at a fixed view depth
     * and its offset is dominated by the camera position, not the drag. A drag close
     * to an axis snaps and is reported in `snappedAxis` for the preview's feedback
     * line. Constraining the pick (rather than projecting a workplane hit after the
     * fact) keeps the text where the cursor visually points; before the cursor moves
     * the plane facing the view wins, like the dynamic workplane does.
     */
    private readonly annotationPlane = (point?: XYZ): Plane => {
        const p1 = this.stepDatas[0].point!;
        const dir = this.stepDatas[1].point!.sub(p1).normalize();
        if (dir === undefined) return Plane.XY.translateTo(p1);

        const view = this.application.activeView;
        const axis = view && point ? this.draggedAxis(view, p1, dir, point) : undefined;
        this.snappedAxis = axis?.snapped ? axis.axis : undefined;
        const normal = axis
            ? dir.cross(axis.axis).normalize()!
            : nearestDimensionNormal(dir, view?.direction() ?? XYZ.unitNZ);
        return new Plane({ origin: p1, normal, xvec: dir });
    };

    /**
     * Screen-space axis inference: the cursor's drag away from the measured
     * segment's screen midpoint is compared against each candidate axis' screen
     * projection (its footprint orthogonalized against `dir`), and the best match
     * wins. The midpoint — not the perpendicular foot — anchors the drag, so the
     * along-segment component breaks the tie between axes that project
     * symmetrically (e.g. X and Y in an isometric view).
     */
    private draggedAxis(
        view: IView,
        p1: XYZ,
        dir: XYZ,
        point: XYZ,
    ): { axis: XYZ; snapped: boolean } | undefined {
        const p2 = this.stepDatas[1].point!;
        const mid = p1.add(p2).multiply(0.5);
        const screen = (p: XYZ) => view.worldToScreen(p);
        if (screen(p1).distanceTo(screen(p2)) < MIN_SCREEN_DIRECTION_PX) return undefined;

        const offset = screen(point).sub(screen(mid));
        if (offset.length() < MIN_SCREEN_DIRECTION_PX) return undefined;
        const drag = offset.normalize()!;

        let best: { axis: XYZ; snapped: boolean } | undefined;
        let bestScore = -1;
        for (const axis of [XYZ.unitX, XYZ.unitY, XYZ.unitZ]) {
            const along = axis.dot(dir);
            if (Math.abs(along) > Math.SQRT1_2) continue;

            const footprint = axis.sub(dir.multiply(along)).normalize()!;
            const axisScreen = screen(mid.add(footprint)).sub(screen(mid)).normalize();
            if (axisScreen === undefined) continue; // the axis faces the camera

            const score = Math.abs(drag.dot(axisScreen));
            if (score > bestScore) {
                best = { axis, snapped: score >= AXIS_SNAP_COS };
                bestScore = score;
            }
        }
        return best;
    }

    private readonly dimensionPrompt = () => {
        return formatMeasurement("length", this.stepDatas[0].point!.distanceTo(this.stepDatas[1].point!));
    };

    protected createPreviewAnnotation(): DimensionAnnotation {
        const p1 = this.stepDatas[0].point!;
        const p2 = this.stepDatas[1].point!;
        return new DimensionAnnotation({
            document: this.document,
            name: "DimensionAnnotation",
            annotationType: "dimension",
            dimensionType: "linear",
            startPoint: p1,
            endPoint: p2,
            // On the measured line until the cursor says where the text belongs.
            textPoint: p1.add(p2).multiply(0.5),
            textHeight: this.textHeight,
        });
    }

    private readonly dimensionPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        const p1 = this.stepDatas[0].point!;
        const p2 = this.stepDatas[1].point!;
        const meshes: ShapeMeshData[] = [this.meshPoint(p1), this.meshPoint(p2)];
        if (point !== undefined && this.previewAnnotation) {
            this.previewAnnotation.textHeight = this.textHeight;
            this.previewAnnotation.textPoint = point;
            if (this.snappedAxis) {
                meshes.push(this.pullLinePreview(p1, p2, point, this.snappedAxis));
            }
        }
        return meshes;
    };

    /** The axis-inference feedback: a dashed, axis-colored line from the segment to the pick. */
    private pullLinePreview(p1: XYZ, p2: XYZ, point: XYZ, axis: XYZ): ShapeMeshData {
        const dir = p2.sub(p1).normalize()!;
        const along = Math.min(Math.max(point.sub(p1).dot(dir), 0), p1.distanceTo(p2));
        const foot = p1.add(dir.multiply(along));
        return this.meshLine(foot, point, axisColor(axis), undefined, "dash");
    }

    protected commitAnnotation(annotation: DimensionAnnotation): void {
        annotation.startPoint = this.stepDatas[0].point!;
        annotation.endPoint = this.stepDatas[1].point!;
        annotation.textPoint = this.stepDatas[2].point!;
        annotation.textHeight = this.textHeight;
    }

    protected override afterExecute(): void {
        this.snappedAxis = undefined;
        super.afterExecute();
    }
}
