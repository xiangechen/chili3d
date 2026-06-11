// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IEdge } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class EdgeCurveNode extends ClassicPreset.Node<
    { edge: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("EdgeCurve");
        this.addInput("edge", new ClassicPreset.Input(editor.socket, "edge"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "curve"));
    }

    data(inputs: { edge?: IEdge[][] }) {
        const edges = (inputs.edge ?? [[]]).flat();

        return {
            value: zipTrees([edges], (edge) => edge.curve),
        };
    }
}
