// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    I18nKeys,
    IDocument,
    IEdge,
    IShape,
    IWire,
    ParameterBody,
    Result,
    Serializer,
    ShapeType,
} from "chili-core";

@Serializer.register(["document", "profile", "path"])
export class SweepBody extends ParameterBody {
    override display: I18nKeys = "body.sweep";

    private _profile: IShape;
    @Serializer.serialze()
    get profile() {
        return this._profile;
    }
    set profile(value: IShape) {
        this.setProperty("profile", value);
    }

    private _path: IWire;
    @Serializer.serialze()
    get path() {
        return this._path;
    }
    set path(value: IWire) {
        this.setProperty("path", value);
    }

    constructor(document: IDocument, profile: IShape, path: IWire | IEdge) {
        super(document);
        this._profile = profile;
        this._path =
            path.shapeType === ShapeType.Wire
                ? (path as IWire)
                : document.application.shapeFactory.wire(path as unknown as IEdge).value!;
    }

    override generateShape(): Result<IShape> {
        return this.document.application.shapeFactory.sweep(this.profile, this.path);
    }
}
