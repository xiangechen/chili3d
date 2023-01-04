// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../control";
import style from "./ribbon.module.css";

export class RibbonStack {
    readonly dom: HTMLDivElement;
    constructor() {
        this.dom = Control.div(style.stack);
    }
}
