// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import style from "./column.module.css";
import { Control } from "./control";

export class Column extends Control {
    constructor(...children: Node[]) {
        super(style.column);
        this.append(...children);
    }

    addItems(...children: Node[]) {
        this.append(...children);
        return this;
    }
}

customElements.define("chili-column", Column);
