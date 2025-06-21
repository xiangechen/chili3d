// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Precision, XYZ, command } from "chili-core";
import { CircleNode } from "../../bodys";
import { SnapLengthAtPlaneData } from "../../snap";
import { IStep, LengthAtPlaneStep, PointStep } from "../../step";
import { CreateFaceableCommand } from "../createCommand";

@command({
    key: "create.circle",
    icon: "icon-circle",
})
export class Circle extends CreateFaceableCommand {
    getSteps(): IStep[] {
        let centerStep = new PointStep("prompt.pickCircleCenter");
        let radiusStep = new LengthAtPlaneStep("prompt.pickRadius", this.getRadiusData);
        return [centerStep, radiusStep];
    }

    private readonly getRadiusData = (): SnapLengthAtPlaneData => {
        const { point, view } = this.stepDatas[0];
        return {
            point: () => point!,
            preview: this.circlePreview,
            plane: (tmp: XYZ | undefined) => this.findPlane(view, point!, tmp),
            validator: (p: XYZ) => {
                if (p.distanceTo(point!) < Precision.Distance) return false;
                const plane = this.findPlane(view, point!, p);
                return p.sub(point!).isParallelTo(plane.normal) === false;
            },
        };
    };

    protected override geometryNode(): GeometryNode {
        const [p1, p2] = [this.stepDatas[0].point!, this.stepDatas[1].point!];
        const plane = this.stepDatas[1].plane ?? this.findPlane(this.stepDatas[1].view, p1, p2);
        const body = new CircleNode(this.document, plane.normal, p1, plane.projectDistance(p1, p2));
        body.isFace = this.isFace;
        return body;
    }

    private readonly circlePreview = (end: XYZ | undefined) => {
        if (!end) return [this.meshPoint(this.stepDatas[0].point!)];

        const { point, view } = this.stepDatas[0];
        const plane = this.findPlane(view, point!, end);
        return [
            this.meshPoint(this.stepDatas[0].point!),
            this.meshLine(point!, end),
            this.meshCreatedShape("circle", plane.normal, point!, plane.projectDistance(point!, end)),
        ];
    };
}
