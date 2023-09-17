// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Body,
    ClassMap,
    I18nKeys,
    IDocument,
    IEdge,
    IShape,
    IWire,
    Result,
    Serializer,
    ShapeType,
} from "chili-core";

@ClassMap.key("SweepBody")
export class SweepBody extends Body {
    override name: I18nKeys = "body.sweep";

    private _profile: IShape;
    @Serializer.property("constructor")
    get profile() {
        return this._profile;
    }
    set profile(value: IShape) {
        this.setPropertyAndUpdate("profile", value);
    }

    private _path: IWire;
    @Serializer.property("constructor")
    get path() {
        return this._path;
    }
    set path(value: IWire) {
        this.setPropertyAndUpdate("path", value);
    }

    constructor(document: IDocument, profile: IShape, path: IWire | IEdge) {
        super(document);
        this._profile = profile;
        this._path =
            path.shapeType === ShapeType.Wire
                ? (path as IWire)
                : document.application.shapeFactory.wire(path as unknown as IEdge).getValue()!;
    }

    @Serializer.deserializer()
    static from({ document, profile, path }: { document: IDocument; profile: IShape; path: IWire }) {
        return new SweepBody(document, profile, path);
    }

    protected override generateShape(): Result<IShape> {
        return this.shapeFactory.sweep(this.profile, this.path);
    }
}
