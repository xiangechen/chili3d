// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";
import { GeometryBaseNode } from "./base";

export class ArcNode extends GeometryBaseNode<
    {
        normal: ClassicPreset.Socket;
        center: ClassicPreset.Socket;
        start: ClassicPreset.Socket;
        angle: ClassicPreset.Socket;
    },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super(editor, "Arc");
        this.addInput("normal", new ClassicPreset.Input(editor.socket, "normal"));
        this.addInput("center", new ClassicPreset.Input(editor.socket, "center"));
        this.addInput("start", new ClassicPreset.Input(editor.socket, "start"));
        this.addInput("angle", new ClassicPreset.Input(editor.socket, "angle"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "edge"));
    }

    override createShape(inputs: {
        normal?: XYZ[][];
        center?: XYZ[][];
        start?: XYZ[][];
        angle?: number[][];
    }) {
        const normals = (inputs.normal ?? [[XYZ.unitZ]]).flat();
        const centers = (inputs.center ?? [[XYZ.zero]]).flat();
        const starts = (inputs.start ?? [[XYZ.unitX]]).flat();
        const angles = (inputs.angle ?? [[Math.PI * 2]]).flat();

        return zipTrees(
            [normals, centers, starts, angles] as any,
            (normal: XYZ, center: XYZ, start: XYZ, angle: any) => {
                return shapeFactory.arc(normal, center, start, angle).value;
            },
        ) as IShape | IShape[];
    }
}
