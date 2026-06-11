// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";
import { GeometryBaseNode } from "./base";

export class CircleNode extends GeometryBaseNode<
    { normal: ClassicPreset.Socket; center: ClassicPreset.Socket; radius: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super(editor, "Circle");
        this.addInput("normal", new ClassicPreset.Input(editor.socket, "normal"));
        this.addInput("center", new ClassicPreset.Input(editor.socket, "center"));
        this.addInput("radius", new ClassicPreset.Input(editor.socket, "radius"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "circle"));
    }

    override createShape(inputs: { normal?: XYZ[][]; center?: XYZ[][]; radius?: number[][] }) {
        const normals = (inputs.normal ?? [[XYZ.unitZ]]).flat();
        const centers = (inputs.center ?? [[XYZ.zero]]).flat();
        const radii = (inputs.radius ?? [[1]]).flat();

        return zipTrees([normals, centers, radii] as any, (normal: XYZ, center: XYZ, radius: any) => {
            if (radius < 1e-6) {
                return undefined;
            }
            return shapeFactory.circle(normal, center, radius).value;
        }) as IShape | IShape[];
    }
}
