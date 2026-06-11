// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, XYZ } from "@chili3d/core";
import { ClassicPreset } from "rete";
import { zipTrees } from "../../tree";
import type { INodeEditor } from "../../types";

export class PlaneNode extends ClassicPreset.Node<
    {
        origin: ClassicPreset.Socket;
        xvec: ClassicPreset.Socket;
        normal: ClassicPreset.Socket;
    },
    Record<string, ClassicPreset.Socket>
> {
    constructor(editor: INodeEditor) {
        super("Plane");
        this.addInput("origin", new ClassicPreset.Input(editor.socket, "origin"));
        this.addInput("xvec", new ClassicPreset.Input(editor.socket, "xvec"));
        this.addInput("normal", new ClassicPreset.Input(editor.socket, "normal"));
        this.addOutput("value", new ClassicPreset.Output(editor.socket, "plane"));
    }

    data(inputs: { origin?: XYZ[]; xvec?: XYZ[]; normal?: XYZ[] }) {
        const origins = inputs.origin ?? [XYZ.zero];
        const xvecs = inputs.xvec ?? [XYZ.unitX];
        const normals = inputs.normal ?? [XYZ.unitZ];

        const value = zipTrees([origins, xvecs, normals], (origin, xvec, normal) => {
            return new Plane({ origin, xvec, normal });
        });

        return { value };
    }
}
