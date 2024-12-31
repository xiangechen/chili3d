// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding, IDocument, Property, PubSub, Transaction } from "chili-core";
import { div, input, label, localize } from "../components";
import { ColorConverter } from "../converters";
import colorStyle from "./colorPorperty.module.css";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class ColorProperty extends PropertyBase {
    readonly converter = new ColorConverter();
    readonly input: HTMLInputElement;

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.input = input({
            className: colorStyle.color,
            type: "color",
            value: new Binding(objects[0], property.name, this.converter),
            onchange: this.setColor,
        });
        this.appendChild(
            div(
                { className: commonStyle.panel },
                label({
                    className: commonStyle.propertyName,
                    textContent: localize(property.display),
                }),
                this.input,
            ),
        );
    }

    disconnectedCallback(): void {
        this.input.removeEventListener("onchange", this.setColor);
    }

    private readonly setColor = (e: Event) => {
        let value = (e.target as any).value;
        let color = this.converter.convertBack(value).value;
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
