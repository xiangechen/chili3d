// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class ListLengthNode extends ClassicPreset.Node<
    { list: ClassicPreset.Socket },
    { length: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Length");
        this.addInput("list", new ClassicPreset.Input(editor.socket, "list"));
        this.addOutput("length", new ClassicPreset.Output(editor.socket, "length"));
    }

    data(inputs: { list?: unknown[][] }) {
        const lists = (inputs.list ?? [[]]).flat();

        return { length: lists.length };
    }
}
