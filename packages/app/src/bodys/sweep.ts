// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    ParameterShapeNode,
    type Result,
    ShapeTypes,
    serializable,
    serialize,
} from "@chili3d/core";

export interface SweepOptions {
    document: IDocument;
    profile: (IWire | IEdge)[];
    path: IWire | IEdge;
    round: boolean;
}

@serializable()
export class SweepedNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.sweep";
    }

    @serialize()
    get profile() {
        return this.getPrivateValue("profile");
    }
    set profile(value: IShape[]) {
        this.setPropertyEmitShapeChanged("profile", value);
    }

    @serialize()
    get path() {
        return this.getPrivateValue("path");
    }
    set path(value: IWire) {
        this.setPropertyEmitShapeChanged("path", value);
    }

    @serialize()
    get round() {
        return this.getPrivateValue("round");
    }
    set round(value: boolean) {
        this.setPropertyEmitShapeChanged("round", value);
    }

    constructor(options: SweepOptions) {
        super({ document: options.document });
        this.setPrivateValue(
            "profile",
            options.profile.map((p) => this.ensureWire(p)),
        );
        this.setPrivateValue("path", this.ensureWire(options.path));
        this.setPrivateValue("round", options.round);
    }

    private ensureWire(path: IEdge | IWire) {
        let wire = path as IWire;
        if (path.shapeType !== ShapeTypes.wire) {
            wire = this.document.application.shapeFactory.wire([path as unknown as IEdge]).value;
        }
        return wire;
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.sweep(this.profile, this.path, this.round);
    }
}
