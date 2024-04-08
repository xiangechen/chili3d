// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    GeometryObject,
    I18nKeys,
    IDocument,
    IFace,
    IShape,
    Property,
    Result,
    Serializer,
} from "chili-core";

@Serializer.register("PrismBody", ["document", "face", "length"])
export class PrismBody extends GeometryObject {
    override display: I18nKeys = "body.prism";

    private _face: IFace;
    @Serializer.serialze()
    get face(): IFace {
        return this._face;
    }
    set face(value: IFace) {
        this.setPropertyAndUpdate("face", value);
    }

    private _length: number;
    @Serializer.serialze()
    @Property.define("common.length")
    get length(): number {
        return this._length;
    }
    set length(value: number) {
        this.setPropertyAndUpdate("length", value);
    }

    constructor(document: IDocument, face: IFace, length: number) {
        super(document);
        this._face = face;
        this._length = length;
    }

    protected override generateShape(): Result<IShape> {
        let [_, normal] = this.face.normal(0, 0);
        let vec = normal.multiply(this.length);
        return this.document.application.shapeFactory.prism(this.face, vec);
    }
}
