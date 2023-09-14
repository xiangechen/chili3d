// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Control } from "../components";

import style from "./propertyBase.module.css";

export abstract class PropertyBase extends Control {
    constructor(readonly objects: any[]) {
        super(style.panel);
        if (objects.length === 0) {
            throw new Error(`there are no objects`);
        }
    }
}
