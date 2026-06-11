// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IEdge, IFace } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class FaceSurfaceNode extends ClassicPreset.Node<
    { face: ClassicPreset.Socket },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("FaceSurface");
        this.addInput("face", new ClassicPreset.Input(editor.socket, "face"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "surface"));
    }

    data(inputs: { face?: IFace[][] }) {
        const faces = (inputs.face ?? [[]]).flat();

        return {
            value: zipTrees([faces], (face) => face.surface()),
        };
    }
}
