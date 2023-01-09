// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Control } from "../../control";
import style from "./title.module.css";

export class Title {
    private readonly _documentName: HTMLSpanElement;
    private readonly _appName: HTMLSpanElement;
    private readonly _saveState: HTMLSpanElement;

    constructor(readonly container: HTMLDivElement) {
        this._documentName = Control.span("value.untitled", style.documentName);
        this._appName = Control.span("value.app.name", style.appName);
        this._saveState = Control.textSpan("*", style.savedStatus);
        Control.append(container, this._documentName, this._saveState, this._appName);
        this.setSaveStatus(true);
    }

    setTitle(title: string) {
        this._documentName.textContent = title;
    }

    setSaveStatus(saved: boolean) {
        if (saved) this._saveState.style.visibility = "hidden";
        else this._saveState.style.visibility = "visible";
    }
}
