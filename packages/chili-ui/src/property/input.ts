// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Parameter } from "chili-core";
import { Transaction } from "chili-core/src/transaction";
import { IConverter, XYZ, XYZConverter } from "chili-shared";
import { NumberConverter } from "chili-shared/src/converter/numberConverter";
import { StringConverter } from "chili-shared/src/converter/stringConverter";
import { Div, TextBlock, TextBox } from "../controls";
import style from "./input.module.css";
import commonStyle from "./common.module.css";
import { PropertyBase } from "./propertyBase";

export class InputProperty extends PropertyBase {
    readonly valueBox: TextBox;
    readonly errorLabel: TextBlock;
    readonly converter: IConverter | undefined;

    constructor(readonly document: IDocument, objects: any[], parameter: Parameter) {
        super(objects, parameter);
        this.converter = parameter.converter ?? this.getConverter();
        this.valueBox = new TextBox(style.box);
        this.valueBox.text = this.getDefaultValue();
        if (this.isReadOnly()) {
            this.valueBox.dom.readOnly = true;
            this.valueBox.addClass(style.readonly);
        }
        let textblock = new TextBlock(parameter.display, commonStyle.propertyName);
        textblock.dom.title = parameter.display;
        this.valueBox.dom.addEventListener("keydown", this.handleKeyDown);
        this.errorLabel = new TextBlock("", style.error);
        this.errorLabel.addClass(style.hidden);
        let div = new Div(style.panel);
        div.add(textblock, this.valueBox);
        this.add(div, this.errorLabel);
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
            let newValue = this.converter.convertBack(this.valueBox.text);
            if (newValue === undefined) {
                this.errorLabel.text = this.converter.error ?? "error";
                this.errorLabel.removeClass(style.hidden);
                return;
            }
            Transaction.excute(this.document, "modify property", () => {
                this.objects.forEach((x) => {
                    x[this.parameter.property] = newValue;
                });
            });
        } else {
            this.errorLabel.addClass(style.hidden);
        }
    };
}
