// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ICommand, Id, IDocument, PubSub, Document } from "chili-core";
import { Container, Token, Logger } from "chili-shared";
import { Hotkey } from "chili-core/src/hotkey";
import { Contextual } from "chili-ui";

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

    private constructor() {
        PubSub.default.sub("excuteCommand", this.excuteCommand);
        PubSub.default.sub("keyDown", this.handleKeyDown);
    }

    handleKeyDown = (e: KeyboardEvent) => {
        let command = Hotkey.instance.getCommand(e);
        if (command !== undefined) this.excuteCommand(command);
    };

    excuteCommand = async (commandName: string) => {
        Logger.info(`excuting command ${commandName}`);
        if (this._activeDocument === undefined) return;
        let command = Container.default.resolve<ICommand>(new Token(commandName));
        if (command === undefined || command.excute === undefined) {
            Logger.error(`Attempted to resolve unregistered dependency token: ${commandName}`);
            return;
        }
        Contextual.instance.registerControls(command)
        await command.excute(this._activeDocument);
        Contextual.instance.clearControls();
    };

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
