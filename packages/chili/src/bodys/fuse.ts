// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Body, ClassMap, I18nKeys, IDocument, IShape, Result, Serializer } from "chili-core";

@ClassMap.key("FuseBody")
export class FuseBody extends Body {
    override name: I18nKeys = "body.fuse";

    private _bottom: IShape;
    @Serializer.property("constructor")
    get bottom(): IShape {
        return this._bottom;
    }
    set bottom(value: IShape) {
        this.setPropertyAndUpdate("bottom", value);
    }

    private _top: IShape;
    @Serializer.property("constructor")
    get top(): IShape {
        return this._top;
    }
    set top(value: IShape) {
        this.setPropertyAndUpdate("top", value);
    }

    constructor(document: IDocument, bottom: IShape, top: IShape) {
        super(document);
        this._bottom = bottom;
        this._top = top;
    }

    @Serializer.deserializer()
    static from({ document, bottom, top }: { document: IDocument; bottom: IShape; top: IShape }) {
        return new FuseBody(document, bottom, top);
    }

    protected override generateShape(): Result<IShape> {
        throw new Error("Method not implemented.");
    }
}
