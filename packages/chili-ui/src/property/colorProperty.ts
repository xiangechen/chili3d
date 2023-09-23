// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Color, ColorConverter, IDocument, Property, PubSub, Transaction } from "chili-core";
import { Binding, bind, div, input, label, localize } from "../controls";
import colorStyle from "./colorPorperty.module.css";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class ColorProperty extends PropertyBase {
    readonly converter = new ColorConverter();
    readonly input: HTMLInputElement;
    readonly binding: Binding;

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
        readonly showTitle: boolean = true,
    ) {
        super(objects);
        this.binding = bind(objects[0], property.name, this.converter);
        this.input = input({
            className: colorStyle.color,
            type: "color",
            value: this.binding,
            onchange: this.setColor,
        });
        this.appendChild(
            div(
                { className: commonStyle.panel },
                showTitle
                    ? label({
                          className: commonStyle.propertyName,
                          textContent: localize(property.display),
                      })
                    : "",
                this.input,
            ),
        );
        this.addDisconnectedCallback(this.onDisconnected);
    }

    private onDisconnected = () => {
        this.input.removeEventListener("onchange", this.setColor);
        this.binding.dispose();
    };

    private setColor = (e: Event) => {
        let value = (e.target as any).value;
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
    };
}

customElements.define("chili-color-property", ColorProperty);
