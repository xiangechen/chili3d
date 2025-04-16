// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
        const value = obj[this.property.name];
        const cvalue = this.converter?.convert(value);
        return cvalue?.isOk ? cvalue.value : String(value);
    }

    private getDefaultValue() {
        const values = this.objects.map(this.getValueString.bind(this));
        const uniqueValues = new Set(values);
        return uniqueValues.size === 1 ? values[0] : "";
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
        const arrayConverter = new ArrayValueConverter(objects, property, this.converter);
        this.append(
            div(
                { className: commonStyle.panel },
                span({ className: commonStyle.propertyName, textContent: localize(property.display) }),
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
        if (!des) {
            let proto = Object.getPrototypeOf(this.objects[0]);
            while (isPropertyChanged(proto)) {
                des = Object.getOwnPropertyDescriptor(proto, this.property.name);
                if (des) break;
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
        if (this.converter && e.key === "Enter") {
            this.setValue(e.target as HTMLInputElement);
        }
    };

    private readonly setValue = (input: HTMLInputElement) => {
        const newValue = this.converter?.convertBack?.(input.value);
        if (!newValue?.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", newValue?.error);
            return;
        }
        Transaction.execute(this.document, "modify property", () => {
            this.objects.forEach((x) => {
                x[this.property.name] = newValue.value;
            });
            this.document.visual.update();
        });
    };

    private getConverter(): IConverter | undefined {
        const name = this.objects[0][this.property.name].constructor.name;
        const converters: { [key: string]: () => IConverter } = {
            [XYZ.name]: () => new XYZConverter(),
            [XY.name]: () => new XYConverter(),
            [Quaternion.name]: () => new QuaternionConverter(),
            [String.name]: () => new StringConverter(),
            [Number.name]: () => new NumberConverter(),
        };
        return converters[name]?.();
    }
}

customElements.define("chili-input-property", InputProperty);
