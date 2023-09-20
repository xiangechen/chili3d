// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, IDocument, Property } from "chili-core";
import { div, input, label, localize } from "../controls";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class ColorProperty extends PropertyBase {
    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.appendChild(
            div(
                { className: commonStyle.panel },
                label({
                    className: commonStyle.propertyName,
                    textContent: localize(property.display),
                }),
                input({
                    type: "color",
                    value: (objects[0][property.name] as Color).toHexStr(),
                    onchange: (e: Event) => {
                        objects.forEach((x) => {
                            x[property.name] = Color.fromHexStr((e.target as any).value);
                        });
                    },
                }),
            ),
        );
    }
}

customElements.define("chili-color-property", ColorProperty);
