// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { GeometryNode, Precision, Property, XYZ, command } from "chili-core";
import { LineNode } from "../../bodys";
import { Dimension, PointSnapData } from "../../snap";
import { IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.line",
    icon: "icon-line",
})
export class Line extends CreateCommand {
    @Property.define("option.command.isConnected", {
        dependencies: [{ property: "repeatOperation", value: true }],
    })
    get isContinue() {
        return this.getPrivateValue("isContinue", false);
    }
    set isContinue(value: boolean) {
        this.setProperty("isContinue", value);
    }

    protected override geometryNode(): GeometryNode {
        return new LineNode(this.document, this.stepDatas[0].point!, this.stepDatas[1].point!);
    }

    getSteps(): IStep[] {
        let firstStep = new PointStep("prompt.pickFistPoint");
        let secondStep = new PointStep("prompt.pickNextPoint", this.getSecondPointData);
        return [firstStep, secondStep];
    }

    protected override resetSteps() {
        if (this.isContinue) {
            this.stepDatas[0] = this.stepDatas[1];
            this.stepDatas.length = 1;
        } else {
            this.stepDatas.length = 0;
        }
    }

    private readonly getSecondPointData = (): PointSnapData => {
        return {
            refPoint: () => this.stepDatas[0].point!,
            dimension: Dimension.D1D2D3,
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
}
