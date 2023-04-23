// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";
import style from "./row.module.css";

export class Row extends Control {
    constructor(...children: Node[]) {
        super(style.row);
        this.append(...children);
    }

    addItems(...children: Node[]) {
        this.append(...children);
        return this;
    }
}

customElements.define("chili-row", Row);
