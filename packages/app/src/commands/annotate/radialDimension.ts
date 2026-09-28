// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CurveUtils,
    command,
    DimensionAnnotation,
    Dimensions,
    formatMeasurement,
    type IEdge,
    type IShapeFilter,
    type IStep,
    type ITrimmedCurve,
    Plane,
    PointOnPlaneStep,
    type PointSnapData,
    SelectShapeStep,
    type ShapeMeshData,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { AnnotationCommandBase } from "./annotationCommandBase";

/** A picked circle/arc edge in world space. */
interface PickedCircle {
    readonly center: XYZ;
    readonly radius: number;
    readonly axis: XYZ;
}

/** Only circle/arc edges can take a radial or diameter dimension. */
const circleEdgeFilter: IShapeFilter = {
    allow: (shape) => {
        const curve = (shape as IEdge).curve;
        return CurveUtils.isTrimmed(curve) && CurveUtils.isCircle(curve.basisCurve);
    },
};

/** Any unit direction perpendicular to `axis` — the leader direction before the cursor speaks. */
function inPlaneDirection(axis: XYZ): XYZ {
    const seed = Math.abs(axis.z) < 0.9 ? XYZ.unitZ : XYZ.unitX;
    return axis.cross(seed).normalize()!;
}

/**
 * Shared interaction of the radius and diameter dimensions: pick a circle/arc
 * edge, then pick where the dimension goes. The position pick is constrained to
 * the circle's plane; its direction from the center sets the leader angle and
 * its distance the label position.
 */
abstract class RadialDimensionCommand extends AnnotationCommandBase<DimensionAnnotation> {
    protected abstract readonly dimensionType: "radial" | "diameter";
    private circle?: PickedCircle;
    /** The leader direction — survives a degenerate pick at the circle center. */
    private direction?: XYZ;

    protected override getSteps(): IStep[] {
        const circleStep = new SelectShapeStep(ShapeTypes.edge, "prompt.select.circleEdge", {
            shapeFilter: circleEdgeFilter,
        });
        const positionStep = new PointOnPlaneStep("prompt.pickDimensionPosition", this.getPositionData);
        return [circleStep, positionStep];
    }

    protected override onRestarting(): void {
        this.circle = undefined;
        this.direction = undefined;
        super.onRestarting();
    }

    protected override afterExecute(): void {
        this.circle = undefined;
        this.direction = undefined;
        super.afterExecute();
    }

    private readCircle(): PickedCircle {
        const data = this.stepDatas[0].shapes[0];
        const edge = data.shape.transformedMul(data.transform) as IEdge;
        const basis = (edge.curve as ITrimmedCurve).basisCurve;
        if (!CurveUtils.isCircle(basis)) {
            edge.dispose();
            throw new Error("unreachable: the shape filter guarantees a circle edge");
        }
        const circle: PickedCircle = {
            center: basis.center,
            radius: basis.radius,
            axis: basis.axis.normalize()!,
        };
        edge.dispose();
        return circle;
    }

    private readonly getPositionData = (): PointSnapData => {
        return {
            dimension: Dimensions.D1D2D3,
            prompt: () => this.dimensionPrompt(),
            preview: this.dimensionPreview,
            plane: () =>
                new Plane({
                    origin: this.circle!.center,
                    normal: this.circle!.axis,
                    xvec: this.direction ?? inPlaneDirection(this.circle!.axis),
                }),
            beforeExecute: () => {
                this.circle = this.readCircle();
                this.direction = inPlaneDirection(this.circle.axis);
                this.startPreview();
            },
            onPreviewReady: this.onPreviewReady,
        };
    };

    private readonly dimensionPrompt = () => {
        const radius = this.circle?.radius ?? 0;
        const radial = this.dimensionType === "radial";
        return formatMeasurement(radial ? "radius" : "diameter", radial ? radius : radius * 2);
    };

    /** The attachment points for a leader along `dir`: center→rim, or rim→rim across the center. */
    private endpoints(dir: XYZ): { start: XYZ; end: XYZ } {
        const { center, radius } = this.circle!;
        return this.dimensionType === "radial"
            ? { start: center, end: center.add(dir.multiply(radius)) }
            : { start: center.add(dir.multiply(-radius)), end: center.add(dir.multiply(radius)) };
    }

    protected createPreviewAnnotation(): DimensionAnnotation {
        const { start, end } = this.endpoints(this.direction!);
        return new DimensionAnnotation({
            document: this.document,
            name: "DimensionAnnotation",
            annotationType: "dimension",
            dimensionType: this.dimensionType,
            startPoint: start,
            endPoint: end,
            textPoint: end,
            // The circle axis pins the dimension plane — the three points are
            // collinear by construction and cannot rederive it.
            planeNormal: this.circle!.axis,
            textHeight: this.textHeight,
        });
    }

    private readonly dimensionPreview = (point: XYZ | undefined): ShapeMeshData[] => {
        if (point === undefined || this.previewAnnotation === undefined || this.circle === undefined) {
            return [];
        }
        this.direction = point.sub(this.circle.center).normalize() ?? this.direction!;
        const { start, end } = this.endpoints(this.direction);
        this.previewAnnotation.startPoint = start;
        this.previewAnnotation.endPoint = end;
        this.previewAnnotation.textPoint = point;
        this.previewAnnotation.textHeight = this.textHeight;
        return [this.meshPoint(start), this.meshPoint(end)];
    };

    protected commitAnnotation(annotation: DimensionAnnotation): void {
        const point = this.stepDatas[1].point!;
        const dir = point.sub(this.circle!.center).normalize() ?? this.direction!;
        const { start, end } = this.endpoints(dir);
        annotation.startPoint = start;
        annotation.endPoint = end;
        annotation.textPoint = point;
        annotation.planeNormal = this.circle!.axis;
        annotation.textHeight = this.textHeight;
    }
}

@command({
    key: "annotate.radius",
    icon: "icon-dRadius",
})
export class AnnotateRadialDimension extends RadialDimensionCommand {
    protected readonly dimensionType = "radial";
}

@command({
    key: "annotate.diameter",
    icon: "icon-circle",
})
export class AnnotateDiameterDimension extends RadialDimensionCommand {
    protected readonly dimensionType = "diameter";
}
