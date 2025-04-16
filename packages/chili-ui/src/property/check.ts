// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
