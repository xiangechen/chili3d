// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Plane } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";
import { GeometryBaseNode } from "./base";

export class RectNode extends GeometryBaseNode<
    { plane: ClassicPreset.Socket; dx: ClassicPreset.Socket; dy: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super(editor, "Rect");
        this.addInput("plane", new ClassicPreset.Input(editor.socket, "plane"));
        this.addInput("dx", new ClassicPreset.Input(editor.socket, "dx"));
        this.addInput("dy", new ClassicPreset.Input(editor.socket, "dy"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "face"));
    }

    override createShape(inputs: { plane?: Plane[][]; dx?: number[][]; dy?: number[][] }) {
        const planes = (inputs.plane ?? [[Plane.XY]]).flat();
        const dxs = (inputs.dx ?? [[1]]).flat();
        const dys = (inputs.dy ?? [[1]]).flat();

        return zipTrees([planes, dxs, dys] as any, (plane: any, dx: number, dy: number) => {
            if (dx <= 0 || dy <= 0) return undefined;
            return shapeFactory.rect(plane, dx, dy).value;
        }) as IShape | IShape[];
    }
}
