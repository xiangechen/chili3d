// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";
import { GeometryBaseNode } from "./base";

export class PointNode extends GeometryBaseNode<
    { xyz: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super(editor, "Point");
        this.addInput("xyz", new ClassicPreset.Input(editor.socket, "xyz"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "vertex"));
    }

    override createShape(inputs: { xyz?: XYZ[][] }) {
        const vectors = inputs.xyz ?? [];

        return zipTrees([vectors], (v) => {
            return shapeFactory.point(v).value;
        }) as IShape[];
    }
}
