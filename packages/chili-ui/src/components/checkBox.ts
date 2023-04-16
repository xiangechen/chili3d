// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";

export class CheckBox extends Control {
    private input: HTMLInputElement;
    constructor(readonly checked: boolean) {
        super();
        this.input = this.initInput();
        this.append(this.input);
    }

    private initInput() {
        let e = document.createElement("input");
        e.type = "checkbox";
        e.checked = this.checked;
        return e;
    }
}

customElements.define("chili-checkbox", CheckBox);
