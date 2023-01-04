// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Id, IDocument, PubSub, Document } from "chili-core";

export class Application {
    static _current: Application | undefined;

    static get current() {
        if (Application._current === undefined) {
            Application._current = new Application();
        }
        return Application._current;
    }

    private _documentMap: Map<string, IDocument> = new Map();
    private _activeDocument: IDocument | undefined;

    private constructor() { }

    getDocument(id: string): IDocument | undefined {
        return this._documentMap.get(id);
    }

    get activeDocument(): IDocument | undefined {
        return this._activeDocument;
    }

    set activeDocument(document: IDocument | undefined) {
        this._activeDocument = document;
        PubSub.default.pub("activeDocumentChanged")(document);
    }

    addDocument(document: IDocument, isActive: boolean = true) {
        if (this._documentMap.has(document.id)) return;
        this._documentMap.set(document.id, document);
        if (isActive) {
            this.activeDocument = document;
        }
    }

    openDocument(file: string): IDocument {
        throw new Error("Method not implemented.");
    }

    closeDocument(document: IDocument): void {
        throw new Error("Method not implemented.");
    }

    newDocument(name: string): IDocument {
        let document = new Document(name, Id.new());
        this.addDocument(document);
        return document;
    }
}
