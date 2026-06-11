// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICurve, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class DivideCurveNode extends ClassicPreset.Node<
    { curve: ClassicPreset.Socket; count: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("DivideCurve");
        this.addInput("curve", new ClassicPreset.Input(editor.socket, "curve"));
        this.addInput("count", new ClassicPreset.Input(editor.socket, "count"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "xyz"));
    }

    data(inputs: { curve?: ICurve[][]; count?: number[] }) {
        const curve = (inputs.curve ?? [[]]).flat();
        const count = inputs.count ?? [3];

        return {
            value: zipTrees([curve, count as any], (curve, count) => {
                return curve.uniformAbscissaByCount(count);
            }),
        };
    }
}
