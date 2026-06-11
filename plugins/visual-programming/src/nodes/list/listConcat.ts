// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { flatTree } from "../../tree";
import type { INodeEditor } from "../../types";

export class ListConcatNode extends ClassicPreset.Node<
    { list1: ClassicPreset.Socket; list2: ClassicPreset.Socket },
    { list: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Concat");
        this.addInput("list1", new ClassicPreset.Input(editor.socket, "list1"));
        this.addInput("list2", new ClassicPreset.Input(editor.socket, "list2"));
        this.addOutput("list", new ClassicPreset.Output(editor.socket, "list"));
    }

    data(inputs: { list1?: unknown[][]; list2?: unknown[][] }): { list: unknown[] } {
        const list1s = (inputs.list1 ?? [[]]).flat();
        const list2s = (inputs.list2 ?? [[]]).flat();

        return { list: flatTree(list1s).concat(flatTree(list2s)) };
    }
}
