// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "./document";
import { HistoryObject } from "./history";
import { Observable } from "./observer";
import { Transaction } from "./transaction";

export interface IDocumentObject {
    setDocument(document?: IDocument): void;
}

export abstract class DocumentObject extends Observable implements IDocumentObject {
    protected _document: IDocument | undefined;

    constructor(document?: IDocument) {
        super();
        this._document = document;
    }

    setDocument(document?: IDocument) {
        if (this._document !== document) this._document = document;
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: ((oldValue: this[K], newValue: this[K]) => void) | undefined
    ): boolean {
        let h: HistoryObject = {
            name: `modify ${String(property)}`,
            object: this,
            property,
            oldValue: this[property],
            newValue,
        };
        let success = super.setProperty(property, newValue, onPropertyChanged);
        if (success && this._document !== undefined) {
            Transaction.add(this._document, h);
        }
        return success;
    }
}
