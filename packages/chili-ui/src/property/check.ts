// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Parameter } from "chili-core";
import { PropertyBase } from "./propertyBase";

export class CheckProperty extends PropertyBase {
    constructor(objects: any[], parameter: Parameter) {
        super(objects, parameter);
    }
}
