// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18nKeys, IDocument, IShape, ParameterGeometry, Result, Serializer } from "chili-core";

@Serializer.register("ImportedBody", ["document", "importedShape"])
export class ImportedBody extends ParameterGeometry {
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
        return Result.ok(this._importedShape);
    }
}
