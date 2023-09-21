// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, ColorConverter, IDocument, Property, PubSub, Transaction } from "chili-core";
import { bind, div, input, label, localize } from "../controls";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";
import colorStyle from "./colorPorperty.module.css";

export class ColorProperty extends PropertyBase {
    readonly converter = new ColorConverter();

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
        readonly showTitle: boolean = true,
    ) {
        super(objects);
        this.appendChild(
            div(
                { className: commonStyle.panel },
                showTitle
                    ? label({
                          className: commonStyle.propertyName,
                          textContent: localize(property.display),
                      })
                    : "",
                input({
                    className: colorStyle.color,
                    type: "color",
                    value: bind(objects[0], property.name, this.converter),
                    onchange: (e) => this.setColor((e.target as any).value),
                }),
            ),
        );
    }

    private setColor(value: string) {
        let color = Color.fromHexStr(value).getValue();
        if (color === undefined) {
            PubSub.default.pub("showToast", "toast.converter.invalidColor");
            return;
        }
        Transaction.excute(this.document, "change color", () => {
            this.objects.forEach((x) => {
                x[this.property.name] = color;
            });
        });
    }
}

customElements.define("chili-color-property", ColorProperty);
