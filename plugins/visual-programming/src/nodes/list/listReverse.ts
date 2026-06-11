// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import type { INodeEditor } from "../../types";

export class ListReverseNode extends ClassicPreset.Node<
    { list: ClassicPreset.Socket },
    { list: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Reverse");
        this.addInput("list", new ClassicPreset.Input(editor.socket, "list"));
        this.addOutput("list", new ClassicPreset.Output(editor.socket, "list"));
    }

    data(inputs: { list?: unknown[][] }) {
        const lists = (inputs.list ?? [[]]).flat();

        return {
            list: lists.reverse(),
        };
    }
}
