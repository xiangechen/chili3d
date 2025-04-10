// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { I18nKeys, IDocument, IShape, ParameterShapeNode, Result, Serializer } from "chili-core";

@Serializer.register(["document", "booleanShape"])
export class BooleanNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.bolean";
    }

    @Serializer.serialze()
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
