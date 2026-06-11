// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class RoundNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("round");
        this.addInput("a", new ClassicPreset.Input(editor.socket, "a"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "value"));
    }

    data(inputs: { a?: number[] }) {
        const as = inputs.a ?? [];
        if (as.length === 0) return { value: [] };

        const value = zipTrees(as, Math.round);

        return { value };
    }
}
