// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Parameter } from "chili-core";
import { Transaction } from "chili-core/src/transaction";
import { IConverter, XYZ, XYZConverter } from "chili-shared";
import { NumberConverter } from "chili-shared/src/converter/numberConverter";
import { StringConverter } from "chili-shared/src/converter/stringConverter";
import style from "./input.module.css";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";
import { Control } from "../control";

export class InputProperty extends PropertyBase {
    readonly valueBox: HTMLInputElement;
    readonly errorLabel: HTMLSpanElement;
    readonly converter: IConverter | undefined;

    constructor(readonly document: IDocument, objects: any[], parameter: Parameter) {
        super(objects, parameter);
        this.converter = parameter.converter ?? this.getConverter();
        this.valueBox = Control.textBox(style.box);
        this.valueBox.value = this.getDefaultValue();
        if (this.isReadOnly()) {
            this.valueBox.readOnly = true;
            this.valueBox.classList.add(style.readonly);
        }
        let span = Control.span(parameter.display, commonStyle.propertyName);
        span.title = parameter.display;
        this.valueBox.addEventListener("keydown", this.handleKeyDown);
        this.errorLabel = Control.span("", style.error);
        this.errorLabel.classList.add(style.hidden);
        let div = Control.div(style.panel);
        Control.append(div, span, this.valueBox);
        Control.append(this.dom, div, this.errorLabel);
    }

    private isReadOnly(): boolean {
        return (
            this.parameter.descriptor.set === undefined ||
            (this.converter === undefined && typeof this.objects[0][this.parameter.property] !== "string")
        );
    }

    private getConverter(): IConverter | undefined {
        let name = this.objects[0][this.parameter.property].constructor.name;
        if (name === XYZ.name) {
            return new XYZConverter();
        } else if (name === String.name) {
            return new StringConverter();
        } else if (name === Number.name) {
            return new NumberConverter();
        }
        return undefined;
    }

    private getValueString(obj: any): string {
        let value = obj[this.parameter.property];
        return this.converter?.convert(value) ?? String(value);
    }

    private getDefaultValue() {
        let value = this.getValueString(this.objects[0]);
        for (let index = 1; index < this.objects.length; index++) {
            const testValue = this.getValueString(this.objects[1]);
            if (value !== testValue) {
                value = "";
                break;
            }
        }
        return value;
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        if (this.converter === undefined) return;
        if (e.key === "Enter") {
            let newValue = this.converter.convertBack(this.valueBox.value);
            if (newValue === undefined) {
                this.errorLabel.textContent = this.converter.error ?? "error";
                this.errorLabel.classList.remove(style.hidden);
                return;
            }
            Transaction.excute(this.document, "modify property", () => {
                this.objects.forEach((x) => {
                    x[this.parameter.property] = newValue;
                });
            });
        } else {
            this.errorLabel.classList.add(style.hidden);
        }
    };
}
