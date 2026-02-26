// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    Result,
    serializable,
    serialze,
} from "chili-core";

@serializable(["document", "booleanShape"])
export class BooleanNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.bolean";
    }

    @serialze()
    get booleanShape(): IShape {
        return this.getPrivateValue("booleanShape");
    }

    constructor(document: IDocument, shape: IShape) {
        super(document);
        this.setPrivateValue("booleanShape", shape);
    }

    override generateShape(): Result<IShape> {
        return Result.ok(this.booleanShape);
    }
}
