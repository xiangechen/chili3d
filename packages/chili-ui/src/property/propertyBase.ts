// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import style from "./propertyBase.module.css";

export abstract class PropertyBase extends HTMLElement {
    constructor(readonly objects: any[]) {
        super();
        this.className = style.panel;
        if (objects.length === 0) {
            throw new Error(`there are no objects`);
        }
    }
}
