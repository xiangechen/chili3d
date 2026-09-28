// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    angularDimensionSweep,
    CurveUtils,
    command,
    DimensionAnnotation,
    Dimensions,
    formatMeasurement,
    type IEdge,
    type IShapeFilter,
    type IStep,
    Plane,
    PointOnPlaneStep,
    type PointSnapData,
    PubSub,
    SelectShapeStep,
    type ShapeMeshData,
    ShapeTypes,
    type SnapResult,
    type XYZ,
} from "@chili3d/core";
import { AnnotationCommandBase } from "./annotationCommandBase";

/** A picked straight edge in world space. */
interface PickedLine {
    readonly start: XYZ;
    readonly direction: XYZ;
    readonly mid: XYZ;
}

/** The measured angle: vertex plus unit-offset points carrying the two directions. */
interface PickedAngle {
    readonly vertex: XYZ;
    readonly p1: XYZ;
    readonly p2: XYZ;
    readonly normal: XYZ;
}

/** Only straight edges can take an angle dimension. */
const lineEdgeFilter: IShapeFilter = {
    allow: (shape) => CurveUtils.isLine((shape as IEdge).curve.basisCurve),
};

/** Midpoint of the closest pair of points between two (non-parallel) infinite lines. */
function closestMidpoint(l1: PickedLine, l2: PickedLine): XYZ {
    const w0 = l1.start.sub(l2.start);
    const b = l1.direction.dot(l2.direction);
    const d = l1.direction.dot(w0);
    const e = l2.direction.dot(w0);
    const denom = 1 - b * b;
    const q1 = l1.start.add(l1.direction.multiply((b * e - d) / denom));
    const q2 = l2.start.add(l2.direction.multiply((e - b * d) / denom));
    return q1.add(q2).multiply(0.5);
}

/**
 * Angle dimension between two straight edges: pick edge, pick edge, then pick
 * where the dimension goes. The vertex is the lines' closest point; the position
 * pick is constrained to the angle's plane and chooses the arc radius and the
 * sweep side — dragging to the far side draws the reflex angle.
 */
@command({
    key: "annotate.angle",
    icon: "icon-dAngle",
})
export class AnnotateAngleDimension extends AnnotationCommandBase<DimensionAnnotation> {
    private angle?: PickedAngle;

    protected override getSteps(): IStep[] {
        const firstStep = new SelectShapeStep(ShapeTypes.edge, "prompt.select.lineEdge", {
            shapeFilter: lineEdgeFilter,
        });
        const secondStep = new SelectShapeStep(ShapeTypes.edge, "prompt.select.lineEdge", {
            shapeFilter: lineEdgeFilter,
        });
        const positionStep = new PointOnPlaneStep("prompt.pickDimensionPosition", this.getPositionData);
        return [firstStep, secondStep, positionStep];
    }

    protected override onRestarting(): void {
        this.angle = undefined;
        super.onRestarting();
    }

    protected override afterExecute(): void {
        this.angle = undefined;
        super.afterExecute();
    }

    private lineOf(stepIndex: number): PickedLine {
        const data = this.stepDatas[stepIndex].shapes[0];
        const edge = data.shape.transformedMul(data.transform) as IEdge;
        const [start, end] = edge.ends();
        edge.dispose();
        return { start, direction: end.sub(start).normalize()!, mid: start.add(end).multiply(0.5) };
    }

    /** Undefined when the two edges are parallel or coincident — no angle plane exists then. */
    private computeAngle(): PickedAngle | undefined {
        const l1 = this.lineOf(0);
        const l2 = this.lineOf(1);
        const normal = l1.direction.cross(l2.direction).normalize();
        if (normal === undefined) return undefined;

        const vertex = closestMidpoint(l1, l2);
        // Orient each direction toward its edge's visible side of the vertex.
        const d1 = l1.mid.sub(vertex).dot(l1.direction) < 0 ? l1.direction.reverse() : l1.direction;
        const d2 = l2.mid.sub(vertex).dot(l2.direction) < 0 ? l2.direction.reverse() : l2.direction;
        return { vertex, p1: vertex.add(d1), p2: vertex.add(d2), normal };
    }

    private readonly getPositionData = (): PointSnapData => {
        return {
            dimension: Dimensions.D1D2D3,
            prompt: (result: SnapResult) => this.anglePrompt(result.point),
            preview: this.dimensionPreview,
            plane: () =>
                new Plane({
                    origin: this.angle!.vertex,
                    normal: this.angle!.normal,
                    xvec: this.angle!.p1.sub(this.angle!.vertex),
                }),
            beforeExecute: () => {
                this.angle = this.computeAngle();
                if (this.angle === undefined) {
                    PubSub.default.pub("showToast", "toast.dimension.parallelEdges");
                    this.controller?.cancel();
                    return;
                }
                this.startPreview();
            },
            onPreviewReady: this.onPreviewReady,
        };
    };

    private readonly anglePrompt = (point: XYZ | undefined) => {
        if (this.angle === undefined || point === undefined) return "";
        const sweep = angularDimensionSweep(this.angle.vertex, this.angle.p1, this.angle.p2, point);
        return sweep === undefined ? "" : formatMeasurement("angle", (Math.abs(sweep) * 180) / Math.PI);
    };

    protected createPreviewAnnotation(): DimensionAnnotation {
        const { vertex, p1, p2 } = this.angle!;
        return new DimensionAnnotation({
            document: this.document,
            name: "DimensionAnnotation",
            annotationType: "dimension",
            dimensionType: "angular",
            centerPoint: vertex,
            startPoint: p1,
            endPoint: p2,
            // On the bisector until the cursor says where the text belongs.
            textPoint: vertex.add(p1.add(p2).sub(vertex.multiply(2)).normalize() ?? p1.sub(vertex)),
            textHeight: this.textHeight,
        });
    }

    private readonly dimensionPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        if (this.angle === undefined) return [];
        if (point !== undefined && this.previewAnnotation) {
            this.previewAnnotation.textPoint = point;
            this.previewAnnotation.textHeight = this.textHeight;
        }
        return [this.meshPoint(this.angle.vertex)];
    };

    protected commitAnnotation(annotation: DimensionAnnotation): void {
        annotation.centerPoint = this.angle!.vertex;
        annotation.startPoint = this.angle!.p1;
        annotation.endPoint = this.angle!.p2;
        annotation.textPoint = this.stepDatas[2].point!;
        annotation.textHeight = this.textHeight;
    }
}
