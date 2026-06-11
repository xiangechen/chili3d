// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { NumberSliderControl } from "../../controls/slider";
import type { INodeEditor } from "../../types";

export class NumberSliderNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    { value: ClassicPreset.Control }
> {
    width = 330;

    constructor(editor: INodeEditor) {
        super("Slider");
        this.addControl("value", new NumberSliderControl(editor.process));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "num"));
    }

    data(): { value: number } {
        return {
            value: (this.controls.value as NumberSliderControl).value || 0,
        };
    }
}
