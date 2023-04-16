// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Property } from "chili-core";
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
