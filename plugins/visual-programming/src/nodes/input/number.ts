// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import type { INodeEditor } from "../../types";

export class NumberNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    { value: ClassicPreset.InputControl<"number"> }
> {
    constructor(editor: INodeEditor) {
        super("Number");
        this.addControl(
            "value",
            new ClassicPreset.InputControl("number", { initial: 0, change: editor.process }),
        );
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "num"));
    }

    data(): { value: number } {
        return {
            value: this.controls.value.value || 0,
        };
    }
}
