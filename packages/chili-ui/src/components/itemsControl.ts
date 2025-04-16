// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
        const items = this.context.items.map((x) =>
            li(input({ type: "radio", value: x, checked: this.context.selectedItems.has(x) }), x),
        );

        return div({ className: style.radioGroup }, span(`${this.header}: `), ul(...items));
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
