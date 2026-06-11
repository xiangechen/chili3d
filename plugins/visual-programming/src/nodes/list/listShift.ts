// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import type { INodeEditor } from "../../types";

export class ListShiftNode extends ClassicPreset.Node<
    { list: ClassicPreset.Socket; offset: ClassicPreset.Socket; wrap: ClassicPreset.Socket },
    { list: ClassicPreset.Socket },
    Record<string, never>
> {
    constructor(editor: INodeEditor) {
        super("Shift");
        this.addInput("list", new ClassicPreset.Input(editor.socket, "list"));
        this.addInput("offset", new ClassicPreset.Input(editor.socket, "offset"));
        this.addInput("wrap", new ClassicPreset.Input(editor.socket, "wrap"));
        this.addOutput("list", new ClassicPreset.Output(editor.socket, "list"));
    }

    data(inputs: { list?: unknown[][]; offset?: number[]; wrap?: boolean[] }): { list: unknown[] } {
        const lists = (inputs.list ?? [[]]).flat();
        if (lists.length === 0) return { list: [] };

        const offsets = (inputs.offset ?? [1]).at(0)!;
        const wraps = (inputs.wrap ?? [true]).at(0)!;
        const list = lists.slice(0, lists.length - offsets);

        if (wraps) {
            return { list: lists.slice(lists.length - offsets).concat(list) };
        }

        return { list };
    }
}
