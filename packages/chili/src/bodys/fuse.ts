// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    type Result,
    serializable,
    serialze,
} from "chili-core";

@serializable(["document", "bottom", "top"])
export class FuseNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.fuse";
    }

    @serialze()
    get bottom(): IShape {
        return this.getPrivateValue("bottom");
    }
    set bottom(value: IShape) {
        this.setPropertyEmitShapeChanged("bottom", value);
    }

    @serialze()
    get top(): IShape {
        return this.getPrivateValue("top");
    }
    set top(value: IShape) {
        this.setPropertyEmitShapeChanged("top", value);
    }

    constructor(document: IDocument, bottom: IShape, top: IShape) {
        super(document);
        this.setPrivateValue("bottom", bottom);
        this.setPrivateValue("top", top);
    }

    override generateShape(): Result<IShape> {
        throw new Error("Method not implemented.");
    }
}
