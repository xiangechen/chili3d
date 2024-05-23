// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IFace, IShape, ParameterBody, Property, Result, Serializer } from "chili-core";
import { GeoUtils } from "chili-geo";

@Serializer.register("PrismBody", ["document", "section", "length"])
export class PrismBody extends ParameterBody {
    override display: I18nKeys = "body.prism";

    private _section: IShape;
    @Serializer.serialze()
    get section(): IShape {
        return this._section;
    }
    set section(value: IFace) {
        this.setProperty("section", value);
    }

    private _length: number;
    @Serializer.serialze()
    @Property.define("common.length")
    get length(): number {
        return this._length;
    }
    set length(value: number) {
        this.setProperty("length", value);
    }

    constructor(document: IDocument, face: IShape, length: number) {
        super(document);
        this._section = face;
        this._length = length;
    }

    override generateShape(): Result<IShape> {
        let normal = GeoUtils.normal(this.section as any);
        let vec = normal.multiply(this.length);
        return this.document.application.shapeFactory.prism(this.section, vec);
    }
}
