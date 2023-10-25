// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { BindableElement } from "../controls";
import style from "./propertyBase.module.css";

export abstract class PropertyBase extends BindableElement {
    constructor(readonly objects: any[]) {
        super();
        this.className = style.panel;
        if (objects.length === 0) {
            throw new Error(`there are no objects`);
        }
    }
}
