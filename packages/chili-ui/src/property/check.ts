// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import { Property } from "chili-core";

import { PropertyBase } from "./propertyBase";

export class CheckProperty extends PropertyBase {
    constructor(
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
    }
}

customElements.define("chili-check-property", CheckProperty);
