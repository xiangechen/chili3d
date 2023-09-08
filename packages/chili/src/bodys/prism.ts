// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Body,
    ClassMap,
    I18nKeys,
    IDocument,
    IFace,
    IShape,
    Property,
    Result,
    Serializer,
} from "chili-core";

@ClassMap.key("PrismBody")
export class PrismBody extends Body {
    override name: I18nKeys = "body.prism";

    private _face: IFace;
    @Serializer.property("constructor")
    get face(): IFace {
        return this._face;
    }
    set face(value: IFace) {
        this.setPropertyAndUpdate("face", value);
    }

    private _length: number;
    @Serializer.property("constructor")
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

    @Serializer.deserializer()
    static create({
        document,
        face,
        length,
    }: {
        document: IDocument;
        face: IFace;
        length: number;
    }): PrismBody {
        return new PrismBody(document, face, length);
    }

    protected override generateShape(): Result<IShape> {
        let [_, normal] = this.face.normal(0, 0);
        let vec = normal.multiply(this.length);
        return this.shapeFactory.prism(this.face, vec);
    }
}
