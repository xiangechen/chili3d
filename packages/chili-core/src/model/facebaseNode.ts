// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Property } from "../property";
import { Serializer } from "../serialize";
import { ParameterShapeNode } from "./node";

export abstract class FacebaseNode extends ParameterShapeNode {
    protected _isFace: boolean = false;
    @Serializer.serialze()
    @Property.define("command.faceable.isFace")
    get isFace() {
        return this._isFace;
    }
    set isFace(value: boolean) {
        this.setProperty("isFace", value);
    }
}
