// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { SelectableItems } from "chili-core";
import { div, input, label } from "./controls";
import style from "./radioGroup.module.css";

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
            ...this.context.items.flatMap((x, i) => [
                input({
                    type: "radio",
                    value: x,
                    checked: this.context.selectedItems.has(x),
                    id: `radio-${i}`,
                }),
                label({
                    htmlFor: `radio-${i}`,
                    textContent: x,
                }),
            ]),
        );
    }

    connectedCallback() {
        this.addEventListener("click", this._onClick);
    }

    disconnectedCallback() {
        this.removeEventListener("click", this._onClick);
    }

    private readonly _onClick = (e: MouseEvent) => {
        const target = e.target as HTMLInputElement;
        if (target?.type === "radio") {
            this.querySelectorAll("input").forEach((x) => (x.checked = x === target));
            this.context.selectedItems = new Set([target.value]);
        }
    };
}

customElements.define("chili-radios", RadioGroup);
