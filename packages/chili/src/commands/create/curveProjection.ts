// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    I18n,
    type IEdge,
    type IFace,
    type IWire,
    property,
    ShapeType,
    XYZ,
} from "chili-core";
import { type IStep, SelectShapeStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    key: "convert.curveProjection",
    icon: "icon-curveProject",
})
export class CurveProjectionCommand extends CreateCommand {
    @property("common.dir")
    get dir() {
        return this.getPrivateValue("dir", "0,0,-1");
    }

    set dir(value: string) {
        const nums = this.dir
            .split(",")
            .map(Number)
            .filter((n) => !isNaN(n));
        if (nums.length !== 3) {
            alert(I18n.translate("error.input.threeNumberCanBeInput"));

            return;
        }
        this.setProperty("dir", value);
    }

    protected override geometryNode() {
        const shape = this.transformdFirstShape(this.stepDatas[0]) as IEdge | IWire;
        const face = this.transformdFirstShape(this.stepDatas[1]) as IFace;
        const [x, y, z] = this.dir.split(",").map(Number);
        const dir = new XYZ(x, y, z).normalize() as XYZ;

        const curveProjection = this.application.shapeFactory.curveProjection(shape, face, dir);
        return new EditableShapeNode(
            this.document,
            I18n.translate("command.convert.curveProjection"),
            curveProjection.value,
        );
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.shape"),
            new SelectShapeStep(ShapeType.Face, "prompt.select.faces", { keepSelection: true }),
        ];
    }
}
