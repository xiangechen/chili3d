// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "./control";

export class IconButton extends Control {
    constructor(readonly dom: HTMLElement) {
        super();
        this.innerHTML = `
        <div id="bb">
            <div>${typeof this}</div>
            <span id="bb">button</span>
        </div>
        `;
    }

    private onButtonClick = (e: PointerEvent) => {
        console.log("click");
    };
}

customElements.define("chili-icon-button", IconButton);
