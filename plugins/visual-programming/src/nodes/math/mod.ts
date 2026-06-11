// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class ModNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("mod");
        this.addInput("a", new ClassicPreset.Input(editor.socket, "a"));
        this.addInput("b", new ClassicPreset.Input(editor.socket, "b"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "value"));
    }

    data(inputs: { a?: number[]; b?: number[] }) {
        const as = inputs.a ?? [];
        const bs = inputs.b ?? [];

        if (as.length === 0 || bs.length === 0) return { value: [] };

        const value = zipTrees([as, bs], (a, b) => {
            if (typeof a === "number" && typeof b === "number") {
                return a % b;
            }
            console.warn("ModNode: invalid types", a, b);
            return a;
        });

        return { value };
    }
}
