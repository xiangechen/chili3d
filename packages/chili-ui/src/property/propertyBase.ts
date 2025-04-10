// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

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
