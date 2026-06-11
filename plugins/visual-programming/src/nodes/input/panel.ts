// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ClassicPreset } from "rete";
import { PanelControl } from "../../controls/panel";
import type { INodeEditor } from "../../types";

export class PanelNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>,
    { value: ClassicPreset.Control }
> {
    width = 200;
    height = 150;

    constructor(readonly editor: INodeEditor) {
        super("Panel");
        this.addInput("input", new ClassicPreset.Input(editor.socket));
        this.addControl("value", new PanelControl(editor.process));
        this.addOutput("value", new ClassicPreset.Output(editor.socket));
    }

    data(inputs: { input?: object[] }) {
        const control = this.controls.value as PanelControl;
        control.hasInput = "input" in inputs;

        if (control.hasInput) {
            const input = inputs.input![0];
            const combineInput = (result: string[], input: any, prefix: string = "") => {
                if (Array.isArray(input)) {
                    result.push(`${prefix}[`);
                    for (const sub of input) {
                        combineInput(result, sub, `${prefix}    `);
                    }
                    result.push(`${prefix}]`);
                } else {
                    result.push(`${prefix}${input}`);
                }
            };

            const result: string[] = [];
            combineInput(result, input);
            control.value = result.join("\n");
        }
        this.editor.area.update("control", control.id);

        return {
            value: control.value,
        };
    }
}
