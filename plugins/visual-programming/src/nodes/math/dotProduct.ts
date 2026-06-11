// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class DotProductNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("Dot");
        this.addInput("a", new ClassicPreset.Input(editor.socket, "a"));
        this.addInput("b", new ClassicPreset.Input(editor.socket, "b"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "dot"));
    }

    data(inputs: { a?: XYZ[]; b?: XYZ[] }) {
        const as = inputs.a ?? [];
        const bs = inputs.b ?? [];

        if (as.length === 0 || bs.length === 0) return { value: [] };

        const value = zipTrees([as, bs], (a, b) => {
            if (a instanceof XYZ && b instanceof XYZ) {
                return a.dot(b);
            }
            return 0;
        });

        return { value };
    }
}
