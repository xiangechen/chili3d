// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IShapeFactory } from "chili-geo";
import { IDocument } from "../document";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { Entity } from "./entity";

export abstract class Body extends Entity {
    readonly shapeFactory: IShapeFactory;
    constructor(document: IDocument) {
        super(document);
        this.shapeFactory = document.application.shapeFactory;
    }
}

export abstract class FaceableBody extends Body {
    private _isFace: boolean = false;
    @Serializer.property()
    @Property.define("command.faceable.isFace")
    get isFace() {
        return this._isFace;
    }
    set isFace(value: boolean) {
        this.setPropertyAndUpdate("isFace", value);
    }
}
