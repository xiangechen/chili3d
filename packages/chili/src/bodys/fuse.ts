// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IShape, ParameterShapeNode, Result, Serializer } from "chili-core";

@Serializer.register(["document", "bottom", "top"])
export class FuseNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.fuse";
    }

    @Serializer.serialze()
    get bottom(): IShape {
        return this.getPrivateValue("bottom");
    }
    set bottom(value: IShape) {
        this.setPropertyEmitShapeChanged("bottom", value);
    }

    @Serializer.serialze()
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
