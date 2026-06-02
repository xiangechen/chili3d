// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    Dimensions,
    type GeometryNode,
    type IStep,
    LengthAtPlaneStep,
    Plane,
    type PointSnapData,
    PointStep,
    Precision,
    type ShapeMeshData,
    type SnapLengthAtPlaneData,
    type XYZ,
} from "@chili3d/core";
import { ArcNode } from "../../bodys/arc";
import { CreateCommand } from "../createCommand";
import { computeArcFromPoints } from "./arcUtils";

@command({
    key: "create.arc2point",
    icon: "icon-arc2point",
})
export class Arc2Point extends CreateCommand {
    getSteps(): IStep[] {
        return [
            new PointStep("prompt.pickFistPoint"),
            new PointStep("prompt.pickArcEnd", this.getEndPointData),
            new LengthAtPlaneStep("prompt.pickArcHeight", this.getHeightData),
        ];
    }

    private readonly getEndPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimensions.D1D2D3,
            validator: (point: XYZ) => {
                return this.stepDatas[0].point!.distanceTo(point) > Precision.Distance;
            },
            preview: this.endPreview,
        };
    };

    private readonly getHeightData = (): SnapLengthAtPlaneData => {
        const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const midpoint = p1.add(p2).multiply(0.5);

        return {
            point: () => midpoint,
            preview: (heightPoint: XYZ | undefined) => this.heightPreview(p1, p2, heightPoint),
            plane: (tmp: XYZ | undefined) => this.findPlane(this.stepDatas[0].view, midpoint, tmp),
            validator: (point: XYZ) => {
                return point.distanceTo(midpoint) > Precision.Distance;
            },
        };
    };

    private readonly endPreview = (point: XYZ | undefined) => {
        const p1 = this.stepDatas[0].point!;
        if (!point) return [this.meshPoint(p1)];
        return [this.meshPoint(p1), this.meshPoint(point), this.meshLine(p1, point)];
    };

    private readonly heightPreview = (p1: XYZ, p2: XYZ, heightPoint: XYZ | undefined) => {
        const result: ShapeMeshData[] = [this.meshPoint(p1), this.meshPoint(p2), this.meshLine(p1, p2)];
        if (!heightPoint) return result;
        const data = this.getActualHeightPoint(p1, p2, heightPoint);
        if (!data) return result;
        result.push(
            this.meshPoint(data.midpoint),
            this.meshPoint(data.heightPoint),
            this.meshLine(data.midpoint, data.heightPoint),
        );
        const geometry = computeArcFromPoints(p1, data.heightPoint, p2);
        if (geometry && Math.abs(geometry.angle) > Precision.Angle) {
            result.push(
                this.meshCreatedShape(
                    "arc",
                    geometry.normal,
                    geometry.center,
                    geometry.start,
                    geometry.angle,
                ),
            );
        }
        return result;
    };

    private getActualHeightPoint(p1: XYZ, p2: XYZ, heightPoint: XYZ) {
        const midpoint = p1.add(p2).multiply(0.5);
        const direction = p2.sub(p1).normalize()!;
        const vec = heightPoint.sub(midpoint);
        if (vec.length() < Precision.Distance || vec.isParallelTo(direction)) return undefined;
        const normal = vec.cross(direction);
        const heightDirection = direction.cross(normal).normalize()!;
        const actualHeight = vec.dot(heightDirection);
        if (Math.abs(actualHeight) < Precision.Distance) return undefined;
        return {
            heightPoint: midpoint.add(heightDirection.multiply(actualHeight)),
            midpoint,
            heightDirection,
        };
    }

    protected override geometryNode(): GeometryNode {
        const [p1, p2, heightPoint] = [
            this.stepDatas[0].point!,
            this.stepDatas[1].point!,
            this.stepDatas[2].point!,
        ];
        const data = this.getActualHeightPoint(p1, p2, heightPoint);
        let actualHeightPoint: XYZ = data!.heightPoint;
        if (this.stepDatas[2].type === "input") {
            const dist = heightPoint.distanceTo(data!.midpoint);
            actualHeightPoint = data!.midpoint.add(data!.heightDirection.multiply(dist));
        }
        const geometry = computeArcFromPoints(p1, actualHeightPoint, p2)!;
        return new ArcNode({
            document: this.document,
            normal: geometry.normal,
            center: geometry.center,
            start: geometry.start,
            angle: geometry.angle,
        });
    }
}
