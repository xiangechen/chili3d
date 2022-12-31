// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Parameter } from "chili-core";
import { Div } from "../controls";
import style from "./propertyBase.module.css";

export class PropertyBase extends Div {
    constructor(readonly objects: any[], readonly parameter: Parameter) {
        super(style.panel);
        if (objects.length === 0) {
            throw new Error(`there are no objects`);
        }
    }
}
