// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";
import style from "./column.module.css";

export class Column extends Control {
    constructor(...children: Node[]) {
        super(style.column);
        this.append(...children);
    }
}

customElements.define("chili-column", Column);