// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
