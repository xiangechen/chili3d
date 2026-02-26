// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type GeometryNode } from "chili-core";
import { PointNode } from "../../bodys";
import { type IStep, PointStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.point",
    icon: "icon-point",
})
export class Point extends CreateCommand {
    protected override geometryNode(): GeometryNode {
        return new PointNode(this.document, this.stepDatas[0].point!);
    }

    getSteps(): IStep[] {
        return [new PointStep("prompt.pickPoint")];
    }
}
