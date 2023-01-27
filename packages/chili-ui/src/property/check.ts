// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Property } from "chili-core";

import { PropertyBase } from "./propertyBase";

export class CheckProperty extends PropertyBase {
    constructor(objects: any[], readonly property: Property) {
        super(objects);
    }
}
