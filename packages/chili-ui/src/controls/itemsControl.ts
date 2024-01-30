// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { SelectableItems } from "chili-core";
import { div, input, li, span, ul } from "./controls";
import style from "./itemsControl.module.css";

export class RadioGroup extends HTMLElement {
    constructor(
        readonly header: string,
        readonly context: SelectableItems<any>,
    ) {
        super();
        this.appendChild(this.render());
    }

    render() {
        return div(
            { className: style.radioGroup },
            span(this.header + ": "),
            ul(
                ...this.context.items.map((x) => {
                    return li(
                        input({ type: "radio", value: x, checked: this.context.selectedItems.has(x) }),
                        x,
                    );
                }),
            ),
        );
    }

    connectedCallback() {
        this.addEventListener("click", this._onClick);
    }

    disconnectedCallback() {
        this.removeEventListener("click", this._onClick);
    }

    private _onClick = (e: MouseEvent) => {
        const target = e.target as HTMLInputElement;
        if (target?.type === "radio") {
            this.querySelectorAll("input").forEach((x) => {
                if (x !== target) x.checked = false;
            });
            target.checked = true;
            this.context.selectedItems = new Set([target.value]);
        }
    };
}

customElements.define("chili-radios", RadioGroup);
