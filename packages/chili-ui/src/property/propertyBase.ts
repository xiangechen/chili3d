// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Property } from "chili-core";

import { Control } from "../control";
import style from "./propertyBase.module.css";

export class PropertyBase {
    readonly dom: HTMLDivElement;
    constructor(readonly objects: any[]) {
        this.dom = Control.div(style.panel);
        if (objects.length === 0) {
            throw new Error(`there are no objects`);
        }
    }
}
