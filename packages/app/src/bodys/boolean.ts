// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IShape,
    ParameterShapeNode,
    Result,
    serializable,
    serialize,
} from "@chili3d/core";

export interface BooleanOptions {
    document: IDocument;
    booleanShape: IShape;
}

@serializable()
export class BooleanNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.bolean";
    }

    @serialize()
    get booleanShape(): IShape {
        return this.getPrivateValue("booleanShape");
    }

    constructor(options: BooleanOptions) {
        super(options);
        this.setPrivateValue("booleanShape", options.booleanShape);
    }

    override generateShape(): Result<IShape> {
        return Result.ok(this.booleanShape);
    }
}
