// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, PubSub } from "chili-core";
import { Control, Label } from "../../components";
import style from "./title.module.css";

const AppName = "Chili 2023";

export class Title extends Control {
    private readonly _documentName: Label;
    private readonly _appName: HTMLSpanElement;
    private readonly _saveState: HTMLSpanElement;

    private currentDocument: IDocument | undefined;

    constructor() {
        super(style.root);
        this._documentName = new Label().addClass(style.name);
        this._appName = new Label().text(AppName).addClass(style.name);
        this._saveState = new Label().text("*").addClass(style.name);
        let split = new Label().text(" | ").addClass(style.name, style.split);
        this.append(this._documentName, this._saveState, split, this._appName);
        this.setSaveStatus(true);

        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
    }

    private handleActiveDocumentChanged = (d: IDocument | undefined) => {
        if (this.currentDocument !== undefined) {
            this.currentDocument.removePropertyChanged(this.handleNameChanged);
        }
        this._documentName.text(d?.name ?? "");
        this.currentDocument = d;
        this.currentDocument?.onPropertyChanged(this.handleNameChanged);
    };

    private handleNameChanged = (d: IDocument, property: keyof IDocument, oldValue: any) => {
        if (property === "name") {
            this._documentName.text(d[property]);
        }
    };

    setSaveStatus(saved: boolean) {
        if (saved) this._saveState.style.visibility = "hidden";
        else this._saveState.style.visibility = "visible";
    }
}

customElements.define("chili-title", Title);
