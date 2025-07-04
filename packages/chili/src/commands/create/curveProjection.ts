// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, EditableShapeNode, I18n, IEdge, IFace, IWire, Property, ShapeType, XYZ } from "chili-core";
import { IStep, SelectShapeStep } from "../../step";
import { CreateCommand } from "../createCommand";

@command({
    key: "convert.curveProjection",
    icon: "icon-curveProjection",
})
export class CurveProjectionCommand extends CreateCommand {
    @Property.define("common.dir")
    get dir() {
        return this.getPrivateValue("dir", "0,0,-1");
    }

    set dir(value: string) {
        this.setProperty("dir", value);
    }

    protected override geometryNode() {
        let shape = this.stepDatas[0].shapes[0].shape as IEdge | IWire;
        let face = this.stepDatas[1].shapes[0].shape as IFace;
        const [x, y, z] = this.dir.split(",").map(Number);
        let dir = new XYZ(x, y, z).normalize() as XYZ;

        let curveProjection = this.application.shapeFactory.curveProjection(shape, face, dir);
        return new EditableShapeNode(
            this.document,
            I18n.translate("command.convert.curveProjection"),
            curveProjection.value,
        );
    }

    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Wire, "prompt.select.shape"),
            new SelectShapeStep(ShapeType.Face, "prompt.select.faces"),
        ];
    }
}
