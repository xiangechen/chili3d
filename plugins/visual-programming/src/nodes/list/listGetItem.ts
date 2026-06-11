// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class ListGetItemNode extends ClassicPreset.Node<
    { list: ClassicPreset.Socket; index: ClassicPreset.Socket },
    { item: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Get Item");
        this.addInput("list", new ClassicPreset.Input(editor.socket, "list"));
        this.addInput("index", new ClassicPreset.Input(editor.socket, "index"));
        this.addOutput("item", new ClassicPreset.Output(editor.socket, "item"));
    }

    data(inputs: { list?: unknown[][]; index?: number[] }): { item: unknown } {
        const lists = (inputs.list ?? [[]]).flat();
        const index = inputs.index ?? [0];

        return { item: lists.at(index[0]) };
    }
}
