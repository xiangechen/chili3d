// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { customElement, DomEvent, ObservableHTMLElement } from "./observableHTMLElement";

@customElement("chili-button")
export class IconButton extends ObservableHTMLElement {
    constructor(readonly dom: HTMLElement) {
        super();
        this.innerHTML = `
        <div id="bb">
            <div>${typeof this}</div>
            <span id="bb">button</span>
        </div>
        `;
    }

    protected getEvents(): DomEvent<"pointerdown">[] {
        return [
            {
                id: "bb",
                type: "pointerdown",
                handler: this.onButtonClick,
            },
        ];
    }

    private onButtonClick = (e: PointerEvent) => {
        console.log("click");
    };
}
