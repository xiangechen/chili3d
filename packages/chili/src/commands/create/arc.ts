// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Plane, PlaneAngle, Precision, ShapeMeshData, XYZ, command } from "chili-core";
import { ArcNode } from "../../bodys/arc";
import { Dimension, SnapLengthAtPlaneData } from "../../snap";
import { AngleStep, IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.arc",
    icon: "icon-arc",
})
export class Arc extends CreateCommand {
    private _planeAngle: PlaneAngle | undefined;

    getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickCircleCenter"),
            new LengthAtPlaneStep("prompt.pickRadius", this.getRadiusData),
            new AngleStep(
                "prompt.pickNextPoint",
                () => this.stepDatas[0].point!,
                () => this.stepDatas[1].point!,
                this.getAngleData,
            ),
        ];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.circlePreview,
            plane: (p: XYZ | undefined) => this.findPlane(view, point!, p),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                return p.sub(point!).isParallelTo(this.stepDatas[0].view.workplane.normal) === false;
            },
        };
    };

    private readonly getAngleData = () => {
        const [center, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, center, p1);
        const points: ShapeMeshData[] = [this.meshPoint(center), this.meshPoint(p1)];
        this._planeAngle = new PlaneAngle(new Plane(center, plane.normal, p1.sub(center)));
        return {
            dimension: Dimension.D1D2,
            preview: (point: XYZ | undefined) => this.anglePreview(point, center, p1, points),
            plane: () => plane,
            validators: [this.angleValidator(center, plane)],
        };
    };

    private anglePreview(
        point: XYZ | undefined,
        center: XYZ,
        p1: XYZ,
        points: ShapeMeshData[],
    ): ShapeMeshData[] {
        point = point ?? p1;
        this._planeAngle!.movePoint(point);
        const result = [...points];
        if (Math.abs(this._planeAngle!.angle) > Precision.Angle) {
            result.push(
                this.meshCreatedShape(
                    "arc",
                    this._planeAngle!.plane.normal,
                    center,
                    p1,
                    this._planeAngle!.angle,
                ),
            );
        }
        return result;
    }

    private angleValidator(center: XYZ, plane: Plane) {
        return (p: XYZ) =>
            p.distanceTo(center) >= Precision.Distance && !p.sub(center).isParallelTo(plane.normal);
    }

    protected override geometryNode(): GeometryNode {
        const [p0, p1] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, p0, p1);
        this._planeAngle?.movePoint(this.stepDatas[2].point!);
        return new ArcNode(this.document, plane.normal, p0, p1, this._planeAngle!.angle);
    }

    private readonly circlePreview = (end: XYZ | undefined) => {
        const visualCenter = this.meshPoint(this.stepDatas[0].point!);
        if (!end) return [visualCenter];
        const { point, view } = this.stepDatas[0];
        const plane = this.findPlane(view, point!, end);
        return [
            visualCenter,
            this.meshLine(this.stepDatas[0].point!, end),
            this.meshCreatedShape("circle", plane.normal, point!, plane.projectDistance(point!, end)),
        ];
    };
}
