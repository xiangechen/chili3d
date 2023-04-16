// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";

export class ComboBox extends Control {
    private input: HTMLSelectElement;
    constructor(readonly items: string[]) {
        super();
        this.input = this.initInput();
        this.append(this.input);
    }

    private initInput() {
        let e = document.createElement("select");
        this.items.forEach((x) => {
            let option = document.createElement("option");
            option.innerText = x;
            e.append(option);
        });
        return e;
    }

    selectedIndex() {
        return this.input.value;
    }

    onSelectionChanged(callback: (index: number) => void) {
        this.input.addEventListener("change", () => {
            callback(this.input.selectedIndex);
        });
    }
}

customElements.define("chili-combobox", ComboBox);
