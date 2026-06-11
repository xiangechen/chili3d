// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class VectorLengthNode extends ClassicPreset.Node<
    Record<string, ClassicPreset.Socket>,
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("Length");
        this.addInput("xyz", new ClassicPreset.Input(editor.socket, "xyz"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "length"));
    }

    data(inputs: { xyz?: XYZ[] }) {
        const xyzs = inputs.xyz ?? [];

        if (xyzs.length === 0) return { value: [] };

        const value = zipTrees([xyzs], (xyz) => {
            if (xyz instanceof XYZ) {
                return xyz.length();
            }
            return 0;
        });

        return { value };
    }
}
