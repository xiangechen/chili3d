// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    I18n,
    type IEdge,
    type IFace,
    type IStep,
    type IWire,
    property,
    SelectShapeStep,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
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
        const dir = new XYZ({ x, y, z }).normalize() as XYZ;

        const curveProjection = this.application.shapeFactory.curveProjection(shape, face, dir);
        return new EditableShapeNode({
            document: this.document,
            name: I18n.translate("command.convert.curveProjection"),
            shape: curveProjection.value,
        });
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep((ShapeTypes.edge | ShapeTypes.wire) as ShapeType, "prompt.select.shape"),
            new SelectShapeStep(ShapeTypes.face, "prompt.select.faces", { keepSelection: true }),
        ];
    }
}
