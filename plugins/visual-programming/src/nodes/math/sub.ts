// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class SubNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    { value: ClassicPreset.InputControl<"number"> }
> {
    constructor(editor: INodeEditor) {
        super("-");
        this.addInput("a", new ClassicPreset.Input(editor.socket, "a"));
        this.addInput("b", new ClassicPreset.Input(editor.socket, "b"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "value"));
    }

    data(inputs: { a?: (number | XYZ)[]; b?: (number | XYZ)[] }) {
        const as = inputs.a ?? [];
        const bs = inputs.b ?? [];

        if (as.length === 0 || bs.length === 0) return { value: [] };

        const value = zipTrees([as, bs], (a, b) => {
            if (a instanceof XYZ && b instanceof XYZ) {
                return a.sub(b);
            } else if (typeof a === "number" && typeof b === "number") {
                return a - b;
            }

            console.warn("Invalid subtraction", a, b);
            return a;
        });

        return { value };
    }
}
