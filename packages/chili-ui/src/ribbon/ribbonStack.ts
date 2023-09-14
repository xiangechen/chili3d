// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Control } from "../components";
import style from "./ribbonStack.module.css";

export class RibbonStack extends Control {
    constructor() {
        super(style.root);
    }
}

customElements.define("ribbon-stack", RibbonStack);
