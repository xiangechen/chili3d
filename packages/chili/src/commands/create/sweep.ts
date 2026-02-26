// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, type GeometryNode, type IWire, property, ShapeType } from "chili-core";
import { SweepedNode } from "../../bodys";
import type { IStep } from "../../step";
import { SelectShapeStep } from "../../step/selectStep";
import { CreateCommand } from "../createCommand";

@command({
    key: "create.sweep",
    icon: "icon-sweep",
})
export class Sweep extends CreateCommand {
    @property("option.command.isRoundCorner")
    get round() {
        return this.getPrivateValue("round", false);
    }

    set round(value: boolean) {
        this.setProperty("round", value);
    }

    protected override geometryNode(): GeometryNode {
        const path = this.transformdFirstShape(this.stepDatas[0], false) as IWire;
        const shapes = this.transformdShapes(this.stepDatas[1], false) as IWire[];
        return new SweepedNode(this.document, shapes, path, this.round);
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.path"),
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.section", {
                keepSelection: true,
                multiple: true,
            }),
        ];
    }
}
