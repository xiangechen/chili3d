// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Binding,
    IConverter,
    IDocument,
    isPropertyChanged,
    Property,
    PubSub,
    Quaternion,
    Result,
    Transaction,
    XY,
    XYZ,
} from "chili-core";
import { div, input, localize, span } from "../components";
import {
    NumberConverter,
    QuaternionConverter,
    StringConverter,
    XYConverter,
    XYZConverter,
} from "../converters";
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
        return Result.ok(this.getDefaultValue());
    }

    convertBack?(value: string): Result<any> {
        throw new Error("Method not implemented.");
    }

    private getValueString(obj: any): string {
        let value = obj[this.property.name];
        let cvalue = this.converter?.convert(value);
        return cvalue?.isOk ? cvalue.value : String(value);
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
        converter?: IConverter,
    ) {
        super(objects);
        this.converter = converter ?? this.getConverter();
        let arrayConverter = new ArrayValueConverter(objects, property, this.converter);
        this.append(
            div(
                { className: commonStyle.panel },
                span({
                    className: commonStyle.propertyName,
                    textContent: localize(property.display),
                }),
                input({
                    className: style.box,
                    value: new Binding(objects[0], property.name, arrayConverter),
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
            while (isPropertyChanged(proto)) {
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

    private readonly handleBlur = (e: FocusEvent) => {
        this.setValue(e.target as HTMLInputElement);
    };

    private readonly handleKeyDown = (e: KeyboardEvent) => {
        e.stopPropagation();
        if (this.converter === undefined) return;
        if (e.key === "Enter") {
            this.setValue(e.target as HTMLInputElement);
        }
    };

    private readonly setValue = (input: HTMLInputElement) => {
        let newValue = this.converter?.convertBack?.(input.value);
        if (!newValue?.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", newValue?.error);
            return;
        }
        Transaction.excute(this.document, "modify property", () => {
            this.objects.forEach((x) => {
                x[this.property.name] = newValue?.value;
            });
            this.document.visual.update();
        });
    };

    private getConverter(): IConverter | undefined {
        let name = this.objects[0][this.property.name].constructor.name;
        if (name === XYZ.name) {
            return new XYZConverter();
        } else if (name === XY.name) {
            return new XYConverter();
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
