// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IDocument } from "../document";
import { IDisposable } from "./disposable";
import { IEqualityComparer } from "./equalityComparer";
import { PropertyHistoryRecord } from "./history";
import { Logger } from "./logger";
import { Transaction } from "./transaction";

export type PropertyChangedHandler<T, K extends keyof T> = (property: K, source: T, oldValue: T[K]) => void;

export interface IPropertyChanged extends IDisposable {
    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>): void;
    clearPropertyChanged(): void;
}

export function isPropertyChanged(obj: object): obj is IPropertyChanged {
    return (
        obj &&
        typeof (obj as IPropertyChanged).onPropertyChanged === "function" &&
        typeof (obj as IPropertyChanged).removePropertyChanged === "function"
    );
}

export class Observable implements IPropertyChanged {
    protected readonly propertyChangedHandlers = new Set<PropertyChangedHandler<any, any>>();
    protected _isDisposed = false;

    private getPrivateKey<K extends keyof this>(pubKey: K) {
        return `_${String(pubKey)}`;
    }

    protected getPrivateValue<K extends keyof this>(pubKey: K, defaultValue?: this[K]): this[K] {
        const privateKey = this.getPrivateKey(pubKey) as keyof this;
        return privateKey in this
            ? (this[privateKey] as this[K])
            : this.initializeDefaultValue(pubKey, defaultValue);
    }

    private initializeDefaultValue<K extends keyof this>(pubKey: K, defaultValue?: this[K]): this[K] {
        if (defaultValue === undefined) {
            Logger.warn(
                `${this.constructor.name}: The property "${String(pubKey)}" is not initialized, and no default value is provided`,
            );
            return undefined as this[K];
        }

        const privateKey = this.getPrivateKey(pubKey);
        (this as any)[privateKey] = defaultValue;
        return defaultValue;
    }

    protected setPrivateValue<K extends keyof this>(pubKey: K, newValue: this[K]): void {
        (this as any)[this.getPrivateKey(pubKey)] = newValue;
    }

    /**
     * Set the value of a private property, and if successful, execute emitPropertyChanged.
     *
     * Note: The private property name must be the public property name with the prefix _, i.e., age->_age(private property name).
     */
    protected setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        const oldValue = this[property];
        if (this.isEuqals(oldValue, newValue, equals)) return false;

        this.setPrivateValue(property, newValue);
        onPropertyChanged?.(property, oldValue);
        this.emitPropertyChanged(property, oldValue);
        return true;
    }

    private isEuqals<K extends keyof this>(
        oldValue: this[K],
        newValue: this[K],
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        return equals ? equals.equals(oldValue, newValue) : oldValue === newValue;
    }

    protected emitPropertyChanged<K extends keyof this>(property: K, oldValue: this[K]) {
        Array.from(this.propertyChangedHandlers).forEach((cb) => cb(property, this, oldValue));
    }

    onPropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.add(handler);
    }

    removePropertyChanged<K extends keyof this>(handler: PropertyChangedHandler<this, K>) {
        this.propertyChangedHandlers.delete(handler);
    }

    clearPropertyChanged(): void {
        this.propertyChangedHandlers.clear();
    }

    readonly dispose = () => {
        if (this._isDisposed) return;
        this._isDisposed = true;
        this.disposeInternal();
    };

    protected disposeInternal() {
        this.propertyChangedHandlers.clear();
    }
}

export abstract class HistoryObservable extends Observable {
    private _document: IDocument;

    get document(): IDocument {
        return this._document;
    }

    constructor(document: IDocument) {
        super();
        this._document = document;
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        return super.setProperty(
            property,
            newValue,
            (property, oldValue) => {
                onPropertyChanged?.(property, oldValue);
                Transaction.add(
                    this.document,
                    new PropertyHistoryRecord(this, property, oldValue, newValue),
                );
            },
            equals,
        );
    }

    override disposeInternal() {
        super.disposeInternal();
        this._document = null as any;
    }
}
