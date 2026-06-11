// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";
import { GeometryBaseNode } from "./base";

export class LineNode extends GeometryBaseNode<
    { start: ClassicPreset.Socket; end: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super(editor, "Line");
        this.addInput("start", new ClassicPreset.Input(editor.socket, "start"));
        this.addInput("end", new ClassicPreset.Input(editor.socket, "end"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "edge"));
    }

    override createShape(inputs: { start?: XYZ[][]; end?: XYZ[][] }) {
        const starts = (inputs.start ?? [[XYZ.zero]]).flat();
        const ends = (inputs.end ?? [[XYZ.zero]]).flat();

        return zipTrees([starts, ends], (start, end) => {
            if (start.distanceTo(end) < 1e-6) {
                return shapeFactory.point(start).value;
            } else {
                return shapeFactory.line(start, end).value;
            }
        }) as IShape | IShape[];
    }
}
