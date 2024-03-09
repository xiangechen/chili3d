// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IConverter,
    IDocument,
    NumberConverter,
    Property,
    PubSub,
    Quaternion,
    QuaternionConverter,
    Result,
    StringConverter,
    Transaction,
    XYZ,
    XYZConverter,
} from "chili-core";

import { div, input, localize, span } from "../controls";
import commonStyle from "./common.module.css";
import style from "./input.module.css";
import { PropertyBase } from "./propertyBase";

class ArrayValueConverter implements IConverter {
    constructor(
        readonly objects: any[],
        readonly property: Property,
        readonly converter?: IConverter,
    ) {}

    convert(value: any): Result<string> {
        return Result.success(this.getDefaultValue());
    }

    convertBack?(value: string): Result<any> {
        throw new Error("Method not implemented.");
    }

    private getValueString(obj: any): string {
        let value = obj[this.property.name];
        let cvalue = this.converter?.convert(value);
        return cvalue?.success ? cvalue.value : String(value);
    }

    private getDefaultValue() {
        let value = this.getValueString(this.objects[0]);
        for (let index = 1; index < this.objects.length; index++) {
            const testValue = this.getValueString(this.objects[index]);
            if (value !== testValue) {
                value = "";
                break;
            }
        }
        return value;
    }
}

export class InputProperty extends PropertyBase {
    readonly converter: IConverter | undefined;

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
        readonly showTitle: boolean = true,
    ) {
        super(objects);
        this.converter = property.converter ?? this.getConverter();
        let arrayConverter = new ArrayValueConverter(objects, property, this.converter);
        this.append(
            div(
                { className: commonStyle.panel },
                showTitle
                    ? span({
                          className: commonStyle.propertyName,
                          textContent: localize(property.display),
                      })
                    : "",
                input({
                    className: style.box,
                    value: this.bind(objects[0], property.name, arrayConverter),
                    readOnly: this.isReadOnly(),
                    onkeydown: this.handleKeyDown,
                    onblur: this.handleBlur,
                }),
            ),
        );
    }

    private isReadOnly(): boolean {
        let des = Object.getOwnPropertyDescriptor(this.objects[0], this.property.name);
        if (des === undefined) {
            let proto = Object.getPrototypeOf(this.objects[0]);
            while (proto.name !== "Object") {
                des = Object.getOwnPropertyDescriptor(proto, this.property.name);
                if (des !== undefined) break;
                proto = Object.getPrototypeOf(proto);
            }
        }
        return (
            des?.set === undefined ||
            (this.converter === undefined && typeof this.objects[0][this.property.name] !== "string")
        );
    }

    private handleBlur = (e: FocusEvent) => {
        this.setValue(e.target as HTMLInputElement);
    };

    private handleKeyDown = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (this.converter === undefined) return;
        if (e.key === "Enter") {
            this.setValue(e.target as HTMLInputElement);
        }
    };

    private setValue = (input: HTMLInputElement) => {
        let newValue = this.converter?.convertBack?.(input.value);
        if (!newValue?.success) {
            PubSub.default.pub("showToast", "error.default");
            return;
        }
        Transaction.excute(this.document, "modify property", () => {
            this.objects.forEach((x) => {
                x[this.property.name] = newValue?.unwrap();
            });
            this.document.visual.viewer.update();
        });
    };

    private getConverter(): IConverter | undefined {
        let name = this.objects[0][this.property.name].constructor.name;
        if (name === XYZ.name) {
            return new XYZConverter();
        } else if (name === Quaternion.name) {
            return new QuaternionConverter();
        } else if (name === String.name) {
            return new StringConverter();
        } else if (name === Number.name) {
            return new NumberConverter();
        }
        return undefined;
    }
}

customElements.define("chili-input-property", InputProperty);
