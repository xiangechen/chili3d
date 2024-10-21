// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IShape, ParameterShapeNode, Result, Serializer } from "chili-core";

@Serializer.register(["document", "bottom", "top"])
export class FuseNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.fuse";
    }

    private _bottom: IShape;
    @Serializer.serialze()
    get bottom(): IShape {
        return this._bottom;
    }
    set bottom(value: IShape) {
        this.setProperty("bottom", value);
    }

    private _top: IShape;
    @Serializer.serialze()
    get top(): IShape {
        return this._top;
    }
    set top(value: IShape) {
        this.setProperty("top", value);
    }

    constructor(document: IDocument, bottom: IShape, top: IShape) {
        super(document);
        this._bottom = bottom;
        this._top = top;
    }

    override generateShape(): Result<IShape> {
        throw new Error("Method not implemented.");
    }
}
