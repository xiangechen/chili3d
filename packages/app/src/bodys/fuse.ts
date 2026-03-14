// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    type Result,
    serializable,
    serialize,
} from "@chili3d/core";

export interface FuseOptions {
    document: IDocument;
    bottom: IShape;
    top: IShape;
}

@serializable()
export class FuseNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.fuse";
    }

    @serialize()
    get bottom(): IShape {
        return this.getPrivateValue("bottom");
    }
    set bottom(value: IShape) {
        this.setPropertyEmitShapeChanged("bottom", value);
    }

    @serialize()
    get top(): IShape {
        return this.getPrivateValue("top");
    }
    set top(value: IShape) {
        this.setPropertyEmitShapeChanged("top", value);
    }

    constructor(options: FuseOptions) {
        super(options);
        this.setPrivateValue("bottom", options.bottom);
        this.setPrivateValue("top", options.top);
    }

    override generateShape(): Result<IShape> {
        throw new Error("Method not implemented.");
    }
}
