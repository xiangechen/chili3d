// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Body, I18nKeys, IDocument, IShape, Result, Serializer } from "chili-core";

@Serializer.register("ImportedBody", ["document", "importedShape"])
export class ImportedBody extends Body {
    override display: I18nKeys = "body.imported";

    private _importedShape: IShape;
    @Serializer.serialze()
    get importedShape() {
        return this._importedShape;
    }

    constructor(document: IDocument, shape: IShape) {
        super(document);
        this._importedShape = shape;
    }

    protected override generateShape(): Result<IShape> {
        return Result.success(this._importedShape);
    }
}
