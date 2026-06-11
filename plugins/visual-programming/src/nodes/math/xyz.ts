// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class XYZNode extends ClassicPreset.Node<
    { x: ClassicPreset.Socket; y: ClassicPreset.Socket; z: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("XYZ");
        this.addInput("x", new ClassicPreset.Input(editor.socket, "x"));
        this.addInput("y", new ClassicPreset.Input(editor.socket, "y"));
        this.addInput("z", new ClassicPreset.Input(editor.socket, "z"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "xyz"));
    }

    data(inputs: { x?: number[]; y?: number[]; z?: number[] }) {
        const x = inputs.x ?? [0];
        const y = inputs.y ?? [0];
        const z = inputs.z ?? [0];

        const value = zipTrees([x, y, z], (x, y, z) => {
            return new XYZ({ x, y, z });
        });

        return { value };
    }
}
