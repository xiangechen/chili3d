// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, input, span } from "chili-controls";
import { Binding, type IDocument, Localize, type Property, Transaction } from "chili-core";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class CheckProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.appendChild(
            div(
                { className: commonStyle.panel },
                span({ className: commonStyle.propertyName, textContent: new Localize(property.display) }),
                input({
                    type: "checkbox",
                    checked: new Binding(objects[0], property.name),
                    onclick: () => {
                        const value = !objects[0][property.name];

                        Transaction.execute(document, "modify property", () => {
                            objects.forEach((x) => {
                                x[property.name] = value;
                            });
                            document.visual.update();
                        });
                    },
                }),
            ),
        );
    }
}

customElements.define("chili-check-property", CheckProperty);
