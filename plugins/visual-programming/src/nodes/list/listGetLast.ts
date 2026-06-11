// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import type { INodeEditor } from "../../types";

export class ListGetLastNode extends ClassicPreset.Node<
    { list: ClassicPreset.Socket },
    { item: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Last");
        this.addInput("list", new ClassicPreset.Input(editor.socket, "list"));
        this.addOutput("item", new ClassicPreset.Output(editor.socket, "item"));
    }

    data(inputs: { list?: unknown[][] }): { item: unknown } {
        const lists = (inputs.list ?? [[]]).flat();

        return { item: lists.at(-1) };
    }
}
