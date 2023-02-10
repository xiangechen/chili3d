// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub } from "chili-core";

export class Application {
    static _current: Application | undefined;

    static get current() {
        if (Application._current === undefined) {
            Application._current = new Application();
        }
        return Application._current;
    }

    private constructor() {}

    private _activeDocument: IDocument | undefined;

    get activeDocument(): IDocument | undefined {
        return this._activeDocument;
    }

    set activeDocument(document: IDocument | undefined) {
        this._activeDocument = document;
        PubSub.default.pub("activeDocumentChanged", document);
    }
}
