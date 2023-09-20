// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    IConverter,
    IDocument,
    IPropertyChanged,
    NumberConverter,
    Property,
    Quaternion,
    QuaternionConverter,
    StringConverter,
    Transaction,
    XYZ,
    XYZConverter,
} from "chili-core";
import { Label, Panel, TextBox } from "../components";

import commonStyle from "./common.module.css";
import style from "./input.module.css";
import { PropertyBase } from "./propertyBase";

export class InputProperty extends PropertyBase {
    readonly valueBox: TextBox;
    readonly error: Label;
    readonly converter: IConverter | undefined;

    constructor(
        readonly document: IDocument,
        objects: any[],
        readonly property: Property,
    ) {
        super(objects);
        this.converter = property.converter ?? this.getConverter();
        this.valueBox = new TextBox()
            .addClass(style.box)
            .setText(this.getDefaultValue())
            .setReadOnly(this.isReadOnly());
        let name = new Label()
            .i18nText(property.display)
            .addClass(commonStyle.propertyName)
            .setTitle(property.display);
        this.error = new Label().i18nText("error.default").addClass(style.error, style.hidden);
        let panel = new Panel().addClass(commonStyle.panel).addItem(name, this.valueBox);
        this.append(panel, this.error);

        this.addConnectedCallback(this.onConnected);
        this.addDisconnectedCallback(this.onDisconnected);
    }

    private onConnected = () => {
        this.valueBox.addEventListener("keydown", this.handleKeyDown);
        (this.objects.at(0) as IPropertyChanged)?.onPropertyChanged(this.handlePropertyChanged);
    };

    private onDisconnected = () => {
        this.valueBox.removeEventListener("keydown", this.handleKeyDown);
        (this.objects.at(0) as IPropertyChanged)?.removePropertyChanged(this.handlePropertyChanged);
    };

    private handlePropertyChanged = (property: string) => {
        if (property === this.property.name) {
            this.valueBox.setText(this.getValueString(this.objects[0]));
        }
    };

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

    private getValueString(obj: any): string {
        let value = obj[this.property.name];
        let cvalue = this.converter?.convert(value);
        return cvalue?.success ? cvalue.value : String(value);
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
            if (!newValue.success) {
                this.error.text(newValue.error ?? "error");
                this.error.addClass(style.hidden);
                return;
            }
            Transaction.excute(this.document, "modify property", () => {
                this.objects.forEach((x) => {
                    x[this.property.name] = newValue.unwrap();
                });
                this.document.visual.viewer.redraw();
            });
        } else {
            this.error.addClass(style.hidden);
        }
    };
}

customElements.define("chili-input-property", InputProperty);
